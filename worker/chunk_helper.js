/**
 * @module chunk_helper
 * @description Chunking helper — splits markdown body into ~2000-character segments
 *              on ## section boundaries with 250-char overlap for context continuity.
 *              Falls back to a single truncated chunk for documents with no headers.
 *
 * @function chunkMarkdown
 * @param {string} markdown - Full markdown document body
 * @param {string} title    - Document title (used for fallback single-chunk label)
 * @returns {Array<{text: string, slug: string}>} Array of chunk objects, each with
 *          trimmed text content and a slug derived from the first ## header
 *
 * @algorithm
 *   1. Split markdown on /\n(?=## )/ to isolate sections by header boundaries
 *   2. Accumulate sections into a chunk until MAX_CHUNK (2000) is exceeded
 *   3. When chunk is full → push and start new chunk with 250-char overlap tail
 *   4. Final leftover section → push as last chunk
 *   5. Fallback: if no chunks produced, return single chunk of title+\n\n+markdown (truncated to 2000)
 *
 * @constants MAX_CHUNK=2000, OVERLAP=250 — tuned for @cf/meta/llama-3.2-3b-instruct context window
 */
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
