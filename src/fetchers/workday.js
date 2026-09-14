import { stripHtml } from '../normalize.js';

// Workday tenants can list thousands of postings, and each description needs
// its own request. So: ask Workday for India-only results when the tenant has a
// country facet, search a few role keywords, and drop listings that are stale,
// clearly outside India, or have a rejected title before fetching details.
// Scoring still applies the real rules afterwards; this only keeps the
// request count sane.
const SEARCH_TERMS = ['data engineer', 'software engineer', 'developer', 'etl', 'backend'];
const PAGE_SIZE = 20;
const MAX_PAGES_PER_TERM = 5;
const MAX_DETAIL_FETCHES = 80;
const MAX_AGE_DAYS = 7;
const INDIA_HINTS = ['india', 'chennai', 'bengaluru', 'bangalore', 'hyderabad'];
const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'jobhunt/1.0' };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// "Posted Today" / "Posted Yesterday" / "Posted 3 Days Ago" / "Posted 30+ Days Ago"
function daysFromPostedOn(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (t.includes('today')) return 0;
  if (t.includes('yesterday')) return 1;
  const m = t.match(/(\d+)(\+?)\s*days?/);
  if (!m) return null;
  return Number(m[1]) + (m[2] ? 1 : 0);
}

// The country facet's parameter name varies by tenant (Country_and_Jurisdiction,
// locationCountry, ...), so look for any facet offering a value named "India".
function findIndiaFacet(facets) {
  for (const f of facets ?? []) {
    const values = f.values ?? [];
    const india = values.find((v) => !v.facetParameter && /^india(\s*\(in\))?$/i.test((v.descriptor ?? '').trim()));
    if (india) return { [f.facetParameter]: [india.id] };
    const nested = findIndiaFacet(values.filter((v) => v.facetParameter));
    if (nested) return nested;
  }
  return null;
}

// Some tenants use site codes instead of city names (UPS: "IN - TDC 1 (IN110)").
// companies.json can map those codes to a city via location_aliases.
function applyAliases(location, aliases) {
  const extra = [];
  const lower = location.toLowerCase();
  for (const [code, city] of Object.entries(aliases)) {
    if (lower.includes(code.toLowerCase()) && !lower.includes(city.toLowerCase())) extra.push(city);
  }
  return extra.length ? `${location}; ${extra.join('; ')}` : location;
}

function looksIndian(locationsText, aliases) {
  const loc = applyAliases(locationsText || '', aliases).toLowerCase();
  return INDIA_HINTS.some((h) => loc.includes(h)) || /\d+\s+locations/.test(loc) || /(^|;\s*)in\s*-\s/.test(loc);
}

async function searchPage(api, body, label) {
  const res = await fetch(`${api}/jobs`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`workday ${label}: HTTP ${res.status}`);
  return res.json();
}

export async function fetchWorkday(company, { skipTitle } = {}) {
  const { token: tenant, host, site, location_aliases: aliases = {} } = company;
  const label = `${tenant}/${site}`;
  const origin = `https://${tenant}.${host}.myworkdayjobs.com`;
  const api = `${origin}/wday/cxs/${tenant}/${site}`;

  const first = await searchPage(api, { appliedFacets: {}, limit: 1, offset: 0, searchText: '' }, label);
  const indiaFacet = findIndiaFacet(first.facets);
  const appliedFacets = indiaFacet ?? {};

  const candidates = new Map();
  for (const term of SEARCH_TERMS) {
    for (let page = 0; page < MAX_PAGES_PER_TERM; page++) {
      await sleep(300);
      const data = await searchPage(api, { appliedFacets, limit: PAGE_SIZE, offset: page * PAGE_SIZE, searchText: term }, label);
      const postings = data.jobPostings ?? [];

      for (const p of postings) {
        if (!p.externalPath || candidates.has(p.externalPath)) continue;
        const days = daysFromPostedOn(p.postedOn);
        if (days !== null && days > MAX_AGE_DAYS) continue;
        if (!indiaFacet && !looksIndian(p.locationsText, aliases)) continue;
        if (skipTitle?.(p.title)) continue;
        candidates.set(p.externalPath, p);
      }

      if (postings.length < PAGE_SIZE) break;
    }
  }

  const jobs = [];
  for (const [path, listing] of [...candidates].slice(0, MAX_DETAIL_FETCHES)) {
    await sleep(300);
    const res = await fetch(`${api}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    if (!res.ok) continue;
    const info = (await res.json()).jobPostingInfo ?? {};

    const locations = [info.location, ...(info.additionalLocations ?? [])].filter(Boolean);
    const country = typeof info.country === 'string' ? info.country : info.country?.descriptor;
    let location = locations.length ? locations.join('; ') : listing.locationsText ?? '';
    if (country && !location.toLowerCase().includes(country.toLowerCase())) location += `; ${country}`;
    location = applyAliases(location, aliases);

    const days = daysFromPostedOn(info.postedOn ?? listing.postedOn);
    jobs.push({
      source: 'workday',
      external_id: String(info.jobReqId ?? info.id ?? path),
      title: info.title ?? listing.title,
      location: location || null,
      url: info.externalUrl ?? `${origin}/${site}${path}`,
      department: null,
      description: stripHtml(info.jobDescription ?? ''),
      posted_at: info.startDate
        ? new Date(info.startDate).toISOString()
        : days !== null
          ? new Date(Date.now() - days * 86400000).toISOString()
          : null,
    });
  }

  return jobs;
}
