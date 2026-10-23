// Cinematic details modal. Plain solid theme background unless a backdrop image
// actually loads — there is deliberately no fallback imagery or effect.
import { h, icon } from '../lib/dom.js';

const TYPE_LABEL = { movie: 'Movie', series: 'Series', episode: 'Episode', game: 'Game', other: 'Title' };
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function createModal({ inertTargets = () => [] } = {}) {
  let overlay = null;
  let dialog = null;
  let ctrl = null;
  let returnTo = null;
  let inerted = [];

  function details(d) {
    const rows = [
      ['Cast', d.cast?.join(', ')],
      ['Genre', d.genres?.join(', ')],
      ['Runtime', d.runtime],
      ['Director', d.directors?.join(', ')],
      ['Writer', d.writers?.join(', ')],
      ['Seasons', d.type === 'series' ? d.seasons : null],
      ['Language', d.languages?.join(', ')],
      ['Country', d.countries?.join(', ')],
      ['Rated', d.rated],
      ['Released', d.released],
      ['Awards', d.awards],
    ].filter(([, v]) => v);
    return h('dl', { class: 'details' }, rows.map(([k, v]) => h('div', { class: 'detail' }, h('dt', null, k), h('dd', null, v))));
  }

  function posterBlock(d) {
    const box = h('div', { class: 'info-poster' });
    const none = () => { box.classList.add('info-poster--none'); box.replaceChildren(h('span', { class: 'poster-text' }, d.title)); };
    if (!d.poster) { none(); return box; }
    const img = h('img', { src: d.poster, alt: `Poster for ${d.title}${d.year ? ` (${d.year})` : ''}`, decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', none, { once: true });
    box.append(img);
    return box;
  }

  function build(d) {
    const typeLabel = TYPE_LABEL[d.type] || 'Title';
    const heroChips = h('div', { class: 'chips' });
    if (d.year) heroChips.append(h('span', { class: 'chip' }, d.year));
    heroChips.append(h('span', { class: 'chip' }, typeLabel));
    if (d.rating != null) {
      heroChips.append(h('span', { class: 'chip chip--rating', 'aria-label': `IMDb rating ${d.rating.toFixed(1)} out of 10` }, icon('star', { size: 14, filled: true }), h('span', { 'aria-hidden': 'true' }, `${d.rating.toFixed(1)}/10`)));
    }

    const closeBtn = h('button', { type: 'button', class: 'icon-btn modal-close', 'aria-label': 'Close details' }, icon('close'));
    closeBtn.addEventListener('click', () => close());

    const hero = h('header', { class: 'hero' }, h('div', { class: 'hero-text' }, h('h2', { id: 'dq-modal-title' }, d.title), heroChips));

    const rating = d.rating != null
      ? h('p', { class: 'score' }, h('span', { class: 'score-value' }, d.rating.toFixed(1)), h('span', { class: 'score-of' }, '/10 on IMDb'), d.votes ? h('span', { class: 'score-votes' }, `${d.votes} votes`) : null)
      : h('p', { class: 'score score--none' }, 'No IMDb rating available');

    const facts = h('div', { class: 'chips chips--info' }, d.year ? h('span', { class: 'chip' }, d.year) : null, h('span', { class: 'chip' }, typeLabel));

    const body = h(
      'div',
      { class: 'info-body' },
      h('h3', { class: 'info-title' }, d.title),
      rating,
      facts,
      h('h4', null, 'Plot'),
      d.plot ? h('p', { class: 'plot' }, d.plot) : h('p', { class: 'plot plot--none' }, 'No plot summary is available for this title.'),
      details(d),
      h('a', { class: 'btn btn--quiet imdb-link', href: `https://www.imdb.com/title/${d.imdbId}/`, target: '_blank', rel: 'noopener noreferrer' }, 'View on IMDb'),
    );

    const scroll = h('div', { class: 'dialog-scroll', tabindex: '0' }, hero, h('div', { class: 'info' }, posterBlock(d), body));
    dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dq-modal-title' }, closeBtn, scroll);
    return { hero, closeBtn };
  }

  // The backdrop URL comes from the catalog (generated ahead of time); this only loads the image
  // itself. If there is no URL, or the image fails, the hero stays a plain themed surface.
  function loadBackdrop(d, hero, signal) {
    if (!d.backdrop) return;
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.className = 'hero-img';
    img.onload = () => {
      if (signal.aborted) return;
      hero.prepend(h('div', { class: 'hero-scrim' }));
      hero.prepend(img);
      hero.classList.add('has-backdrop');
    };
    img.onerror = () => { /* keep the plain themed hero */ };
    img.src = d.backdrop;
  }

  function onKeydown(e) {
    if (!overlay) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => !el.hidden);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialog.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !dialog.contains(active))) { e.preventDefault(); first.focus(); }
  }

  function open(entry, trigger) {
    const d = entry?.result?.state === 'ok' ? entry.result.data : null;
    if (!d) return;
    close({ restore: false });
    returnTo = trigger || document.activeElement;
    ctrl = new AbortController();
    const { hero, closeBtn } = build(d);
    overlay = h('div', { class: 'modal' }, dialog);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.body.append(overlay);
    document.documentElement.classList.add('modal-open');
    inerted = inertTargets();
    for (const el of inerted) el.setAttribute('inert', '');
    document.addEventListener('keydown', onKeydown);
    closeBtn.focus();
    loadBackdrop(d, hero, ctrl.signal);
  }

  function close({ restore = true } = {}) {
    if (!overlay) return;
    ctrl?.abort();
    ctrl = null;
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    overlay = null;
    dialog = null;
    document.documentElement.classList.remove('modal-open');
    for (const el of inerted) el.removeAttribute('inert');
    inerted = [];
    const target = returnTo;
    returnTo = null;
    if (restore && target && document.contains(target)) target.focus();
  }

  return { open, close, get isOpen() { return !!overlay; } };
}
