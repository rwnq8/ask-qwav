/**
 * @module d1_fallback_v3
 * @description Third-pass D1 abstract fallback — runs after the full citation loop
 *              and v1/v2 fallbacks. Uses title + slug substring matching against
 *              the living-paper D1 database. Rate-limited to 5 fills max.
 *
 * @strategy For each context with empty/<100 char text:
 *           1. Try title substring LIKE match (first 80 chars)
 *           2. Fall back to slug-based LOWER(title) LIKE match (first 80 chars)
 *           3. On hit → populate context with abstract (≤2500 chars)
 *           Stops after 5 successful fills to avoid D1 overload.
 *
 * @integration Final fallback in the chain: cite_loop → d1_fallback → d1_fallback_v2 → d1_fallback_v3
 * @limit 5 fills max — prevents runaway D1 queries for large result sets
 */
{
  let filledCount = 0;
  for (let i = 0; i < contexts.length && filledCount < 5; i++) {
    const ctx = contexts[i];
    if (ctx.text && ctx.text.length >= 100 && ctx.text.indexOf("[Full text") !== 0) continue;
    
    const cit = citations[i];
    if (!cit || !cit.title) continue;
    
    const titleTerm = cit.title.replace(/\s+/g, " ").trim().substring(0, 80);
    const slugTerm = (cit.slug || "").replace(/\.html$/, "").replace(/-/g, " ").toLowerCase().substring(0, 80);
    
    let row = null;
    // Strategy 1: title substring match
    try {
      row = await env.PAPERS_DB.prepare(
        "SELECT abstract FROM papers WHERE title LIKE ?1 LIMIT 1"
      ).bind("%" + titleTerm + "%").first().catch(() => null);
    } catch (e) {}
    
    // Strategy 2: slug-based title match
    if (!row || !row.abstract) {
      try {
        row = await env.PAPERS_DB.prepare(
          "SELECT abstract FROM papers WHERE LOWER(title) LIKE ?1 LIMIT 1"
        ).bind("%" + slugTerm + "%").first().catch(() => null);
      } catch (e) {}
    }
    
    if (row && row.abstract && row.abstract.length > 50) {
      contexts[i].text = row.abstract.substring(0, 2500);
      filledCount++;
    }
  }
}
