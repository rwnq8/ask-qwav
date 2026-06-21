# Unfixable Papers Tracker — 36 Papers Requiring Manual R2 Triage

> **Priority:** LOW  
> **Status:** PENDING — requires human intervention  
> **Date identified:** 2026-06-21  
> **Affected:** 36 / 451 papers (~8%)  
> **See also:** `FAILURES.md` section 2

---

## Problem Description

36 papers in the R2 bucket (`qnfo` → `papers/*.md`) have content-quality issues that **cannot be fixed programmatically**. These include:

- Missing or corrupted markdown content
- Mismatched titles between R2 content and D1 metadata
- Encoding issues or truncated files
- Papers that exist in D1 but not in R2 (or vice versa)
- Papers with empty or unparseable content

### Why Programmatic Fixing Fails
These are **content-quality** issues requiring:
1. Finding the original paper source (arXiv, DOI, etc.)
2. Downloading or reconstructing the correct markdown
3. Manual review of title-author-content consistency
4. R2 upload of corrected files with correct keys

No automated process can determine the *correct* content for a corrupted paper — it requires source lookup and human review.

---

## Impact

- Degraded search results for affected papers
- The `/validate-selmer` endpoint may flag these as Sha obstructions
- Incomplete or broken paper views on the frontend
- Potential D1/R2 consistency errors

---

## Required Triage Process

For each of the 36 papers:

1. **Identify the paper** from R2 `papers/<paper_id>.md`
2. **Check D1 metadata** for title, authors, DOI/arXiv ID
3. **Locate source** via arXiv, DOI resolver, or other sources
4. **Download/reconstruct** the correct markdown content
5. **Verify consistency** between title, authors, and content
6. **Upload corrected file** to R2 `qnfo` bucket under correct key
7. **Validate** via `/validate-selmer` endpoint

---

## Discovery Commands

To list affected papers programmatically (requires wrangler access):

```bash
# Check for empty or very small R2 objects
wrangler r2 object list qnfo --prefix papers/ | \
  jq '.[] | select(.size < 100) | .key'

# Check D1 for papers with missing R2 content
wrangler d1 execute living-paper --command \
  "SELECT id, title FROM papers WHERE id NOT IN (SELECT DISTINCT REPLACE(key, 'papers/', '') FROM r2_objects)"

# Run Selmer validation on all papers
curl -X POST https://ask-qwav.q08.workers.dev/validate-selmer \
  -H "Content-Type: application/json" \
  -d '{"title": "Paper Title Here", "checks": ["d1", "r2", "cluster", "multi-edge"]}'
```

---

## Tracking Table

| # | Paper ID / Title | Issue Type | Status | Fix Date |
|---|-----------------|------------|--------|----------|
| 1 | TBD | TBD | ⚠️ PENDING | — |
| ... | ... | ... | ⚠️ PENDING | — |
| 36 | TBD | TBD | ⚠️ PENDING | — |

*Populate this table during manual triage session.*

---

## Dependencies

- Access to R2 bucket `qnfo` (via Cloudflare dashboard or wrangler CLI)
- Access to D1 database `living-paper`
- Working Cloudflare API token with R2 read/write permissions
- Original paper sources (arXiv API, DOI resolver)
- Time estimate: ~2-4 hours for full triage of 36 papers
