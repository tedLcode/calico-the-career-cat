export async function fetchLever(token) {
  const url = `https://api.lever.co/v0/postings/${token}?mode=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'jobhunt/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`lever ${token}: HTTP ${res.status}`);
  const postings = await res.json();
  return postings.map((p) => ({
    source: 'lever',
    external_id: String(p.id),
    title: p.text,
    location: p.categories?.location ?? null,
    url: p.hostedUrl,
    department: p.categories?.team ?? p.categories?.department ?? null,
    description: p.descriptionPlain ?? '',
    posted_at: p.createdAt ? new Date(p.createdAt).toISOString() : null,
  }));
}
