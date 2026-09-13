import fs from 'node:fs';

const ATS = {
  greenhouse: (token) => `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=false`,
  lever: (token) => `https://api.lever.co/v0/postings/${token}?mode=json`,
  ashby: (token) => `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=false`,
};

function candidateTokens(name) {
  const lower = name.toLowerCase().trim();
  const noSpace = lower.replace(/\s+/g, '');
  const hyphen = lower.replace(/\s+/g, '-');
  return [...new Set([lower, noSpace, hyphen])];
}

async function probe(ats, token) {
  const url = ATS[ats](token);
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'jobhunt/1.0' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const jobs = ats === 'lever' ? body : body.jobs;
    if (!Array.isArray(jobs) || jobs.length === 0) return null;
    return jobs.length;
  } catch {
    return null;
  }
}

async function resolveCompany(name) {
  for (const token of candidateTokens(name)) {
    for (const ats of Object.keys(ATS)) {
      const count = await probe(ats, token);
      if (count !== null) return { name, ats, token, jobCount: count };
    }
  }
  return null;
}

function loadExistingCompanies(path) {
  if (!fs.existsSync(path)) return [];
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--from-list') {
    const listPath = args[1];
    const tierArgIdx = args.indexOf('--tier');
    const tier = tierArgIdx !== -1 ? Number(args[tierArgIdx + 1]) : 1;
    const outPath = 'companies.json';

    const names = fs
      .readFileSync(listPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const existing = loadExistingCompanies(outPath);
    const resolved = [];
    const unresolved = [];

    for (const name of names) {
      const r = await resolveCompany(name);
      if (r) {
        console.log(`RESOLVED  ${name} -> ${r.ats}/${r.token} (${r.jobCount} jobs)`);
        resolved.push({ name: r.name, ats: r.ats, token: r.token, tier });
      } else {
        console.log(`MISS      ${name}`);
        unresolved.push(name);
      }
    }

    const merged = [...existing.filter((c) => !resolved.some((r) => r.name === c.name)), ...resolved];
    fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n');

    console.log(`\nResolved ${resolved.length}/${names.length} for tier ${tier}.`);
    console.log(`companies.json now has ${merged.length} total entries.`);
    if (unresolved.length) {
      console.log(`Unresolved (add to companies-manual.md if they have their own portal):`);
      for (const n of unresolved) console.log(`  - ${n}`);
    }
  } else {
    const name = args[0];
    if (!name) {
      console.error('Usage: node scripts/resolve-company.js "Company Name"');
      console.error('       node scripts/resolve-company.js --from-list companies.txt --tier 1');
      process.exit(1);
    }
    const r = await resolveCompany(name);
    if (r) {
      console.log(`RESOLVED  ${name} -> ${r.ats}/${r.token} (${r.jobCount} jobs)`);
    } else {
      console.log(`MISS      ${name} (tried: ${candidateTokens(name).join(', ')} across greenhouse/lever/ashby)`);
    }
  }
}

main();
