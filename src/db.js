import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'jobs.db');

fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = DELETE');

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  company       TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  title         TEXT NOT NULL,
  location      TEXT,
  url           TEXT NOT NULL,
  department    TEXT,
  description   TEXT,
  posted_at     TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  score         INTEGER DEFAULT 0,
  track         TEXT,
  reject_reason TEXT,
  status        TEXT DEFAULT 'new',
  notified_at   TEXT,
  applied_at    TEXT,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_score  ON jobs(score DESC);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// Refreshes everything that can legitimately change on a re-fetch. Deliberately
// omits status, applied_at, notes, first_seen_at, notified_at from the SET
// clause so a re-run can never wipe application history.
const upsertStmt = db.prepare(`
  INSERT INTO jobs (
    id, source, company, external_id, title, location, url, department,
    description, posted_at, first_seen_at, last_seen_at, score, track, reject_reason
  ) VALUES (
    @id, @source, @company, @external_id, @title, @location, @url, @department,
    @description, @posted_at, @first_seen_at, @last_seen_at, @score, @track, @reject_reason
  )
  ON CONFLICT(id) DO UPDATE SET
    source        = excluded.source,
    company       = excluded.company,
    external_id   = excluded.external_id,
    title         = excluded.title,
    location      = excluded.location,
    url           = excluded.url,
    department    = excluded.department,
    description   = excluded.description,
    posted_at     = excluded.posted_at,
    last_seen_at  = excluded.last_seen_at,
    score         = excluded.score,
    track         = excluded.track,
    reject_reason = excluded.reject_reason
`);

export function upsertJob(job) {
  const existed = db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(job.id);
  upsertStmt.run({
    score: 0,
    track: null,
    reject_reason: null,
    location: null,
    department: null,
    description: null,
    posted_at: null,
    ...job,
  });
  return !existed;
}

export function getPendingDigest(limit) {
  return db
    .prepare(
      `SELECT * FROM jobs WHERE status = 'new' AND reject_reason IS NULL ORDER BY score DESC LIMIT ?`
    )
    .all(limit);
}

export function markNotified(ids) {
  if (!ids || ids.length === 0) return;
  const now = new Date().toISOString();
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(
    `UPDATE jobs SET status = 'notified', notified_at = ? WHERE id IN (${placeholders})`
  ).run(now, ...ids);
}

// A pending job that a successfully-fetched company didn't return this run has
// been taken down (or aged past the fetcher's pre-filter), so keep it out of
// the digest. Companies whose fetch failed are left alone.
export function markDelisted(companies, seenSince) {
  if (!companies || companies.length === 0) return 0;
  const placeholders = companies.map(() => '?').join(',');
  return db
    .prepare(
      `UPDATE jobs SET reject_reason = 'no longer listed'
       WHERE status = 'new' AND reject_reason IS NULL AND last_seen_at < ? AND company IN (${placeholders})`
    )
    .run(seenSince, ...companies).changes;
}

export function setStatus(id, status) {
  if (status === 'applied') {
    db.prepare(`UPDATE jobs SET status = ?, applied_at = ? WHERE id = ?`).run(
      status,
      new Date().toISOString(),
      id
    );
  } else {
    db.prepare(`UPDATE jobs SET status = ? WHERE id = ?`).run(status, id);
  }
}

export function getMeta(key) {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key);
  return row ? row.value : null;
}

export function setMeta(key, value) {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}
