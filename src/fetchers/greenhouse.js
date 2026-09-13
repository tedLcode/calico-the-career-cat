import { stripHtml } from '../normalize.js';

export async function fetchGreenhouse(token) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'jobhunt/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`greenhouse ${token}: HTTP ${res.status}`);
  const { jobs = [] } = await res.json();
  return jobs.map((j) => ({
    source: 'greenhouse',
    external_id: String(j.id),
    title: j.title,
    location: j.location?.name ?? null,
    url: j.absolute_url,
    department: j.departments?.[0]?.name ?? null,
    description: stripHtml(j.content ?? ''),
    posted_at: j.updated_at ?? null,
  }));
}
