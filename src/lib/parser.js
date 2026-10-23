// Parser for Movies.txt — one title per line.
//
// Supported line forms (see README → "Movies.txt"):
//   Title
//   Title (2010)          also  Title [2010]   or a series range  Title (2008–2013)
//   tt0000000             an IMDb ID, for exact matches
// Blank lines and full-line comments (#, //, ;) are ignored. Duplicates are removed.

const MAX_LINE = 200;
const MAX_ENTRIES = 3000;
const IMDB_ID = /^tt\d{6,10}$/i;
const YEAR_SUFFIX = /\s*[([]\s*((?:18|19|20)\d{2})(?:\s*[–—-]\s*(?:(?:18|19|20)\d{2})?)?\s*[)\]]\s*$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function normalizeKeyText(s) {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** @returns {{entries: Array, stats: {lines:number, comments:number, blank:number, duplicates:number, invalid:number, truncated:boolean}}} */
export function parseMovieList(text) {
  const stats = { lines: 0, comments: 0, blank: 0, duplicates: 0, invalid: 0, truncated: false };
  const entries = [];
  if (typeof text !== 'string') return { entries, stats };

  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const seen = new Set();
  const maxYear = new Date().getFullYear() + 5;

  for (const rawLine of lines) {
    stats.lines++;
    let line = rawLine.replace(CONTROL_CHARS, '').trim();
    if (!line) { stats.blank++; continue; }
    if (line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) { stats.comments++; continue; }
    line = line.replace(/^[-*•]\s+/, '').trim(); // markdown-style bullets
    if (!line) { stats.blank++; continue; }
    if (line.length > MAX_LINE || !/[\p{L}\p{N}]/u.test(line)) { stats.invalid++; continue; }

    let title = line;
    let year = null;
    let imdbId = null;
    let key;

    if (IMDB_ID.test(line)) {
      imdbId = line.toLowerCase();
      title = imdbId;
      key = `id:${imdbId}`;
    } else {
      const m = line.match(YEAR_SUFFIX);
      if (m && line.slice(0, m.index).trim()) {
        const y = Number(m[1]);
        if (y <= maxYear) {
          year = y;
          title = line.slice(0, m.index).trim();
        }
      }
      key = `t:${normalizeKeyText(title)}|${year ?? ''}`;
    }

    if (seen.has(key)) { stats.duplicates++; continue; }
    if (entries.length >= MAX_ENTRIES) { stats.truncated = true; break; }
    seen.add(key);
    entries.push({ id: `e${entries.length}`, key, title, year, imdbId, result: null, loading: false });
  }
  return { entries, stats };
}
