import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { scoreJob } from './score.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));

function job(overrides) {
  return {
    title: 'Data Engineer',
    location: 'Chennai',
    description: '',
    posted_at: null,
    ...overrides,
  };
}

test('clean DE match scores and tags DE', () => {
  const { score, track, reject_reason } = scoreJob(
    job({
      title: 'Data Engineer',
      location: 'Chennai, India',
      description: 'You will build ETL pipelines using Python, SQL, PostgreSQL and AWS. 0-1 years experience required.',
    }),
    config
  );
  assert.equal(reject_reason, null);
  assert.equal(track, 'DE');
  assert.ok(score >= 60, `expected a strong DE score, got ${score}`);
});

test('clean SWE match scores and tags SWE', () => {
  const { score, track, reject_reason } = scoreJob(
    job({
      title: 'Software Engineer I',
      location: 'Bengaluru',
      description: 'Backend role building REST APIs in Java and Python with PostgreSQL. 0-1 years experience.',
    }),
    config
  );
  assert.equal(reject_reason, null);
  assert.equal(track, 'SWE');
  assert.ok(score > 0);
});

test('senior title is hard-rejected', () => {
  const { reject_reason, track } = scoreJob(
    job({ title: 'Senior Data Engineer', location: 'Chennai' }),
    config
  );
  assert.ok(reject_reason);
  assert.equal(track, 'NONE');
});

test('mandatory experience above ceiling is hard-rejected', () => {
  const { reject_reason } = scoreJob(
    job({
      title: 'Data Engineer',
      location: 'Chennai',
      description: 'Requires 3+ years of experience with Python and SQL.',
    }),
    config
  );
  assert.ok(reject_reason);
  assert.match(reject_reason, /experience/);
});

test('"1-2 years preferred" wording does not get rejected', () => {
  const { reject_reason } = scoreJob(
    job({
      title: 'Data Engineer',
      location: 'Chennai',
      description: '1-2 years preferred but fresh graduates with strong fundamentals are encouraged to apply.',
    }),
    config
  );
  assert.equal(reject_reason, null);
});

test('location outside the allowed list is rejected', () => {
  const { reject_reason } = scoreJob(
    job({ title: 'Data Engineer', location: 'Mumbai, India' }),
    config
  );
  assert.ok(reject_reason);
  assert.match(reject_reason, /location/);
});

test('India-based remote passes', () => {
  const { reject_reason } = scoreJob(
    job({ title: 'Data Engineer', location: 'Remote - India' }),
    config
  );
  assert.equal(reject_reason, null);
});

test('remote outside India is rejected', () => {
  const { reject_reason } = scoreJob(
    job({ title: 'Data Engineer', location: 'Remote - Turkey' }),
    config
  );
  assert.ok(reject_reason);
  assert.match(reject_reason, /location/);
});

test('unqualified "Remote" with no country is rejected', () => {
  const { reject_reason } = scoreJob(
    job({ title: 'Data Engineer', location: 'Remote' }),
    config
  );
  assert.ok(reject_reason);
  assert.match(reject_reason, /location/);
});

test('title matching both DE and SWE keyword sets tags BOTH', () => {
  const { track } = scoreJob(
    job({ title: 'Data Engineer / Software Engineer', location: 'Chennai' }),
    config
  );
  assert.equal(track, 'BOTH');
});

test('Data Engineer II requiring 3+ years mandatory is rejected on experience, not title', () => {
  const { reject_reason } = scoreJob(
    job({
      title: 'Data Engineer II',
      location: 'Chennai',
      description: 'Minimum 3 years of experience required.',
    }),
    config
  );
  assert.ok(reject_reason);
  assert.match(reject_reason, /experience/);
});

test('Data Engineer II accepting 0-2 years passes since title itself is not hard-rejected', () => {
  const { reject_reason, track } = scoreJob(
    job({
      title: 'Data Engineer II',
      location: 'Chennai',
      description: '0-2 years of experience with Python and SQL.',
    }),
    config
  );
  assert.equal(reject_reason, null);
  assert.equal(track, 'DE');
});
