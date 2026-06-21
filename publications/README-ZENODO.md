# Zenodo Manual Upload Guide — Ultrametric Tree Case Study

> **Status:** MANUAL — ready for upload  
> **Metadata file:** `publications/zenodo-metadata.json`  
> **Publication file:** `publications/ultrametric-case-study/index.html`  
> **Date prepared:** 2026-06-21

---

## Step-by-Step Upload

### 1. Prepare the Upload Bundle
```bash
# From the repo root:
cd publications
zip ultrametric-case-study-v2.8.0.zip \
  ultrametric-case-study/index.html \
  zenodo-metadata.json
```

### 2. Upload to Zenodo (Manual via Web UI)

1. Go to **https://zenodo.org/deposit/new**
2. Click **"New Upload"**
3. **Drag and drop** `ultrametric-case-study-v2.8.0.zip`
4. **Fill metadata** using `zenodo-metadata.json` as reference:
   - **Title:** Ultrametric Tree — Practical p-Adic Information Retrieval on Cloudflare Workers
   - **Authors:** QWAV / QNFO (affiliation: QNFO Research)
   - **Description:** See JSON `description` field
   - **License:** QNFO-Unified-License-v2.0
   - **Publication date:** 2026-06-21
   - **Keywords:** Copy from JSON `keywords` array
   - **Communities:** qnfo, cloudflare
   - **Related identifiers:** Copy from JSON `related_identifiers`
5. **Save draft** → review → **Publish**

### 3. After Publication
Once Zenodo assigns a DOI, update these files with the DOI:
- `publications/social-media-posts.md` — replace `[DOI pending]`
- `publications/zenodo-metadata.json` — add `doi` field
- `pages/llms.txt` — add DOI reference
- `pages/index.html` — add DOI meta tag

---

## Metadata Summary

| Field | Value |
|-------|-------|
| **Title** | Ultrametric Tree — Practical p-Adic Information Retrieval on Cloudflare Workers |
| **Version** | 2.8.0 |
| **Type** | Publication (case study) |
| **License** | QNFO-Unified-License-v2.0 |
| **Access** | Open Access |
| **Language** | English |
| **Date** | 2026-06-21 |

### Live URLs (for Related Identifiers)
- Case study: https://ultrametric-case-study.ask-qwav.pages.dev
- Live system: https://ask-qwav.tech / https://ask-qwav.q08.workers.dev
- GitHub: https://github.com/deepcs-org/ask-qwav (use rwnq8/ask-qwav)

---

## File Inventory for Upload

| File | Size | Description |
|------|------|-------------|
| `ultrametric-case-study/index.html` | ~17 KB | Standalone case study (self-contained HTML with CSS, light/dark theme) |
| `zenodo-metadata.json` | ~2 KB | Complete Zenodo deposit metadata |
