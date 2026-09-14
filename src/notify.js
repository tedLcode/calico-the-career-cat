import { getMeta, setMeta, setStatus, markNotified } from './db.js';

const MDV2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!]/g;

function escapeMdV2(text) {
  return String(text ?? '').replace(MDV2_SPECIAL, '\\$&');
}

function apiBase() {
  return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
}

function chatId() {
  return process.env.TELEGRAM_CHAT_ID;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageGapMs() {
  return Number(process.env.TELEGRAM_MESSAGE_GAP_MS ?? 1100);
}

function retryBaseMs() {
  return Number(process.env.TELEGRAM_RETRY_BASE_MS ?? 2000);
}

function relativeDate(iso) {
  if (!iso) return 'date unknown';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months <= 1 ? '1 month ago' : `${months} months ago`;
}

// Network-level failures (connection reset, timeout, DNS) come back as a
// normal failed result instead of throwing, so one dropped connection can't
// abort the whole run.
async function telegramPost(method, body) {
  try {
    const res = await fetch(`${apiBase()}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error_code: 'NETWORK', description: err.cause?.code ?? err.message };
  }
}

// Telegram allows roughly one message per second per chat; bursts beyond that
// get a 429 with retry_after. Network drops get a short backoff too.
async function telegramPostWithRetry(method, body, attempts = 3) {
  let result = await telegramPost(method, body);
  for (let i = 1; i < attempts && !result.ok && (result.error_code === 429 || result.error_code === 'NETWORK'); i++) {
    const waitMs = result.error_code === 429 ? (result.parameters?.retry_after ?? 5) * 1000 + 500 : retryBaseMs() * i;
    await sleep(waitMs);
    result = await telegramPost(method, body);
  }
  return result;
}

export async function processCallbacks() {
  const offset = Number(getMeta('tg_offset') ?? 0);
  let data;
  try {
    const res = await fetch(`${apiBase()}/getUpdates?offset=${offset}&timeout=0`, { signal: AbortSignal.timeout(20000) });
    data = await res.json();
  } catch (err) {
    console.log(`WARN  Telegram unreachable, button presses will be applied next run: ${err.cause?.code ?? err.message}`);
    return;
  }
  if (!data.ok) return;

  let maxUpdateId = offset - 1;
  for (const update of data.result) {
    maxUpdateId = Math.max(maxUpdateId, update.update_id);

    const cb = update.callback_query;
    if (!cb || !cb.data) continue;
    const [action, jobId] = cb.data.split(':');
    if (!jobId || (action !== 'a' && action !== 's')) continue;

    setStatus(jobId, action === 'a' ? 'applied' : 'skipped');
    await telegramPost('answerCallbackQuery', { callback_query_id: cb.id });

    const prefix = action === 'a' ? '✅ ' : '⏭ ';
    await telegramPost('editMessageText', {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text: prefix + cb.message.text,
    });
  }

  setMeta('tg_offset', String(maxUpdateId + 1));
}

export async function sendDigest(jobs) {
  const ids = [];
  if (jobs.length === 0) return ids;

  const chennaiCount = jobs.filter((j) => (j.location || '').toLowerCase().includes('chennai')).length;
  await sendText(`📬 ${jobs.length} new job${jobs.length === 1 ? '' : 's'} · ${chennaiCount} in Chennai`);

  let networkFailuresInARow = 0;
  for (const job of jobs) {
    const text = [
      `*${escapeMdV2(job.title)}*`,
      `${escapeMdV2(job.company)} · ${escapeMdV2(job.location || 'Unknown')}`,
      `${escapeMdV2(job.track)} · score ${escapeMdV2(job.score)} · ${escapeMdV2(relativeDate(job.posted_at))}`,
    ].join('\n');

    const result = await telegramPostWithRetry('sendMessage', {
      chat_id: chatId(),
      text,
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Open', url: job.url }],
          [
            { text: '✅ Applied', callback_data: `a:${job.id}` },
            { text: '⏭ Skip', callback_data: `s:${job.id}` },
          ],
        ],
      },
    });

    if (result.ok) {
      // Marked one at a time so a failure partway through can't cause the
      // already-delivered jobs to be sent again next run.
      markNotified([job.id]);
      ids.push(job.id);
      networkFailuresInARow = 0;
    } else if (result.error_code === 'NETWORK' && ++networkFailuresInARow >= 2) {
      console.log(`WARN  Telegram unreachable (${result.description}); ${jobs.length - ids.length} jobs stay queued for next run`);
      break;
    }
    await sleep(messageGapMs());
  }

  return ids;
}

export async function sendText(msg) {
  return telegramPostWithRetry('sendMessage', { chat_id: chatId(), text: msg });
}
