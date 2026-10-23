// Catalog schema, validation and sanitising. Pure and dependency-free: it runs in
// Node (refresh / persist / validate scripts) and in the browser (defence in depth).
//
// The catalog (public/data/catalog.json) is the ONLY data the deployed site reads.
// See docs/CATALOG.md for the human-readable schema.
import { isImdbId, safeImageUrl } from './validate.js';

export const SCHEMA_VERSION = 1;
export const LIMITS = Object.freeze({ maxEntries: 3000, maxBytes: 12 * 1024 * 1024 });
export const STATUSES = Object.freeze(['ok', 'notfound', 'pending', 'alias']);
export const MEDIA_TYPES = Object.freeze(['movie', 'series', 'episode', 'game', 'other']);
export const BACKDROP_HOSTS = Object.freeze(['image.tmdb.org']);

const KEY_RE = /^(?:id:tt\d{6,10}|t:[^\r\n]{1,300}\|(?:\d{4})?)$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const YEAR_RE = /^\d{4}(?:–(?:\d{4})?)?$/;
const VOTES_RE = /^\d{1,3}(?:,\d{3})*$|^\d+$/;
const DIGEST_RE = /^[a-f0-9]{64}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;

/** Patterns that must never appear in public data (credentials or credential-bearing URLs). */
const SECRET_PATTERNS = [
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT-like (TMDB v4 token)
  /(?:^|[?&;\s"'])(?:api[_-]?key|apikey|access[_-]?token)\s*=/i, // key in a query string
  /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\bauthorization\s*:/i,
];

export function looksLikeSecret(value) {
  return typeof value === 'string' && SECRET_PATTERNS.some((re) => re.test(value));
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIso = (v) => typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));

// ---------- field sanitisers: return the clean value, or undefined when invalid ----------
function str(v, max) {
  if (typeof v !== 'string' || !v || v.length > max || CONTROL.test(v)) return undefined;
  if (v !== v.trim() || /\s{2,}/.test(v) || v.toUpperCase() === 'N/A') return undefined;
  return v;
}
const optStr = (max) => (v) => (v === null ? null : str(v, max));
const optPattern = (re, max) => (v) => (v === null ? null : typeof v === 'string' && v.length <= max && re.test(v) ? v : undefined);
function optList(v) {
  if (v === null) return null;
  if (!Array.isArray(v) || !v.length || v.length > 40) return undefined;
  return v.every((x) => str(x, 200) === x) ? v : undefined;
}
function optRating(v) {
  if (v === null) return null;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10 ? v : undefined;
}
function optPoster(v) {
  if (v === null) return null;
  const safe = safeImageUrl(v);
  if (!safe || safe !== v) return undefined;
  const u = new URL(safe);
  return u.search || u.hash ? undefined : safe;
}

const DATA_FIELDS = {
  imdbId: (v) => (isImdbId(v) ? v : undefined),
  title: (v) => str(v, 300),
  type: (v) => (MEDIA_TYPES.includes(v) ? v : undefined),
  year: optPattern(YEAR_RE, 12),
  rating: optRating,
  votes: optPattern(VOTES_RE, 14),
  poster: optPoster,
  plot: optStr(4000),
  genres: optList,
  cast: optList,
  directors: optList,
  writers: optList,
  runtime: optStr(40),
  languages: optList,
  countries: optList,
  rated: optStr(20),
  released: optStr(30),
  awards: optStr(300),
  seasons: optPattern(/^\d{1,3}$/, 3),
};

/** Validates one entry's `data` object. Returns { value, problems }. */
export function sanitizeData(d) {
  const problems = [];
  if (!isObj(d)) return { value: null, problems: ['data is not an object'] };
  const out = {};
  for (const k of Object.keys(d)) if (!(k in DATA_FIELDS)) problems.push(`unknown data field "${k}"`);
  for (const [k, fn] of Object.entries(DATA_FIELDS)) {
    const v = d[k] === undefined ? null : d[k];
    const clean = fn(v);
    if (clean === undefined) {
      problems.push(`invalid data.${k}`);
      out[k] = null;
    } else out[k] = clean;
    if (looksLikeSecret(JSON.stringify(v))) problems.push(`data.${k} looks like a credential`);
  }
  if (!out.imdbId || !out.title) return { value: null, problems };
  return { value: out, problems };
}

function sanitizeBackdrop(b) {
  const problems = [];
  if (!isObj(b)) return { value: null, problems: ['backdrop is not an object'] };
  for (const k of Object.keys(b)) if (!['url', 'checkedAt', 'refreshAfter'].includes(k)) problems.push(`unknown backdrop field "${k}"`);
  let url = b.url ?? null;
  if (url !== null) {
    const safe = safeImageUrl(url, BACKDROP_HOSTS);
    const u = safe ? new URL(safe) : null;
    if (!safe || safe !== url || u.search || u.hash) { problems.push('invalid backdrop.url'); url = null; }
  }
  const checkedAt = b.checkedAt ?? null;
  const refreshAfter = b.refreshAfter ?? null;
  if (checkedAt !== null && !isIso(checkedAt)) problems.push('invalid backdrop.checkedAt');
  if (refreshAfter !== null && !isIso(refreshAfter)) problems.push('invalid backdrop.refreshAfter');
  return { value: { url, checkedAt: isIso(checkedAt) ? checkedAt : null, refreshAfter: isIso(refreshAfter) ? refreshAfter : null }, problems };
}

function sanitizeSource(s) {
  const problems = [];
  if (!isObj(s)) return { value: null, problems: ['source is not an object'] };
  for (const k of Object.keys(s)) if (!['title', 'year', 'imdbId'].includes(k)) problems.push(`unknown source field "${k}"`);
  const title = str(s.title, 200);
  const year = s.year ?? null;
  const imdbId = s.imdbId ?? null;
  if (!title) problems.push('invalid source.title');
  if (year !== null && !(Number.isInteger(year) && year >= 1800 && year <= new Date().getUTCFullYear() + 6)) problems.push('invalid source.year');
  if (imdbId !== null && !isImdbId(imdbId)) problems.push('invalid source.imdbId');
  if (!title) return { value: null, problems };
  return { value: { title, year: problems.includes('invalid source.year') ? null : year, imdbId: problems.includes('invalid source.imdbId') ? null : imdbId }, problems };
}

const ENTRY_FIELDS = ['key', 'source', 'status', 'id', 'aliasOf', 'data', 'backdrop', 'fetchedAt', 'refreshAfter'];

/** Canonical entry with a fixed key order so output is deterministic. */
export function makeEntry(e) {
  return {
    key: e.key,
    source: { title: e.source.title, year: e.source.year ?? null, imdbId: e.source.imdbId ?? null },
    status: e.status,
    id: e.id ?? null,
    aliasOf: e.aliasOf ?? null,
    data: e.data ?? null,
    backdrop: e.backdrop ?? null,
    fetchedAt: e.fetchedAt ?? null,
    refreshAfter: e.refreshAfter,
  };
}

export function checkEntry(raw) {
  const problems = [];
  if (!isObj(raw)) return { entry: null, problems: ['entry is not an object'] };
  for (const k of Object.keys(raw)) if (!ENTRY_FIELDS.includes(k)) problems.push(`unknown entry field "${k}"`);

  const key = typeof raw.key === 'string' && KEY_RE.test(raw.key) ? raw.key : null;
  if (!key) problems.push('invalid key');
  const src = sanitizeSource(raw.source);
  problems.push(...src.problems);
  const status = STATUSES.includes(raw.status) ? raw.status : null;
  if (!status) problems.push('invalid status');
  const id = raw.id ?? null;
  const aliasOf = raw.aliasOf ?? null;
  const fetchedAt = raw.fetchedAt ?? null;
  const refreshAfter = raw.refreshAfter;
  if (id !== null && !isImdbId(id)) problems.push('invalid id');
  if (aliasOf !== null && !isImdbId(aliasOf)) problems.push('invalid aliasOf');
  if (fetchedAt !== null && !isIso(fetchedAt)) problems.push('invalid fetchedAt');
  if (!isIso(refreshAfter)) problems.push('invalid refreshAfter');

  let data = null;
  let backdrop = null;
  if (status === 'ok') {
    const d = sanitizeData(raw.data);
    problems.push(...d.problems);
    data = d.value;
    if (data && id !== data.imdbId) problems.push('id does not match data.imdbId');
    if (!id) problems.push('ok entry needs an id');
    const b = sanitizeBackdrop(raw.backdrop);
    problems.push(...b.problems);
    backdrop = b.value;
    if (!fetchedAt) problems.push('ok entry needs fetchedAt');
    if (aliasOf !== null) problems.push('ok entry must not set aliasOf');
  } else if (status === 'alias') {
    if (!id || aliasOf !== id) problems.push('alias entry needs id === aliasOf');
    if (raw.data !== null && raw.data !== undefined) problems.push('alias entry must not carry data');
    if (raw.backdrop !== null && raw.backdrop !== undefined) problems.push('alias entry must not carry a backdrop');
    if (!fetchedAt) problems.push('alias entry needs fetchedAt');
  } else if (status === 'notfound' || status === 'pending') {
    if (id !== null || aliasOf !== null) problems.push(`${status} entry must not have an id`);
    if (raw.data !== null && raw.data !== undefined) problems.push(`${status} entry must not carry data`);
    if (raw.backdrop !== null && raw.backdrop !== undefined) problems.push(`${status} entry must not carry a backdrop`);
    if (status === 'notfound' && !fetchedAt) problems.push('notfound entry needs fetchedAt');
    if (status === 'pending' && fetchedAt !== null) problems.push('pending entry must not have fetchedAt');
  }

  const usable = key && src.value && status && isIso(refreshAfter) && (status !== 'ok' || (data && backdrop));
  if (!usable) return { entry: null, problems };
  const entry = makeEntry({ key, source: src.value, status, id, aliasOf, data, backdrop, fetchedAt, refreshAfter });
  return { entry, problems };
}

/**
 * Inspects a parsed catalog.
 * @returns {{ fatal: string|null, errors: string[], entries: object[], meta: object|null }}
 *   `fatal` => unusable. `errors` => problems found (strict callers treat any as failure;
 *   the browser simply uses the entries that did validate).
 */
export function inspectCatalog(raw, { bytes = 0, forbidden = [] } = {}) {
  const errors = [];
  if (!isObj(raw)) return { fatal: 'catalog is not a JSON object', errors, entries: [], meta: null };
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    const newer = Number.isInteger(raw.schemaVersion) && raw.schemaVersion > SCHEMA_VERSION;
    return { fatal: `unsupported schemaVersion ${JSON.stringify(raw.schemaVersion)}${newer ? ' (newer than this site understands)' : ''}`, errors, entries: [], meta: null };
  }
  for (const k of Object.keys(raw)) if (!['schemaVersion', 'generatedAt', 'sourceDigest', 'entries'].includes(k)) errors.push(`unknown top-level field "${k}"`);
  if (raw.generatedAt !== null && !isIso(raw.generatedAt)) errors.push('invalid generatedAt');
  if (raw.sourceDigest !== null && !(typeof raw.sourceDigest === 'string' && DIGEST_RE.test(raw.sourceDigest))) errors.push('invalid sourceDigest');
  if (!Array.isArray(raw.entries)) return { fatal: 'entries is not an array', errors, entries: [], meta: null };
  if (raw.entries.length > LIMITS.maxEntries) return { fatal: `too many entries (${raw.entries.length} > ${LIMITS.maxEntries})`, errors, entries: [], meta: null };
  if (bytes > LIMITS.maxBytes) return { fatal: `catalog too large (${bytes} bytes > ${LIMITS.maxBytes})`, errors, entries: [], meta: null };
  if (raw.entries.length > 0 && raw.generatedAt === null) errors.push('generatedAt is null but entries exist');

  const entries = [];
  const keys = new Set();
  const ids = new Set();
  raw.entries.forEach((e, i) => {
    const { entry, problems } = checkEntry(e);
    const label = entry ? entry.key : `#${i}`;
    for (const p of problems) errors.push(`entry ${label}: ${p}`);
    if (!entry) return;
    if (keys.has(entry.key)) { errors.push(`entry ${label}: duplicate key`); return; }
    keys.add(entry.key);
    if (entry.status === 'ok') {
      if (ids.has(entry.id)) { errors.push(`entry ${label}: duplicate IMDb id ${entry.id}`); return; }
      ids.add(entry.id);
    }
    entries.push(entry);
  });
  for (const e of entries) if (e.status === 'alias' && !ids.has(e.aliasOf)) errors.push(`entry ${e.key}: alias target ${e.aliasOf} not in catalog`);

  const blob = JSON.stringify(raw);
  if (looksLikeSecret(blob)) errors.push('catalog contains credential-like content');
  for (const f of forbidden) if (typeof f === 'string' && f.length >= 6 && blob.includes(f)) errors.push('catalog contains a configured secret value');

  return { fatal: null, errors, entries, meta: { generatedAt: raw.generatedAt ?? null, sourceDigest: raw.sourceDigest ?? null } };
}

export function emptyCatalog() {
  return { schemaVersion: SCHEMA_VERSION, generatedAt: null, sourceDigest: null, entries: [] };
}

export function serializeCatalog(c) {
  return `${JSON.stringify({ schemaVersion: c.schemaVersion, generatedAt: c.generatedAt, sourceDigest: c.sourceDigest, entries: c.entries.map(makeEntry) }, null, 2)}\n`;
}

/** Converts validated catalog entries into the shape the UI renders (aliases are hidden). */
export function catalogToEntries(entries) {
  const out = [];
  for (const e of entries) {
    if (e.status === 'alias') continue;
    const base = { id: e.key, key: e.key, title: e.source.title, year: e.source.year, imdbId: e.source.imdbId };
    if (e.status === 'ok') out.push({ ...base, result: { state: 'ok', data: { ...e.data, backdrop: e.backdrop?.url ?? null } } });
    else out.push({ ...base, result: { state: e.status } }); // 'notfound' | 'pending'
  }
  return out;
}
