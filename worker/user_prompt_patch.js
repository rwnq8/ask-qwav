/**
 * @module user_prompt_patch
 * @description Patches the user prompt with research context from Vectorize query results.
 *              Three modes depending on what the cite_loop produced:
 *
 * @modes
 *   1. contexts.length > 0 → "Research Context" mode:
 *      Prepends all matched paper text chunks as [Name]:\ntext blocks.
 *      Instructs LLM to answer ONLY from the provided context with actual title citations.
 *
 *   2. citations.length > 0 (no context text) → "Partial Index" mode:
 *      Lists available source URLs. Instructs LLM to acknowledge limited data,
 *      cite available titles, and NOT fabricate content or fall back to general knowledge.
 *
 *   3. Neither contexts nor citations → "No Results" mode:
 *      Instructs LLM to state clearly that no QWAV sources were found and
 *      explicitly forbids fabrication or general-knowledge fallback.
 *
 * @integration Inserted inline into the main query handler, after cite_loop and fallbacks.
 *              Sets userPrompt = basePrefix + context + question + constraint.
 *
 * @citation_enforcement The system prompt also includes "Cite sources by exact title"
 *                        and a "Fabrication prevention" section that penalizes invented sources.
 */
if (contexts.length > 0) {
          userPrompt += `Research Context:\n\n${contexts.map((c, i) => `[${c.name}]:\n${c.text}`).join("\n\n---\n\n")}\n\n`;
          userPrompt += `Question: ${query}\n\nProvide a thorough answer using ONLY the Research Context above. Cite named sources by their actual title (not "[Source N]" or "Unknown source").`;
        } else if (citations.length > 0) {
          userPrompt += "Available QWAV sources (full text is being indexed):\n\n" + citations.map((c, i) => `[${c.title}]: ${c.url}`).join("\n") + "\n\n";
          userPrompt += `Question: ${query}\n\nSeveral QWAV research sources were found on this topic. Their full text content is currently being indexed into the search database. Answer ONLY based on source titles and partial information available above. Do NOT fabricate content — if you lack details, acknowledge this clearly. Do NOT fall back to general knowledge.`;
        } else {
          userPrompt += `Question: ${query}\n\nNo QWAV research sources were found for this query. State this clearly. Do NOT fabricate citations or answer from general knowledge.`;
        }
