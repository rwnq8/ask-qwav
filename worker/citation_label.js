/**
 * @module citation_label
 * @description Builds a human-readable citation label from paper metadata.
 *              Prefers the paper title; falls back to a cleaned-up slug path.
 *              Returns null for untitled/empty sources so they are excluded from LLM context.
 *
 * @function citationLabel
 * @param {object} meta  - Paper metadata object (title, slug, id)
 * @param {number} index - Position index in the citation list (unused — kept for API compatibility)
 * @returns {string|null} Citation label (max 80 chars), or null if source should be skipped
 *
 * @fallback_chain
 *   1. If title is meaningful (not "Untitled", >3 chars) → use title (truncated to 80)
 *   2. Else if slug → clean path: strip papers/, .html, trailing digits, replace -/ with spaces
 *   3. If cleaned slug >5 chars → use it (truncated to 80)
 *   4. Otherwise → return null (skip this source entirely)
 */
function citationLabel(meta, index) {
  const title = (meta.title || "").trim();
  const slug = (meta.slug || meta.id || "").trim();
  
  // If the title is meaningful (not "Untitled"), use it
  if (title && title !== "Untitled" && title.length > 3) {
    return title.substring(0, 80);
  }
  
  // Fall back to slug with meaningful segments
  if (slug) {
    let label = slug
      .replace(/papers\//, "")
      .replace(/\.html?$/, "")
      .replace(/\d+$/, "")
      .replace(/[\/:]+/g, " \u00a7 ")
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (label.length > 5) return label.substring(0, 80);
  }
  
  // Skip this source entirely
  return null;
}
