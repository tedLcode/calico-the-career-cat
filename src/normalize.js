import crypto from 'node:crypto';

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

export function stripHtml(html) {
  if (!html) return '';
  let text = html;
  for (const [entity, char] of Object.entries(ENTITIES)) {
    text = text.split(entity).join(char);
  }
  text = text.replace(/<[^>]*>/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, 8000);
}

export function makeId(source, company, externalId) {
  return crypto
    .createHash('sha1')
    .update(`${source}|${company}|${externalId}`)
    .digest('hex');
}
