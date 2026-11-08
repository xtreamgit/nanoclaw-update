/**
 * A channel redelivery reuses messages_in.id (`${platformMessageId}:${agentGroupId}`).
 * That used to throw UNIQUE constraint failed: messages_in.id out of insertMessage,
 * and routeInbound rejected — index.ts logged "Failed to route inbound message"
 * and the new text was never stored.
 *
 * Same content keeps the existing row and routing still succeeds. Different
 * content is stored under a new id, both ids are logged, and routing succeeds.
 */
import fs from 'fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./container-runner.js', () => ({
  wakeContainer: vi.fn().mockResolvedValue(true),
  isContainerRunning: vi.fn().mockReturnValue(false),
  getActiveContainerCount: vi.fn().mockReturnValue(0),
  killContainer: vi.fn(),
}));

vi.mock('./config.js', async () => {
  const actual = await vi.importActual('./config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-test-inbound-id-collision' };
});

import { initChannelAdapters, registerChannelAdapter, teardownChannelAdapters } from './channels/channel-registry.js';
import type { ChannelAdapter, ChannelDefaults } from './channels/adapter.js';
import {
  closeDb,
  createAgentGroup,
  createMessagingGroup,
  createMessagingGroupAgent,
  initTestDb,
  runMigrations,
} from './db/index.js';
import { findSessionForAgent } from './db/sessions.js';
import { log } from './log.js';
import { inboundDbPath } from './mailbox/sqlite/paths.js';
import { routeInbound } from './router.js';

const TEST_DIR = '/tmp/nanoclaw-test-inbound-id-collision';

const channelDefaults: ChannelDefaults = {
  dm: { engageMode: 'pattern', engagePattern: '.', threads: true, unknownSenderPolicy: 'public' },
  group: { engageMode: 'mention-sticky', threads: true, unknownSenderPolicy: 'request_approval' },
  mentions: 'platform',
};

function makeAdapter(): ChannelAdapter {
  return {
    name: 'telegram',
    channelType: 'telegram',
    supportsThreads: true,
    defaults: channelDefaults,
    setup: async () => {},
    teardown: async () => {},
    isConnected: () => true,
    deliver: async () => undefined,
  };
}

function content(text: string): string {
  return JSON.stringify({ sender: 'Alex', senderId: 'telegram:1', text });
}

async function inbound(id: string, text: string): Promise<void> {
  await routeInbound({
    channelType: 'telegram',
    platformId: 'telegram:42',
    threadId: null,
    message: {
      id,
      kind: 'chat-sdk',
      content: content(text),
      timestamp: '2026-11-08T18:46:33.000Z',
      isMention: true,
      isGroup: false,
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function inboundRows(): Promise<Array<{ id: string; content: string; status: string }>> {
  const session = await findSessionForAgent('ag-1', 'mg-1', null);
  expect(session).toBeDefined();
  const db = new Database(inboundDbPath('ag-1', session!.id), { readonly: true });
  try {
    return db.prepare('SELECT id, content, status FROM messages_in ORDER BY seq').all() as Array<{
      id: string;
      content: string;
      status: string;
    }>;
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  await runMigrations(await initTestDb());
  registerChannelAdapter('telegram', { factory: () => makeAdapter(), defaults: channelDefaults });
  await initChannelAdapters(() => ({
    onInbound: () => {},
    onInboundEvent: () => {},
    onMetadata: () => {},
    onAction: () => {},
  }));
  await createAgentGroup({
    id: 'ag-1',
    name: 'Test Agent',
    folder: 'test-agent',
    agent_provider: null,
    created_at: '2026-11-08T18:00:00.000Z',
  });
  await createMessagingGroup({
    id: 'mg-1',
    channel_type: 'telegram',
    platform_id: 'telegram:42',
    instance: 'telegram',
    name: 'Alex',
    is_group: 0,
    unknown_sender_policy: 'public',
    created_at: '2026-11-08T18:00:00.000Z',
  });
  await createMessagingGroupAgent({
    id: 'mga-1',
    messaging_group_id: 'mg-1',
    agent_group_id: 'ag-1',
    engage_mode: 'pattern',
    engage_pattern: '.',
    sender_scope: 'all',
    ignored_message_policy: 'drop',
    session_mode: 'shared',
    priority: 0,
    threads: 1,
    created_at: '2026-11-08T18:00:00.000Z',
  });
});

afterEach(async () => {
  await teardownChannelAdapters();
  await closeDb();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('routeInbound when messages_in.id collides', () => {
  it('treats a same-content redelivery as a successful route and keeps one row', async () => {
    const info = vi.spyOn(log, 'info');
    await inbound('tg-46', 'hello');
    await inbound('tg-46', 'hello');

    const stored = await inboundRows();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('tg-46:ag-1');
    expect(JSON.parse(stored[0].content).text).toBe('hello');
    expect(info.mock.calls.filter((call) => call[0] === 'Message routed')).toHaveLength(2);
    info.mockRestore();
  });

  it('stores different content under a new id, logs both ids, and still routes', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(log, 'info');
    await inbound('tg-46', 'hello');
    await inbound('tg-46', 'the new text');

    const stored = await inboundRows();
    expect(stored.map((row) => row.id)).toEqual(['tg-46:ag-1', 'tg-46:ag-1#2']);
    expect(JSON.parse(stored[0].content).text).toBe('hello');
    expect(JSON.parse(stored[1].content).text).toBe('the new text');
    expect(stored[1].status).toBe('pending');
    expect(warn).toHaveBeenCalledWith('Inbound id collided with different content; stored under a new id', {
      collidingId: 'tg-46:ag-1',
      newId: 'tg-46:ag-1#2',
    });
    expect(info.mock.calls.filter((call) => call[0] === 'Message routed')).toHaveLength(2);
    warn.mockRestore();
    info.mockRestore();
  });
});
