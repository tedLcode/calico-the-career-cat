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

test('level II title is rejected even when the JD says 0-2 years', () => {
  const { reject_reason, track } = scoreJob(
    job({
      title: 'Data Engineer II',
      location: 'Chennai',
      description: '0-2 years of experience with Python and SQL.',
    }),
    config
  );
  assert.match(reject_reason, /not an entry-level role/);
  assert.equal(track, 'NONE');
});

test('numeric and roman level titles above I are rejected', () => {
  for (const title of ['SDE-2', 'SDE 2', 'Software Engineer 2', 'Software Engineer III', 'Data Engineer IV']) {
    const { reject_reason } = scoreJob(job({ title, location: 'Chennai' }), config);
    assert.ok(reject_reason, `${title} should be rejected`);
  }
});

test('entry-level titles are not caught by the level filter', () => {
  for (const title of ['SDE-1', 'Software Engineer I', 'Data Engineer 1', 'Associate Data Engineer', 'Graduate Software Engineer 2026']) {
    const { reject_reason } = scoreJob(job({ title, location: 'Chennai' }), config);
    assert.equal(reject_reason, null, `${title} should pass`);
  }
});

test('Member of Technical Staff is treated as an entry band, but Staff Engineer is not', () => {
  const mts = scoreJob(job({ title: 'Member of Technical Staff', location: 'Chennai' }), config);
  assert.equal(mts.reject_reason, null);
  assert.equal(mts.track, 'SWE');
  for (const title of ['Staff Software Engineer', 'Senior Member of Technical Staff']) {
    assert.ok(scoreJob(job({ title, location: 'Chennai' }), config).reject_reason, `${title} should be rejected`);
  }
});

test('intermediate-level titles are rejected', () => {
  const { reject_reason } = scoreJob(job({ title: 'Data Engineer - Intermediate', location: 'Chennai' }), config);
  assert.ok(reject_reason);
});

test('bank corporate titles above entry level are rejected', () => {
  for (const title of ['Cloud Platform Engineer - Azure, Officer', 'Data Engineer - Assistant Vice President']) {
    assert.ok(scoreJob(job({ title, location: 'Chennai' }), config).reject_reason, `${title} should be rejected`);
  }
});

test('hardware qualification roles are treated as off-profile', () => {
  const { reject_reason } = scoreJob(job({ title: 'Member of Technical Staff - Drive Qual', location: 'Chennai' }), config);
  assert.match(reject_reason ?? '', /outside DE\/backend profile/);
});

test('"intern" only matches internships, not words like internal', () => {
  const internal = scoreJob(job({ title: 'Software Engineer - Internal Tools', location: 'Chennai' }), config);
  assert.equal(internal.reject_reason, null);
  const intern = scoreJob(job({ title: 'Data Engineering Intern', location: 'Chennai' }), config);
  assert.ok(intern.reject_reason);
});

test('Chennai outranks another allowed city for the same job', () => {
  const base = { title: 'Data Engineer', description: 'Python, SQL, AWS and ETL pipelines.' };
  const chennai = scoreJob(job({ ...base, location: 'Chennai, India' }), config);
  const bengaluru = scoreJob(job({ ...base, location: 'Bengaluru, India' }), config);
  assert.ok(chennai.score > bengaluru.score, `chennai=${chennai.score} bengaluru=${bengaluru.score}`);
});

test('entry-level title earns a bonus over a plain title', () => {
  const plain = scoreJob(job({ title: 'Data Engineer', location: 'Hyderabad' }), config);
  const entry = scoreJob(job({ title: 'Associate Data Engineer', location: 'Hyderabad' }), config);
  assert.ok(entry.score > plain.score, `entry=${entry.score} plain=${plain.score}`);
});

test('posting older than the 7-day cutoff is rejected', () => {
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
  const { reject_reason } = scoreJob(
    job({ title: 'Data Engineer', location: 'Chennai', posted_at: tenDaysAgo }),
    config
  );
  assert.ok(reject_reason);
  assert.match(reject_reason, /days ago/);
});

test('posting within the 7-day cutoff is not rejected', () => {
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
  const { reject_reason } = scoreJob(
    job({ title: 'Data Engineer', location: 'Chennai', posted_at: twoDaysAgo }),
    config
  );
  assert.equal(reject_reason, null);
});

test('unknown posting date is not rejected', () => {
  const { reject_reason } = scoreJob(
    job({ title: 'Data Engineer', location: 'Chennai', posted_at: null }),
    config
  );
  assert.equal(reject_reason, null);
});

test('non-engineering title is rejected even with Chennai, entry-level and tier bonuses', () => {
  const { reject_reason } = scoreJob(
    job({
      title: 'Associate Customer Support Specialist',
      location: 'Chennai',
      tier: 1,
      posted_at: new Date().toISOString(),
    }),
    config
  );
  assert.match(reject_reason, /not a DE\/SWE role/);
});

test('off-profile engineering titles are rejected', () => {
  for (const title of [
    'Software Engineer (iOS)',
    'Software Engineer - SAP ABAP',
    'Frontend Software Engineer',
    'Software Engineer - Embedded',
  ]) {
    const { reject_reason } = scoreJob(job({ title, location: 'Chennai' }), config);
    assert.match(reject_reason ?? '', /outside DE\/backend profile/, `${title} should be rejected`);
  }
});

test('a SWIFT payments engineering title is not treated as off-profile', () => {
  const { reject_reason } = scoreJob(job({ title: 'Software Engineer - SWIFT Payments', location: 'Chennai' }), config);
  assert.equal(reject_reason, null);
});
