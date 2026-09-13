import { fetchGreenhouse } from '../src/fetchers/greenhouse.js';
import { fetchLever } from '../src/fetchers/lever.js';
import { fetchAshby } from '../src/fetchers/ashby.js';

const FETCHERS = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
};

const [ats, token] = process.argv.slice(2);

if (!ats || !token) {
  console.error('Usage: npm run fetch:test -- <greenhouse|lever|ashby> <token>');
  process.exit(1);
}

const fetcher = FETCHERS[ats];
if (!fetcher) {
  console.error(`Unknown ATS "${ats}". Expected one of: ${Object.keys(FETCHERS).join(', ')}`);
  process.exit(1);
}

try {
  const jobs = await fetcher(token);
  console.log(`Fetched ${jobs.length} jobs from ${ats}/${token}. First 3:`);
  console.log(JSON.stringify(jobs.slice(0, 3), null, 2));
} catch (err) {
  console.error(`Fetch failed: ${err.message}`);
  process.exit(1);
}
