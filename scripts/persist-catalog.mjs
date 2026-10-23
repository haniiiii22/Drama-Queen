#!/usr/bin/env node
// Installs a freshly generated catalog (from the fetch job's artifact) into the working tree.
// Runs in the persist job, which has NO API credentials. It re-validates everything and refuses
// to overwrite a catalog that changed since the fetch job read it (stale result protection).
//
//   node scripts/persist-catalog.mjs --artifact <dir> [--catalog public/data/catalog.json] [--source public/Movies.txt]
//
// Exit codes: 0 ok (changed=true|false), 2 invalid artifact, 5 stale artifact.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { inspectCatalog } from '../src/lib/catalog.js';
import { prepareSource, EXIT } from './catalog/refresh.js';
import { sha256, sourceDigest, safeLogText } from './catalog/util.js';
import { parseArgs, atomicWrite, setOutput } from './catalog/io.js';

let args;
try { args = parseArgs(process.argv.slice(2), { options: ['artifact', 'catalog', 'source'] }); } catch (e) { console.error(`::error::${e.message}`); process.exit(EXIT.ERROR); }
if (!args.artifact) { console.error('::error::--artifact <dir> is required'); process.exit(EXIT.ERROR); }
const catalogPath = args.catalog || 'public/data/catalog.json';
const sourcePath = args.source || 'public/Movies.txt';
const die = (code, m) => { console.error(`::error::${safeLogText(m, 500)}`); process.exit(code); };

// 1. The artifact must contain exactly the two expected files.
const names = readdirSync(args.artifact).sort();
if (names.join(',') !== 'catalog.json,report.json') die(EXIT.ERROR, `Unexpected artifact contents: ${names.join(', ') || '(empty)'}`);

// 2. Revalidate the catalog from scratch (never trust the previous job).
const text = readFileSync(join(args.artifact, 'catalog.json'), 'utf8');
let raw;
let report;
try { raw = JSON.parse(text); } catch { die(EXIT.ERROR, 'Artifact catalog.json is not valid JSON.'); }
try { report = JSON.parse(readFileSync(join(args.artifact, 'report.json'), 'utf8')); } catch { die(EXIT.ERROR, 'Artifact report.json is not valid JSON.'); }
const r = inspectCatalog(raw, { bytes: Buffer.byteLength(text) });
if (r.fatal) die(EXIT.ERROR, `Artifact catalog rejected: ${r.fatal}`);
if (r.errors.length) die(EXIT.ERROR, `Artifact catalog rejected (${r.errors.length} problem(s), first: ${r.errors[0]})`);

// 3. Stale-result protection.
const currentText = existsSync(catalogPath) ? readFileSync(catalogPath, 'utf8') : null;
const currentSha = currentText === null ? null : sha256(currentText);
if ((report.baseCatalogSha256 ?? null) !== currentSha) die(EXIT.STALE, 'The catalog changed after the fetch job read it. Not overwriting a newer catalog; re-run the workflow.');
const { sources } = prepareSource(existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : '');
const keys = sources.map((s) => s.key);
if (r.meta.sourceDigest !== sourceDigest(keys) || keys.join('\n') !== r.entries.map((e) => e.key).join('\n')) {
  die(EXIT.STALE, 'Movies.txt changed after the fetch job read it. Not persisting a result for an older list; a newer run will handle it.');
}

// 4. Deterministic install, only if the content actually differs.
if (currentText === text) { console.log('[persist] catalog unchanged; nothing to write.'); setOutput('changed', 'false'); process.exit(0); }
atomicWrite(catalogPath, text);
console.log(`[persist] catalog updated (${r.entries.length} entries).`);
setOutput('changed', 'true');
