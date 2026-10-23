// Freshness and request-budget policy for the metadata refresh. Every value can be
// overridden with a (non-secret) environment variable; out-of-range values are rejected
// and replaced by the default, with a warning.
const DAY = 86_400_000;

const SPEC = {
  ttlDays: { env: 'CATALOG_TTL_DAYS', def: 14, min: 1, max: 365 },
  negativeTtlDays: { env: 'CATALOG_NEGATIVE_TTL_DAYS', def: 3, min: 0.04, max: 60 },
  backdropTtlDays: { env: 'CATALOG_BACKDROP_TTL_DAYS', def: 30, min: 1, max: 365 },
  backdropNegativeTtlDays: { env: 'CATALOG_BACKDROP_NEGATIVE_TTL_DAYS', def: 3, min: 0.04, max: 60 },
  maxOmdbRequests: { env: 'CATALOG_MAX_OMDB_REQUESTS', def: 900, min: 1, max: 100000 },
  maxTmdbRequests: { env: 'CATALOG_MAX_TMDB_REQUESTS', def: 900, min: 1, max: 100000 },
  concurrency: { env: 'CATALOG_CONCURRENCY', def: 3, min: 1, max: 8 },
};

export const DEFAULTS = Object.freeze({
  ...Object.fromEntries(Object.entries(SPEC).map(([k, v]) => [k, v.def])),
  jitter: 0.2, // refreshAfter is stretched by up to +20% so entries don't all expire on one day
  timeoutMs: 10_000,
  retries: 2, // retries after the first attempt (transient failures only)
  backoffBaseMs: 600,
  backoffMaxMs: 8_000,
  maxRetryAfterMs: 30_000, // longer Retry-After values stop the run instead of waiting
  haltAfterConsecutiveFailures: 5,
});

export function policyFromEnv(env = {}, warn = () => {}) {
  const p = { ...DEFAULTS };
  for (const [k, s] of Object.entries(SPEC)) {
    const raw = env[s.env];
    if (raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= s.min && n <= s.max) p[k] = n;
    else warn(`${s.env} must be a number between ${s.min} and ${s.max}; using the default (${s.def}).`);
  }
  return p;
}

export const days = (n) => n * DAY;
