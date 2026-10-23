// Catalog refresh engine (build time only — runs in the GitHub Actions "fetch" job or locally).
//
//   Movies.txt  ──►  plan (what is missing / expired?)  ──►  OMDb (+ optional TMDB)
//               ──►  validated catalog.json (atomic, deterministic)
//
// Rules this module enforces (see docs/CATALOG.md and SECURITY.md):
//  * Fresh entries are reused with ZERO requests; only missing/expired entries are fetched.
//  * Only a confirmed "not found" is negative-cached. Rate limits, auth errors, timeouts, 5xx
//    and malformed responses never become "not found": the previous valid entry is kept.
//  * No credential, credential-bearing URL or API text is ever logged or written to the catalog.
import { parseMovieList } from '../../src/lib/parser.js';
import { normalizeOmdb, pickBackdrop, isImdbId, safeImageUrl } from '../../src/lib/validate.js';
import { inspectCatalog, sanitizeData, checkEntry, makeEntry, emptyCatalog, serializeCatalog, SCHEMA_VERSION } from '../../src/lib/catalog.js';
import { createHttp, FetchError } from './http.js';
import { createLimiter } from './limiter.js';
import { DEFAULTS, days } from './policy.js';
import { sourceDigest } from './util.js';

export const EXIT = Object.freeze({ OK: 0, ERROR: 2, MISSING_KEY: 3, AUTH: 4, STALE: 5 });

export class RefreshError extends Error {
  constructor(code, message, exitCode = EXIT.ERROR) {
    super(message);
    this.name = 'RefreshError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => new Date(ms).toISOString();
const EMPTY_BACKDROP = Object.freeze({ url: null, checkedAt: null, refreshAfter: null });

// ---------- inputs ----------
/** Parses Movies.txt text into representable source entries. */
export function prepareSource(sourceText) {
  const { entries } = parseMovieList(typeof sourceText === 'string' ? sourceText : '');
  const sources = [];
  let skipped = 0;
  for (const e of entries) {
    const title = e.title.replace(/\s+/g, ' ').trim();
    const s = { key: e.key, title, year: e.year ?? null, imdbId: e.imdbId ?? null };
    const probe = checkEntry({ key: s.key, source: { title: s.title, year: s.year, imdbId: s.imdbId }, status: 'pending', id: null, aliasOf: null, data: null, backdrop: null, fetchedAt: null, refreshAfter: iso(0) });
    if (!probe.entry || probe.problems.length) skipped++;
    else sources.push(s);
  }
  return { sources, skipped };
}

/** Parses and strictly validates an existing catalog file. Missing file => empty catalog. */
export function parseExisting(text, { forbidden = [] } = {}) {
  if (text === undefined || text === null) return { catalog: emptyCatalog(), entries: [], bytes: 0 };
  let raw;
  try { raw = JSON.parse(text); } catch { throw new RefreshError('catalog_malformed', 'The existing catalog is not valid JSON. It was left untouched; see "Recovery" in the README.'); }
  const bytes = Buffer.byteLength(text);
  const r = inspectCatalog(raw, { bytes, forbidden });
  if (r.fatal) throw new RefreshError('catalog_invalid', `The existing catalog is unusable (${r.fatal}). It was left untouched; see "Recovery" in the README.`);
  if (r.errors.length) throw new RefreshError('catalog_invalid', `The existing catalog failed validation (${r.errors.length} problem(s), first: ${r.errors[0]}). It was left untouched; see "Recovery" in the README.`);
  return { catalog: { schemaVersion: SCHEMA_VERSION, generatedAt: r.meta.generatedAt, sourceDigest: r.meta.sourceDigest, entries: r.entries }, entries: r.entries, bytes };
}

// ---------- planning (no network, no secrets) ----------
const rank = (item) => {
  const ex = item.existing;
  if (!ex || ex.status === 'pending' || item.reason === 'orphanAlias') return 0;
  if (ex.status === 'notfound') return 1;
  return 2;
};

export function computePlan({ sources, existingEntries, now, force = false }) {
  const byKey = new Map(existingEntries.map((e) => [e.key, e]));
  const srcKeys = new Set(sources.map((s) => s.key));
  const liveIds = new Set(existingEntries.filter((e) => e.status === 'ok' && srcKeys.has(e.key)).map((e) => e.id));
  const items = [];
  const counts = { new: 0, pending: 0, orphanAlias: 0, forced: 0, expired: 0, reused: 0 };

  for (const s of sources) {
    const ex = byKey.get(s.key) ?? null;
    let reason = null;
    if (!ex) reason = 'new';
    else if (ex.status === 'pending') reason = 'pending';
    else if (ex.status === 'alias' && !liveIds.has(ex.aliasOf)) reason = 'orphanAlias';
    else if (force) reason = 'forced';
    else if (now >= Date.parse(ex.refreshAfter)) reason = 'expired';
    if (reason) { items.push({ src: s, existing: ex, reason }); counts[reason]++; } else counts.reused++;
  }
  items.sort((a, b) => rank(a) - rank(b) || Date.parse(a.existing?.fetchedAt ?? 0) - Date.parse(b.existing?.fetchedAt ?? 0));

  const removed = existingEntries.filter((e) => !srcKeys.has(e.key)).map((e) => e.key);
  const keptOrder = existingEntries.filter((e) => srcKeys.has(e.key)).map((e) => e.key);
  const wantedOrder = sources.map((s) => s.key).filter((k) => byKey.has(k));
  const reordered = keptOrder.join('\n') !== wantedOrder.join('\n');
  return { items, counts, removed, reordered, needsFetch: items.length > 0 || removed.length > 0 || reordered };
}

function checkRemoval({ sources, existingEntries, removed, allowLargeRemoval }) {
  if (allowLargeRemoval) return;
  const wipes = sources.length === 0 && existingEntries.length > 0;
  const large = removed.length > 10 && removed.length > existingEntries.length / 2;
  if (wipes || large) {
    throw new RefreshError(
      'large_removal',
      `Refusing to remove ${removed.length} of ${existingEntries.length} catalog entries (Movies.txt is ${sources.length ? 'much shorter than the catalog' : 'missing or empty'}). If this is intentional, run the workflow manually with "allow_large_removal" enabled.`,
    );
  }
}

/** Offline plan used by the workflow's `plan` job and by `npm run catalog:plan`. */
export function planOnly({ sourceText, existingText, now = Date.now(), force = false, allowLargeRemoval = false }) {
  const existing = parseExisting(existingText);
  const { sources, skipped } = prepareSource(sourceText);
  const plan = computePlan({ sources, existingEntries: existing.entries, now, force });
  checkRemoval({ sources, existingEntries: existing.entries, removed: plan.removed, allowLargeRemoval });
  return { needsFetch: plan.needsFetch, counts: plan.counts, removed: plan.removed.length, reordered: plan.reordered, sourceTitles: sources.length, skipped, catalogEntries: existing.entries.length };
}

// ---------- the refresh ----------
export async function refreshCatalog(opts) {
  const {
    sourceText, existingText, omdbKey, tmdbKey,
    fetchImpl, sleep = defaultSleep, random = Math.random, now = () => Date.now(),
    policy = DEFAULTS, force = false, allowLargeRemoval = false, log = () => {},
  } = opts;

  if (!omdbKey) throw new RefreshError('missing_omdb_key', 'OMDB_API_KEY is not set. Nothing was fetched and the existing catalog was not modified.', EXIT.MISSING_KEY);
  const forbidden = [omdbKey, tmdbKey].filter(Boolean);
  const existing = parseExisting(existingText, { forbidden });
  const { sources, skipped } = prepareSource(sourceText);
  const t = now();
  const plan = computePlan({ sources, existingEntries: existing.entries, now: t, force });
  checkRemoval({ sources, existingEntries: existing.entries, removed: plan.removed, allowLargeRemoval });

  const state = { requests: { omdb: 0, tmdb: 0 }, halted: { omdb: null, tmdb: null }, failures: { omdb: 0, tmdb: 0 } };
  const counts = { lookups: 0, updated: 0, notFound: 0, failed: 0, deduped: 0, tmdbChecked: 0, tmdbFailed: 0 };
  const maxReq = { omdb: policy.maxOmdbRequests, tmdb: policy.maxTmdbRequests };
  const beforeAttempt = (svc) => {
    if (state.halted[svc]) throw new FetchError('halted', `${svc} requests halted`);
    if (state.requests[svc] >= maxReq[svc]) { state.halted[svc] = 'budget'; throw new FetchError('halted', `${svc} request budget reached`); }
    state.requests[svc]++;
  };
  const http = createHttp({ fetchImpl, sleep, random, policy, beforeAttempt });
  const limiter = createLimiter(policy.concurrency);
  const jitter = () => 1 + policy.jitter * random();

  const onFailure = (svc, e) => {
    const kind = e instanceof FetchError ? e.kind : 'invalid';
    if (kind === 'halted') return;
    if (kind === 'auth' || kind === 'ratelimit') { state.halted[svc] ||= kind; return; }
    state.failures[svc]++;
    if (state.failures[svc] >= policy.haltAfterConsecutiveFailures) state.halted[svc] ||= 'failures';
  };

  // ----- OMDb -----
  const omdbMemo = new Map();
  function omdbRequest(job) {
    const id = job.src.imdbId || (job.existing && (job.existing.status === 'ok' || job.existing.status === 'alias') ? job.existing.id : null);
    const memoKey = id ? `i:${id}` : `t:${job.src.title.toLowerCase()}|${job.src.year ?? ''}`;
    const hit = omdbMemo.get(memoKey);
    if (hit) { counts.deduped++; return hit; }
    const u = new URL('https://www.omdbapi.com/');
    u.searchParams.set('apikey', omdbKey);
    if (id) u.searchParams.set('i', id);
    else { u.searchParams.set('t', job.src.title); if (job.src.year) u.searchParams.set('y', String(job.src.year)); }
    u.searchParams.set('plot', 'full');
    u.searchParams.set('r', 'json');
    const p = limiter.run(async () => {
      const res = await http.getJson('omdb', u.href);
      const b = res.body;
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw new FetchError('invalid', 'unexpected response');
      if (b.Response === 'True') {
        const data = normalizeOmdb(b);
        if (!data) throw new FetchError('invalid', 'metadata failed validation');
        if (data.poster) { // credential-free, query-free poster URLs only
          const pu = new URL(data.poster); pu.search = ''; pu.hash = '';
          data.poster = safeImageUrl(pu.href);
        }
        if (sanitizeData(data).problems.length) throw new FetchError('invalid', 'metadata failed validation');
        const blob = JSON.stringify(data);
        if (forbidden.some((f) => f.length >= 6 && blob.includes(f))) throw new FetchError('invalid', 'metadata failed validation'); // never store a configured secret
        return { kind: 'ok', data };
      }
      const err = String(b.Error || '');
      if (/limit/i.test(err)) throw new FetchError('ratelimit', 'rate limited');
      if (res.status === 401 || res.status === 403 || /api key/i.test(err)) throw new FetchError('auth', 'API key rejected');
      if (/not found|incorrect imdb id/i.test(err)) return { kind: 'notfound' };
      throw new FetchError('invalid', 'unexpected response');
    });
    omdbMemo.set(memoKey, p);
    return p;
  }

  const outcomes = new Map();
  await Promise.all(plan.items.map(async (job) => {
    counts.lookups++;
    try {
      const out = await omdbRequest(job);
      state.failures.omdb = 0;
      outcomes.set(job.src.key, out);
    } catch (e) {
      onFailure('omdb', e);
      if (!(e instanceof FetchError && e.kind === 'halted')) counts.failed++;
    }
  }));
  if (state.halted.omdb === 'auth') throw new RefreshError('auth', 'OMDb rejected the API key. Nothing was saved. Check the OMDB_API_KEY secret (and that the key is activated).', EXIT.AUTH);

  // ----- assemble entries in source order -----
  const byKey = new Map(existing.entries.map((e) => [e.key, e]));
  const entries = [];
  const winners = new Map(); // imdb id -> entry that owns it
  const stamp = (e) => ({ key: e.key, source: { title: e.src.title, year: e.src.year, imdbId: e.src.imdbId } });
  for (const s of sources) {
    const ex = byKey.get(s.key) ?? null;
    const out = outcomes.get(s.key);
    let entry;
    if (out?.kind === 'ok') {
      const same = ex && ex.status === 'ok' && ex.id === out.data.imdbId;
      entry = makeEntry({
        ...stamp({ key: s.key, src: s }), status: 'ok', id: out.data.imdbId, data: out.data,
        backdrop: same ? ex.backdrop : { ...EMPTY_BACKDROP }, fetchedAt: iso(t), refreshAfter: iso(t + days(policy.ttlDays) * jitter()),
      });
      counts.updated++;
    } else if (out?.kind === 'notfound') {
      counts.notFound++;
      if (ex && (ex.status === 'ok' || ex.status === 'alias')) entry = { ...ex, refreshAfter: iso(t + days(policy.negativeTtlDays) * jitter()) }; // keep valid data
      else entry = makeEntry({ ...stamp({ key: s.key, src: s }), status: 'notfound', fetchedAt: iso(t), refreshAfter: iso(t + days(policy.negativeTtlDays) * jitter()) });
    } else if (ex) {
      entry = { ...ex }; // not (successfully) looked up: preserve whatever we had
    } else {
      entry = makeEntry({ ...stamp({ key: s.key, src: s }), status: 'pending', refreshAfter: iso(t) });
    }
    if (entry.status === 'ok') {
      const w = winners.get(entry.id);
      if (w) { // two source lines resolve to the same title: keep the first, store the rest as aliases
        if (!w.backdrop.url && entry.backdrop?.url) w.backdrop = entry.backdrop;
        entry = makeEntry({ ...stamp({ key: s.key, src: s }), status: 'alias', id: entry.id, aliasOf: entry.id, fetchedAt: entry.fetchedAt, refreshAfter: entry.refreshAfter });
      } else winners.set(entry.id, entry);
    }
    entries.push(entry);
  }

  // ----- TMDB backdrops (optional) -----
  if (tmdbKey) {
    const bearer = tmdbKey.startsWith('eyJ');
    const due = entries.filter((e) => e.status === 'ok' && (force || !e.backdrop.refreshAfter || t >= Date.parse(e.backdrop.refreshAfter)));
    const tmdbMemo = new Map();
    await Promise.all(due.map(async (e) => {
      counts.tmdbChecked++;
      try {
        let p = tmdbMemo.get(e.id);
        if (p) counts.deduped++;
        else {
          const u = new URL(`https://api.themoviedb.org/3/find/${e.id}`);
          u.searchParams.set('external_source', 'imdb_id');
          if (!bearer) u.searchParams.set('api_key', tmdbKey);
          const headers = bearer ? { authorization: `Bearer ${tmdbKey}` } : undefined;
          p = limiter.run(async () => {
            const res = await http.getJson('tmdb', u.href, { headers });
            if (res.status === 401 || res.status === 403) throw new FetchError('auth', 'TMDB credential rejected');
            if (res.status === 404) return { url: null };
            if (res.status !== 200 || !res.body || typeof res.body !== 'object' || Array.isArray(res.body)) throw new FetchError('invalid', 'unexpected response');
            return { url: pickBackdrop(res.body, e.data.type) };
          });
          tmdbMemo.set(e.id, p);
        }
        const r = await p;
        state.failures.tmdb = 0;
        if (r.url) e.backdrop = { url: r.url, checkedAt: iso(t), refreshAfter: iso(t + days(policy.backdropTtlDays) * jitter()) };
        else e.backdrop = { url: e.backdrop.url, checkedAt: iso(t), refreshAfter: iso(t + days(policy.backdropNegativeTtlDays) * jitter()) };
      } catch (err) {
        onFailure('tmdb', err);
        if (!(err instanceof FetchError && err.kind === 'halted')) counts.tmdbFailed++;
      }
    }));
  }

  // ----- finalise: deterministic, validated, change-aware -----
  const digest = sourceDigest(sources.map((s) => s.key));
  const draft = { schemaVersion: SCHEMA_VERSION, generatedAt: existing.catalog.generatedAt, sourceDigest: digest, entries: entries.map(makeEntry) };
  const previousText = serializeCatalog(existing.catalog);
  let text = serializeCatalog(draft);
  const changed = text !== previousText;
  if (changed) { draft.generatedAt = iso(t); text = serializeCatalog(draft); }

  const check = inspectCatalog(JSON.parse(text), { bytes: Buffer.byteLength(text), forbidden });
  if (check.fatal || check.errors.length) throw new RefreshError('generated_invalid', `The generated catalog failed validation (${check.fatal || check.errors[0]}). Nothing was saved.`);

  const finalPending = draft.entries.filter((e) => e.status === 'pending').length;
  const warnings = [];
  if (state.halted.omdb === 'ratelimit') warnings.push('OMDb rate limit reached: remaining titles keep their previous data (or stay pending) and will be retried in a later run.');
  if (state.halted.omdb === 'budget') warnings.push(`OMDb request budget (${policy.maxOmdbRequests}) reached: the remaining titles will be handled in a later run.`);
  if (state.halted.omdb === 'failures') warnings.push('OMDb kept failing: stopped early to avoid hammering the API. Remaining titles will be retried in a later run.');
  if (state.halted.tmdb) warnings.push(`TMDB lookups stopped early (${state.halted.tmdb}); existing backdrops were kept.`);
  if (!tmdbKey) warnings.push('TMDB_API_KEY is not set: backdrops were not looked up (existing backdrops were kept).');
  if (skipped) warnings.push(`${skipped} line(s) in Movies.txt could not be represented and were skipped.`);
  if (counts.failed) warnings.push(`${counts.failed} title(s) could not be refreshed this run; previous data was kept.`);
  if (finalPending) warnings.push(`${finalPending} title(s) are still pending and will show without details until the next successful run.`);

  const complete = !state.halted.omdb && !state.halted.tmdb && counts.failed === 0 && counts.tmdbFailed === 0 && finalPending === 0;
  const report = {
    complete,
    changed,
    titles: { source: sources.length, skipped, reused: plan.counts.reused, looked_up: counts.lookups, updated: counts.updated, not_found: counts.notFound, failed: counts.failed, pending: finalPending, aliases: draft.entries.filter((e) => e.status === 'alias').length, removed: plan.removed.length },
    reasons: plan.counts,
    requests: { omdb: state.requests.omdb, tmdb: state.requests.tmdb, deduplicated: counts.deduped },
    halted: state.halted,
    tmdb: { enabled: !!tmdbKey, checked: counts.tmdbChecked, failed: counts.tmdbFailed },
    baseCatalogSha256: null, // filled in by the CLI (needs the raw file bytes)
    warnings,
  };
  log(`titles: ${sources.length}, reused: ${plan.counts.reused}, looked up: ${counts.lookups}, requests: omdb ${state.requests.omdb} / tmdb ${state.requests.tmdb}`);
  return { text, report, changed };
}
