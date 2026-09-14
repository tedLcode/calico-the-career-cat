import { fetchGreenhouse } from '../src/fetchers/greenhouse.js';
import { fetchLever } from '../src/fetchers/lever.js';
import { fetchAshby } from '../src/fetchers/ashby.js';
import { fetchWorkday } from '../src/fetchers/workday.js';
import { fetchSmartRecruiters } from '../src/fetchers/smartrecruiters.js';

const FETCHERS = {
  greenhouse: ([token]) => fetchGreenhouse(token),
  lever: ([token]) => fetchLever(token),
  ashby: ([token]) => fetchAshby(token),
  workday: ([token, host, site]) => fetchWorkday({ token, host, site }),
  smartrecruiters: ([token]) => fetchSmartRecruiters({ token }),
};

const [ats, ...args] = process.argv.slice(2);

if (!ats || args.length === 0) {
  console.error('Usage: npm run fetch:test -- <greenhouse|lever|ashby|smartrecruiters> <token>');
  console.error('       npm run fetch:test -- workday <tenant> <wdN> <site>');
  process.exit(1);
}

const fetcher = FETCHERS[ats];
if (!fetcher) {
  console.error(`Unknown ATS "${ats}". Expected one of: ${Object.keys(FETCHERS).join(', ')}`);
  process.exit(1);
}

try {
  const jobs = await fetcher(args);
  console.log(`Fetched ${jobs.length} jobs from ${ats}/${args.join('/')}. First 3:`);
  console.log(JSON.stringify(jobs.slice(0, 3), null, 2));
} catch (err) {
  console.error(`Fetch failed: ${err.message}`);
  process.exit(1);
}
