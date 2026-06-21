// D1 fallback for empty-text contexts — sequential lookups, no nested template literals
const emptyContexts = [];
for (let i = 0; i < contexts.length; i++) {
  if (!contexts[i].text || contexts[i].text.length < 100 || contexts[i].text.indexOf("[Full text") === 0) {
    emptyContexts.push(i);
  }
}
if (emptyContexts.length > 0) {
  try {
    for (let ei = 0; ei < emptyContexts.length; ei++) {
      const ctxIdx = emptyContexts[ei];
      const cit = citations[ctxIdx];
      if (!cit || !cit.slug) continue;
      const r2key = "papers/" + cit.slug.replace(/\.html$/, "").replace(/ /g, "-").toLowerCase() + ".md";
      try {
        const row = await env.PAPERS_DB.prepare(
          "SELECT abstract FROM papers WHERE r2_key = ? LIMIT 1"
        ).bind(r2key).first().catch(() => null);
        if (row && row.abstract && row.abstract.length > 50) {
          contexts[ctxIdx].text = row.abstract.substring(0, 2500);
        }
      } catch (e) {}
    }
  } catch (e) {}
}
