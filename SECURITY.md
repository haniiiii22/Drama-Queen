# Security report

Scope: the Drama Queen repository, its GitHub Actions workflow and the static site it publishes.
This is an honest description of what was built and tested, not a guarantee. Nothing here has been
run against real GitHub, OMDb or TMDB; see "Not verified" below.

## IMPORTANT: rotate keys that were ever exposed

An earlier version of this project (the first ZIP) could compile `OMDB_API_KEY` / `TMDB_API_KEY` into the
public JavaScript bundle ("public-client mode"), and offered a proxy as an alternative. **Any key that
was put into a `.env` file, built with that version and deployed, is public and must be rotated:**

1. Create a new OMDb key (and a new TMDB key if used) at the providers.
2. Revoke the old ones.
3. Store the new keys only as GitHub **Secrets** (Settings → Secrets and variables → Actions).
4. If a key was ever committed, pasted in an issue/chat, or printed in a log, treat it as exposed as well.
   Deleting the commit does not un-expose it; rotation does.

The current version contains no code path that can put a key into the site, but it cannot undo past exposure.

## Architecture and trust boundaries

`public/Movies.txt` → workflow *fetch* job (only place with keys) → artifact → *persist* job
(no keys, can write the catalog commit) → *build* job (no keys) → *deploy* job (Pages only).
The browser reads `data/catalog.json` and nothing else.

| Job | API secrets | Permissions | Can push | Notes |
|---|---|---|---|---|
| test | no | contents: read | no | blocks everything else |
| plan | no | contents: read | no | offline; decides whether a fetch is needed |
| fetch | **OMDB_API_KEY, TMDB_API_KEY** (one step) | contents: read | no | Node built-ins only, no `npm install`; checkout without persisted credentials; runs only on the default branch, never for pull requests |
| persist | no | contents: write | catalog file only | re-validates from scratch, refuses stale results, no empty commits |
| build | no | contents: read | no | builds the persisted commit; validation and verification are blocking |
| deploy | no | pages: write, id-token: write | no | |

## Findings and fixes

| # | Finding (earlier design) | Fix |
|---|---|---|
| 1 | API keys could be embedded in the public bundle (`define`/env) | Removed. The browser has no keys, no API code and no `import.meta.env` use. `connect-src 'self'` in the CSP. `verify-dist` fails the build on any key value, API host or token-shaped string. |
| 2 | Optional runtime proxy (extra attack surface, open-relay risk) | Removed with `proxy/` and `wrangler.toml`. |
| 3 | Every visitor spent API quota; visitors' browsers contacted third parties | Visits make no metadata request. Metadata is fetched at most once per freshness window by CI. |
| 4 | Browser-side cache (IndexedDB) could hide a new deployment or hold stale/poisoned data | Removed. The catalog is fetched with `cache: 'no-cache'`. |
| 5 | A fork pull request could try to read secrets | Secrets are referenced only by the fetch job, which is skipped for pull requests. `pull_request_target` is not used. PRs run tests and a build without secrets or deployment. |
| 6 | A compromised dependency could run next to secrets | The fetch job installs nothing and uses only Node built-ins and repository code. |
| 7 | A broken API run could destroy the catalog | A valid entry is never replaced by "not found". Rate limits, auth errors, malformed responses, timeouts and 5xx keep old data. A malformed existing catalog fails safely. A truncated or missing `Movies.txt` cannot wipe the catalog without `allow_large_removal`. |
| 8 | Poisoned API content could inject markup or URLs | Strict schema with a field whitelist, HTTPS and host allow-listed images, no `innerHTML` anywhere (checked by a test), CSP without `unsafe-*`. |
| 9 | Credential leakage through logs | Credentials are read from the environment only, never passed as arguments or URLs (a TMDB v4 token goes in an `Authorization` header). Errors carry no URLs. Logs print counts only and strip control characters and `::` so API text cannot inject workflow commands. A secret value found in API text rejects that entry. |
| 10 | Race: two runs overwriting each other | Single concurrency group without cancellation; persist compares the base catalog hash and the `Movies.txt` digest and exits 5 on a stale result; pushes retry with rebase but never force. |
| 11 | Supply chain: movable action tags | All actions pinned to full commit SHAs (verified with `git ls-remote`), with version comments; Dependabot configured. |
| 12 | A TMDB JWT detector in `verify-dist` required 20+ characters per segment and would have missed a real token header | Found by the new mutation test and fixed (≥10). |

## Verified by automated tests

See `npm test`. They cover: no key in the build output even with keys in the environment; no browser
contact with APIs; no refetch of fresh data (a second run makes zero requests); duplicates; a missing
OMDb key; rate limits; auth failures; invalid, oversized and hostile metadata; workflow structure (secrets
only in the fetch step, permissions, SHA pinning, no `pull_request_target`, tests and validation block the
deploy); and the existing UI (routes, search, modal accessibility, themes, fallbacks, offline use).
The workflow tests are static and were mutation-checked (adding a secret to the build job, widening
permissions, unpinning an action or making tests non-blocking each fail them).

## Remaining limitations

* **Not run on real GitHub/OMDb/TMDB.** The workflow YAML parses and is checked statically; real run
  behaviour (permissions, artifact hand-off, Pages deployment) is untested here.
* **Branch protection.** The persist job pushes with `GITHUB_TOKEN`. If the default branch requires
  pull requests or status checks, that push is rejected and the run fails with an explicit message; adjust the
  rules or commit the catalog from a local refresh.
* **The `push` trigger names `main`.** If your default branch has another name, edit it.
* **Third-party image hosts.** Posters and backdrops are loaded by the visitor's browser from
  `m.media-amazon.com`, `ia.media-imdb.com` and `image.tmdb.org` (with `no-referrer`). Those hosts see the
  visitor's IP address. This is an image download, not an API call; to avoid it, self-host the images (not implemented).
* **Stale pages.** GitHub Pages may serve a cached `index.html` briefly after deploy.
* **Secrets in the fetch job are readable by the repository's own code.** Anyone who can merge to the
  default branch can change what runs next to the keys. Restrict who can push, and use an environment with
  required reviewers if you need more.
* **`npm audit`** is advisory in CI (`continue-on-error`) so a new advisory cannot take the site down.
* No claim of absolute security is made.
