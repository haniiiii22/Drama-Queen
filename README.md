# Drama Queen

A personal, non-commercial movie and TV series archive: a cinematic, static website (dark and light themes,
poster grid, details modal, local search) published on GitHub Pages.

**Architecture**

```
public/Movies.txt ─▶ GitHub Actions (fetch job: OMDb + optional TMDB)
                  ─▶ validated catalog  public/data/catalog.json  (committed)
                  ─▶ static Vite build ─▶ GitHub Pages
```

The deployed site **never calls OMDb, TMDB or any proxy**. Visiting, searching, navigating, changing theme and
opening a details window make no API request; the browser only reads `data/catalog.json`. If the APIs are down, the
site keeps working from the last good catalog. Details: [docs/CATALOG.md](docs/CATALOG.md),
[SECURITY.md](SECURITY.md).

## 1. Setup on GitHub

1. Push this project to a repository whose default branch is `main` (otherwise edit the `push` trigger in
   `.github/workflows/deploy.yml`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions → New repository secret:**
   * `OMDB_API_KEY` – **required** (free key from omdbapi.com).
   * `TMDB_API_KEY` – optional, for backdrops in the details window. Either the v3 API key or the v4 "Read Access Token" works.
     Without it the site works and windows just have a plain header.
   Never put keys in files, issues or chat. The secrets are used only by the *fetch* job.
4. Optional **variables** (same page, *Variables* tab): `LOGO_PATH`, `CATALOG_TTL_DAYS`, `CATALOG_NEGATIVE_TTL_DAYS`,
   `CATALOG_BACKDROP_TTL_DAYS`, `CATALOG_BACKDROP_NEGATIVE_TTL_DAYS`, `CATALOG_MAX_OMDB_REQUESTS`, `CATALOG_MAX_TMDB_REQUESTS`.
5. If the default branch is protected, allow `github-actions[bot]` to push (see Limitations).

## 2. Adding titles and refreshing

Edit **`public/Movies.txt`**, one title per line, and push to `main`:

```text
# comments start with #, // or ;
Inception
The Wire (2002)
Dark (2017–2020)
tt0111161
```

A push that changes the list starts the workflow automatically. Manual refresh: **Actions → "Update catalog and
deploy" → Run workflow.** `force_refresh` re-checks every title regardless of freshness (still within the request
budget). `allow_large_removal` is only needed if you deliberately remove most of the list.

Optional weekly refresh: uncomment the `schedule:` block in the workflow. With a fresh catalog a scheduled run
makes zero metadata requests.

A missing `OMDB_API_KEY` stops the refresh with a clear message; the catalog and site are untouched.

## 3. How the persistent cache avoids repeated API use

The catalog is the cache, and it is committed. Each entry has a `refreshAfter` date. A run only asks the APIs about
titles that are **new**, **pending**, **expired** or **forced**. Defaults: found 14 days, confirmed not-found 3 days,
TMDB backdrop 30 days, missing backdrop 3 days (all +0–20 % jitter). Requests are de-duplicated, bounded in
concurrency and per-run budget (900 OMDb), time-limited, retried with capped exponential backoff and jitter, and
honour `Retry-After`. No TMDB lookup happens while a valid backdrop is cached. Transient failures (rate limit,
auth error, malformed reply, timeout, 5xx) keep the old entry and are **never** recorded as "not found". A second run with
an unchanged list and fresh catalog makes **zero** requests and creates no commit.

## 4. Recovery

* **Some titles show "Details pending":** the last attempt failed transiently. Re-run the workflow later.
* **Rate limit:** the run stops early, keeps everything it has, and the next run continues.
* **"Rejected the API key" (exit 4):** replace the secret with a valid key.
* **Run says the catalog or Movies.txt changed meanwhile (exit 5):** another change landed; just re-run.
* **Corrupt or hand-edited catalog:** the refresh refuses to touch it. Restore `public/data/catalog.json` from git
  history, or replace it with the empty catalog `{"schemaVersion":1,"generatedAt":null,"sourceDigest":null,"entries":[]}`
  and re-run with `force_refresh`.
* **Validate locally:** `npm run catalog:validate`.
* **Exposed a key?** Rotate it (see SECURITY.md).

## 5. Local use

```bash
npm ci
npm run dev        # development server
npm test           # all tests (no network, synthetic keys only)
npm run build      # build + verification into dist/
```

Local refresh (keys only in your shell, never in a file):

```bash
read -rs OMDB_API_KEY && export OMDB_API_KEY
node scripts/refresh-catalog.mjs --out catalog-out
node scripts/persist-catalog.mjs --artifact catalog-out
```

`node scripts/refresh-catalog.mjs --plan` shows offline what would be fetched.

## 6. Logo

Place **`public/logo.png`** (default). If it exists it appears left of "Drama Queen"; otherwise nothing is rendered.
Another path: `LOGO_PATH` (env var locally, repository variable in Actions). About 240 × 72 px, displayed at most 36 px tall.

## 7. Filtering

Movies and Series use the media type OMDb reported when the catalog was built; titles of other types appear only on Home.

## 8. Limitations

* The workflow has not been run on real GitHub, and the real OMDb/TMDB APIs were not contacted during development.
* Branch protection can block the bot's catalog commit; the run then fails explicitly.
* Posters/backdrops load from image CDNs in the visitor's browser (an image download, not an API call); those
  hosts see the visitor's IP.
* GitHub Pages may briefly serve a cached page after a deploy.

## 9. Project layout

```text
public/                  Movies.txt (yours), logo.png (optional), data/catalog.json (generated)
src/main.js, src/ui/     app, grid, modal, About, theme
src/lib/catalog.js       catalog schema + validation (shared with CI scripts)
scripts/                 refresh-catalog, persist-catalog, validate-catalog, verify-dist
scripts/catalog/         refresh engine (policy, http, limiter, io)
docs/CATALOG.md          catalog schema
tests/                   unit, CLI, workflow, security and browser tests
.github/workflows/       update-catalog-and-deploy workflow; dependabot.yml
```

## 10. Credits and data

Site made for H.N. Made and designed by M&H.

This website is created solely for fun and personal entertainment. It is a non-commercial personal movie and TV series archive. It does not host, stream or distribute any film or episode. All posters, images and metadata belong to their respective owners. This product uses the TMDB API but is not endorsed or certified by TMDB.
