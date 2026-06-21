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

