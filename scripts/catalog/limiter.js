// Tiny concurrency limiter whose queued jobs can be cancelled with an AbortSignal.
export function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

export function createLimiter(concurrency = 4) {
  let active = 0;
  const queue = [];

  const pump = () => {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      if (job.signal?.aborted) { job.reject(abortError()); continue; }
      active++;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => { active--; pump(); });
    }
  };

  return {
    run(fn, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const job = { fn, resolve, reject, signal };
        queue.push(job);
        signal?.addEventListener('abort', () => {
          const i = queue.indexOf(job);
          if (i >= 0) { queue.splice(i, 1); reject(abortError()); }
        }, { once: true });
        pump();
      });
    },
    get queued() { return queue.length; },
    get active() { return active; },
  };
}
