import { h } from '../lib/dom.js';

export const ABOUT_STATEMENT =
  'This website is created solely for fun and personal entertainment. It is a non-commercial personal movie and TV series archive.';

export function renderAbout() {
  return h(
    'div',
    { class: 'page about' },
    h('h1', { tabindex: '-1' }, 'About'),
    h(
      'div',
      { class: 'credits' },
      h('p', { class: 'credit' }, 'Site made for H.N'),
      h('p', { class: 'credit' }, 'Made and designed by M&H'),
    ),
    h('p', { class: 'statement' }, ABOUT_STATEMENT),
    h(
      'section',
      { class: 'about-section', 'aria-labelledby': 'about-data' },
      h('h2', { id: 'about-data' }, 'Where the details come from'),
      h('p', null, 'Titles, posters, ratings and plots come from the OMDb API. Backdrop images come from TMDB. They are collected ahead of time and saved with the site, so browsing never calls their APIs; posters and backdrops are still loaded directly from the image servers. This product uses the TMDB API but is not endorsed or certified by TMDB. All posters, images and metadata belong to their respective owners.'),
    ),
  );
}
