# Catalog schema (version 1)

`public/data/catalog.json` is the **only data file the deployed website reads**. It is generated
by the GitHub Actions *fetch* job (`scripts/refresh-catalog.mjs`), validated again by the
*persist* job (`scripts/persist-catalog.mjs`), committed, validated a third time before the
build (`scripts/validate-catalog.mjs`), and finally checked again in the browser
(`src/lib/catalog.js`). All four use the same code. Do not edit it by hand; change
`public/Movies.txt` and run the workflow.

The file is deterministic: entries follow the order of `Movies.txt`, keys are in a fixed order,
and `generatedAt` only changes when the content changes. An unchanged run produces
byte-identical output, so it creates no commit.

## Top level

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | `1` | A newer number makes the site show "This catalog needs a newer site" instead of guessing. |
| `generatedAt` | ISO-8601 UTC string or `null` | When the content last changed. `null` only for an empty catalog. |
| `sourceDigest` | 64-hex SHA-256 or `null` | Digest of the normalised `Movies.txt` the catalog was built for. Used to reject stale results. |
| `entries` | array | One element per unique line of `Movies.txt`. At most 3000. |

Unknown top-level fields are rejected. The file may not exceed 12 MiB.

## Entry

| Field | Meaning |
|---|---|
| `key` | Stable identity of the source line: `id:tt1234567` (IMDb id given) or `t:<normalised title>\|<year or empty>`. Unique. |
| `source` | `{ title, year, imdbId }` as written in `Movies.txt` (`year`/`imdbId` may be `null`). |
| `status` | `ok`, `notfound`, `pending` or `alias` (below). |
| `id` | The IMDb id (`tt` + 6–10 digits) for `ok` and `alias`; `null` otherwise. |
| `aliasOf` | For `alias` only: the IMDb id of the `ok` entry that holds the data. |
| `data` | Metadata for `ok` entries (below); `null` otherwise. |
| `backdrop` | `{ url, checkedAt, refreshAfter }` or `null`. `url` may be `null` for "checked, none found". |
| `fetchedAt` | When OMDb data was last fetched successfully (or when "not found" was confirmed). `null` for `pending`. |
| `refreshAfter` | When the entry becomes due again. Jittered by up to +20 % so entries do not all expire on one day. |

Unknown fields are rejected at every level.

### Status values

* **`ok`** – OMDb returned a record. `data` is present and valid.
* **`notfound`** – OMDb *explicitly* answered "not found" (confirmed negative). Cached for 3 days by
  default. Never produced by a rate limit, auth failure, malformed response, timeout or 5xx.
* **`pending`** – not fetched yet, or the last attempt failed transiently. Shown as "Details pending".
  A pending entry that used to be `ok` is **not** downgraded: the old data is kept instead.
* **`alias`** – two lines of `Movies.txt` resolved to the same IMDb id. Only one entry holds the data;
  the alias points at it and is not shown twice.

### `data` (only for `status: "ok"`)

`imdbId`, `title`, `type` (`movie` | `series` | `episode` | `game` | `other`), `year`, `rating`
(number 0–10 or `null`), `votes`, `poster`, `plot`, `genres[]`, `cast[]`, `directors[]`,
`writers[]`, `runtime`, `languages[]`, `countries[]`, `rated`, `released`, `awards`, `seasons`.

Every field is present; a value that OMDb reports as `"N/A"` is stored as `null`. Strings carry no control
characters. `poster` must be an `https://` URL on `m.media-amazon.com` or `ia.media-imdb.com`
with no query string, fragment or credentials. `backdrop.url` must be `https://image.tmdb.org/...`
under the same rules.

## Freshness defaults

| What | Default | Override (repository *variable*, not secret) |
|---|---|---|
| Successful metadata | 14 days | `CATALOG_TTL_DAYS` |
| Confirmed not found | 3 days | `CATALOG_NEGATIVE_TTL_DAYS` |
| TMDB backdrop found | 30 days | `CATALOG_BACKDROP_TTL_DAYS` |
| TMDB backdrop missing | 3 days | `CATALOG_BACKDROP_NEGATIVE_TTL_DAYS` |
| OMDb request budget per run | 900 | `CATALOG_MAX_OMDB_REQUESTS` |
| TMDB request budget per run | 900 | `CATALOG_MAX_TMDB_REQUESTS` |

## What validation rejects

Invalid JSON, a non-object root, a newer schema version, more than 3000 entries or 12 MiB,
unknown fields, duplicate `key`s, duplicate IMDb ids, malformed ids / years / ratings / votes /
timestamps / digests, unknown statuses or media types, inconsistent entries (an `ok` entry whose
`id` differs from `data.imdbId`, a `notfound` entry with data, an alias to a missing target),
image URLs that are not HTTPS, not allow-listed, or carry a query / fragment / credentials, and any
string that looks like a credential (JWT-like tokens, `apikey=`, `Authorization:`, bearer tokens)
or equals a configured secret value.

In the browser a failing *entry* is skipped and the rest still render; a structurally broken file shows a
retry screen. In CI any problem fails the job and nothing is deployed.
