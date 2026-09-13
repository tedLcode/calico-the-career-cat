import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertJob, getPendingDigest } from './db.js';
import { makeId } from './normalize.js';
import { scoreJob } from './score.js';
import { processCallbacks, sendDigest, sendText } from './notify.js';
import { fetchGreenhouse } from './fetchers/greenhouse.js';
import { fetchLever } from './fetchers/lever.js';
import { fetchAshby } from './fetchers/ashby.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FETCHERS = { greenhouse: fetchGreenhouse, lever: fetchLever, ashby: fetchAshby };

// Score against the full description (skill/experience keywords can appear
// anywhere in a long JD), but only persist a short snippet — the DB is
// committed to git on every run, and the full text isn't needed once scored.
const STORED_DESCRIPTION_LENGTH = 800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'));
}

async function main() {
  await processCallbacks();

  const companies = loadJson('companies.json');
  const config = loadJson('config.json');

  let fetched = 0;
  let newCount = 0;
  let errors = 0;

  for (const company of companies) {
    try {
      const rawJobs = await FETCHERS[company.ats](company.token);
      const now = new Date().toISOString();

      for (const raw of rawJobs) {
        fetched++;
        const id = makeId(raw.source, company.name, raw.external_id);
        const { score, track, reject_reason } = scoreJob({ ...raw, tier: company.tier }, config);

        const wasNew = upsertJob({
          ...raw,
          id,
          company: company.name,
          description: raw.description ? raw.description.slice(0, STORED_DESCRIPTION_LENGTH) : raw.description,
          first_seen_at: now,
          last_seen_at: now,
          score,
          track,
          reject_reason,
        });
        if (wasNew) newCount++;
      }
    } catch (err) {
      console.log(`WARN  ${company.name}: ${err.message}`);
      errors++;
    }
    await sleep(400);
  }

  const pending = getPendingDigest(1000).filter((job) => job.score >= config.notify_threshold);
  const notifiedIds = await sendDigest(pending);

  console.log(`fetched=${fetched} new=${newCount} notified=${notifiedIds.length} errors=${errors}`);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await sendText('⚠️ jobhunt run failed: ' + err.message);
  } catch {
    // best-effort — if Telegram itself is unreachable, the exit code below is the fallback signal
  }
  process.exit(1);
});
