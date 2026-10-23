// HTTP layer for the refresh job. Responsibilities: explicit timeouts, bounded retries with
// exponential backoff + jitter for transient failures, Retry-After handling, request counting
// and budgets. Errors NEVER contain the request URL (OMDb puts the API key in the query string).

export class FetchError extends Error {
  /** @param {'ratelimit'|'auth'|'transient'|'invalid'|'halted'} kind */
  constructor(kind, message, { retryAfterMs = null, status = null } = {}) {
    super(message);
    this.name = 'FetchError';
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

/** Parses a Retry-After header (delta-seconds or HTTP date) into milliseconds, or null. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (/^\d{1,7}$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

/**
 * @param {object} o
 * @param {Function} o.fetchImpl      fetch-compatible function
 * @param {Function} o.sleep          (ms) => Promise
 * @param {Function} o.random         () => [0,1)
 * @param {object}   o.policy         timeoutMs, retries, backoffBaseMs, backoffMaxMs, maxRetryAfterMs
 * @param {Function} o.beforeAttempt  (service) => void; may throw FetchError('halted') to stop (budget, circuit breaker)
 */
export function createHttp({ fetchImpl, sleep, random, policy, beforeAttempt }) {
  async function once(url, headers) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), policy.timeoutMs);
    try {
      const res = await fetchImpl(url, { headers: { accept: 'application/json', ...headers }, signal: ctrl.signal, redirect: 'error' });
      const raw = await res.text();
      let body = null;
      try { body = JSON.parse(raw.slice(0, 2_000_000)); } catch { /* not JSON */ }
      return { status: res.status, body, retryAfterMs: parseRetryAfter(res.headers?.get?.('retry-after')) };
    } catch {
      throw new FetchError('transient', ctrl.signal.aborted ? 'request timed out' : 'network error');
    } finally {
      clearTimeout(timer);
    }
  }

  const backoff = (attempt, retryAfterMs) => {
    const exp = Math.min(policy.backoffMaxMs, policy.backoffBaseMs * 2 ** attempt);
    const jittered = Math.round(exp * (0.5 + random() * 0.5));
    return retryAfterMs != null ? Math.max(jittered, retryAfterMs) : jittered;
  };

  /** @returns {Promise<{status:number, body:any}>}; throws FetchError */
  async function getJson(service, url, { headers } = {}) {
    for (let attempt = 0; ; attempt++) {
      beforeAttempt(service);
      let res;
      try {
        res = await once(url, headers);
      } catch (e) {
        if (attempt < policy.retries) { await sleep(backoff(attempt, null)); continue; }
        throw e;
      }
      if (res.status === 429) {
        const ra = res.retryAfterMs;
        if (ra != null && ra <= policy.maxRetryAfterMs && attempt < policy.retries) { await sleep(backoff(attempt, ra)); continue; }
        throw new FetchError('ratelimit', 'rate limited (HTTP 429)', { retryAfterMs: ra, status: 429 });
      }
      if (res.status >= 500) {
        const ra = res.retryAfterMs;
        if (attempt < policy.retries && (ra == null || ra <= policy.maxRetryAfterMs)) { await sleep(backoff(attempt, ra)); continue; }
        throw new FetchError('transient', `server error (HTTP ${res.status})`, { retryAfterMs: ra, status: res.status });
      }
      return { status: res.status, body: res.body };
    }
  }

  return { getJson };
}
