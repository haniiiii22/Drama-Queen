// Poster-grid pages: Home (everything), Movies and Series (filtered by the media type OMDb
// reported when the catalog was generated — never guessed from the title).
// All data is already in memory: rendering and filtering never touch the network.
import { h, icon, plural } from '../lib/dom.js';
import { normalizeKeyText } from '../lib/parser.js';

const PAGES = {
  home: { title: 'The collection', type: null, noun: ['title', 'titles'] },
  movies: { title: 'Movies', type: 'movie', noun: ['movie', 'movies'] },
  series: { title: 'Series', type: 'series', noun: ['series', 'series'] },
};

const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

/** @param {{ app: object, openDetails: Function, reloadList: Function, clearSearch: Function }} deps */
export function createCollection({ app, openDetails, reloadList, clearSearch }) {
  const cards = new Map(); // entry.id -> { el, hay }
  let page = null;
  let name = null;
  let applyQueued = false;
  let ui = null;

  // ---------- cards ----------
  function posterFrame(entry) {
    const r = entry.result;
    const frame = h('span', { class: 'poster' });
    if (r.state === 'ok') {
      const d = r.data;
      const fallback = () => {
        frame.replaceChildren(h('span', { class: 'poster-text' }, d.title));
        frame.classList.add('poster--none');
      };
      if (d.poster) {
        const img = h('img', {
          src: d.poster,
          alt: `Poster for ${d.title}${d.year ? ` (${d.year})` : ''}`,
          loading: 'lazy',
          decoding: 'async',
          referrerpolicy: 'no-referrer',
        });
        img.addEventListener('error', fallback, { once: true });
        frame.append(img);
      } else fallback();
    } else {
      frame.classList.add('poster--missing');
      frame.append(h('span', { class: 'poster-label' }, r.state === 'notfound' ? 'Not found' : 'Details pending'));
    }
    return frame;
  }

  function cardInner(entry) {
    const r = entry.result;
    const ok = r.state === 'ok';
    const d = ok ? r.data : null;
    const title = d ? d.title : entry.title;
    const year = d ? d.year : entry.year;

    const meta = h('span', { class: 'card-meta' });
    if (year) meta.append(h('span', null, String(year)));
    if (d?.rating != null) {
      meta.append(
        h('span', { class: 'rating', 'aria-label': `IMDb rating ${d.rating.toFixed(1)} out of 10` }, icon('star', { size: 13, filled: true }), h('span', { 'aria-hidden': 'true' }, d.rating.toFixed(1))),
      );
    }
    if (r.state === 'notfound') meta.append(h('span', { class: 'badge-missing' }, 'Not found'));

    const body = [posterFrame(entry), h('span', { class: 'card-title' }, title), meta];
    if (ok) {
      const btn = h('button', { type: 'button', class: 'card', 'aria-label': `Open details for ${title}${year ? ` (${year})` : ''}` }, body);
      btn.addEventListener('click', () => openDetails(entry, btn));
      return btn;
    }
    return h('div', { class: 'card card--static' }, body);
  }

  function getCard(entry) {
    let c = cards.get(entry.id);
    if (c) return c;
    const el = h('li', { class: 'card-item' }, cardInner(entry));
    const detail = entry.result.state === 'ok' ? entry.result.data.title : '';
    c = { el, hay: normalizeKeyText(`${entry.title} ${detail}`) };
    cards.set(entry.id, c);
    return c;
  }

  // ---------- filtering & status ----------
  function schedule() {
    if (applyQueued || !page) return;
    applyQueued = true;
    raf(() => { applyQueued = false; apply(); });
  }

  function apply() {
    if (!page || app.status !== 'ready' || !ui) return;
    const cfg = PAGES[name];
    const q = normalizeKeyText(app.query || '');
    let shown = 0;
    let pending = 0;

    for (const e of app.entries) {
      const c = getCard(e);
      if (e.result.state === 'pending') pending++;
      const typeOk = !cfg.type || (e.result.state === 'ok' && e.result.data.type === cfg.type);
      const vis = typeOk && (!q || c.hay.includes(q));
      if (c.el.hidden === vis) c.el.hidden = !vis;
      if (vis) shown++;
    }

    const total = app.entries.length;
    if (q) ui.count.textContent = `${plural(shown, ...cfg.noun)} matching “${app.query.trim()}”`;
    else if (!cfg.type) ui.count.textContent = plural(total, ...cfg.noun);
    else ui.count.textContent = plural(shown, ...cfg.noun);

    renderBanner(pending);
    renderEmpty({ shown, q });
  }

  function renderBanner(pending) {
    const msg = pending > 0 ? `${plural(pending, 'title doesn’t', 'titles don’t')} have details yet. They will appear after the next successful catalog refresh.` : null;
    if (ui.bannerMsg === msg) return;
    ui.bannerMsg = msg;
    ui.banner.replaceChildren(msg ? h('p', null, msg) : '');
    ui.banner.hidden = !msg;
  }

  function renderEmpty({ shown, q }) {
    const cfg = PAGES[name];
    let node = null;
    if (shown === 0) {
      if (q) {
        const clear = h('button', { type: 'button', class: 'btn btn--quiet' }, 'Clear search');
        clear.addEventListener('click', clearSearch);
        node = h('div', { class: 'empty empty--compact' }, h('h2', null, `Nothing matches “${app.query.trim()}”`), h('p', null, 'Check the spelling or try a shorter search.'), clear);
      } else if (cfg.type) {
        node = h('div', { class: 'empty empty--compact' }, h('h2', null, `No ${cfg.noun[1]} to show`), h('p', null, `None of the titles in the catalog are classified as ${cfg.noun[1]}.`));
      }
    }
    if (ui.emptyNode?.isEqualNode?.(node) && node) return;
    ui.empty.replaceChildren(node || '');
    ui.empty.hidden = !node;
    ui.emptyNode = node;
  }

  // ---------- list-level states ----------
  function listState() {
    if (app.status === 'ready') return null;
    if (app.status === 'loading') {
      return h('div', { class: 'empty empty--compact', role: 'status' }, h('p', null, 'Loading your collection…'));
    }
    if (app.status === 'error' || app.status === 'unsupported') {
      const again = h('button', { type: 'button', class: 'btn' }, 'Try again');
      again.addEventListener('click', reloadList);
      const unsupported = app.status === 'unsupported';
      return h(
        'div',
        { class: 'empty' },
        h('h2', null, unsupported ? 'This catalog needs a newer site' : 'Couldn’t load the collection'),
        h('p', null, unsupported ? 'The catalog was written by a newer version of Drama Queen than this page understands. Reload the page, or redeploy the site.' : 'The catalog file could not be loaded. Check your connection, then try again.'),
        again,
      );
    }
    // 'empty' (catalog has no entries) and 'missing' (no catalog file in this build)
    return h(
      'div',
      { class: 'empty' },
      h('h2', null, 'Add your titles'),
      h('p', null, 'Drama Queen shows the titles from a plain-text file named Movies.txt. Details are collected ahead of time by a GitHub Actions workflow, so nothing is looked up while you browse.'),
      h('p', null, 'Put the file in the project’s public folder, one title per line, then run the “Update catalog and deploy” workflow:'),
      h('ul', { class: 'format' }, h('li', null, h('code', null, 'Title')), h('li', null, h('code', null, 'Title (year)')), h('li', null, h('code', null, 'tt followed by digits, an IMDb ID'))),
      h('p', null, 'The README has the full details.'),
    );
  }

  // ---------- lifecycle ----------
  function unmount() {
    page = null;
    ui = null;
  }

  function mount(container, pageName) {
    unmount();
    name = PAGES[pageName] ? pageName : 'home';
    const cfg = PAGES[name];

    const count = h('p', { class: 'count', 'aria-live': 'polite' });
    const banner = h('div', { class: 'banner', role: 'status', hidden: true });
    const empty = h('div', { class: 'empty-wrap', hidden: true });
    const grid = h('ul', { class: 'grid', 'aria-label': cfg.title });

    page = h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('h1', { tabindex: '-1' }, cfg.title), count), banner, grid, empty);
    ui = { count, banner, empty, bannerMsg: undefined, emptyNode: null };
    container.replaceChildren(page);

    const state = listState();
    if (state) {
      grid.hidden = true;
      empty.hidden = false;
      empty.replaceChildren(state);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const e of app.entries) frag.append(getCard(e).el);
    grid.append(frag);
    apply();
  }

  return {
    mount,
    unmount,
    refresh: schedule,
    /** Forgets rendered cards (after the catalog is reloaded). */
    reset() { cards.clear(); },
    destroy() { unmount(); },
  };
}
