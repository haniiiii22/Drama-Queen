import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-700.css';
import './styles/main.css';

import { config, CATALOG_FILE } from './config.js';
import { inspectCatalog, catalogToEntries, LIMITS } from './lib/catalog.js';
import { icon } from './lib/dom.js';
import { initThemeToggle } from './ui/theme.js';
import { createCollection } from './ui/collection.js';
import { createModal } from './ui/modal.js';
import { renderAbout } from './ui/about.js';

const ROUTES = { '': 'home', movies: 'movies', series: 'series', about: 'about' };
const TITLES = { home: 'Drama Queen', movies: 'Movies · Drama Queen', series: 'Series · Drama Queen', about: 'About · Drama Queen' };

const $ = (sel) => document.querySelector(sel);
const main = $('#main');
const nav = $('#site-nav');
const menuBtn = $('#menu-btn');
const input = $('#search-input');
const clearBtn = $('#search-clear');

/**
 * Shared state. `entries` come from the static catalog generated at deploy time; every entry
 * already carries its result, so nothing in this app ever calls OMDb or TMDB.
 * status: loading | ready | empty | missing | error | unsupported
 */
const app = { entries: [], status: 'loading', query: '' };

// ---------- catalog ----------
async function loadCatalog() {
  app.status = 'loading';
  try {
    const url = new URL(CATALOG_FILE, document.baseURI);
    // Revalidate with the host (cheap conditional request) so a freshly deployed catalog is never
    // hidden behind a stale browser or CDN copy.
    const res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
    const type = res.headers.get('content-type') || '';
    if (res.status === 404 || res.status === 410 || type.includes('text/html')) { app.entries = []; app.status = 'missing'; return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > LIMITS.maxBytes) throw new Error('catalog too large');
    const result = inspectCatalog(JSON.parse(text));
    if (result.fatal) {
      app.entries = [];
      app.status = /schemaVersion/.test(result.fatal) ? 'unsupported' : 'error';
      return;
    }
    // Defence in depth: entries that fail validation are skipped, the rest still render.
    app.entries = catalogToEntries(result.entries);
    app.status = app.entries.length ? 'ready' : 'empty';
  } catch {
    app.entries = [];
    app.status = 'error';
  }
}

async function reloadList() {
  collection.unmount();
  render({ focus: false });
  await loadCatalog();
  collection.reset();
  render({ focus: false });
}

// ---------- views ----------
const modal = createModal({ inertTargets: () => [$('#app-shell'), $('#skip-link')].filter(Boolean) });
const collection = createCollection({
  app,
  openDetails: (entry, trigger) => modal.open(entry, trigger),
  reloadList,
  clearSearch: () => setQuery(''),
});

function currentRoute() {
  const key = location.hash.replace(/^#\/?/, '').split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
  return ROUTES[key] ?? 'home';
}

function render({ focus = true } = {}) {
  const route = currentRoute();
  modal.close({ restore: false });
  setMenu(false);
  for (const a of nav.querySelectorAll('a')) {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = TITLES[route];
  if (route === 'about') {
    collection.unmount();
    main.replaceChildren(renderAbout());
  } else {
    collection.mount(main, route);
  }
  if (focus) {
    window.scrollTo(0, 0);
    main.querySelector('h1')?.focus({ preventScroll: true });
  }
}

// ---------- header ----------
function initLogo() {
  const slot = $('#brand-logo');
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.className = 'brand-logo-img';
  // Shown only if the file exists and decodes; otherwise nothing is rendered at all.
  img.onload = () => { slot.append(img); slot.hidden = false; };
  img.onerror = () => { /* no logo: display nothing */ };
  img.src = new URL(config.logoPath, document.baseURI).href;
}

function setMenu(open) {
  nav.classList.toggle('is-open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  menuBtn.replaceChildren(icon(open ? 'close' : 'menu'));
}

function setQuery(value) {
  input.value = value;
  applyQuery(value);
}

function applyQuery(value) {
  app.query = value;
  clearBtn.hidden = !value;
  if (currentRoute() === 'about') {
    if (value.trim()) location.hash = '#/';
    return;
  }
  collection.refresh();
}

function initHeader() {
  $('#search-icon').append(icon('search', { size: 18 }));
  clearBtn.append(icon('close', { size: 16 }));
  initThemeToggle($('#theme-toggle'));
  setMenu(false);
  initLogo();

  menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open') && !modal.isOpen) { setMenu(false); menuBtn.focus(); }
  });

  let timer = 0;
  input.addEventListener('input', () => {
    clearBtn.hidden = !input.value;
    clearTimeout(timer);
    timer = setTimeout(() => applyQuery(input.value), 150);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); setQuery(''); } });
  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); applyQuery(input.value); });
  clearBtn.addEventListener('click', () => { setQuery(''); input.focus(); });

  $('#skip-link').addEventListener('click', (e) => { e.preventDefault(); main.focus(); });
}

// ---------- boot ----------
initHeader();
window.addEventListener('hashchange', () => render());
render({ focus: false });
loadCatalog().then(() => render({ focus: false }));
