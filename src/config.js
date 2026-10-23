// Build-time configuration injected by vite.config.js (see `define`).
//
// SECURITY: this object only ever carries the logo path. API credentials are NOT build-time
// configuration for the site at all: they are used solely by the catalog-refresh job in
// GitHub Actions (scripts/refresh-catalog.mjs), never by the browser bundle.
/* global __DQ_CONFIG__ */
const injected = typeof __DQ_CONFIG__ !== 'undefined' ? __DQ_CONFIG__ : {};

export const config = Object.freeze({
  logoPath: typeof injected.logoPath === 'string' && injected.logoPath ? injected.logoPath : 'logo.png',
});

/** The only data file the site reads (relative to the page, so it works under /<repo>/). */
export const CATALOG_FILE = 'data/catalog.json';
export const THEME_KEY = 'dq-theme';
