function parseMinYearsExperience(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const mins = [];

  for (const m of lower.matchAll(/(\d+)\s*\+\s*(?:years?|yrs?)/g)) {
    mins.push(Number(m[1]));
  }
  for (const m of lower.matchAll(/(\d+)\s*(?:-|to)\s*(\d+)\s*(?:years?|yrs?)/g)) {
    mins.push(Number(m[1]));
  }
  for (const m of lower.matchAll(/minimum(?:\s+of)?\s+(\d+)\s*(?:years?|yrs?)/g)) {
    mins.push(Number(m[1]));
  }
  for (const m of lower.matchAll(/\b(\d+)\s*(?:years?|yrs?)\s+of\s+experience/g)) {
    mins.push(Number(m[1]));
  }

  if (mins.length === 0) return null;
  return Math.min(...mins);
}

function daysSince(isoDate) {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / 86400000;
}

function compile(patterns) {
  return (patterns ?? []).map((p) => new RegExp(p, 'i'));
}

function titleTrackHits(title, config) {
  return {
    de: config.tracks.DE.title.some((kw) => title.includes(kw)),
    swe: config.tracks.SWE.title.some((kw) => title.includes(kw)),
  };
}

// Every rule that can be decided from the title alone. Exported so fetchers
// can skip these postings before paying for a description request.
export function titleRejectReason(rawTitle, config) {
  const title = (rawTitle || '').toLowerCase();
  if (config.hard_reject_title.some((kw) => title.includes(kw))) return 'title matches hard-reject list';
  if (compile(config.hard_reject_title_patterns).some((re) => re.test(title))) return 'title is not an entry-level role';

  const { de, swe } = titleTrackHits(title, config);
  // Location/tier/entry-level bonuses would otherwise lift non-engineering
  // titles (sales, support) over the notify threshold on their own.
  if (!de && !swe) return 'title is not a DE/SWE role';

  if (compile(config.off_profile_title_patterns).some((re) => re.test(title))) return 'title outside DE/backend profile';
  return null;
}

export function scoreJob(job, config) {
  const title = (job.title || '').toLowerCase();
  const location = (job.location || '').toLowerCase();
  const description = job.description || '';

  const titleReason = titleRejectReason(title, config);
  if (titleReason) return { score: 0, track: 'NONE', reject_reason: titleReason };

  const minYears = parseMinYearsExperience(description);
  if (minYears !== null && minYears > config.max_years_experience) {
    return { score: 0, track: 'NONE', reject_reason: `requires ${minYears}+ years experience` };
  }

  const cityMatch = config.locations.some((loc) => location.includes(loc));
  const remoteCountry = config.remote_requires_country;
  const indiaRemoteMatch = remoteCountry
    ? location.includes('remote') && location.includes(remoteCountry)
    : false;
  const locationOk = cityMatch || indiaRemoteMatch;
  if (!locationOk) {
    return { score: 0, track: 'NONE', reject_reason: 'location not in allowed list' };
  }

  const daysOld = job.posted_at ? daysSince(job.posted_at) : null;
  if (daysOld !== null && config.max_posting_age_days != null && daysOld > config.max_posting_age_days) {
    return {
      score: 0,
      track: 'NONE',
      reject_reason: `posted ${Math.floor(daysOld)} days ago, older than the ${config.max_posting_age_days}-day cutoff`,
    };
  }

  const { de: deTitleHit, swe: sweTitleHit } = titleTrackHits(title, config);
  const track = deTitleHit && sweTitleHit ? 'BOTH' : deTitleHit ? 'DE' : 'SWE';

  let score = 25; // locationOk already confirmed above

  if (deTitleHit) score += 30;
  if (sweTitleHit) score += 30;

  const coreSkills = new Set([...config.tracks.DE.skills_core, ...config.tracks.SWE.skills_core]);
  const secondarySkills = new Set([...config.tracks.DE.skills_secondary, ...config.tracks.SWE.skills_secondary]);
  const lowerDescription = description.toLowerCase();
  let skillPoints = 0;
  for (const kw of coreSkills) if (lowerDescription.includes(kw)) skillPoints += 4;
  for (const kw of secondarySkills) if (lowerDescription.includes(kw)) skillPoints += 2;
  score += Math.min(skillPoints, 30);

  if (daysOld !== null) {
    if (daysOld <= 2) score += 15;
    else score += 5; // 3-7 days old — anything older was already rejected above
  }

  if (track === 'DE' || track === 'BOTH') {
    score += config.de_priority_bonus ?? 0;
  }

  const tierBonus = config.company_tier_bonus?.[String(job.tier)];
  if (tierBonus) score += tierBonus;

  const locationBonus = Object.entries(config.location_bonus ?? {}).find(([loc]) => location.includes(loc));
  if (locationBonus) score += locationBonus[1];

  if (compile(config.entry_level_title_patterns).some((re) => re.test(title))) score += config.entry_level_bonus ?? 0;

  return { score, track, reject_reason: null };
}
