#!/usr/bin/env node
// Refreshes public/data/catalog.json from public/Movies.txt using OMDb (+ optional TMDB).
//
//   node scripts/refresh-catalog.mjs --plan      offline: what would need fetching? (no credentials)
//   node scripts/refresh-catalog.mjs             fetch what is missing/expired, write catalog-out/
//
// Credentials come ONLY from the environment (OMDB_API_KEY, TMDB_API_KEY) — never from
// arguments or files — and are never printed. This script uses only Node built-ins and the
// repository's own source, so the CI job that runs it needs no `npm install` (no third-party
// code ever runs next to the secrets).
import { join } from 'node:path';
import { refreshCatalog, planOnly, RefreshError, EXIT } from './catalog/refresh.js';
import { policyFromEnv } from './catalog/policy.js';
import { readTextOrUndefined, atomicWrite, parseArgs, setOutput, addSummary, envFlag } from './catalog/io.js';
import { makeRedactor, safeLogText, sha256 } from './catalog/util.js';

const env = process.env;
const trim = (v) => (typeof v === 'string' ? v.trim() : '');
const omdbKey = trim(env.OMDB_API_KEY);
const tmdbKey = trim(env.TMDB_API_KEY);
const redact = makeRedactor([omdbKey, tmdbKey]);
const say = (m) => console.log(safeLogText(redact(m), 400));
const warn = (m) => console.log(`::warning::${safeLogText(redact(m), 400)}`);
const fail = (m) => console.error(`::error::${safeLogText(redact(m), 600)}`);

let args;
try {
  args = parseArgs(process.argv.slice(2), { flags: ['plan'], options: ['source', 'catalog', 'out'] });
} catch (e) { fail(e.message); process.exit(EXIT.ERROR); }

const sourcePath = args.source || 'public/Movies.txt';
const catalogPath = args.catalog || 'public/data/catalog.json';
const outDir = args.out || 'catalog-out';
const force = envFlag(env.FORCE_REFRESH);
const allowLargeRemoval = envFlag(env.ALLOW_LARGE_REMOVAL);

try {
  const sourceText = readTextOrUndefined(sourcePath);
  const existingText = readTextOrUndefined(catalogPath);

  if (args.plan) {
    const plan = planOnly({ sourceText, existingText, force, allowLargeRemoval });
    say(`plan: ${plan.sourceTitles} title(s) in ${sourcePath}, ${plan.catalogEntries} in the catalog; new ${plan.counts.new}, pending ${plan.counts.pending}, expired ${plan.counts.expired}, forced ${plan.counts.forced}, removed ${plan.removed}, reordered ${plan.reordered}`);
    say(plan.needsFetch ? 'The catalog needs refreshing.' : 'The catalog is up to date: no metadata requests are needed.');
    setOutput('needs_fetch', plan.needsFetch ? 'true' : 'false');
    process.exit(EXIT.OK);
  }

  const policy = policyFromEnv(env, warn);
  const result = await refreshCatalog({ sourceText, existingText, omdbKey, tmdbKey, fetchImpl: (...a) => fetch(...a), policy, force, allowLargeRemoval, log: say });
  result.report.baseCatalogSha256 = existingText === undefined ? null : sha256(existingText);

  atomicWrite(join(outDir, 'catalog.json'), result.text);
  atomicWrite(join(outDir, 'report.json'), `${JSON.stringify(result.report, null, 2)}\n`);

  const r = result.report;
  say(`done: ${r.titles.looked_up} looked up, ${r.titles.updated} updated, ${r.titles.not_found} not found, ${r.titles.failed} failed, ${r.titles.pending} pending, ${r.titles.removed} removed`);
  say(`requests: OMDb ${r.requests.omdb}, TMDB ${r.requests.tmdb} (${r.requests.deduplicated} duplicate request(s) avoided)`);
  say(result.changed ? 'The catalog changed.' : 'The catalog is unchanged.');
  for (const w of r.warnings) warn(w);
  addSummary(
    [
      '### Catalog refresh',
      `- ${r.complete ? 'Complete' : '**Incomplete** (see warnings): the next eligible run continues the work'}`,
      `- Titles in Movies.txt: ${r.titles.source}; reused without a request: ${r.titles.reused}; looked up: ${r.titles.looked_up}`,
      `- Updated: ${r.titles.updated}; not found: ${r.titles.not_found}; failed (previous data kept): ${r.titles.failed}; pending: ${r.titles.pending}; removed: ${r.titles.removed}`,
      `- API requests: OMDb ${r.requests.omdb}, TMDB ${r.requests.tmdb}`,
      `- Catalog changed: ${result.changed ? 'yes' : 'no'}`,
      ...r.warnings.map((w) => `- ⚠ ${safeLogText(w, 300)}`),
    ].join('\n'),
  );
  process.exit(EXIT.OK);
} catch (e) {
  if (e instanceof RefreshError) { fail(e.message); process.exit(e.exitCode); }
  fail(`Unexpected ${e?.name || 'error'}: ${safeLogText(redact(e?.message || ''), 200)}`);
  process.exit(EXIT.ERROR);
}
