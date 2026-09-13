export async function fetchAshby(token) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=false`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'jobhunt/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ashby ${token}: HTTP ${res.status}`);
  const { jobs = [] } = await res.json();
  return jobs.map((j) => ({
    source: 'ashby',
    external_id: String(j.id),
    title: j.title,
    location: j.location ?? null,
    url: j.jobUrl,
    department: j.department ?? j.team ?? null,
    description: j.descriptionPlain ?? '',
    posted_at: j.publishedAt ?? null,
  }));
}
