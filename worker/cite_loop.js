/**
 * @module cite_loop
 * @description Citation extraction loop — processes Vectorize query matches into
 *              structured contexts (text + name) and citations (title + slug + url + score).
 *              Filters out untitled/empty/unknown sources to keep LLM context clean.
 *              Each context is capped at 2500 chars; names are sanitized of -/.html artifacts.
 *
 * @integration Inserted inline into the main query handler after Vectorize similarity search.
 * @input  vectorMatches — Array from Vectorize query with { metadata: { text, title, slug, url }, score }
 * @output  contexts[] — Array of { text: string (≤2500), name: string } for LLM prompt prep
 *          citations[] — Array of { title, slug, url, score (0-1) } for citation tracking
 *
 * @filtering
 *   - Skips matches where title/slug is empty, "Untitled", or "unknown"
 *   - Skips matches where text content is ≤30 chars (too short to be useful)
 *   - Sanitizes display names: strips .html, replaces - with spaces
 */
for (const match of vectorMatches) {
          const meta = match.metadata || {};
          const text = meta.text || meta.content || "";

          // Derive source name -- skip Untitled/empty/unknown
          const rawTitle = meta.title || meta.paper_title || "";
          const rawSlug = meta.slug || match.id || "";
          const sourceTitle = (rawTitle !== "Untitled" && rawTitle !== "" && rawTitle !== "unknown")
            ? rawTitle : "";
          const sourceSlug = (rawSlug !== "" && rawSlug !== "unknown") ? rawSlug : "";

          // Only include named, non-Unknown sources
          if (sourceTitle || sourceSlug) {
            const displayName = sourceTitle
              ? sourceTitle.replace(/-/g, " ").replace(/\.html$/, "")
              : sourceSlug.replace(/-/g, " ").replace(/\.html$/, "").replace(/index::\d+$/, "");

            if (text && text.length > 30) {
              contexts.push({
                text: text.substring(0, 2500),
                name: displayName
              });
            }

            citations.push({
              title: displayName,
              slug: sourceSlug,
              url: meta.url || "https://papers.qnfo.org/papers/" + (sourceSlug || rawSlug),
              score: Math.round((match.score || 0) * 100) / 100
            });
          }
        }

