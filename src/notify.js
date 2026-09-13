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

function relativeDate(iso) {
  if (!iso) return 'date unknown';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months <= 1 ? '1 month ago' : `${months} months ago`;
}

async function telegramPost(method, body) {
  const res = await fetch(`${apiBase()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function processCallbacks() {
  const offset = Number(getMeta('tg_offset') ?? 0);
  const res = await fetch(`${apiBase()}/getUpdates?offset=${offset}&timeout=0`);
  const data = await res.json();
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
  const capped = jobs.slice(0, 10);
  const ids = [];

  for (const job of capped) {
    const text = [
      `*${escapeMdV2(job.title)}*`,
      `${escapeMdV2(job.company)} · ${escapeMdV2(job.location || 'Unknown')}`,
      `${escapeMdV2(job.track)} · score ${escapeMdV2(job.score)} · ${escapeMdV2(relativeDate(job.posted_at))}`,
    ].join('\n');

    const result = await telegramPost('sendMessage', {
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

    if (result.ok) ids.push(job.id);
    await sleep(350);
  }

  if (jobs.length > capped.length) {
    await sendText(`+${jobs.length - capped.length} more in the queue`);
  }

  if (ids.length) markNotified(ids);
  return ids;
}

export async function sendText(msg) {
  await telegramPost('sendMessage', { chat_id: chatId(), text: msg });
}
