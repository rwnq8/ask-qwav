// Build a human-readable citation label from metadata
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
