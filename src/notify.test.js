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

test('sendDigest caps at 10, sends an overflow notice, and escapes MarkdownV2 special characters', async () => {
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
      // 10 digest messages + 1 overflow "+2 more" message
      assert.equal(sendMessageCalls.length, 11);
      assert.equal(ids.length, 10);

      const firstBody = JSON.parse(sendMessageCalls[0].options.body);
      const firstLine = firstBody.text.split('\n')[0];
      assert.equal(firstLine, '*C\\+\\+ Engineer \\(Fintech\\)\\! \\[urgent\\]*');

      const overflowBody = JSON.parse(sendMessageCalls[10].options.body);
      assert.equal(overflowBody.text, '+2 more in the queue');
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
