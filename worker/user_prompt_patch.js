if (contexts.length > 0) {
          userPrompt += `Research Context:\n\n${contexts.map((c, i) => `[${c.name}]:\n${c.text}`).join("\n\n---\n\n")}\n\n`;
          userPrompt += `Question: ${query}\n\nProvide a thorough answer using ONLY the Research Context above. Cite named sources by their actual title (not "[Source N]" or "Unknown source").`;
        } else if (citations.length > 0) {
          userPrompt += "Available QWAV sources (full text is being indexed):\n\n" + citations.map((c, i) => `[${c.title}]: ${c.url}`).join("\n") + "\n\n";
          userPrompt += `Question: ${query}\n\nSeveral QWAV research sources were found on this topic. Their full text content is currently being indexed into the search database. Answer ONLY based on source titles and partial information available above. Do NOT fabricate content — if you lack details, acknowledge this clearly. Do NOT fall back to general knowledge.`;
        } else {
          userPrompt += `Question: ${query}\n\nNo QWAV research sources were found for this query. State this clearly. Do NOT fabricate citations or answer from general knowledge.`;
        }
