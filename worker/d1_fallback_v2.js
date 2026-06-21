/**
 * @module d1_fallback_v2
 * @description Second-pass D1 fallback using title-based matching when r2_key lookups
 *              in d1_fallback.js fail. Tries two strategies sequentially:
 *              1. LIKE match on truncated citation title (first 60 chars)
 *              2. LIKE match on LOWER(title) using slug-derived search terms
 *
 * @strategy Runs only if emptyContexts still has unresolved entries after v1.
 *          Each strategy uses .catch(() => null) to fail gracefully per-paper.
 *          Abstracts capped at 2500 chars on success.
 *
 * @integration Runs after d1_fallback.js v1. Operates on the same emptyContexts array.
 */
if (emptyContexts.length > 0) {
  try {
    for (let ei = 0; ei < emptyContexts.length; ei++) {
      const ctxIdx = emptyContexts[ei];
      const cit = citations[ctxIdx];
      if (!cit || !cit.title) continue;
      const titleTerm = cit.title.replace(/\s+/g, " ").trim().substring(0, 60);
      try {
        const row = await env.PAPERS_DB.prepare(
          "SELECT abstract FROM papers WHERE title LIKE ?1 LIMIT 1"
        ).bind("%" + titleTerm + "%").first().catch(() => null);
        if (row && row.abstract && row.abstract.length > 50) {
          contexts[ctxIdx].text = row.abstract.substring(0, 2500);
          continue;
        }
      } catch (e) {}
      const slugTerm = (cit.slug || "").replace(/\.html$/, "").replace(/-/g, " ").toLowerCase();
      try {
        const row = await env.PAPERS_DB.prepare(
          "SELECT abstract FROM papers WHERE LOWER(title) LIKE ?1 LIMIT 1"
        ).bind("%" + slugTerm + "%").first().catch(() => null);
        if (row && row.abstract && row.abstract.length > 50) {
          contexts[ctxIdx].text = row.abstract.substring(0, 2500);
        }
      } catch (e) {}
    }
  } catch (e) {}
}
