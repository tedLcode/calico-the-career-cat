import test from 'node:test';
import assert from 'node:assert/strict';
import { getMeta, setMeta, db } from './db.js';
import { processCallbacks, sendDigest } from './notify.js';

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_CHAT_ID = 'test-chat';

function withMockFetch(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options, calls.length - 1);
  };
  return fn(calls).finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(body) {
  return { json: async () => body };
}

test('processCallbacks applies a status change from a callback_query and advances the offset', async () => {
  const originalOffset = getMeta('tg_offset');
  setMeta('tg_offset', '100'); // known baseline, independent of any real leftover offset
  const testJobId = 'test-notify-job-1';
  db.prepare(
    `INSERT INTO jobs (id, source, company, external_id, title, url, first_seen_at, last_seen_at, status)
     VALUES (?, 'greenhouse', 'TestCo', 'ext-1', 'Test Job', 'https://example.com', datetime('now'), datetime('now'), 'notified')`
  ).run(testJobId);

  try {
    await withMockFetch(
      (url) => {
        if (url.includes('getUpdates')) {
          return jsonResponse({
            ok: true,
            result: [
              {
                update_id: 500,
                callback_query: {
                  id: 'cbid1',
                  data: `a:${testJobId}`,
                  message: { chat: { id: 1 }, message_id: 42, text: 'Test Job' },
                },
              },
            ],
          });
        }
        return jsonResponse({ ok: true });
      },
      async (calls) => {
        await processCallbacks();

        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(testJobId);
        assert.equal(job.status, 'applied');
        assert.ok(job.applied_at);
        assert.equal(getMeta('tg_offset'), '501');

        const methods = calls.map((c) => c.url.split('/').pop().split('?')[0]);
        assert.ok(methods.includes('answerCallbackQuery'));
        assert.ok(methods.includes('editMessageText'));
      }
    );
  } finally {
    db.prepare('DELETE FROM jobs WHERE id = ?').run(testJobId);
    if (originalOffset === null) {
      db.prepare('DELETE FROM meta WHERE key = ?').run('tg_offset');
    } else {
      setMeta('tg_offset', originalOffset);
    }
  }
});

test('sendDigest sends every job after a header, and escapes MarkdownV2 special characters', async () => {
  process.env.TELEGRAM_MESSAGE_GAP_MS = '0';
  const jobs = Array.from({ length: 12 }, (_, i) => ({
    id: `job-${i}`,
    title: i === 0 ? 'C++ Engineer (Fintech)! [urgent]' : `Job ${i}`,
    company: 'Test.Co',
    location: 'Chennai',
    track: 'DE',
    score: 80,
    url: 'https://example.com',
    posted_at: new Date().toISOString(),
  }));

  await withMockFetch(
    () => jsonResponse({ ok: true }),
    async (calls) => {
      const ids = await sendDigest(jobs);

      const sendMessageCalls = calls.filter((c) => c.url.includes('sendMessage'));
      // 1 header + one message per job — no cap
      assert.equal(sendMessageCalls.length, 13);
      assert.equal(ids.length, 12);

      const header = JSON.parse(sendMessageCalls[0].options.body);
      assert.equal(header.text, '📬 12 new jobs · 12 in Chennai');

      const firstJobBody = JSON.parse(sendMessageCalls[1].options.body);
      const firstLine = firstJobBody.text.split('\n')[0];
      assert.equal(firstLine, '*C\\+\\+ Engineer \\(Fintech\\)\\! \\[urgent\\]*');
    }
  );
});

test('sendDigest retries after a Telegram 429 instead of dropping the job', async () => {
  process.env.TELEGRAM_MESSAGE_GAP_MS = '0';
  let jobSends = 0;

  await withMockFetch(
    (url, options) => {
      const body = JSON.parse(options.body);
      if (!body.reply_markup) return jsonResponse({ ok: true }); // header message
      jobSends++;
      return jsonResponse(
        jobSends === 1 ? { ok: false, error_code: 429, parameters: { retry_after: 0 } } : { ok: true }
      );
    },
    async () => {
      const ids = await sendDigest([
        {
          id: 'job-429',
          title: 'Retry Job',
          company: 'Test.Co',
          location: 'Chennai',
          track: 'DE',
          score: 80,
          url: 'https://example.com',
          posted_at: new Date().toISOString(),
        },
      ]);
      assert.deepEqual(ids, ['job-429']);
      assert.equal(jobSends, 2);
    }
  );
});

test('sendDigest does not mark a job notified if the Telegram send fails', async () => {
  const jobs = [
    {
      id: 'job-fail',
      title: 'Failing Job',
      company: 'Test.Co',
      location: 'Chennai',
      track: 'DE',
      score: 80,
      url: 'https://example.com',
      posted_at: new Date().toISOString(),
    },
  ];

  await withMockFetch(
    () => jsonResponse({ ok: false, error_code: 401, description: 'Unauthorized' }),
    async () => {
      const ids = await sendDigest(jobs);
      assert.deepEqual(ids, []);
    }
  );
});

function testJob(id) {
  return {
    id,
    title: 'Network Job',
    company: 'Test.Co',
    location: 'Chennai',
    track: 'DE',
    score: 80,
    url: 'https://example.com',
    posted_at: new Date().toISOString(),
  };
}

test('sendDigest retries a dropped connection instead of crashing', async () => {
  process.env.TELEGRAM_MESSAGE_GAP_MS = '0';
  process.env.TELEGRAM_RETRY_BASE_MS = '0';
  let jobSends = 0;

  await withMockFetch(
    (url, options) => {
      const body = JSON.parse(options.body);
      if (!body.reply_markup) return jsonResponse({ ok: true }); // header message
      jobSends++;
      if (jobSends === 1) throw new TypeError('fetch failed'); // simulated ECONNRESET
      return jsonResponse({ ok: true });
    },
    async () => {
      const ids = await sendDigest([testJob('job-net-1')]);
      assert.deepEqual(ids, ['job-net-1']);
      assert.equal(jobSends, 2);
    }
  );
});

test('sendDigest stops cleanly and keeps jobs queued when Telegram stays unreachable', async () => {
  process.env.TELEGRAM_MESSAGE_GAP_MS = '0';
  process.env.TELEGRAM_RETRY_BASE_MS = '0';
  let attempts = 0;

  await withMockFetch(
    () => {
      attempts++;
      throw new TypeError('fetch failed');
    },
    async () => {
      const ids = await sendDigest([testJob('job-net-a'), testJob('job-net-b'), testJob('job-net-c'), testJob('job-net-d')]);
      assert.deepEqual(ids, []);
      // header (3 tries) + two jobs (3 tries each), then it gives up instead of hammering the rest
      assert.equal(attempts, 9);
    }
  );
});

test('processCallbacks does not crash the run when Telegram is unreachable', async () => {
  const before = getMeta('tg_offset');
  await withMockFetch(
    () => {
      throw new TypeError('fetch failed');
    },
    async () => {
      await processCallbacks();
      assert.equal(getMeta('tg_offset'), before);
    }
  );
});
