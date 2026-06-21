// D1 fallback for empty-text contexts using title matching
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
