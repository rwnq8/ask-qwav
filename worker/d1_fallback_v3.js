// D1 abstract fallback for contexts with empty/minimal text
// Runs after the citation loop — uses title/substring matching against living-paper D1
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
