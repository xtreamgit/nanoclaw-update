/**
 * A Telegram replay inserts the same messages_in id again. That unique
 * violation used to reject the route, so the DM never woke the agent.
 */
import fs from 'fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const actual = await vi.importActual<typeof import('./config.js')>('./config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-test-inbound-id' };
});

import { initTestDb, closeDb, runMigrations, createAgentGroup } from './db/index.js';
import { createSession } from './db/sessions.js';
import { initSessionFolder, writeSessionMessage } from './session-manager.js';
import { inboundDbPath } from './mailbox/sqlite/paths.js';
import type { Session } from './types.js';

const TEST_DIR = '/tmp/nanoclaw-test-inbound-id';
const AG = 'ag-inbound-id';
const SESS = 'sess-inbound-id';

function now(): string {
  return new Date().toISOString();
}

function chat(id: string, text: string) {
  return {
    id,
    kind: 'chat' as const,
    timestamp: now(),
    content: JSON.stringify({ text }),
  };
}

function readRows(): Array<{ id: string; status: string; content: string }> {
  const db = new Database(inboundDbPath(AG, SESS), { readonly: true });
  try {
    return db.prepare('SELECT id, status, content FROM messages_in ORDER BY seq').all() as Array<{
      id: string;
      status: string;
      content: string;
    }>;
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const db = await initTestDb();
  await runMigrations(db);
  await createAgentGroup({
    id: AG,
    name: 'InboundId',
    folder: 'inbound-id',
    agent_provider: null,
    created_at: now(),
  });
  const sess: Session = {
    id: SESS,
    agent_group_id: AG,
    messaging_group_id: null,
    thread_id: null,
    agent_provider: null,
    status: 'active',
    container_status: 'stopped',
    last_active: null,
    created_at: now(),
  };
  await createSession(sess);
  initSessionFolder(AG, SESS);
});

afterEach(async () => {
  await closeDb();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('writeSessionMessage duplicate ids', () => {
  it('keeps one row when the same id arrives again with the same text', async () => {
    const first = await writeSessionMessage(AG, SESS, chat('tg:1', 'hello'));
    const second = await writeSessionMessage(AG, SESS, chat('tg:1', 'hello'));

    expect(first).toBeUndefined();
    expect(second).toEqual({ status: 'duplicate', id: 'tg:1', pending: true });
    expect(readRows()).toHaveLength(1);
  });

  it('stores a new row when the same id arrives with different text', async () => {
    await writeSessionMessage(AG, SESS, chat('tg:1', 'hello'));
    const edited = await writeSessionMessage(AG, SESS, chat('tg:1', 'hello edited'));

    expect(edited?.status).toBe('stored');
    expect(edited && edited.status === 'stored' && edited.id.startsWith('tg:1:')).toBe(true);
    const rows = readRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => JSON.parse(row.content).text)).toEqual(['hello', 'hello edited']);
  });

  it('reports a completed duplicate as not pending', async () => {
    await writeSessionMessage(AG, SESS, chat('tg:1', 'hello'));
    const db = new Database(inboundDbPath(AG, SESS));
    try {
      db.prepare("UPDATE messages_in SET status = 'completed' WHERE id = ?").run('tg:1');
    } finally {
      db.close();
    }

    const again = await writeSessionMessage(AG, SESS, chat('tg:1', 'hello'));
    expect(again).toEqual({ status: 'duplicate', id: 'tg:1', pending: false });
    expect(readRows()).toHaveLength(1);
  });

  it('rethrows a sqlite error that is not a unique violation', async () => {
    fs.writeFileSync(inboundDbPath(AG, SESS), 'not a database');
    await expect(writeSessionMessage(AG, SESS, chat('tg:1', 'hello'))).rejects.toThrow(/not a database/i);
  });
});
