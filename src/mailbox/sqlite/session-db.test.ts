/**
 * Tests for core per-session messages_in schema maintenance.
 *
 * Task-specific DB tests (insertTask, cancel/pause/resume, updateTask,
 * insertRecurrence) live beside the SQLite task implementation.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../log.js';
import type { InboundWrite } from '../model.js';
import {
  ensureSchema,
  getInboundSourceSessionId,
  insertMessage,
  migrateMessagesInTable,
  syncProcessingAcks,
} from './session-db.js';

const TEST_DIR = '/tmp/nanoclaw-session-db-test';
const DB_PATH = path.join(TEST_DIR, 'inbound.db');

afterEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('migrateMessagesInTable', () => {
  it('backfills series_id = id on legacy rows and is idempotent', () => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });

    // Build a legacy inbound.db WITHOUT series_id to simulate a pre-fix install.
    const db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE messages_in (
        id             TEXT PRIMARY KEY,
        seq            INTEGER UNIQUE,
        kind           TEXT NOT NULL,
        timestamp      TEXT NOT NULL,
        status         TEXT DEFAULT 'pending',
        process_after  TEXT,
        recurrence     TEXT,
        tries          INTEGER DEFAULT 0,
        platform_id    TEXT,
        channel_type   TEXT,
        thread_id      TEXT,
        content        TEXT NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO messages_in (id, seq, kind, timestamp, status, content) VALUES (?, ?, 'task', datetime('now'), 'pending', '{}')",
    ).run('legacy-1', 2);

    migrateMessagesInTable(db);
    migrateMessagesInTable(db); // idempotent

    const row = db.prepare('SELECT series_id FROM messages_in WHERE id = ?').get('legacy-1') as {
      series_id: string;
    };
    expect(row.series_id).toBe('legacy-1');
    db.close();
  });

  it('adds source_session_id on a legacy DB, leaves existing rows NULL, is idempotent', () => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });

    const db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE messages_in (
        id             TEXT PRIMARY KEY,
        seq            INTEGER UNIQUE,
        kind           TEXT NOT NULL,
        timestamp      TEXT NOT NULL,
        status         TEXT DEFAULT 'pending',
        process_after  TEXT,
        recurrence     TEXT,
        tries          INTEGER DEFAULT 0,
        platform_id    TEXT,
        channel_type   TEXT,
        thread_id      TEXT,
        content        TEXT NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO messages_in (id, seq, kind, timestamp, status, content) VALUES (?, ?, 'chat', datetime('now'), 'pending', '{}')",
    ).run('legacy-2', 2);

    migrateMessagesInTable(db);
    migrateMessagesInTable(db); // idempotent

    const cols = (db.prepare("PRAGMA table_info('messages_in')").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('source_session_id');

    expect(getInboundSourceSessionId(db, 'legacy-2')).toBeNull();
    expect(getInboundSourceSessionId(db, 'does-not-exist')).toBeNull();
    db.close();
  });
});

describe('syncProcessingAcks — script-skip counter', () => {
  function freshPair() {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    ensureSchema(DB_PATH, 'inbound');
    const outPath = path.join(TEST_DIR, 'outbound.db');
    ensureSchema(outPath, 'outbound');
    return { inDb: new Database(DB_PATH), outDb: new Database(outPath) };
  }

  function seedTask(inDb: InstanceType<typeof Database>, id: string, content: Record<string, unknown>) {
    inDb
      .prepare(
        `INSERT INTO messages_in (id, seq, timestamp, status, tries, kind, content, series_id)
         VALUES (?, 2, datetime('now'), 'processing', 0, 'task', ?, ?)`,
      )
      .run(id, JSON.stringify(content), id);
  }

  function ack(outDb: InstanceType<typeof Database>, id: string, status: string) {
    outDb
      .prepare(
        "INSERT OR REPLACE INTO processing_ack (message_id, status, status_changed) VALUES (?, ?, datetime('now'))",
      )
      .run(id, status);
  }

  const status = (inDb: InstanceType<typeof Database>, id: string) =>
    (inDb.prepare('SELECT status FROM messages_in WHERE id = ?').get(id) as { status: string }).status;

  it('script-skip:error ack lands the row as a FAILED run (streak-derivable history)', () => {
    const { inDb, outDb } = freshPair();
    seedTask(inDb, 't1', { prompt: 'p', script: 'x' });
    ack(outDb, 't1', 'script-skip:error');

    syncProcessingAcks(inDb, outDb);

    expect(status(inDb, 't1')).toBe('failed');
  });

  it('a settled row is terminal — a lingering ack cannot flip failed back to completed', () => {
    const { inDb, outDb } = freshPair();
    seedTask(inDb, 't1', { prompt: 'p', script: 'x' });
    ack(outDb, 't1', 'script-skip:error');
    syncProcessingAcks(inDb, outDb);

    ack(outDb, 't1', 'completed');
    syncProcessingAcks(inDb, outDb);

    expect(status(inDb, 't1')).toBe('failed');
  });

  it('plain completed ack completes the row as before', () => {
    const { inDb, outDb } = freshPair();
    seedTask(inDb, 't1', { prompt: 'p', script: 'x' });
    ack(outDb, 't1', 'completed');

    syncProcessingAcks(inDb, outDb);

    expect(status(inDb, 't1')).toBe('completed');
  });
});

describe('insertMessage id collision', () => {
  function freshInbound(): Database.Database {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    ensureSchema(DB_PATH, 'inbound');
    return new Database(DB_PATH);
  }

  function chat(id: string, content: string): InboundWrite {
    return {
      id,
      kind: 'chat',
      timestamp: '2026-11-08T18:46:33.000Z',
      platformId: 'telegram:42',
      channelType: 'telegram',
      threadId: null,
      content,
      processAfter: null,
      recurrence: null,
    };
  }

  const rows = (db: Database.Database) =>
    db.prepare('SELECT id, seq, status, content, series_id FROM messages_in ORDER BY seq').all() as Array<{
      id: string;
      seq: number;
      status: string;
      content: string;
      series_id: string;
    }>;

  it('keeps the existing row when the same id is redelivered with the same content', () => {
    const db = freshInbound();
    const message = chat('tg-1:ag-1', '{"text":"hello"}');
    insertMessage(db, message, 2);
    db.prepare("UPDATE messages_in SET status = 'completed' WHERE id = ?").run(message.id);

    insertMessage(db, { ...message, timestamp: '2026-11-08T18:47:00.000Z' }, 4);

    expect(rows(db)).toEqual([
      {
        id: 'tg-1:ag-1',
        seq: 2,
        status: 'completed',
        content: '{"text":"hello"}',
        series_id: 'tg-1:ag-1',
      },
    ]);
    db.close();
  });

  it('stores different content under a new id and logs both ids', () => {
    const db = freshInbound();
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    insertMessage(db, chat('tg-1:ag-1', '{"text":"hello"}'), 2);

    insertMessage(db, chat('tg-1:ag-1', '{"text":"the new text"}'), 4);

    expect(rows(db)).toEqual([
      {
        id: 'tg-1:ag-1',
        seq: 2,
        status: 'pending',
        content: '{"text":"hello"}',
        series_id: 'tg-1:ag-1',
      },
      {
        id: 'tg-1:ag-1#2',
        seq: 4,
        status: 'pending',
        content: '{"text":"the new text"}',
        series_id: 'tg-1:ag-1#2',
      },
    ]);
    expect(warn).toHaveBeenCalledWith('Inbound id collided with different content; stored under a new id', {
      collidingId: 'tg-1:ag-1',
      newId: 'tg-1:ag-1#2',
    });

    // Redelivery of the rewritten text is a no-op, not another row.
    insertMessage(db, chat('tg-1:ag-1', '{"text":"the new text"}'), 6);
    expect(rows(db)).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);

    insertMessage(db, chat('tg-1:ag-1', '{"text":"a third text"}'), 6);
    expect(rows(db).map((row) => row.id)).toEqual(['tg-1:ag-1', 'tg-1:ag-1#2', 'tg-1:ag-1#3']);
    warn.mockRestore();
    db.close();
  });

  it('rethrows SQLite errors that are not a messages_in.id conflict', () => {
    const db = freshInbound();
    insertMessage(db, chat('tg-1:ag-1', '{"text":"hello"}'), 2);

    expect(() => insertMessage(db, chat('tg-2:ag-1', '{"text":"other"}'), 2)).toThrow(
      /UNIQUE constraint failed: messages_in\.seq/,
    );
    expect(rows(db)).toHaveLength(1);

    db.exec('DROP TABLE messages_in');
    expect(() => insertMessage(db, chat('tg-3:ag-1', '{"text":"dropped"}'), 4)).toThrow(/no such table/i);
    db.close();
  });
});
