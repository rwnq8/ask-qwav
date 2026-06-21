# QWAV Project — Known Failures & Blockers

> **Purpose:** Document every persistent failure so future sessions do **NOT** waste time retrying the same dead ends.  
> **Rule:** Before attempting any task in this list, read the failure reason and either (a) the blocker has been resolved upstream, or (b) skip it.

---

## 1. Buffer Social Media Scheduling — API Deprecated (PERMANENT)

**Status:** ❌ BLOCKED — no workaround without architectural change  
**Date tested:** 2026-06-21  
**Tested with:** Regenerated Buffer token `kHcB2hN...`

### What was attempted
- Set `BUFFER_ACCESS_TOKEN` as a Cloudflare Worker secret via `wrangler secret put`
- POST to `https://ask-qwav.q08.workers.dev/buffer-schedule`
- Worker calls `https://api.bufferapp.com/1/updates/create.json?access_token=TOKEN`
- Token was correctly set and available in `env.BUFFER_ACCESS_TOKEN`

### Response from Buffer API
```json
{"error":"OIDC tokens are not accepted for direct API access","code":401}
```

### Root Cause
Buffer **deprecated** Personal Access Token (PAT) authentication for their API. Modern Buffer tokens are OIDC tokens that require the full OAuth 2.0 Authorization Code flow:

1. Register a Buffer application at https://buffer.com/developers/apps
2. Obtain `client_id` + `client_secret`
3. Implement OAuth redirect flow to get `authorization_code`
4. Exchange code for `access_token` (short-lived) + `refresh_token`
5. Use `Authorization: Bearer <token>` header on API calls
6. Token refresh logic needed

The current worker implementation uses the **deprecated v1 API** with `access_token` as a query parameter — this API endpoint no longer accepts new-style tokens.

### What would fix it
- Rewrite `/buffer-schedule` endpoint to use OAuth 2.0 Bearer token flow
- Store `BUFFER_CLIENT_ID`, `BUFFER_CLIENT_SECRET`, `BUFFER_REFRESH_TOKEN` as secrets
- Implement token refresh logic in the worker
- Update API calls to use new Buffer API endpoints (likely different from `api.bufferapp.com/1/`)

### Workaround (manual)
Manually post to Buffer via their web UI at https://buffer.com using the social media content in `publications/social-media-posts.md`.

### Affected files
- `worker/worker.js` lines ~1024–1044 (`/buffer-schedule` endpoint)
- `publications/buffer-schedule.ps1` (PowerShell scheduler script)
- `publications/social-media-posts.md` (post content — still valid, just can't auto-post)

---

## 2. 36 Unfixable Papers — Manual R2 Edits Required

**Status:** ⚠️ PENDING — requires manual intervention  
**Date identified:** 2026-06-21 (previous session)

### What's wrong
36 papers in the R2 bucket (`qnfo` → `papers/*.md`) have issues that cannot be fixed programmatically:
- Missing or corrupted markdown content
- Mismatched titles between R2 content and D1 metadata
- Encoding issues or truncated files
- Papers that exist in D1 but not in R2 (or vice versa)

### Why it's unfixable programmatically
These are content-quality issues — the fix requires:
- Finding the original paper source (arXiv, DOI, etc.)
- Downloading/reconstructing the correct markdown
- Manual review of title-author-content consistency
- R2 upload of corrected files with correct keys

### Affected
- 36 out of 451 total papers (~8%)
- These papers may return degraded results in search queries
- The `validate-selmer` endpoint may flag these as Sha obstructions

### What would fix it
Manual triage session with access to R2 bucket + original paper sources.

### Affected bindings
- R2: `qnfo` bucket, `papers/*.md` keys
- D1: `living-paper` database, `papers` table

---

## 3. rtk Hook Warning (Cosmetic)

**Status:** ℹ️ COSMETIC — does not affect functionality  
**Date observed:** 2026-06-21

### Symptom
Every `npx wrangler` command prints:
```
[rtk] /!\ No hook installed — run `rtk init -g` for automatic token savings
```

### Cause
`rtk` is a Git credential/token helper installed in this environment. It wraps shell commands but has no hook configured for the current repo. All wrangler commands exit with code 1 because rtk wraps the exit code.

### Impact
- Commands work correctly despite exit code 1
- Deployments succeed
- Can be safely ignored

### Fix (if desired)
Run `rtk init -g` to install the hook, or remove rtk from the PATH.

---

## 4. Offloaded Tool Outputs (Session Artifact)

**Status:** ℹ️ COSMETIC — session infrastructure limitation

Large tool outputs (>~4000 chars) are offloaded to `C:\Users\LENOVO\.deepchat\sessions\*\tool_*.offload` files. These files are temporary and may be cleaned up automatically. When investigating a tool output that shows as offloaded, read the offload file directly.

---

## Historical (Resolved)

| Issue | Resolution |
|-------|-----------|
| Worker version stuck at 2.6.0 | Fixed: bumped to 2.7.0 (commit 8dd2d4e, deployed) |
| Pages missing SEO meta tags | Fixed: OG/Twitter/JSON-LD + llms.txt (commit fca76ac, deployed) |
| I-K endpoints not implemented | Fixed: /validate-selmer, /p-adic-embed, /period-bridge all live |
| Helper modules undocumented | Fixed: 8 modules received JSDoc headers (2026-06-21) |
