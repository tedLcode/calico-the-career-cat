import test from 'node:test';
import assert from 'node:assert/strict';
import { db, upsertJob, markDelisted } from './db.js';

test('markDelisted flags pending jobs that a successfully-fetched company no longer lists', () => {
  const old = '2026-01-01T00:00:00.000Z';
  const runStart = new Date(Date.now() - 1000).toISOString();
  const fresh = new Date().toISOString();
  const base = { source: 'greenhouse', title: 'Data Engineer', url: 'https://example.com', first_seen_at: old };

  try {
    upsertJob({ ...base, id: 'test-delisted-gone', company: 'TestCoA', external_id: '1', last_seen_at: old });
    upsertJob({ ...base, id: 'test-delisted-seen', company: 'TestCoA', external_id: '2', last_seen_at: fresh });
    upsertJob({ ...base, id: 'test-delisted-failed', company: 'TestCoB', external_id: '3', last_seen_at: old });

    const changed = markDelisted(['TestCoA'], runStart);
    const reason = (id) => db.prepare('SELECT reject_reason FROM jobs WHERE id = ?').get(id).reject_reason;

    assert.equal(changed, 1);
    assert.equal(reason('test-delisted-gone'), 'no longer listed');
    assert.equal(reason('test-delisted-seen'), null);
    assert.equal(reason('test-delisted-failed'), null); // TestCoB's fetch "failed", so it's untouched
  } finally {
    db.prepare("DELETE FROM jobs WHERE id LIKE 'test-delisted-%'").run();
  }
});
