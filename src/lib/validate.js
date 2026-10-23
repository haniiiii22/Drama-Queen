// Normalisation and validation of untrusted API data. Nothing here ever invents
// a value: anything missing, "N/A" or malformed becomes null.

const IMDB_ID = /^tt\d{5,10}$/;
export const IMAGE_HOSTS = Object.freeze(['m.media-amazon.com', 'ia.media-imdb.com', 'image.tmdb.org']);
const TYPES = new Set(['movie', 'series', 'episode', 'game']);
const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/w1280';
const TMDB_PATH = /^\/[A-Za-z0-9_-]{5,80}\.(?:jpg|jpeg|png|webp)$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/g;

export function text(v, max = 2000) {
  if (typeof v !== 'string') return null;
  const s = v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s.toUpperCase() === 'N/A') return null;
  return s.slice(0, max);
}

export function list(v, maxItems = 40) {
  const s = text(v, 1500);
  if (!s) return null;
  const items = s.split(',').map((x) => x.trim()).filter(Boolean).slice(0, maxItems);
  return items.length ? items : null;
}

/** Returns a safe https URL on an allow-listed host, or null. */
export function safeImageUrl(value, hosts = IMAGE_HOSTS) {
  if (typeof value !== 'string' || value.length > 600) return null;
  let u;
  try { u = new URL(value.trim()); } catch { return null; }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (!hosts.includes(u.hostname)) return null;
  return u.href;
}

export function isImdbId(v) {
  return typeof v === 'string' && IMDB_ID.test(v);
}

/** Normalises an OMDb "full" record. Returns null when the record is unusable. */
export function normalizeOmdb(raw) {
  if (!raw || typeof raw !== 'object' || raw.Response !== 'True') return null;
  const imdbId = isImdbId(raw.imdbID) ? raw.imdbID : null;
  const title = text(raw.Title, 300);
  if (!imdbId || !title) return null;

  const t = typeof raw.Type === 'string' ? raw.Type.toLowerCase() : '';
  const yearRaw = text(raw.Year, 20);
  let year = null;
  if (yearRaw && /^\d{4}(?:\s*[–—-]\s*(?:\d{4})?)?$/.test(yearRaw)) year = yearRaw.replace(/\s*[—-]\s*/, '–').replace(/\s+/g, '');
  else if (yearRaw && /\d{4}/.test(yearRaw)) year = yearRaw.match(/\d{4}/)[0];

  let rating = null;
  const r = parseFloat(raw.imdbRating);
  if (Number.isFinite(r) && r >= 0 && r <= 10) rating = r;

  const votes = typeof raw.imdbVotes === 'string' && /^\d{1,3}(,\d{3})*$|^\d+$/.test(raw.imdbVotes) ? raw.imdbVotes : null;
  const seasons = typeof raw.totalSeasons === 'string' && /^\d{1,3}$/.test(raw.totalSeasons) ? raw.totalSeasons : null;

  return {
    imdbId,
    title,
    type: TYPES.has(t) ? t : 'other',
    year,
    rating,
    votes,
    poster: safeImageUrl(raw.Poster),
    plot: text(raw.Plot, 4000),
    genres: list(raw.Genre),
    cast: list(raw.Actors),
    directors: list(raw.Director),
    writers: list(raw.Writer),
    runtime: text(raw.Runtime, 40),
    languages: list(raw.Language),
    countries: list(raw.Country),
    rated: text(raw.Rated, 20),
    released: text(raw.Released, 30),
    awards: text(raw.Awards, 300),
    seasons,
  };
}

/** Picks a TMDB backdrop URL from a /find/{imdb_id} response, or null. */
export function pickBackdrop(raw, type) {
  if (!raw || typeof raw !== 'object') return null;
  const movies = Array.isArray(raw.movie_results) ? raw.movie_results : [];
  const shows = Array.isArray(raw.tv_results) ? raw.tv_results : [];
  const order = type === 'series' ? [shows, movies] : type === 'movie' ? [movies, shows] : [movies, shows];
  for (const group of order) {
    for (const item of group) {
      const p = item && typeof item.backdrop_path === 'string' ? item.backdrop_path : null;
      if (p && TMDB_PATH.test(p)) return safeImageUrl(TMDB_IMG_BASE + p);
    }
  }
  return null;
}
