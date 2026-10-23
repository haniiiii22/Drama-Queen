#!/usr/bin/env node
// Strict validation of a catalog file. Exits non-zero on any problem.
//
//   node scripts/validate-catalog.mjs [file] [--source public/Movies.txt] [--require-in-sync] [--allow-missing]
//
// Checks: JSON syntax, schema and field formats, duplicate keys/IMDb ids, media types and ratings,
// HTTPS image URLs on an allow-list, entry/size limits, and absence of credentials or
// credential-bearing URLs. With --source it also checks the catalog matches Movies.txt.
import { readFileSync, existsSync } from 'node:fs';
import { inspectCatalog } from '../src/lib/catalog.js';
import { prepareSource } from './catalog/refresh.js';
import { sourceDigest, safeLogText } from './catalog/util.js';
import { parseArgs } from './catalog/io.js';

let args;
try { args = parseArgs(process.argv.slice(2), { flags: ['require-in-sync', 'allow-missing'], options: ['source'] }); } catch (e) { console.error(`::error::${e.message}`); process.exit(2); }
const file = args._[0] || 'public/data/catalog.json';
const bad = (m) => { console.error(`::error::${safeLogText(m, 500)}`); process.exit(2); };

if (!existsSync(file)) {
  if (args['allow-missing']) { console.log(`[catalog] ${file} not found (allowed).`); process.exit(0); }
  bad(`${file} does not exist.`);
}
const text = readFileSync(file, 'utf8');
let raw;
try { raw = JSON.parse(text); } catch { bad(`${file} is not valid JSON.`); }

const forbidden = [process.env.OMDB_API_KEY, process.env.TMDB_API_KEY].map((v) => (v || '').trim()).filter(Boolean);
const r = inspectCatalog(raw, { bytes: Buffer.byteLength(text), forbidden });
if (r.fatal) bad(`${file}: ${r.fatal}`);
if (r.errors.length) {
  for (const e of r.errors.slice(0, 20)) console.error(`::error::${safeLogText(e, 300)}`);
  bad(`${file} failed validation (${r.errors.length} problem(s)).`);
}

const byStatus = {};
for (const e of r.entries) byStatus[e.status] = (byStatus[e.status] || 0) + 1;
console.log(`[catalog] ${file} is valid: ${r.entries.length} entries ${JSON.stringify(byStatus)}, generated ${r.meta.generatedAt ?? 'never'}.`);

if (args.source) {
  const sourceText = existsSync(args.source) ? readFileSync(args.source, 'utf8') : '';
  const { sources } = prepareSource(sourceText);
  const wantKeys = sources.map((s) => s.key);
  const haveKeys = r.entries.map((e) => e.key);
  const inSync = r.meta.sourceDigest === sourceDigest(wantKeys) && wantKeys.join('\n') === haveKeys.join('\n');
  if (inSync) console.log(`[catalog] in sync with ${args.source}.`);
  else if (args['require-in-sync']) bad(`The catalog is NOT in sync with ${args.source}: run the "Update catalog and deploy" workflow (or npm run catalog:refresh) so new, removed or reordered titles are processed.`);
  else console.log(`::warning::The catalog is not in sync with ${args.source}.`);
}
