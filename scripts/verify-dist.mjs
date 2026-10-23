// Post-build checks on dist/. Fails the build on any problem. Never prints secret values.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectCatalog } from '../src/lib/catalog.js';

const dist = new URL('../dist/', import.meta.url).pathname;
const problems = [];
const notes = [];
const rel = (f) => `dist/${relative(dist, f)}`;

if (!existsSync(join(dist, 'index.html'))) {
  console.error('[verify] dist/index.html is missing.');
  process.exit(1);
}

// ---- HTML / CSP ----
const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (!/http-equiv="Content-Security-Policy"/.test(html)) problems.push('CSP <meta> tag missing from index.html');
if (/<!--CSP-->/.test(html)) problems.push('CSP placeholder was not replaced');
if (/(?:src|href)="\/(?!\/)/.test(html)) problems.push('index.html contains root-absolute asset paths (breaks GitHub Pages sub-paths)');
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || '';
for (const code of inline) {
  const hash = `'sha256-${createHash('sha256').update(code).digest('base64')}'`;
  if (!csp.includes(hash)) problems.push('inline script hash is missing from the CSP (theme script would be blocked)');
}
if (inline.length !== 1) problems.push(`expected exactly 1 inline script, found ${inline.length}`);
if (/unsafe-inline|unsafe-eval/.test(csp)) problems.push('CSP contains unsafe-inline/unsafe-eval');
if (!/connect-src 'self'(;|$)/.test(csp)) problems.push("CSP connect-src must be exactly 'self' (the site must not contact any API)");

// ---- files ----
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(dist);
if (!files.some((f) => /\.js$/.test(f))) problems.push('no JavaScript bundle emitted');
if (files.some((f) => /\.map$/.test(f))) problems.push('source maps are present in dist/');

// ---- catalog ----
const catalogFile = join(dist, 'data', 'catalog.json');
if (existsSync(catalogFile)) {
  const text = readFileSync(catalogFile, 'utf8');
  try {
    const r = inspectCatalog(JSON.parse(text), { bytes: Buffer.byteLength(text), forbidden: [process.env.OMDB_API_KEY, process.env.TMDB_API_KEY].map((v) => (v || '').trim()).filter(Boolean) });
    if (r.fatal) problems.push(`data/catalog.json: ${r.fatal}`);
    for (const e of r.errors.slice(0, 5)) problems.push(`data/catalog.json: ${e}`);
    notes.push(`catalog: ${r.entries.length} entries, valid`);
  } catch {
    problems.push('data/catalog.json is not valid JSON');
  }
} else {
  notes.push('catalog: data/catalog.json absent (the site shows its "Add your titles" state)');
}

// ---- no API plumbing, no credentials anywhere in public output ----
const textFiles = files.filter((f) => /\.(html|js|css|svg|json|txt|webmanifest)$/i.test(f));
const FORBIDDEN_IN_CODE = [
  [/omdbapi\.com/i, 'references the OMDb API host'],
  [/api\.themoviedb\.org/i, 'references the TMDB API host'],
  [/\bapi_?key["']?\s*[=:]/i, 'sets an API key parameter'],
  [/\bOMDB_API_KEY\b|\bTMDB_API_KEY\b|\bPROXY_URL\b/, 'mentions a credential/proxy variable'],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i, 'contains a bearer credential'],
  [/\.workers\.dev/i, 'references a public proxy host'],
];
const envSecrets = [process.env.OMDB_API_KEY, process.env.TMDB_API_KEY].map((v) => (v || '').trim()).filter((v) => v.length >= 6);
for (const f of textFiles) {
  const body = readFileSync(f, 'utf8');
  if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(body)) problems.push(`${rel(f)} contains a JWT-like token`);
  for (const k of envSecrets) if (body.includes(k)) problems.push(`${rel(f)} contains a configured API key value`);
  const isData = /\/(Movies\.txt|data\/catalog\.json)$/.test(f); // user content: checked by the catalog validator instead
  if (!isData) for (const [re, why] of FORBIDDEN_IN_CODE) if (re.test(body)) problems.push(`${rel(f)} ${why}`);
}
notes.push(`Movies.txt in dist: ${files.some((f) => f.endsWith('/Movies.txt')) ? 'present' : 'absent'}`);

for (const n of notes) console.log(`[verify] ${n}`);
if (problems.length) {
  for (const p of problems) console.error(`[verify] PROBLEM: ${p}`);
  process.exit(1);
}
console.log(`[verify] OK — ${files.length} files in dist/.`);
