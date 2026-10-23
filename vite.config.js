import { defineConfig, loadEnv } from 'vite';
import { createHash } from 'node:crypto';

const log = (msg) => console.log(`[drama-queen] ${msg}`);

/**
 * Build-time configuration for the SITE. It deliberately contains no API credentials:
 * OMDb/TMDB keys are only read by scripts/refresh-catalog.mjs in the CI "fetch" job.
 * Only the (public) logo path is injected into the bundle.
 */
function readConfig(mode) {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const raw = typeof env.LOGO_PATH === 'string' ? env.LOGO_PATH.trim() : '';
  const ok = /^[A-Za-z0-9._\-/]{1,120}$/.test(raw) && !raw.includes('..');
  if (raw && !ok) log('LOGO_PATH is not a safe relative path — using logo.png.');
  return { logoPath: raw && ok ? raw.replace(/^\/+/, '') : 'logo.png' };
}

/** Injects a Content-Security-Policy <meta> at build time, hashing the one inline theme script. */
function cspPlugin() {
  return {
    name: 'dq-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
        const hashes = inline.map((code) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`);
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(' ')}`.trim(),
          "style-src 'self'",
          // Posters / backdrops are plain <img> loads from these image CDNs; no API is ever contacted.
          "img-src 'self' data: https://m.media-amazon.com https://ia.media-imdb.com https://image.tmdb.org",
          "font-src 'self' data:",
          "connect-src 'self'", // the page may only fetch its own static files (the catalog)
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'none'",
        ].join('; ');
        return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const cfg = readConfig(mode);
  return {
    // Relative base: assets, the logo and data/catalog.json resolve correctly under any
    // GitHub Pages path (https://user.github.io/<repo>/) or custom domain.
    base: './',
    define: { __DQ_CONFIG__: JSON.stringify(cfg) },
    plugins: [cspPlugin()],
    build: { target: 'es2020', sourcemap: false, assetsInlineLimit: 2048 },
  };
});
