import { stripHtml } from '../normalize.js';

// Like Workday, each description is a separate request, so narrow the listing
// first: India only, recent only, not a rejected title, and skip postings the
// company itself labels as mid-senior or above (SmartRecruiters exposes an
// experienceLevel field).
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_DETAIL_FETCHES = 60;
const MAX_AGE_DAYS = 7;
const SENIOR_LEVELS = new Set(['mid_senior_level', 'director', 'executive']);
const HEADERS = { Accept: 'application/json', 'User-Agent': 'jobhunt/1.0' };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function daysSince(iso) {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

function formatLocation(loc) {
  if (!loc) return null;
  const base =
    loc.fullLocation || [loc.city, loc.region, loc.country === 'in' ? 'India' : loc.country].filter(Boolean).join(', ');
  return loc.remote ? `${base} (Remote)` : base;
}

export async function fetchSmartRecruiters({ token: companyId }, { skipTitle } = {}) {
  const base = `https://api.smartrecruiters.com/v1/companies/${companyId}/postings`;
  const candidates = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`${base}?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&country=in`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`smartrecruiters ${companyId}: HTTP ${res.status}`);
    const postings = (await res.json()).content ?? [];

    let anyRecent = false;
    for (const p of postings) {
      const days = p.releasedDate ? daysSince(p.releasedDate) : null;
      if (days === null || days <= MAX_AGE_DAYS) anyRecent = true;
      if (days !== null && days > MAX_AGE_DAYS) continue;
      if (p.location?.country && p.location.country !== 'in') continue;
      if (SENIOR_LEVELS.has(p.experienceLevel?.id)) continue;
      if (skipTitle?.(p.name)) continue;
      candidates.push(p);
    }

    // Listings come back newest first, so a page with nothing recent means we're done.
    if (postings.length < PAGE_SIZE || !anyRecent) break;
    await sleep(200);
  }

  const jobs = [];
  for (const p of candidates.slice(0, MAX_DETAIL_FETCHES)) {
    const res = await fetch(`${base}/${p.id}`, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) continue;
    const d = await res.json();
    const sections = d.jobAd?.sections ?? {};
    // companyDescription is left out on purpose: boilerplate about the company
    // tends to mention technologies and would inflate skill-keyword scores.
    const html = ['jobDescription', 'qualifications', 'additionalInformation']
      .map((k) => sections[k]?.text ?? '')
      .join(' ');

    jobs.push({
      source: 'smartrecruiters',
      external_id: String(d.id ?? p.id),
      title: d.name ?? p.name,
      location: formatLocation(d.location ?? p.location),
      url: d.postingUrl ?? `https://jobs.smartrecruiters.com/${companyId}/${p.id}`,
      department: d.department?.label ?? p.department?.label ?? null,
      description: stripHtml(html),
      posted_at: d.releasedDate ?? p.releasedDate ?? null,
    });
    await sleep(200);
  }

  return jobs;
}
