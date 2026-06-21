// ─── Chunking helper: splits markdown into ~2000-char segments on ## boundaries ───
function chunkMarkdown(markdown, title) {
  const MAX_CHUNK = 2000;
  const OVERLAP = 250;
  const chunks = [];
  
  // Split on ## headers to get sections
  const sections = markdown.split(/\n(?=## )/);
  
  let currentChunk = "";
  let slug = "";
  
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    
    // Extract slug from first header
    if (!slug) {
      const headerMatch = trimmed.match(/^#+\s+(.+)/m);
      if (headerMatch) {
        slug = headerMatch[1].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      }
    }

    if (currentChunk.length + trimmed.length > MAX_CHUNK && currentChunk.length > 0) {
      chunks.push({ text: currentChunk.trim(), slug: slug });
      const overlapText = currentChunk.length > OVERLAP ? currentChunk.substring(currentChunk.length - OVERLAP) : currentChunk;
      currentChunk = overlapText + "\n\n" + trimmed;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + trimmed;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push({ text: currentChunk.trim(), slug: slug });
  }
  
  return chunks.length > 0 ? chunks : [{ text: (title + "\n\n" + markdown).substring(0, MAX_CHUNK), slug: slug }];
}
