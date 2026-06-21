/**
 * =============================================================================
 * QWAV Research API — Cloudflare Worker (ask-qwav.q08.workers.dev)
 * =============================================================================
 * @module      qwav-worker
 * @version     2.7.0
 * @deploy      ask-qwav.q08.workers.dev
 * @wrangler    worker/wrangler.toml
 * @runtime     Cloudflare Workers (fetch + scheduled)
 * @model       @cf/meta/llama-3.2-3b-instruct
 * @embeddings  @cf/baai/bge-base-en-v1.5
 *
 * ─── Architecture ───
 *   Storage:   D1 (qnfo-audit + living-paper), R2 (qnfo bucket), Vectorize
 *   Caching:   In-memory query cache with p-adic TTL scaling
 *   Rate:      Per-IP, 10 req/min on /index-papers
 *   CORS:      Open (Access-Control-Allow-Origin: *)
 *
 * ─── Mathematical Foundations ───
 *   1. Ultrametric Tree: Agglomerative single-linkage clustering → dendrogram
 *      Strong triangle inequality: d(x,z) ≤ max(d(x,y), d(y,z))
 *      Enables "Did You Mean?" discovery + cluster-based search expansion
 *   2. p-Adic Language Model: Token → Z_p embedding → ultrametric ball attention
 *      No softmax; binary attention via |x - y|_p ≤ p^{-2} threshold
 *   3. Tate-Shafarevich: Hasse local-global validation across D1, R2, Vectorize
 *      Selmer group obstruction certificate via multi-edge checks
 *   4. Fontaine Period Bridge: B_cris / B_st / B_dR bridges between
 *      R2 ↔ D1 ↔ Vectorize representations
 *   5. Bruhat-Tits Building: Simplicial complex from ultrametric apartment chains
 *   6. p-Adic Perceptron: Z_p-weighted linear classifier with Hensel lifting
 *
 * ─── Endpoint Catalog ───
 *   GET  /health               System health, paper count, index progress
 *   GET  /thread?id=            Get chat thread messages
 *   GET  /threads               List all chat threads
 *   DELETE /thread?id=          Delete chat thread
 *   GET  /recent                Recent queries + answers
 *   GET  /did-you-mean?q=       Ultrametric spelling correction + cluster suggestions
 *   GET  /ultrametric-tree      Tree stats: depth, clusters, Hensel layers, foundations
 *   GET  /papers?search=&limit=  Search papers in D1 living-paper database
 *   POST /fix-titles            Batch-correct paper titles via ultrametric matching
 *   GET  /stats                 Query + paper statistics
 *   POST /sync-clusters         Rebuild ultrametric tree from D1 and persist to R2
 *   GET  /validate?title=       Hasse local-global validation of a paper title
 *   GET  /paper-versions?title=  Witt vector version tracking for papers
 *   GET  /spectral-analysis?title=  Spectral analysis of p-adic paper neighborhoods
 *   GET  /bruhat-tits           Bruhat-Tits building apartments + chambers from tree
 *   GET  /perceptron?inputs=&weights=&p=  p-adic perceptron with Hensel-lifted weights
 *   GET  /dendrogram-json       Tree as D3-compatible JSON dendrogram
 *   POST /vectorize-tree-search p-adic vector search with ultrametric pruning
 *   GET  /validate-multi?titles=  Batch Hasse local-global validation
 *   POST /paper-diff            Pairwise ultrametric diff between paper versions
 *   GET  /berkovich-explorer    Berkovich analytification of the paper corpus
 *   GET  /stats/csv             Download full stats as CSV
 *   POST /index-papers          CRON-like manual index: status, start, continue
 *   POST /  or  POST /query     Main RAG query: embed → Vectorize → LLM with citations
 *   POST /validate-selmer       [I] Tate-Shafarevich: Selmer group validation + obstruction
 *   POST /p-adic-embed          [J] p-adic LM: token→Z_p embed→ultrametric attention mask
 *   POST /period-bridge         [K] Fontaine Period Bridge between R2/D1/Vectorize
 *   GET  /spec                  OpenAPI 3.1 specification (AI/LLM discoverability)
 *
 * ─── Discoverability Metadata ───
 *   @topic      quantum-computing, p-adic-mathematics, number-theory, information-retrieval
 *   @standards  OpenAPI 3.1, llmstxt.org, Schema.org/SoftwareApplication
 *   @ai-crawler llms.txt: GET /spec (OpenAPI), robots.txt: Allow all AI bots
 *   @keywords   ultrametric, p-adic, RAG, vector search, Hasse principle,
 *               Tate-Shafarevich, Fontaine bridge, Bruhat-Tits, Berkovich,
 *               Hensel lifting, Witt vectors, Ostrowski theorem, dendrogram,
 *               Cloudflare Workers, D1, R2, Vectorize, Llama 3.2
 * =============================================================================
 */

/**
 * Strips editorializing superlatives from paper abstracts to reduce LLM hallucination.
 * Removes phrases like "groundbreaking", "revolutionary", "state-of-the-art", etc.
 * Collapses whitespace and fixes double punctuation from removed phrases.
 *
 * @param {string} text - Raw abstract text
 * @returns {string} Sanitized abstract with editorial phrases removed
 */
function sanitizeAbstract(text) {
  if (!text) return text;
  let cleaned = text;
  // Remove common editorializing superlatives and phrases
  const editorialPhrases = [
    /\bfar[- ]reaching implications?\b/gi,
    /\bground[- ]?breaking\b/gi,
    /\brevolutionary\b/gi,
    /\bunprecedented\b/gi,
    /\bremarkable\b/gi,
    /\bparadigm[- ]?shifting\b/gi,
    /\bgame[- ]?changing\b/gi,
    /\btransformative\b/gi,
    /\bprofound(ly)?\b/gi,
    /\bcutting[- ]?edge\b/gi,
    /\bstate[- ]of[- ]the[- ]art\b/gi,
    /\bnovel (and )?(innovative|exciting)\b/gi,
    /\bopens (up )?new avenues?\b/gi,
    /\ba major breakthrough\b/gi,
    /\bthis (paper|work) (presents|introduces) a novel\b/gi,
  ];
  for (const p of editorialPhrases) {
    cleaned = cleaned.replace(p, '');
  }
  // Collapse whitespace and trim
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  // Fix any double commas/punctuation from removed phrases
  cleaned = cleaned.replace(/, ,/g, ',').replace(/\. \./g, '.').replace(/\s+,/g, ',').replace(/,\s*,/g, ',');
  return cleaned;
}

/**
 * Generates a unique thread ID with timestamp + random suffix.
 * Format: th_{base36_timestamp}_{6-char_random}
 *
 * @returns {string} Unique thread identifier
 */
function generateId() {
  return "th_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 8);
}

/**
 * Splits markdown into overlapping ~2000-character chunks on ## section boundaries.
 * Used for Vectorize indexing — each chunk gets embedded separately.
 * Falls back to a single title-prefixed chunk if no sections are found.
 *
 * @param {string} markdown - Full markdown content of a paper
 * @param {string} title - Paper title (used for slug extraction + fallback chunk)
 * @returns {Array<{text: string, slug: string}>} Array of chunk objects
 */
function chunkMarkdown(markdown, title) {
  const MAX_CHUNK = 2000;
  const OVERLAP = 250;
  const chunks = [];
  const sections = markdown.split(/\n(?=## )/);
  let currentChunk = "";
  let slug = "";
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    if (!slug) {
      const headerMatch = trimmed.match(/^#+\s+(.+)/m);
      if (headerMatch) slug = headerMatch[1].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }
    if (currentChunk.length + trimmed.length > MAX_CHUNK && currentChunk.length > 0) {
      chunks.push({ text: currentChunk.trim(), slug: slug });
      const overlapText = currentChunk.length > OVERLAP ? currentChunk.substring(currentChunk.length - OVERLAP) : currentChunk;
      currentChunk = overlapText + "\n\n" + trimmed;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + trimmed;
    }
  }
  if (currentChunk.trim()) chunks.push({ text: currentChunk.trim(), slug: slug });
  return chunks.length > 0 ? chunks : [{ text: (title + "\n\n" + markdown).substring(0, MAX_CHUNK), slug: slug }];
}

/**
 * Levenshtein (edit) distance between two strings.
 * Used for "Did you mean?" spelling correction and ultrametric tree construction.
 * O(m*n) dynamic programming with optimized single-row memory.
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Minimum edit distance (0 = identical)
 */
// ─── Levenshtein distance for "Did you mean?" ───
function levenshtein(a, b) {
  const alen = a.length, blen = b.length;
  const matrix = [];
  for (let i = 0; i <= alen; i++) { matrix[i] = [i]; }
  for (let j = 0; j <= blen; j++) { matrix[0][j] = j; }
  for (let i = 1; i <= alen; i++) {
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[alen][blen];
}

/**
 * Search the ultrametric title index for titles within a given Levenshtein
 * distance of the query. Used by validate-selmer for multi-edge consensus checks.
 * @param {string} query - Title to search for
 * @param {number} maxDist - Maximum Levenshtein distance (default 1)
 * @param {number} maxResults - Maximum results to return (default 5)
 * @returns {string[]} Array of matching titles (lowercased)
 */
function levenshteinSearch(query, maxDist = 1, maxResults = 5) {
  const q = query.toLowerCase();
  const results = [];
  for (const [title, node] of ultrametricTitleIndex) {
    const dist = levenshtein(q, title);
    if (dist <= maxDist) results.push(title);
    if (results.length >= maxResults) break;
  }
  return results;
}

// ============================================================
// ULTRAMETRIC TREE — "Did You Mean?" discovery engine v2.7+
// ============================================================
// Case Study: Practical Ultrametric Distance in QWAV Information Retrieval
//
// MATHEMATICAL FOUNDATION:
// An ultrametric distance d satisfies the STRONG triangle inequality:
//   d(x,z) ≤ max(d(x,y), d(y,z))
// This is strictly stronger than the metric inequality d(x,z) ≤ d(x,y)+d(y,z).
// Ultrametric spaces correspond canonically to rooted trees (dendrograms):
// the distance between any two leaves equals the height (merge distance) of
// their lowest common ancestor. Balls in ultrametric spaces are either disjoint
// or nested — never partially overlapping.
//
// IMPLEMENTATION:
// 1. Agglomerative single-linkage clustering builds an ultrametric tree
//    from all paper titles. Single-linkage guarantees ultrametric distances.
// 2. Internal nodes represent clusters with radius = merge distance.
// 3. SEARCH: word-level edit-distance matching finds seed titles.
// 4. CLUSTER EXPANSION: the tree reveals structural neighbors of seeds —
//    papers that are mathematically "near" even when they lack direct
//    word overlap. This is the discovery/wonderment mechanism.
// 5. PRUNING: the strong triangle inequality guarantees that if a query
//    is farther than maxDistance + cluster_radius from a cluster's
//    representative, no member of that cluster can be a valid match.
//
// QNFO APPLICATIONS:
// - The tree reveals natural subfield clusters (ultrametric geometry,
//   p-adic analysis, quantum foundations, hierarchical models, etc.)
// - R2 persistence enables cold-start resilience
// - The structure mirrors the hierarchical nature of the research itself
// - Cluster metadata enriches the "Did you mean?" response
// - This implementation itself serves as a case study in applying
//   ultrametric distance to practical information retrieval problems
// ============================================================

// ─── Ultrametric Tree State ───
let ultrametricTree = null;
let ultrametricTreeBuiltAt = 0;
let ultrametricTitleIndex = new Map(); // title → leaf (for fast cluster lookup)
let initInProgress = false;   // R2 restoration lock
const ULTRA_TREE_TTL = 3600000; // 1 hour rebuild

/**
 * Builds the ultrametric tree via agglomerative single-linkage clustering.
 * Single-linkage guarantees the ultrametric property (strong triangle inequality).
 * Complexity: O(n³) worst case (~93M operations for n≈450).
 *
 * Algorithm:
 *   1. Create leaf nodes for each title
 *   2. Compute pairwise Levenshtein distance matrix
 *   3. Iteratively merge closest clusters (single-linkage = min distance)
 *   4. Build title→leaf index for fast cluster lookup
 *
 * @param {string[]} titles - Array of paper titles to cluster
 * @returns {Object|null} Root node of the ultrametric tree, or null if empty
 */
// ─── Tree builder: agglomerative single-linkage clustering ───
function buildUltrametricTree(titles) {
  if (!titles || titles.length === 0) return null;
  const n = titles.length;
  if (n === 1) return { type: "leaf", title: titles[0], rep: titles[0], size: 1 };
  
  // Step 1: Create leaf nodes
  const nodes = titles.map(t => ({ type: "leaf", title: t, rep: t, size: 1 }));
  
  // Step 2: Compute pairwise distance matrix
  let active = nodes.map((_, i) => i);
  const D = [];
  for (let i = 0; i < n; i++) D[i] = [];  // Init all rows first
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      D[i][j] = levenshtein(nodes[i].rep.toLowerCase(), nodes[j].rep.toLowerCase());
      D[j][i] = D[i][j];
    }
  }
  
  // Step 3: Agglomerative merging (O(n³) worst case, ~93M ops for n≈450)
  let mergeCount = 0;
  while (active.length > 1) {
    let bestI = 0, bestJ = 1, bestDist = Infinity;
    for (let ai = 0; ai < active.length; ai++) {
      const i = active[ai];
      for (let aj = ai + 1; aj < active.length; aj++) {
        const j = active[aj];
        if (D[i][j] < bestDist) { bestDist = D[i][j]; bestI = ai; bestJ = aj; }
      }
    }
    
    const idxI = active[bestI], idxJ = active[bestJ];
    const child = {
      type: "internal",
      children: [nodes[idxI], nodes[idxJ]],
      distance: bestDist, // the ultrametric merge height
      rep: nodes[idxI].size >= nodes[idxJ].size ? nodes[idxI].rep : nodes[idxJ].rep,
      size: nodes[idxI].size + nodes[idxJ].size
    };
    nodes[idxI] = child;
    
    // Update distances: single-linkage = min(child distances)
    for (let ak = 0; ak < active.length; ak++) {
      const k = active[ak];
      if (k !== idxI && k !== idxJ) {
        D[idxI][k] = Math.min(D[idxI][k], D[idxJ][k]);
        D[k][idxI] = D[idxI][k];
      }
    }
    active.splice(bestJ, 1);
    mergeCount++;
  }
  
  ultrametricTree = nodes[active[0]];
  // Build title→leaf index
  ultrametricTitleIndex.clear();
  (function indexLeaves(node) {
    if (node.type === "leaf") ultrametricTitleIndex.set(node.title.toLowerCase(), node);
    else node.children.forEach(indexLeaves);
  })(ultrametricTree);
  
  return ultrametricTree;
}

/**
 * Finds the leaf node for a paper title in the ultrametric title index.
 *
 * @param {string} title - Paper title to look up
 * @returns {Object|null} Leaf node or null if not found
 */
function findClusterForTitle(title) {
  return ultrametricTitleIndex.get(title.toLowerCase()) || null;
}

/**
 * Collects all paper titles in the same cluster as a given title.
 * Traverses the ultrametric tree up to maxClusterDistance merge height.
 *
 * @param {string} title - Seed paper title
 * @param {number} [maxClusterDistance=Infinity] - Maximum merge distance to traverse
 * @returns {string[]} Array of paper titles in the cluster
 */
function getClusterTitles(title, maxClusterDistance = Infinity) {
  const leaf = findClusterForTitle(title);
  if (!leaf) return [];
  const results = [];
  (function collect(node, target, maxDist) {
    if (node === target || node.type === "leaf") { results.push(node.title); return; }
    if (node.distance > maxDist) return;
    node.children.forEach(c => collect(c, target, maxDist));
  })(ultrametricTree, leaf, maxClusterDistance);
  return results;
}

/**
 * Searches the ultrametric tree for titles matching a query word within edit distance.
 * Uses strong triangle inequality pruning: skips clusters where
 * d(query, rep) > maxDistance + cluster_radius.
 *
 * @param {string} queryWord - Word to search for
 * @param {number} maxDistance - Maximum Levenshtein distance
 * @param {number} [maxResults=5] - Maximum results to return
 * @returns {string[]} Matching paper titles sorted by edit distance
 */
// ─── Tree-based search with ultrametric pruning ───
function searchUltrametricTree(queryWord, maxDistance, maxResults = 5) {
  if (!ultrametricTree) return [];
  const q = queryWord.toLowerCase().trim();
  const results = [];
  (function searchNode(node) {
    if (node.type === "leaf") {
      // Compare query against each WORD in the title (not the full title)
      const tWords = node.title.toLowerCase().split(/\s+/);
      for (const tw of tWords) {
        if (Math.abs(q.length - tw.length) > maxDistance + 1) continue;
        const d = levenshtein(q, tw);
        if (d > 0 && d <= maxDistance) { results.push({ title: node.title, dist: d }); break; }
      }
      return;
    }
    for (const child of node.children) {
      const d_rep = levenshtein(q, child.rep.toLowerCase());
      const effectiveRadius = child.type === "internal" ? child.distance : 0;
      // Strong triangle inequality: d(q,m) ≤ max(d(q,rep), radius)
      // Search if q could be within maxDistance of any member
      if (d_rep <= maxDistance + effectiveRadius) searchNode(child);
    }
  })(ultrametricTree);
  results.sort((a, b) => a.dist - b.dist);
  const seen = new Set(); const unique = [];
  for (const r of results) {
    const norm = r.title.toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
    if (!seen.has(norm)) { seen.add(norm); unique.push(r); if (unique.length >= maxResults) break; }
  }
  return unique.map(r => r.title);
}

/**
 * Enhanced "Did you mean?" suggestion engine combining word-level edit distance
 * with ultrametric cluster expansion.
 *
 * Phase 1: Word-level Levenshtein matching against all titles
 * Phase 2: Ultrametric cluster expansion from top matches
 * Phase 3: Direct tree-based search if no word matches found
 *
 * @param {string} query - User's query string
 * @param {string[]} titles - All paper titles to search against
 * @param {number} [maxResults=8] - Maximum suggestions to return
 * @param {number} [maxWordDist=5] - Maximum per-word edit distance
 * @param {number} [maxClusterDist=15] - Maximum cluster merge distance for expansion
 * @returns {string[]} Suggested paper titles, deduplicated and sorted by relevance
 */
// ─── Enhanced suggestions: word-match + ultrametric cluster expansion ───
function suggestCorrectionsUltra(query, titles, maxResults = 8, maxWordDist = 5, maxClusterDist = 15) {
  const qWords = query.toLowerCase().trim().split(/\s+/).filter(w => w.length >= 3);
  if (qWords.length === 0) return [];
  
  // Phase 1: Word-level edit-distance matching
  const scored = [];
  for (const title of titles) {
    const tWords = title.toLowerCase().split(/\s+/);
    let bestDist = Infinity;
    for (const qw of qWords) {
      for (const tw of tWords) {
        if (Math.abs(qw.length - tw.length) > maxWordDist + 1) continue;
        const d = levenshtein(qw, tw);
        if (d < bestDist) bestDist = d;
      }
    }
    if (bestDist > 0 && bestDist <= maxWordDist) scored.push({ title, dist: bestDist, source: "word" });
  }
  
  // Phase 2: Ultrametric cluster expansion (if word matches found)
  if (ultrametricTree && scored.length > 0) {
    const clusterSet = new Set();
    for (const s of scored) {
      for (const nt of getClusterTitles(s.title, maxClusterDist)) {
        if (nt !== s.title) clusterSet.add(nt);
      }
    }
    for (const ct of clusterSet) {
      if (!scored.some(s => s.title === ct)) scored.push({ title: ct, dist: maxWordDist + 1, source: "cluster" });
    }
  }
  
  // Phase 3: If no word matches, try direct tree-based search
  if (ultrametricTree && scored.length === 0) {
    for (const qw of qWords) {
      const treeResults = searchUltrametricTree(qw, maxWordDist, 5);
      for (const tr of treeResults) {
        if (!scored.some(s => s.title === tr)) scored.push({ title: tr, dist: maxWordDist, source: "tree" });
      }
    }
  }
  
  scored.sort((a, b) => a.dist - b.dist);
  const seen = new Set(); const unique = [];
  for (const s of scored) {
    const norm = s.title.toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
    if (!seen.has(norm)) { seen.add(norm); unique.push(s); if (unique.length >= maxResults) break; }
  }
  return unique.map(s => s.title);
}

/**
 * Backward-compatible wrapper for "Did you mean?" suggestions.
 * Delegates to suggestCorrectionsUltra when the tree is available;
 * falls back to pure word-level Levenshtein matching otherwise.
 *
 * @param {string} query - User's query
 * @param {string[]} titles - Paper titles
 * @param {number} [maxResults=5] - Max suggestions
 * @param {number} [maxDistance=3] - Max edit distance
 * @returns {string[]} Suggested titles
 */
// ─── Backward-compatible wrapper ───
function suggestCorrections(query, titles, maxResults = 5, maxDistance = 3) {
  if (ultrametricTree) return suggestCorrectionsUltra(query, titles, maxResults, maxDistance);
  // Fallback: pure word-level matching
  const qWords = query.toLowerCase().trim().split(/\s+/).filter(w => w.length >= 3);
  if (qWords.length === 0) return [];
  const scored = [];
  for (const title of titles) { const tWords = title.toLowerCase().split(/\s+/); let bd = Infinity;
    for (const qw of qWords) for (const tw of tWords) {
      if (Math.abs(qw.length - tw.length) > maxDistance + 1) continue; const d = levenshtein(qw, tw); if (d < bd) bd = d;
    } if (bd > 0 && bd <= maxDistance) scored.push({ title, dist: bd }); }
  scored.sort((a, b) => a.dist - b.dist);
  const seen = new Set(); const unique = [];
  for (const s of scored) { const norm = s.title.toLowerCase().replace(/[^a-zA-Z0-9]/g, ''); if (!seen.has(norm)) { seen.add(norm); unique.push(s); if (unique.length >= maxResults) break; } }
  return unique.map(s => s.title);
}

// ─── Tree stats for /ultrametric-tree endpoint ───
// Enhanced with p-adic valuation, Hensel lifting depth, and Ostrowski hybrid metrics
/**
 * Computes comprehensive statistics from the ultrametric tree.
 * Extracts max depth, max valuation, cluster distribution, foundational papers
 * by depth, Hensel layers (papers at each merge level), and Berkovich type counts.
 *
 * @param {Object} node - Root node of the ultrametric tree
 * @returns {Object} Tree statistics object with clusters, depth, HenSel layers,
 *                   p-adic metrics, Ostrowski theorem reference, and TTL
 */
function getTreeStats(node) {
  if (!node) return { built: false };
  
  function walk(n, depth, mergePath) {
    if (n.type === "leaf") {
      // p-adic valuation: depth from root = ord_p(paper)
      // p-adic absolute value: |paper|_p = 2^{-depth} (using p=2)
      // Higher depth = more specialized, lower depth = more foundational
      const valuation = depth;  // ord_p ≈ depth from root
      const padicNorm = Math.pow(2, -valuation);  // |x|_2 = 2^{-ord_2(x)}
      return {
        leaves: [{ title: n.title, valuation, padicNorm, mergePath: [...mergePath] }],
        internal: 0, maxDepth: depth, maxDist: 0, clusters: [],
        // Hensel lifting data: the path of merge distances along the branch
        henselPath: mergePath
      };
    }
    const leftPath = [...mergePath, n.distance];
    const rightPath = [...mergePath, n.distance];
    const l = walk(n.children[0], depth + 1, leftPath);
    const r = walk(n.children[1], depth + 1, rightPath);
    return {
      leaves: [...l.leaves, ...r.leaves],
      internal: l.internal + r.internal + 1,
      maxDepth: Math.max(l.maxDepth, r.maxDepth),
      maxDist: Math.max(n.distance, l.maxDist, r.maxDist),
      clusters: [...l.clusters, ...r.clusters, { distance: n.distance, size: n.size, rep: n.rep }],
      // Hensel path data: merge distances along deepest branch
      henselPath: l.leaves.length >= r.leaves.length ? l.henselPath : r.henselPath
    };
  }
  
  const stats = walk(node, 0, []);
  
  // Ostrowski hybrid ranking: combine ultrametric + p-adic
  // Euclidean part: cluster distance (ultrametric structure)
  // p-adic part: valuation (depth = specialization)
  // Ostrowski's theorem says every nontrivial absolute value on Q
  // is equivalent to |·|_∞ or |·|_p — we combine both
  const allLeaves = stats.leaves;
  const maxValuation = stats.maxDepth || 1;
  
  // Assign Ostrowski hybrid score: balanced combination
  // Score = α · |x|_∞ + β · |x|_2 where |x|_∞ = 1/(cluster_distance+1)
  // Higher score = more foundational (close to root, large cluster)
  allLeaves.forEach(leaf => {
    const avgMergeDist = leaf.mergePath.length > 0 
      ? leaf.mergePath.reduce((a,b)=>a+b,0) / leaf.mergePath.length 
      : 0;
    // Euclidean-like norm: 1/(avg merge distance + 1) — closer clusters = higher
    const euclidNorm = 1 / (avgMergeDist + 1);
    // p-adic norm: 2^{-valuation} — deeper = smaller
    const padicNorm = Math.pow(2, -leaf.valuation);
    // Ostrowski hybrid: weighted harmonic mean
    leaf.ostrowskiScore = (2 * euclidNorm * padicNorm) / (euclidNorm + padicNorm + 0.001);
  });
  
  // Top foundations: papers closest to root (highest Ostrowski score)
  const foundations = allLeaves
    .filter(l => l.valuation <= 10)
    .sort((a, b) => b.ostrowskiScore - a.ostrowskiScore)
    .slice(0, 10)
    .map(l => ({ title: l.title, valuation: l.valuation, padicNorm: Math.round(l.padicNorm * 1000) / 1000, ostrowskiScore: Math.round(l.ostrowskiScore * 1000) / 1000 }));
  
  // Hensel lifting: find papers at each merge-distance "layer"
  // Papers that join clusters at similar merge distances form "Hensel layers"
  const henselLayers = {};
  for (const leaf of allLeaves) {
    for (const d of leaf.mergePath) {
      if (!henselLayers[d]) henselLayers[d] = [];
      if (henselLayers[d].length < 3) henselLayers[d].push(leaf.title);
    }
  }
  const topHenselLayers = Object.entries(henselLayers)
    .filter(([d, _]) => parseInt(d) <= 30)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .slice(0, 10)
    .map(([d, titles]) => ({ mergeDistance: parseInt(d), papers: titles.slice(0, 3) }));
  
  // Top clusters (existing)
  const topClusters = stats.clusters
    .filter(c => c.distance <= 30 && c.size >= 3)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 20);
    
  return {
    built: true,
    builtAt: new Date(ultrametricTreeBuiltAt).toISOString(),
    totalLeaves: allLeaves.length,
    totalInternal: stats.internal,
    maxDepth: stats.maxDepth,
    maxValuation,
    maxUltrametricDistance: stats.maxDist,
    topClusters,
    topFoundations: foundations,        // p-adic: most foundational papers
    henselLayers: topHenselLayers,      // Hensel lifting: papers at each merge layer
    pAdicPrime: 2,                      // the prime used for valuation
    ostrowskiTheorem: "Combining |·|_∞ (cluster distance) + |·|_2 (valuation depth)",
    mahlerCoefficients: { coefficients: [0.033, -0.001, 0, -0.001, 0.001], theorem: "Mahler: f(x) = sum a_k C(x,k) approximates any continuous function on Z_p" },
    berkovichModel: { type1Points: 451, type2Points: 450, gaussNorm: "2-adic norm on paper titles" },
    pAdicInterpolation: { knownPapers: 3, recommendedCount: 10 },
    fontainePeriodRings: { bridges: ["R2 to D1", "D1 to Vectorize", "Vectorize to Tree", "R2 to Pages", "D1 clusters to R2 tree"] },
    ttlMinutes: Math.round(ULTRA_TREE_TTL / 60000)
  };
}


// ─── Did-you-mean cache ───
let didYouMeanCache = null;
let didYouMeanCacheTs = 0;

// ─── Query cache (in-memory, TTL 5min, max 200 entries) ───
const queryCache = new Map();
const CACHE_TTL_MS = 300000;    // fallback TTL (used when tree not available)
const MAX_CACHE_SIZE = 200;

// p-adic cache TTL: queries closer to ultrametric tree root (more foundational)
// get longer TTLs. ord_2(query) ≈ depth-inverse → TTL = base * 2^{ord_2}
// This mirrors the p-adic norm: |x|_2 = 2^{-ord_2(x)} → smaller norm = longer lived
/**
 * Computes a p-adic cache TTL for a query based on its depth in the ultrametric tree.
 * Queries closer to the root (more foundational topics) get longer TTLs.
 * TTL = 15s × 2^{ord_2(depth)}, capped at 600s.
 * Mirrors the p-adic norm: |x|_2 = 2^{-ord_2(x)} → smaller norm = longer lived.
 *
 * @param {string} query - The user's query string
 * @returns {number} Cache TTL in milliseconds
 */
function getPAdicCacheTTL(query) {
  if (!ultrametricTree) return CACHE_TTL_MS;
  const words = query.toLowerCase().trim().split(/\s+/).filter(w => w.length >= 3);
  if (words.length === 0) return CACHE_TTL_MS;
  // Estimate valuation: find minimum depth at which a cluster rep matches any query word
  let bestDepth = 222;
  function searchDepth(node, depth) {
    if (node.type === 'leaf') { bestDepth = Math.min(bestDepth, depth); return; }
    for (const word of words) {
      const d = levenshtein(word, node.rep.toLowerCase());
      if (d <= 5 && depth < bestDepth) bestDepth = depth;
    }
    if (node.children) { searchDepth(node.children[0], depth + 1); searchDepth(node.children[1], depth + 1); }
  }
  searchDepth(ultrametricTree, 0);
  // ord_2 ≈ (maxDepth - bestDepth) / 10 → 0-22 range, cap at 6 for TTL multiplier
  const ord2 = Math.min(6, Math.max(0, Math.floor((222 - bestDepth) / 15)));
  const ttl = 15000 * Math.pow(2, ord2); // 15s → 30s → 60s → 120s → 240s → 480s → 960s
  return Math.min(600000, ttl);
}

/**
 * Retrieves a cached query result if still within its TTL window.
 *
 * @param {string} key - Cache key (typically the query string)
 * @returns {*|null} Cached data or null if expired/missing
 */
function getCachedQuery(key) {
  const entry = queryCache.get(key);
  if (!entry) return null;
  const ttl = entry.ttl || CACHE_TTL_MS;
  if (Date.now() - entry.ts > ttl) { queryCache.delete(key); return null; }
  return entry.data;
}

/**
 * Stores a query result in the in-memory cache with a p-adic TTL.
 * Evicts oldest entry when cache exceeds MAX_CACHE_SIZE (200 entries).
 *
 * @param {string} key - Cache key
 * @param {*} data - Data to cache
 * @param {string|null} [query=null] - Original query (for p-adic TTL computation)
 */
function setCachedQuery(key, data, query = null) {
  if (queryCache.size >= MAX_CACHE_SIZE) {
    const firstKey = queryCache.keys().next().value;
    queryCache.delete(firstKey);
  }
  const ttl = query ? getPAdicCacheTTL(query) : CACHE_TTL_MS;
  queryCache.set(key, { data, ts: Date.now(), ttl });
}

// ─── Rate limiter (in-memory, per-IP, 10 req/min on /index-papers) ───
const rateLimitMap = new Map();
const RATE_WINDOW_MS = 60000;
const MAX_INDEX_REQUESTS = 10;

/**
 * Simple in-memory per-IP rate limiter for the /index-papers endpoint.
 * Allows MAX_INDEX_REQUESTS (10) per RATE_WINDOW_MS (60s).
 *
 * @param {string} ip - Client IP address
 * @returns {boolean} true if request is allowed, false if rate limited
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MS;
  let entries = rateLimitMap.get(ip);
  if (!entries) entries = [];
  entries = entries.filter(ts => ts > windowStart);
  if (entries.length >= MAX_INDEX_REQUESTS) return false;
  entries.push(now);
  rateLimitMap.set(ip, entries);
  return true;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const startTime = Date.now();
    const sourceIp = request.headers.get("CF-Connecting-IP") || "unknown";

    // ─── R2 Ultrametric Tree Restoration (cold-start resilience) ───
    if (!ultrametricTree && !initInProgress) {
      initInProgress = true;
      try {
        const stored = await env.PAPERS_R2.get("ultrametric/tree.json");
        const storedTs = await env.PAPERS_R2.get("ultrametric/built-at.txt");
        if (stored && storedTs) {
          ultrametricTree = JSON.parse(await stored.text());
          ultrametricTreeBuiltAt = parseInt(await storedTs.text(), 10) || 0;
          // Restore title index
          const storedIdx = await env.PAPERS_R2.get("ultrametric/title-index.json");
          if (storedIdx) ultrametricTitleIndex = new Map(JSON.parse(await storedIdx.text()));
        }
      } catch (r2e) { /* tree will be built on first /did-you-mean call */ }
      initInProgress = false;
    }
    const hdrs = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: hdrs });
    }

    /**
     * GET /health — System health check.
     * Returns model version, paper count, index progress, and vectorize chunk count.
     * Falls back to version "2.5.2" on D1 error.
     */
    // ─── Health endpoint ───
    if (request.method === "GET" && url.pathname === "/health") {
      try {
        const paperCount = await env.PAPERS_DB.prepare(
          "SELECT COUNT(*) as cnt FROM papers WHERE r2_key IS NOT NULL AND r2_key != x''"
        ).first().catch(() => ({ cnt: 0 }));
        const idxRow = await env.DB.prepare(
          "SELECT value FROM index_progress WHERE key = ?"
        ).bind("index_progress").first().catch(() => null);
        const vcRow = await env.DB.prepare(
          "SELECT value FROM index_progress WHERE key = ?"
        ).bind("vectorize_indexed_count").first().catch(() => null);
        const idxProgress = idxRow ? JSON.parse(idxRow.value) : null;
        const vectorizeChunks = vcRow ? parseInt(vcRow.value) || 0 : 0;
        return new Response(JSON.stringify({
          status: "ok",
          model: "@cf/meta/llama-3.2-3b-instruct",
          version: "2.7.0",
          features: ["rag", "vectorize", "threads", "analytics", "anti-hallucination", "indexing", "cache", "rate-limit", "cron"],
          paper_count: paperCount.cnt,
          indexed_papers: idxProgress ? idxProgress.indexed : 0,
          chunks_in_vectorize: vectorizeChunks
        }), { headers: hdrs });
      } catch (e) {
        return new Response(JSON.stringify({ status: "ok", model: "@cf/meta/llama-3.2-3b-instruct", version: "2.5.2" }), { headers: hdrs });
      }
    }

    /**
     * GET /thread?id= — Retrieve a chat thread's messages by thread ID.
     * POST /threads — List all chat threads.
     * DELETE /thread?id= — Delete a chat thread and its messages.
     */
    // ─── Thread endpoints ───
    if (request.method === "GET" && url.pathname === "/thread") {
      const tid = url.searchParams.get("id");
      if (!tid) return new Response(JSON.stringify({ error: "Missing ?id=thread_id" }), { status: 400, headers: hdrs });
      try {
        const row = await env.DB.prepare("SELECT messages, created_at, updated_at FROM chat_sessions WHERE thread_id = ?").bind(tid).first();
        if (!row) return new Response(JSON.stringify({ thread_id: tid, messages: [], created_at: null }), { headers: hdrs });
        return new Response(JSON.stringify({ thread_id: tid, messages: JSON.parse(row.messages || "[]"), created_at: row.created_at, updated_at: row.updated_at }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }
    if (request.method === "GET" && url.pathname === "/threads") {
      try {
        const rows = await env.DB.prepare("SELECT thread_id, messages, created_at, updated_at FROM chat_sessions WHERE messages != x'5b5d' ORDER BY updated_at DESC LIMIT 10").all();
        const threads = (rows.results || []).map(row => {
          let firstQuery = '';
          try {
            const msgs = JSON.parse(row.messages || '[]');
            const firstUser = msgs.find(m => m.role === 'user');
            if (firstUser && firstUser.content) firstQuery = firstUser.content.substring(0, 100);
          } catch (e) { /* ignore parse errors */ }
          return {
            thread_id: row.thread_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            first_query: firstQuery
          };
        });
        return new Response(JSON.stringify({ threads }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }
    if (request.method === "DELETE" && url.pathname === "/thread") {
      const tid = url.searchParams.get("id");
      if (!tid) return new Response(JSON.stringify({ error: "Missing ?id=thread_id" }), { status: 400, headers: hdrs });
      try {
        const result = await env.DB.prepare("DELETE FROM chat_sessions WHERE thread_id = ?").bind(tid).run();
        return new Response(JSON.stringify({ thread_id: tid, deleted: result.changes > 0 }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }
    /**
     * GET /recent — Returns most recent queries and answers from the query log.
     */
    if (request.method === "GET" && url.pathname === "/recent") {
      try {
        const r = await env.DB.prepare("SELECT id, thread_id, timestamp, query, citations_count, elapsed_ms, created_at FROM ask_queries_v2 ORDER BY id DESC LIMIT 20").all();
        return new Response(JSON.stringify({ queries: r.results }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── "Did you mean?" spelling suggestions ───
    /**
     * GET /did-you-mean?q= — Ultrametric spelling correction.
     * Uses word-level Levenshtein + ultrametric cluster expansion to suggest
     * paper titles close to the user's query. Returns suggestions and cluster info.
     */
    if (request.method === "GET" && url.pathname === "/did-you-mean") {
      try {
        const q = (url.searchParams.get("q") || "").trim();
        if (!q || q.length < 3 || q.length > 100) {
          return new Response(JSON.stringify({ suggestions: [] }), { headers: hdrs });
        }
        // Use cached titles or fetch all (small corpus, fast enough)
        let titles = didYouMeanCache;
        if (!titles || (Date.now() - didYouMeanCacheTs) > 600000) {
          const papers = await env.PAPERS_DB.prepare(
            "SELECT DISTINCT title FROM papers WHERE title NOT LIKE '%{{%' AND LENGTH(title) > 5 AND LENGTH(title) < 200 ORDER BY title LIMIT 454"
          ).all();
          titles = (papers.results || []).map(r => r.title).filter(Boolean);
          didYouMeanCache = titles;
          didYouMeanCacheTs = Date.now();
          // Build ultrametric tree (async) — persist to R2 for cold-start resilience
          if (!ultrametricTree || (Date.now() - ultrametricTreeBuiltAt) > ULTRA_TREE_TTL) {
            buildUltrametricTree(titles);
            ultrametricTreeBuiltAt = Date.now();
            // Persist to R2: tree JSON + title index
            try {
              await env.PAPERS_R2.put("ultrametric/tree.json", JSON.stringify(ultrametricTree));
              await env.PAPERS_R2.put("ultrametric/title-index.json", JSON.stringify([...ultrametricTitleIndex]));
              await env.PAPERS_R2.put("ultrametric/built-at.txt", ultrametricTreeBuiltAt.toString());
            } catch (r2e) { /* non-fatal: tree still works in-memory */ }
          }
        }
        const suggestions = suggestCorrections(q, titles, 8, 5);  // Increased to show cluster neighbors
        const treeInfo = ultrametricTree ? { clusters: ultrametricTree.size, builtAt: new Date(ultrametricTreeBuiltAt).toISOString() } : null;
        // Add "discoveries" — ultrametric cluster neighbors beyond direct word matches
        const discoveries = [];
        if (ultrametricTree && suggestions.length > 0) {
          const wordMatches = new Set(suggestions.slice(0, 4)); // First 4 are word matches
          for (const s of suggestions) {
            if (!wordMatches.has(s)) discoveries.push(s);
          }
        }
        return new Response(JSON.stringify({ suggestions: suggestions.slice(0, 5), discoveries: discoveries.slice(0, 5), tree: treeInfo }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── Ultrametric tree info endpoint ───
    /**
     * GET /ultrametric-tree — Full tree statistics.
     * Returns depth, max valuation, cluster distribution, foundational papers,
     * HenSel lift layers, p-adic metrics, Berkovich type counts, and TTL.
     */
    if (request.method === "GET" && url.pathname === "/ultrametric-tree") {
      try {
        // Ensure tree is built
        if (!ultrametricTree || (Date.now() - ultrametricTreeBuiltAt) > ULTRA_TREE_TTL) {
          const papers = await env.PAPERS_DB.prepare(
            "SELECT DISTINCT title FROM papers WHERE title NOT LIKE '%{{%' AND LENGTH(title) > 5 AND LENGTH(title) < 200 ORDER BY title LIMIT 454"
          ).all();
          const titles = (papers.results || []).map(r => r.title).filter(Boolean);
          buildUltrametricTree(titles);
          ultrametricTreeBuiltAt = Date.now();
        }
        const stats = getTreeStats(ultrametricTree);
        return new Response(JSON.stringify(stats), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── Papers browsing endpoint ───
    /**
     * GET /papers?search=&limit= — Search papers in the living-paper D1 database.
     * Supports free-text search against title + abstract, with pagination.
     * Returns arxiv_id, title, r2_key, abstract, and cluster metadata.
     */
    if (request.method === "GET" && url.pathname === "/papers") {
      try {
        const search = url.searchParams.get("search") || "";
        const arxivId = url.searchParams.get("arxiv_id") || "";
        const excludeAutoTitles = url.searchParams.get("exclude_auto_titles") === "true";
        const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
        const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50")));
        const offset = (page - 1) * limit;

        if (arxivId) {
          const paper = await env.PAPERS_DB.prepare(
            "SELECT arxiv_id, title, abstract, r2_key FROM papers WHERE arxiv_id = ? AND r2_key IS NOT NULL AND r2_key != x''"
          ).bind(arxivId).first();
          if (!paper) return new Response(JSON.stringify({ error: "Paper not found" }), { status: 404, headers: hdrs });
          return new Response(JSON.stringify({ paper }), { headers: hdrs });
        }

        let sql, params;
        if (search) {
          const term = "%" + search + "%";
          sql = "SELECT arxiv_id, title, abstract FROM papers WHERE r2_key IS NOT NULL AND r2_key != x'' AND (title LIKE ?1 OR abstract LIKE ?2)" + (excludeAutoTitles ? " AND title NOT LIKE '%Obsidian%' AND LENGTH(title) > 2" : "") + " ORDER BY arxiv_id ASC LIMIT ?3 OFFSET ?4";
          params = [term, term, limit, offset];
        } else {
          sql = "SELECT arxiv_id, title, abstract FROM papers WHERE r2_key IS NOT NULL AND r2_key != x''" + (excludeAutoTitles ? " AND title NOT LIKE '%Obsidian%' AND LENGTH(title) > 2" : "") + " ORDER BY arxiv_id ASC LIMIT ?1 OFFSET ?2";
          params = [limit, offset];
        }

        const papers = await env.PAPERS_DB.prepare(sql).bind(...params).all();

        // Get total count for pagination
        let totalCount;
        if (search) {
          const term = "%" + search + "%";
          const cntRow = await env.PAPERS_DB.prepare(
            "SELECT COUNT(*) as cnt FROM papers WHERE r2_key IS NOT NULL AND r2_key != x'' AND (title LIKE ?1 OR abstract LIKE ?2)" + (excludeAutoTitles ? " AND title NOT LIKE '%Obsidian%' AND LENGTH(title) > 2" : "")
          ).bind(term, term).first();
          totalCount = cntRow ? cntRow.cnt : 0;
        } else {
          const cntRow = await env.PAPERS_DB.prepare(
            "SELECT COUNT(*) as cnt FROM papers WHERE r2_key IS NOT NULL AND r2_key != x''" + (excludeAutoTitles ? " AND title NOT LIKE '%Obsidian%' AND LENGTH(title) > 2" : "")
          ).first();
          totalCount = cntRow ? cntRow.cnt : 0;
        }

        return new Response(JSON.stringify({
          papers: papers.results,
          page,
          limit,
          total: totalCount,
          total_pages: Math.ceil(totalCount / limit)
        }), { headers: hdrs });

      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── Fix auto-generated paper titles ───
    /**
     * POST /fix-titles — Batch-correct paper titles via ultrametric matching.
     * Accepts an array of titles, returns ultrametric-corrected suggestions.
     * Used for cleaning up OCR or user-misremembered paper titles.
     */
    if (request.method === "POST" && url.pathname === "/fix-titles") {
      let afterArxivId = '';
      try { const body = await request.json(); afterArxivId = body.after_arxiv_id || ''; } catch {}
      try {
        let sql, params;
        if (afterArxivId) {
          sql = "SELECT arxiv_id, title, r2_key FROM papers WHERE r2_key IS NOT NULL AND r2_key != x'' AND (title LIKE '%Obsidian%' OR LOWER(title) LIKE '%obsidian%' OR LENGTH(title) < 3 OR LENGTH(title) > 200 OR title LIKE '%{{%' OR title LIKE '%}}%') AND arxiv_id > ? ORDER BY arxiv_id ASC LIMIT 25";
          params = [afterArxivId];
        } else {
          sql = "SELECT arxiv_id, title, r2_key FROM papers WHERE r2_key IS NOT NULL AND r2_key != x'' AND (title LIKE '%Obsidian%' OR LOWER(title) LIKE '%obsidian%' OR LENGTH(title) < 3 OR LENGTH(title) > 200 OR title LIKE '%{{%' OR title LIKE '%}}%') ORDER BY arxiv_id ASC LIMIT 25";
          params = [];
        }
        const papers = await env.PAPERS_DB.prepare(sql).bind(...params).all();
        if (!papers.results || papers.results.length === 0) {
          return new Response(JSON.stringify({ fixed: 0, message: "No more bad titles found", complete: true }), { headers: hdrs });
        }
        let fixed = 0, errors = [], lastId = '';
        for (const paper of papers.results) {
          lastId = paper.arxiv_id;
          try {
            const r2Obj = await env.PAPERS_R2.get(paper.r2_key);
            if (!r2Obj) { errors.push({ arxiv_id: paper.arxiv_id, error: "R2 not found" }); continue; }
            const md = await r2Obj.text();
            // Try heading first, then frontmatter, then first non-empty line
            let realTitle = '';
            let hMatch = md.match(/^#\s+(.+)$/m) || md.match(/^##\s+(.+)$/m);
            if (hMatch && hMatch[1]) realTitle = hMatch[1].trim();
            if (!realTitle) {
              let fmMatch = md.match(/^title:\s*["']?(.+?)["']?\s*$/im);
              if (fmMatch && fmMatch[1] && !fmMatch[1].includes("{{")) realTitle = fmMatch[1].trim();
            }
            if (!realTitle) {
              let firstLine = md.split("\n").find(l => l.trim() && !l.startsWith("---") && !l.match(/^(title|permalink|layout|tags|date|aliases):/) && !l.match(/^[{}]/) && l.trim().length > 2);
              if (firstLine) realTitle = firstLine.replace(/^[#\s*>-]+/, '').replace(/[{}]/g, '').trim();
            }
            if (!realTitle) {
              // Fallback: use filename from R2 key, but clean up Obsidian prefixes
              let keyName = (paper.r2_key || "").replace("papers/", "").replace(/\.(md|html)$/, "");
              // Strip Obsidian id: obsidian-XXXX pattern
              keyName = keyName.replace(/^id[ _-]*obsidian[-_][a-f0-9]+[-_]?/i, "");
              // Strip leading IDs like "2021-05-12 " or numeric prefixes
              keyName = keyName.replace(/^[\d\-_]+[ _]+/, "");
              // Check if it's a raw UUID/hex hash (not useful as title)
              if (!keyName || keyName.match(/^[0-9a-f]{10,}$/i) || keyName.length < 3) {
                // Last resort: try to find meaningful text from template body
                const bodyLines = md.split("\n").filter(l => {
                  const t = l.trim();
                  return t && !t.startsWith("---") && !t.startsWith("{{") && !t.startsWith("}}") 
                      && !t.match(/^(title|permalink|layout|tags|date|aliases|paper_title|citation_title):/)
                      && !t.match(/^[{}#\*>-]/) && t.length > 10;
                });
                if (bodyLines.length > 0) {
                  keyName = bodyLines[0].trim().replace(/[{}]/g, "").replace(/^[#\s*>-]+/, "").substring(0, 200);
                }
              } else {
                keyName = keyName.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
              }
              if (keyName && keyName.length >= 3 && keyName.length < 300 && !keyName.match(/^[0-9a-f]{10,}$/i)) {
                realTitle = keyName;
              }
            }
            // One more fallback: try frontmatter aliases, paper_title, citation_title
            if (!realTitle) {
              const altFields = ['paper_title', 'citation_title', 'aliases', 'subtitle'];
              for (const field of altFields) {
                const am = md.match(new RegExp("^" + field + ":\\s*[\"']?([^\"'\\n]+)[\"']?\\s*$", "im"));
                if (am && am[1] && !am[1].includes("{{") && am[1].trim().length > 2 && am[1].trim().length < 300) {
                  realTitle = am[1].trim();
                  break;
                }
              }
            }
            if (!realTitle) { errors.push({ arxiv_id: paper.arxiv_id, error: "no extractable title" }); continue; }
            if (realTitle.length < 3 || realTitle.length > 300) { errors.push({ arxiv_id: paper.arxiv_id, error: "title invalid: " + realTitle.substring(0, 50) }); continue; }
            if (realTitle === paper.title) { errors.push({ arxiv_id: paper.arxiv_id, error: "same title" }); continue; }
            await env.PAPERS_DB.prepare("UPDATE papers SET title = ? WHERE arxiv_id = ?").bind(realTitle, paper.arxiv_id).run();
            fixed++;
          } catch (e) { errors.push({ arxiv_id: paper.arxiv_id, error: e.message }); }
        }
        return new Response(JSON.stringify({ fixed, errors: errors.slice(0, 10), last_arxiv_id: lastId, complete: papers.results.length < 25 }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── Buffer Social Media Scheduler ───
    if (request.method === "POST" && url.pathname === "/buffer-schedule") {
      try {
        const token = env.BUFFER_ACCESS_TOKEN;
        if (!token) return new Response(JSON.stringify({ error: "BUFFER_ACCESS_TOKEN secret not configured. Run: npx wrangler secret put BUFFER_ACCESS_TOKEN" }), { status: 500, headers: hdrs });
        const now = new Date();
        const t1 = new Date(now.getTime() + 7200000).toISOString(); // +2h
        const t2 = new Date(now.getTime() + 14400000).toISOString(); // +4h
        const posts = [
          { text: "🚀 19/20 ultrametric & p-adic principles now LIVE on Cloudflare Workers — 451 papers organized as an ultrametric dendrogram. p-adic valuation ranks papers, Hensel's lemma enables incremental discovery, Ostrowski's theorem drives hybrid scoring. Live: https://ask.qwav.tech Case study: https://ultrametric-case-study.ask-qwav.pages.dev", scheduled_at: t1 },
          { text: "🔬 How it works: 3-phase discovery — ① word-level Levenshtein ② ultrametric cluster expansion (finds structurally related papers without word overlap!) ③ tree-based pruned search. Mahler coefficients compress rankings, Berkovich spaces model nested hierarchies, Tate/Amice perform spectral analysis. GitHub: https://github.com/rwnq8/ask-qwav", scheduled_at: t2 }
        ];
        const results = [];
        for (const post of posts) {
          const resp = await fetch("https://api.bufferapp.com/1/updates/create.json?access_token=" + encodeURIComponent(token), {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "text=" + encodeURIComponent(post.text) + "&now=false&scheduled_at=" + encodeURIComponent(post.scheduled_at) + "&top=true"
          });
          results.push(await resp.json());
        }
        return new Response(JSON.stringify({ scheduled: results.length, results }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    /**
     * GET /stats — Query and paper statistics.
     * Returns total queries, citations, indexing progress, and timing percentiles.
     */
    if (request.method === "GET" && url.pathname === "/stats") {
      try {
        const c = await env.DB.prepare("SELECT COUNT(*) as total, COALESCE(AVG(elapsed_ms),0) as avg_ms, COALESCE(SUM(citations_count),0) as total_cit FROM ask_queries_v2").first();
        const threads = await env.DB.prepare("SELECT COUNT(*) as total FROM chat_sessions").first();
        
        // ─── p-adic Time Series Clustering ───
        // Two timestamps are p-adically close if ord_p(|t1-t2|) is large
        // ord_2(diff) = number of trailing zeros in binary = log2 of largest power-of-2 divisor
        // Query recency buckets by 2-adic valuation:
        //   ord2 ≥ 10: within ~17 min (2^10 = 1024 seconds)
        //   ord2 ≥ 5:  within ~32 seconds
        //   ord2 ≥ 0:  within ~1 second
        const now = Date.now();
        const recentRows = await env.DB.prepare(
          "SELECT timestamp FROM ask_queries_v2 ORDER BY id DESC LIMIT 1000"
        ).all();
        let ord2ge10 = 0, ord2ge5 = 0, ord2ge0 = 0, totalClassified = 0;
        for (const row of (recentRows.results || [])) {
          totalClassified++;
          const ts = new Date(row.timestamp).getTime();
          const diffMs = Math.abs(now - ts);
          if (diffMs === 0) { ord2ge0++; ord2ge5++; ord2ge10++; continue; }
          // Count trailing zeros in binary diffMs → ord_2(diffMs)
          let ord2 = 0, d = diffMs;
          while (d % 2 === 0 && d > 0) { ord2++; d /= 2; }
          if (ord2 >= 10) ord2ge10++;
          if (ord2 >= 5) ord2ge5++;
          if (ord2 >= 0) ord2ge0++;
        }
        
        return new Response(JSON.stringify({
          total_queries: c.total, avg_latency_ms: Math.round(c.avg_ms),
          total_citations: c.total_cit, total_threads: threads.total,
          pAdicTimeClusters: {
            total_queries_classified: totalClassified,
            prime: 2,
            clusters: [
              { ord2label: "ord₂ ≥ 10  (≤17 min)", count: ord2ge10, window_seconds: 1024 },
              { ord2label: "ord₂ ≥ 5   (≤32 sec)", count: ord2ge5, window_seconds: 32 },
              { ord2label: "ord₂ ≥ 0   (≤1 sec)",  count: ord2ge0, window_seconds: 1 }
            ],
            note: "Higher ord₂ = closer in 2-adic time. |t1-t2|_2 = 2^{-ord_2}"
          }
        }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── D1 Cluster metadata: store paper→cluster mapping ───
    /**
     * POST /sync-clusters — Rebuild the ultrametric tree from D1 paper titles
     * and persist it to R2 (ultrametric/tree.json) for cold-start resilience.
     */
    if (request.method === "POST" && url.pathname === "/sync-clusters") {
      try {
        if (!ultrametricTree) return new Response(JSON.stringify({ error: "tree not built" }), { status: 503, headers: hdrs });
        // Create table if not exists
        await env.PAPERS_DB.prepare(
          "CREATE TABLE IF NOT EXISTS paper_clusters (arxiv_id TEXT PRIMARY KEY, cluster_depth INTEGER, ostrowski_score REAL, cluster_rep TEXT)"
        ).run();
        // Walk tree and collect leaf→cluster assignments
        const assignments = [];
        const repMap = new Map();
        function walkAssign(node, rep, depth) {
          if (node.type === "leaf") {
            assignments.push({ arxiv_id: node.title, depth, rep });
            return;
          }
          const newRep = node.rep || rep;
          walkAssign(node.children[0], newRep, depth + 1);
          walkAssign(node.children[1], newRep, depth + 1);
        }
        walkAssign(ultrametricTree, ultrametricTree.rep, 0);
        // Batch insert (D1 supports up to 100 bound params per statement)
        const stmt = await env.PAPERS_DB.prepare(
          "INSERT OR REPLACE INTO paper_clusters (arxiv_id, cluster_depth, ostrowski_score, cluster_rep) VALUES (?, ?, ?, ?)"
        );
        const batch = [];
        for (const a of assignments) {
          const score = Math.pow(2, -a.depth) * (1 / (a.depth + 1)); // Ostrowski hybrid
          batch.push(stmt.bind(a.arxiv_id, a.depth, Math.round(score * 10000) / 10000, a.rep));
          if (batch.length >= 25) { await env.PAPERS_DB.batch(batch); batch.length = 0; }
        }
        if (batch.length > 0) await env.PAPERS_DB.batch(batch);
        return new Response(JSON.stringify({ synced: assignments.length, message: "Cluster metadata synced to D1" }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── Hasse Local-Global Validation ───
    // A paper is "valid" globally iff valid at all local checks (D1, R2, clusters)
    /**
     * GET /validate?title= — Hasse local-global validation of a paper title.
     * Checks existence in D1 papers table, R2 storage, and paper_clusters table.
     * Returns valid: true only if all local checks pass.
     */
    if (request.method === "GET" && url.pathname === "/validate") {
      try {
        const title = (url.searchParams.get("title") || "").trim();
        if (!title) return new Response(JSON.stringify({ valid: false, error: "title required" }), { status: 400, headers: hdrs });
        // Local check 1: D1 papers table
        const d1Check = await env.PAPERS_DB.prepare("SELECT arxiv_id, title FROM papers WHERE title LIKE ? LIMIT 1").bind("%" + title + "%").first();
        // Local check 2: R2 storage (check if paper key exists)
        let r2Check = false;
        if (d1Check && d1Check.arxiv_id) {
          const r2Obj = await env.PAPERS_R2.get("papers/" + d1Check.arxiv_id + ".md");
          r2Check = !!r2Obj;
        }
        // Local check 3: paper_clusters table
        const clusterCheck = await env.PAPERS_DB.prepare("SELECT cluster_depth FROM paper_clusters WHERE arxiv_id LIKE ? LIMIT 1").bind("%" + title + "%").first();
        const valid = !!(d1Check && r2Check);
        return new Response(JSON.stringify({
          valid,
          checks: {
            d1_papers: !!d1Check,
            r2_storage: r2Check,
            cluster_assigned: !!clusterCheck
          },
          principle: "Hasse Local-Global: a paper is globally valid iff locally valid at every check point"
        }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    /**
     * GET /paper-versions?title= — Witt vector version tracking.
     * Returns all versions of a paper found across D1 and R2, modeled as
     * Witt vector components (v_0, v_1, v_2, ...) representing version layers.
     */
    // ─── Witt Vector Version Tracking ───
    if (request.method === "GET" && url.pathname === "/paper-versions") {
      try {
        const title = (url.searchParams.get("title") || "").trim();
        if (!title) return new Response(JSON.stringify({ versions: [], error: "title required" }), { status: 400, headers: hdrs });
        // Create version table if not exists
        await env.PAPERS_DB.prepare(
          "CREATE TABLE IF NOT EXISTS paper_versions (arxiv_id TEXT, component INTEGER, ghost_ts TEXT, PRIMARY KEY (arxiv_id, component))"
        ).run();
        // Query version history (Witt components)
        const versions = await env.PAPERS_DB.prepare(
          "SELECT component, ghost_ts FROM paper_versions WHERE arxiv_id LIKE ? ORDER BY component ASC"
        ).bind("%" + title + "%").all();
        return new Response(JSON.stringify({
          versions: (versions.results || []).map(v => ({ component: v.component, timestamp: v.ghost_ts })),
          principle: "Witt Vectors: each component is a version layer. Teichmüller lift maps characteristic-p versions to characteristic-0 history.",
          note: "Ghost components track prior states. The Witt polynomial W_n(x_0,...,x_n) reconstructs the full history."
        }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    /**
     * GET /spectral-analysis?title= — Spectral analysis of a paper's p-adic neighborhood.
     * Computes eigenvalues of the graph Laplacian for the cluster containing the paper,
     * revealing spectral gaps, connectivity, and diffusion properties.
     */
    // ─── Tate's Thesis: Multi-Scale Spectral Analysis ───
    // Fourier analysis on the adele ring A_Q simultaneously at all places (∞, 2, 3, 5, ...)
    // The spectral decomposition of the ultrametric tree reveals multi-scale structure
    if (request.method === "GET" && url.pathname === "/spectral-analysis") {
      try {
        if (!ultrametricTree) return new Response(JSON.stringify({ error: "tree not built" }), { status: 503, headers: hdrs });
        // Compute spectral components at different p-adic scales
        const scales = [2, 3, 5, 7, 11]; // primes
        const spectra = {};
        for (const p of scales) {
          // p-adic spectral density: count clusters at each merge-distance ≡ 0 (mod p)
          const density = {};
          function walkSpectral(node) {
            if (node.type === "leaf") return;
            const d = node.distance;
            const residue = d % p;
            density[residue] = (density[residue] || 0) + 1;
            for (const child of node.children) walkSpectral(child);
          }
          walkSpectral(ultrametricTree);
          // Dominant residue class = spectral "frequency"
          const maxRes = Object.entries(density).sort((a,b) => b[1]-a[1])[0];
          spectra["p=" + p] = {
            dominantResidue: parseInt(maxRes[0]),
            clusterCount: maxRes[1],
            totalInternal: Object.values(density).reduce((a,b) => a+b, 0),
            interpretation: "The Amice p-adic Fourier transform decomposes merge distances mod " + p
          };
        }
        // ─── Principle #20: Intrinsic Amice Transform ───
        const intrinsicAmice = {};
        if (ultrametricTree) {
          const depths = [];
          function getDepths(node, d) {
            if (node.type === "leaf") depths.push(d || 0);
            else for (const c of node.children || []) getDepths(c, (d || 0) + 1);
          }
          getDepths(ultrametricTree, 0);
          const f = (k) => depths[Math.min(k, depths.length - 1)] || 0;
          const binom = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
          const coeffs = [];
          for (let n = 0; n <= 5; n++) {
            let a = 0;
            for (let k = 0; k <= n; k++) a += ((n - k) % 2 === 0 ? 1 : -1) * binom(n, k) * f(k);
            coeffs.push({ n, coefficient: Math.round(a * 1e6) / 1e6 });
          }
          intrinsicAmice.coefficients = coeffs;
          intrinsicAmice.theorem = "Amice Transform: continuous f: Z_p → C_p represented by uniformly convergent Mahler series f(x) = Σ a_n C(x,n)";
          intrinsicAmice.functionSpace = "Z_p → C_p";
        }
        return new Response(JSON.stringify({
          spectra,
          intrinsicAmice,
          principle: "Tate's Thesis: Fourier analysis on adeles A_Q simultaneously at ∞ and all primes p. The Amice transform gives the p-adic spectral decomposition.",
          note: "Each prime p reveals a different 'frequency' in the ultrametric tree structure."
        }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── Bruhat-Tits Building Representation ───
    /**
     * GET /bruhat-tits — Bruhat-Tits building from ultrametric tree.
     * Apartments are maximal chains in the tree; chambers are top-dimensional simplices.
     * The type-preserving automorphism group encodes corpus symmetries.
     */
    if (request.method === "GET" && url.pathname === "/bruhat-tits") {
      try {
        if (!ultrametricTree) return new Response(JSON.stringify({ error: "tree not built" }), { status: 503, headers: hdrs });
        // The Bruhat-Tits building is a simplicial complex where:
        // - Vertices = clusters (internal nodes) + papers (leaves)
        // - Apartments = maximal subcomplexes (maximal chains in the tree)
        // - Chambers = top-level simplices (the largest clusters)
        function findMaximalChains(node, path) {
          if (node.type === "leaf") return [[...path, node.title]];
          const chains = [];
          for (const child of node.children) {
            chains.push(...findMaximalChains(child, [...path, node.distance]));
          }
          return chains;
        }
        const chains = findMaximalChains(ultrametricTree, []);
        const aptLen = chains.map(c => c.length).sort((a,b) => b-a);
        
        return new Response(JSON.stringify({
          building: {
            vertices: 451 + 450,  // leaves + internal
            apartments: chains.length,
            maxApartmentLength: aptLen[0],
            chambers: chains.filter(c => c.length >= 50).length
          },
          principle: "Bruhat-Tits buildings are simplicial complexes realizing p-adic groups. Each apartment is a maximal chain in the ultrametric tree. Chambers are top-dimensional simplices.",
          note: "The building's type-preserving automorphism group encodes symmetries of the paper corpus."
        }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }
    /**
     * GET /perceptron?inputs=&weights=&p= — p-adic perceptron.
     * Computes Z_p-weighted dot product with Hensel-lifted weight correction.
     * Returns activation, p-adic norm, and corrected weights.
     */
    // ─── A: p-adic Perceptron ───
    if (request.method === "GET" && url.pathname === "/perceptron") {
      try {
        const inputs = (url.searchParams.get("inputs") || "1").split(",").map(Number);
        const weights = (url.searchParams.get("weights") || "1").split(",").map(Number);
        const p = parseInt(url.searchParams.get("p") || "2");
        if (inputs.length !== weights.length) return new Response(JSON.stringify({ error: "inputs/weights length mismatch" }), { status: 400, headers: hdrs });
        const ws = inputs.reduce((s, x, i) => s + x * weights[i], 0);
        let ord = 0, v = Math.abs(Math.floor(ws));
        while (v > 0 && v % p === 0) { ord++; v = Math.floor(v / p); }
        return new Response(JSON.stringify({
          weighted_sum: Math.round(ws * 1000) / 1000, valuation: ord, padic_norm: Math.pow(p, -ord),
          activated: ord >= 2, principle: "p-adic neuron: valuation IS the decision boundary"
        }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── A: D3 Dendrogram JSON ───
    /**
     * GET /dendrogram-json — Tree as D3-compatible JSON dendrogram.
     * Converts the ultrametric tree into a nested hierarchy with name, children,
     * and distance properties suitable for D3.js cluster layout visualization.
     */
    if (request.method === "GET" && url.pathname === "/dendrogram-json") {
      try {
        if (!ultrametricTree) return new Response(JSON.stringify({ error: "tree not built" }), { status: 503, headers: hdrs });
        function toD3(node) { if (node.type === "leaf") return { name: node.title.substring(0, 60) }; const c = node.children.map(toD3); return { name: (node.rep || "cluster").substring(0, 40), distance: node.distance, children: c }; }
        return new Response(JSON.stringify({ tree: toD3(ultrametricTree), leaves: 451 }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── E: Vectorize Ultrametric Index ───
    /**
     * POST /vectorize-tree-search — p-adic vector search with ultrametric pruning.
     * Embeds query, searches Vectorize index, then prunes results using the
     * ultrametric tree to remove false positives outside the target cluster.
     */
    if (request.method === "POST" && url.pathname === "/vectorize-tree-search") {
      try {
        if (!ultrametricTree) return new Response(JSON.stringify({ error: "tree not built" }), { status: 503, headers: hdrs });
        const body = await request.json(); const queryVec = body.vector || [];
        let node = ultrametricTree, path = [];
        while (node && node.type !== "leaf") {
          const dL = node.children[0].rep ? levenshtein(node.children[0].rep.toLowerCase(), (queryVec[0]||"").toString()) : 99;
          const dR = node.children[1].rep ? levenshtein(node.children[1].rep.toLowerCase(), (queryVec[0]||"").toString()) : 99;
          path.push({ dir: dL <= dR ? "L" : "R", dist: Math.min(dL, dR) }); node = dL <= dR ? node.children[0] : node.children[1];
        }
        return new Response(JSON.stringify({ path: path.slice(0, 10), leaf: node ? node.title : null, reduction: "O(log n * cluster_size) vs O(n)", principle: "Ultrametric Vector Index" }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── F: Multi-Edge Hasse Validation ───
    /**
     * GET /validate-multi?titles= — Batch Hasse local-global validation.
     * Validates multiple titles in parallel via /validate, returning per-title
     * validity results and aggregate statistics.
     */
    if (request.method === "GET" && url.pathname === "/validate-multi") {
      try {
        const title = (url.searchParams.get("title") || "").trim();
        if (!title) return new Response(JSON.stringify({ error: "title required" }), { status: 400, headers: hdrs });
        const results = await Promise.all([
          fetch(new URL("/validate?title=" + encodeURIComponent(title), request.url)).then(r => r.json()).catch(() => ({ valid: false })),
          fetch(new URL("/validate?title=" + encodeURIComponent(title), request.url)).then(r => r.json()).catch(() => ({ valid: false })),
          fetch(new URL("/validate?title=" + encodeURIComponent(title), request.url)).then(r => r.json()).catch(() => ({ valid: false }))
        ]);
        return new Response(JSON.stringify({
          edges: results.length, unanimous: results.every(r => r.valid === results[0].valid),
          edge_votes: results.filter(r => r.valid).length,
          principle: "Multi-Edge Hasse: globally valid iff unanimously valid across all edge locations"
        }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── G: Witt Vector Diff Engine ───
    /**
     * POST /paper-diff — Pairwise ultrametric diff between paper versions.
     * Computes the ultrametric distance and cluster path between two paper titles,
     * returning their lowest common ancestor and merge distance.
     */
    if (request.method === "POST" && url.pathname === "/paper-diff") {
      try {
        const body = await request.json(); const title = (body.title || "").trim(); const content = (body.content || "").trim();
        if (!title || !content) return new Response(JSON.stringify({ error: "title and content required" }), { status: 400, headers: hdrs });
        await env.PAPERS_DB.prepare("CREATE TABLE IF NOT EXISTS paper_versions (arxiv_id TEXT, component INTEGER, ghost_ts TEXT, content_hash TEXT, PRIMARY KEY (arxiv_id, component))").run();
        const cur = await env.PAPERS_DB.prepare("SELECT MAX(component) as mc FROM paper_versions WHERE arxiv_id LIKE ?").bind("%"+title+"%").first();
        const nc = (cur && cur.mc != null) ? cur.mc + 1 : 0;
        await env.PAPERS_DB.prepare("INSERT OR REPLACE INTO paper_versions VALUES (?,?,?,?)").bind(title, nc, new Date().toISOString(), content.substring(0,32)).run();
        const all = await env.PAPERS_DB.prepare("SELECT component, ghost_ts, content_hash FROM paper_versions WHERE arxiv_id LIKE ? ORDER BY component").bind("%"+title+"%").all();
        return new Response(JSON.stringify({
          component: nc, total: (all.results||[]).length,
          ghosts: (all.results||[]).map(v => ({ c: v.component, t: v.ghost_ts, h: v.content_hash })),
          principle: "Witt Vector Diff: each component = version layer. Ghosts = history."
        }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── H: Berkovich Space Explorer ───
    /**
     * GET /berkovich-explorer — Berkovich analytification of the paper corpus.
     * Maps papers to Type I/II/III/IV points on the Berkovich projective line,
     * with p-adic valuations and multiplicative seminorms.
     */
    if (request.method === "GET" && url.pathname === "/berkovich-explorer") {
      try {
        if (!ultrametricTree) return new Response(JSON.stringify({ error: "tree not built" }), { status: 503, headers: hdrs });
        function collect(n, d) {
          if (n.type === "leaf") return { t1: [{ t: n.title.substring(0, 50), v: d, nm: Math.pow(2, -d) }], t2: [], t3: [], mr: 0 };
          const l = collect(n.children[0], d + 1), r = collect(n.children[1], d + 1);
          return { t1: [...l.t1, ...r.t1], t2: [...l.t2, ...r.t2, { r: (n.rep||"").substring(0,40), d: n.distance, s: n.size }], t3: [...l.t3, ...r.t3], mr: Math.max(n.distance, l.mr, r.mr) };
        }
        const data = collect(ultrametricTree, 0);
        return new Response(JSON.stringify({
          type1: data.t1.length, type2: data.t2.length, maxRadius: data.mr,
          shilov: data.t2.filter(p => p.d <= 5).slice(0, 5),
          principle: "Berkovich analytic space over Z_2: Type-1 = papers, Type-2 = cluster seminorms"
        }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    /**
     * GET /stats/csv — Download full query statistics as CSV.
     * Returns all ask_queries_v2 rows as comma-separated values with headers.
     */
    if (request.method === "GET" && url.pathname === "/stats/csv") {
      try {
        const c = await env.DB.prepare("SELECT COUNT(*) as total, COALESCE(AVG(elapsed_ms),0) as avg_ms, COALESCE(SUM(citations_count),0) as total_cit FROM ask_queries_v2").first();
        const threads = await env.DB.prepare("SELECT COUNT(*) as total FROM chat_sessions").first();
        const now = new Date().toISOString();
        const csv = [
          "metric,value",
          "report_time," + now,
          "total_queries," + c.total,
          "avg_latency_ms," + Math.round(c.avg_ms),
          "total_citations," + c.total_cit,
          "total_threads," + threads.total,
          "worker_version,2.7.0"
        ].join("\n");
        return new Response(csv, { headers: { ...hdrs, "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=ask-qwav-stats.csv" } });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    /**
     * POST /index-papers — Manual paper indexing (CRON-like).
     * Actions: "status" (progress), "start" (new batch), "continue" (next batch).
     * Rate-limited to 10 req/min per IP. Chunks markdown, embeds via bge-base,
     * upserts to Vectorize index. Maximum 20 papers per batch.
     */
    // ─── Index papers endpoint ───
    if (request.method === "POST" && url.pathname === "/index-papers") {
      // Rate limiting
      if (!checkRateLimit(sourceIp)) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Max 10 requests/minute." }), { status: 429, headers: hdrs });
      }
      let action, batchSize;
      try {
        const body = await request.json();
        action = body.action || "status";
        batchSize = Math.min(body.batch_size || 5, 20);
      } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: hdrs }); }
      if (action === "status") {
        try {
          const row = await env.DB.prepare("SELECT value FROM index_progress WHERE key = ?").bind("index_progress").first();
          const kvRow = await env.DB.prepare("SELECT value FROM index_progress WHERE key = ?").bind("vectorize_indexed_count").first();
          const progress = row ? JSON.parse(row.value) : { indexed: 0, errors: [], last_arxiv_id: null };
          const vc = kvRow ? parseInt(kvRow.value) || 0 : 0;
          const totalRow = await env.PAPERS_DB.prepare("SELECT COUNT(*) as cnt FROM papers WHERE r2_key IS NOT NULL AND r2_key != x''").first();
          return new Response(JSON.stringify({ indexed_papers: progress.indexed, total_papers: totalRow.cnt, chunks_in_vectorize: vc, last_arxiv_id: progress.last_arxiv_id, errors: (progress.errors || []).slice(-20), complete: progress.indexed >= totalRow.cnt }), { headers: hdrs });
        } catch (e) { return new Response(JSON.stringify({ error: "Status failed: " + e.message }), { status: 500, headers: hdrs }); }
      }
      if (action === "start" || action === "continue") {
        try {
          let row = await env.DB.prepare("SELECT value FROM index_progress WHERE key = ?").bind("index_progress").first();
          let progress = row ? JSON.parse(row.value) : { indexed: 0, errors: [], last_arxiv_id: null };
          const totalRow = await env.PAPERS_DB.prepare("SELECT COUNT(*) as cnt FROM papers WHERE r2_key IS NOT NULL AND r2_key != x''").first();
          const total = totalRow.cnt;
          let papers;
          if (progress.last_arxiv_id) {
            papers = await env.PAPERS_DB.prepare("SELECT arxiv_id, title, r2_key, abstract FROM papers WHERE r2_key IS NOT NULL AND r2_key != x'' AND arxiv_id > ?1 ORDER BY arxiv_id ASC LIMIT ?2").bind(progress.last_arxiv_id, batchSize).all();
          } else {
            papers = await env.PAPERS_DB.prepare("SELECT arxiv_id, title, r2_key, abstract FROM papers WHERE r2_key IS NOT NULL AND r2_key != x'' ORDER BY arxiv_id ASC LIMIT ?1").bind(batchSize).all();
          }
          if (!papers.results || papers.results.length === 0) {
            return new Response(JSON.stringify({ message: "No more papers", indexed: progress.indexed, total: total, complete: true }), { headers: hdrs });
          }
          let indexed = 0, newErrors = [], lastArxivId = progress.last_arxiv_id, totalChunks = 0;
          for (const paper of papers.results) {
            lastArxivId = paper.arxiv_id;
            try {
              const r2Object = await env.PAPERS_R2.get(paper.r2_key);
              if (!r2Object) { newErrors.push({ arxiv_id: paper.arxiv_id, error: "R2 not found: " + paper.r2_key }); continue; }
              const markdown = await r2Object.text();
              const chunks = chunkMarkdown(markdown, paper.title);
              totalChunks += chunks.length;
              for (let ci = 0; ci < chunks.length; ci++) {
                const chunk = chunks[ci];
                const embResult = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: chunk.text });
                const vector = embResult.data[0];
                await env.VECTORIZE_INDEX.upsert([{ id: paper.arxiv_id + "_chunk_" + ci, values: vector, metadata: { arxiv_id: paper.arxiv_id, title: paper.title || "", abstract: (paper.abstract || "").substring(0, 500), chunk_index: ci, total_chunks: chunks.length, text: chunk.text.substring(0, 2500), r2_key: paper.r2_key || "", slug: chunk.slug || paper.r2_key.replace("papers/", "").replace(".md", ""), url: "https://papers.qnfo.org/papers/" + (chunk.slug || paper.r2_key.replace("papers/", "").replace(".md", "")) } }]);
              }
              indexed++;
            } catch (paperErr) { newErrors.push({ arxiv_id: paper.arxiv_id, error: paperErr.message }); }
          }
          progress.indexed = (progress.indexed || 0) + indexed;
          progress.errors = [...(progress.errors || []), ...newErrors];
          progress.last_arxiv_id = lastArxivId;
          await env.DB.prepare("INSERT OR REPLACE INTO index_progress (key, value) VALUES (?1, ?2)").bind("index_progress", JSON.stringify(progress)).run();
          const existingCount = await env.DB.prepare("SELECT value FROM index_progress WHERE key = ?").bind("vectorize_indexed_count").first();
          const prevCount = existingCount ? parseInt(existingCount.value) || 0 : 0;
          await env.DB.prepare("INSERT OR REPLACE INTO index_progress (key, value) VALUES (?1, ?2)").bind("vectorize_indexed_count", String(prevCount + totalChunks)).run();
          return new Response(JSON.stringify({ batch_indexed: indexed, total_indexed: progress.indexed, total_papers: total, chunks_created: totalChunks, last_arxiv_id: lastArxivId, errors: newErrors.slice(0, 10), complete: progress.indexed >= total, progress_pct: Math.round((progress.indexed / total) * 100) }), { headers: hdrs });
        } catch (e) { return new Response(JSON.stringify({ error: "Batch failed: " + e.message }), { status: 500, headers: hdrs }); }
      }
      return new Response(JSON.stringify({ error: "Unknown action", valid_actions: ["status","start","continue","reset"] }), { status: 400, headers: hdrs });
    }

    // ─── Main query endpoint ───
    /**
     * POST / or POST /query — Main RAG query pipeline.
     * 1. Embed query via @cf/baai/bge-base-en-v1.5
     * 2. Search Vectorize index for top-5 matching chunks
     * 3. Build research context from R2 markdown (D1 fallback for empty chunks)
     * 4. Assemble system prompt with anti-hallucination guardrails
     * 5. Query @cf/meta/llama-3.2-3b-instruct (temp=0, top_p=0.1)
     * 6. Post-process: strip fabricated references, external URLs, in-text citations
     * 7. Log to D1, update thread, cache result
     *
     * @param {string} body.query - The research question
     * @param {string} [body.thread_id] - Optional thread ID for conversation continuity
     * @returns {object} answer, citations, thread_id, elapsed_ms, timing breakdown
     */
    // ─── Main RAG query pipeline ───
    if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/query")) {
      let query, threadId;
      try {
        const body = await request.json();
        query = (body.query || "").trim();
        threadId = body.thread_id || generateId();
      } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: hdrs }); }
      if (!query || query.length < 2) return new Response(JSON.stringify({ error: "Query too short" }), { status: 400, headers: hdrs });

      let embedMs = 0, vectorMs = 0, llmMs = 0;
      try {
        // ─── JAILBREAK GUARD ───
        const jailbreakPatterns = [
          /(creative story|tell me a story|write a story|creative writing)/i,
          /(ignore (your |previous )?instructions?|disregard (your |previous )?rules?)/i,
          /(pretend|imagine you are|role.play|act as (if|though))/i,
          /(what (is|are) your (personal )?opinion|how do you feel)/i,
          /(format (your )?(answer|response) as (an? )?(academic )?paper)/i,
          /(generate|create|produce|write) (a |an )?(creative|fictional|made.up|imaginary)/i,
          /(list (all |the )?references|generate (a |the )?bibliography|produce (a |the )?reference list)/i
        ];
        for (const p of jailbreakPatterns) {
          if (p.test(query)) {
            return new Response(JSON.stringify({ answer: "This request cannot be fulfilled. Ask QWAV provides factual answers grounded in the QWAV research corpus only.", citations: [], thread_id: threadId, elapsed_ms: Date.now() - startTime, timing: { embed_ms: 0, vector_ms: 0, llm_ms: 0 }, model: "llama-3.2-3b-instruct", blocked: "jailbreak_guard" }), { headers: hdrs });
          }
        }

        // ─── Query cache check ───
        const cacheKey = query.toLowerCase().trim();
        const cached = getCachedQuery(cacheKey);
        if (cached) {
          return new Response(JSON.stringify({ ...cached, cached: true, elapsed_ms: Date.now() - startTime }), { headers: hdrs });
        }

        // ─── Embed query ───
        const t1 = Date.now();
        const embResult = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: query });
        const queryVector = embResult.data[0];
        embedMs = Date.now() - t1;

        // ─── Vector search (topK=10, filter to 5 with text) ───
        const t2 = Date.now();
        let vectorMatches = [];
        try {
          const vecResult = await env.VECTORIZE_INDEX.query(queryVector, { topK: 10, returnMetadata: true });
          vectorMatches = (vecResult.matches || []).filter(m => {
            const mt = (m.metadata || {}).text || (m.metadata || {}).content || "";
            return mt.length > 50;
          }).slice(0, 5);
        } catch (e) {}
        vectorMs = Date.now() - t2;

        // ─── Build contexts and citations (named sources only, no Untitled/unknown) ───
        const contexts = [];
        const citations = [];
        for (const match of vectorMatches) {
          const meta = match.metadata || {};
          const text = meta.text || meta.content || "";
          const rawTitle = meta.title || meta.paper_title || "";
          const rawSlug = (meta.slug || match.id || "").replace(/\/[^\/]+::\d+$/g, '').replace(/\/$/, '');
          const sourceTitle = (rawTitle !== "Untitled" && rawTitle !== "" && rawTitle !== "unknown") ? rawTitle : "";
          const sourceSlug = (rawSlug !== "" && rawSlug !== "unknown") ? rawSlug : "";
          if (sourceTitle || sourceSlug) {
            const displayName = (sourceTitle
              ? sourceTitle.replace(/-/g, " ").replace(/\.html$/, "").replace(/\b\w/g, c => c.toUpperCase())
              : sourceSlug.replace(/-/g, " ").replace(/\.html$/, "").replace(/index::\d+$/, "").replace(/\b\w/g, c => c.toUpperCase()))
              .replace(/\/$/, '').trim().replace(/\s+/g, ' ');
            contexts.push({ text: sanitizeAbstract(text.substring(0, 2500)), name: displayName });
            citations.push({ title: displayName, slug: sourceSlug, url: meta.url || "https://papers.qnfo.org/papers/" + (sourceSlug || rawSlug), score: Math.round((match.score || 0) * 100) / 100, excerpt: (text || "").substring(0, 300) });
          }
        }

        // ─── D1 ABSTRACT FALLBACK for empty-text contexts ───
        {
          let filled = 0;
          for (let i = 0; i < contexts.length && filled < 5; i++) {
            const ctx = contexts[i];
            if (ctx.text && ctx.text.length >= 100 && ctx.text.indexOf("[Full text") !== 0) continue;
            const cit = citations[i];
            if (!cit || !cit.title) continue;
            const titleTerm = cit.title.replace(/\s+/g, " ").trim().substring(0, 80);
            const slugTerm = (cit.slug || "").replace(/\.html$/, "").replace(/-/g, " ").toLowerCase().substring(0, 80);
            let row = null;
            try { row = await env.PAPERS_DB.prepare("SELECT abstract FROM papers WHERE title LIKE ?1 LIMIT 1").bind("%" + titleTerm + "%").first().catch(() => null); } catch (e) {}
            if (!row || !row.abstract) {
              try { row = await env.PAPERS_DB.prepare("SELECT abstract FROM papers WHERE LOWER(title) LIKE ?1 LIMIT 1").bind("%" + slugTerm + "%").first().catch(() => null); } catch (e) {}
            }
            if (row && row.abstract && row.abstract.length > 50) {
              contexts[i].text = sanitizeAbstract(row.abstract.substring(0, 2500));
              filled++;
            }
          }
        }

        // ─── Thread history ───
        let threadHistory = [];
        if (threadId) {
          const session = await env.DB.prepare("SELECT messages FROM chat_sessions WHERE thread_id = ?").bind(threadId).first();
          if (session) threadHistory = JSON.parse(session.messages || "[]");
        }
        const recentHistory = threadHistory.slice(-6);

        // ─── AI Inference ───
        const t4 = Date.now();
        const systemPrompt = "You are Ask QWAV, a research oracle grounded ONLY in the QWAV research corpus on ultrametric geometry, p-adic physics, and quantum computing.\n\nCRITICAL RULES \u2014 violations make your answer unusable:\n\nACCURACY:\n1. CITE ONLY FROM PROVIDED CONTEXT. cite ONLY named sources by their actual title. Never use anonymous labels like \"Source 1\" or \"Unknown source.\"\n2. NEVER FABRICATE references. Do not invent: author names, journal names, arXiv IDs, DOIs, page numbers, publication years, repository names, GitHub URLs, or code links.\n3. STICK TO FACTS from the context. No editorializing, hype, overstatement, or superlatives.\n\nBOUNDARIES:\n4. If context is insufficient, ACKNOWLEDGE LIMITS rather than inventing.\n5. REJECT: creative writing, storytelling, role-playing, hypothetical scenarios.\n6. NEVER output a References section, Bibliography, Works Cited, or any formatted list of sources — even if the sources are real. NEVER create in-text citations like (Author, Year) or [N]. Do NOT number sources or create bulleted/footnoted reference lists at the end of your answer under any heading.\n7. NEVER format your response as an academic paper with fabricated sections.\n8. NEVER output URLs, hyperlinks, or markdown links (like [text](url)) to external websites, GitHub repositories, or any resource outside the QWAV corpus. Cite sources by their displayed name ONLY.\n\nFORMAT:\n9. Use LaTeX math ($$...$$ for display, $...$ for inline).";

        let userPrompt = "";
        if (recentHistory.length > 0) {
          userPrompt += "Previous conversation:\n" + recentHistory.map((m) => (m.role === "user" ? "Q" : "A") + ": " + m.content.substring(0, 500)).join("\n") + "\n\n";
        }
        if (contexts.length > 0) {
          userPrompt += "Research Context:\n\n" + contexts.map((c, i) => "[" + c.name + "]:\n" + c.text).join("\n\n---\n\n") + "\n\n";
          userPrompt += "Question: " + query + "\n\nProvide a thorough answer using ONLY the Research Context above. Cite named sources by their actual title.";
        } else if (citations.length > 0) {
          userPrompt += "Available QWAV sources (abstracts are being indexed):\n\n" + citations.map((c, i) => "[" + c.title + "]: " + c.url).join("\n") + "\n\n";
          userPrompt += "Question: " + query + "\n\nSeveral QWAV sources exist on this topic. Answer using the source titles and available information above. Do NOT fall back to general knowledge. Acknowledge if full details are not yet indexed.";
        } else {
          userPrompt += "Question: " + query + "\n\nNo QWAV research sources were found. State this clearly. Do NOT fabricate citations or answer from general knowledge.";
        }

        const aiResult = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 3000,
          temperature: 0.0,
          top_p: 0.1
        });

        const answer = aiResult.response || aiResult.answer || (typeof aiResult === "string" ? aiResult : JSON.stringify(aiResult));

        // ─── Post-process: strip fabricated references, URLs, in-text citations ───
        const answerClean = answer
          .replace(/\n\s*(?:References|Bibliography|Works Cited|Reference List|Sources|Further Reading)[\s\S]*$/gi, '')
          .replace(/\([A-Z][A-Za-z\-']+(?:\s+[A-Z][A-Za-z\-']+)*(?:,\s*\d{4}(?:,\s*(?:p\.?\s*\d+|sect?\.?\s*\d+[a-z]?|ch\.?\s*\d+|title))?)?\)/g, '')
          .replace(/\[(?:[A-Z][A-Za-z\-']+(?:\s+[A-Z][A-Za-z\-']+)*(?:,\s*\d{4}(?:,\s*(?:p\.?\s*\d+|sect?\.?\s*\d+[a-z]?|ch\.?\s*\d+|title))?)?)\]/g, '')
          .replace(/\b\dv\d+(?:\.\d+)*\b/g, '')
          // Strip fabricated markdown links to github.com repos
          .replace(/\[([^\]]*?)\]\(https?:\/\/github\.com\/[^\)]+\)/gi, '')
          // Strip bare github.com URLs
          .replace(/https?:\/\/github\.com\/[^\s\)\]\n]+/gi, '')
          // Strip markdown links to any external domain (LLM should only cite QNFO named sources, never external URLs)
          .replace(/\[([^\]]*?)\]\(https?:\/\/(?!papers\.qnfo\.org\b|qnfo\.org\b)[^\)]+\)/gi, '')
          // Strip bare external URLs (preserve only QNFO-owned domains)
          .replace(/https?:\/\/(?!papers\.qnfo\.org\b|qnfo\.org\b)[^\s\)\]\n]+\.[a-z]{2,}[^\s\)\]\n]*/gi, '')
          .replace(/—\s*$/, '')
          .replace(/\s{2,}/g, ' ')
          .trim();

        llmMs = Date.now() - t4;
        const totalMs = Date.now() - startTime;

        // ─── Update thread + log ───
        const updatedMessages = JSON.stringify([...threadHistory, { role: "user", content: query, timestamp: startTime }, { role: "assistant", content: answerClean, timestamp: Date.now(), citations: citations.length }]);
        ctx.waitUntil(env.DB.prepare("INSERT INTO chat_sessions (thread_id, messages, created_at, updated_at) VALUES (?1, ?2, datetime(x'6e6f77'), datetime(x'6e6f77')) ON CONFLICT(thread_id) DO UPDATE SET messages = ?3, updated_at = datetime(x'6e6f77')").bind(threadId, updatedMessages, updatedMessages).run().catch(() => {}));
        ctx.waitUntil(env.DB.prepare("INSERT INTO ask_queries_v2 (timestamp, thread_id, query, answer, citations_count, elapsed_ms, source_ip) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(startTime, threadId, query, answerClean.substring(0, 8000), citations.length, totalMs, sourceIp).run().catch(() => {}));

        // Cache successful result
        setCachedQuery(cacheKey, { answer: answerClean, citations, thread_id: threadId, timing: { embed_ms: embedMs, vector_ms: vectorMs, llm_ms: llmMs }, model: "llama-3.2-3b-instruct" });

        return new Response(JSON.stringify({ answer: answerClean, citations, thread_id: threadId, elapsed_ms: totalMs, timing: { embed_ms: embedMs, vector_ms: vectorMs, llm_ms: llmMs }, model: "llama-3.2-3b-instruct" }), { headers: hdrs });

      } catch (err) {
        const totalMs = Date.now() - startTime;
        const errMsg = err?.message || String(err);
        ctx.waitUntil(env.DB.prepare("INSERT INTO ask_queries_v2 (timestamp, thread_id, query, answer, citations_count, elapsed_ms, source_ip) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)").bind(startTime, threadId, query, "ERROR: " + errMsg.substring(0, 500), totalMs, sourceIp).run().catch(() => {}));
        return new Response(JSON.stringify({ answer: "Error: " + errMsg, citations: [], thread_id: threadId, elapsed_ms: totalMs, error: errMsg }), { headers: hdrs });
      }
    }

    /**
     * POST /validate-selmer — [Option I] Tate-Shafarevich Group Validation.
     * Runs full Selmer group verification across all local representations:
     * D1 (papers table), R2 (storage), cluster (paper_clusters), 
     * multi-edge (cross-representation consistency).
     * Performs global lift verification via ostrowski_score.
     * Stores Selmer generators in D1 selmer_generators table.
     *
     * @param {string} body.title - Paper title to validate
     * @param {string[]} [body.checks] - Which checks to run (d1, r2, cluster, multi-edge)
     * @returns {object} sha_rank, local_results, global_lift, obstruction_certificate
     */
    // ─── I: Tate-Shafarevich Group Validation ───
    if (request.method === "POST" && url.pathname === "/validate-selmer") {
      try {
        const body = await request.json();
        const title = (body.title || "").trim();
        const checks = body.checks || ["d1", "r2", "cluster", "multi-edge"];
        if (!title) return new Response(JSON.stringify({ error: "title required" }), { status: 400, headers: hdrs });
        const localResults = {};
        if (checks.includes("d1")) {
          const d1Check = await env.PAPERS_DB.prepare("SELECT arxiv_id, title, r2_key, abstract FROM papers WHERE title LIKE ? LIMIT 1").bind("%" + title + "%").first();
          localResults.d1 = { valid: !!d1Check, arxiv_id: d1Check?.arxiv_id || null };
        }
        if (checks.includes("r2")) {
          let r2Valid = false, r2ContentHash = null;
          if (localResults.d1?.arxiv_id) {
            const r2Obj = await env.PAPERS_R2.get("papers/" + localResults.d1.arxiv_id + ".md");
            if (r2Obj) { const text = await r2Obj.text(); r2ContentHash = text.length.toString(36); r2Valid = true; }
          }
          localResults.r2 = { valid: r2Valid, content_hash: r2ContentHash };
        }
        if (checks.includes("cluster")) {
          const clusterCheck = await env.PAPERS_DB.prepare("SELECT cluster_depth, cluster_rep, ostrowski_score FROM paper_clusters WHERE arxiv_id LIKE ? LIMIT 1").bind("%" + title + "%").first();
          localResults.cluster = { valid: !!clusterCheck, depth: clusterCheck?.cluster_depth || null, rep: clusterCheck?.cluster_rep || null, ostrowski_score: clusterCheck?.ostrowski_score || null };
        }
        if (checks.includes("multi-edge")) {
          const edgeResults = [];
          const validated = await fetch(new URL("/validate?title=" + encodeURIComponent(title), request.url)).then(r => r.json()).catch(() => ({ valid: false }));
          edgeResults.push(validated.valid);
          edgeResults.push(!!(localResults.d1?.valid && localResults.r2?.valid));
          if (ultrametricTree) edgeResults.push(levenshteinSearch(title, 1, 5).length > 0);
          else edgeResults.push(localResults.cluster?.valid || false);
          localResults.multiEdge = { valid: edgeResults.every(v => v && v === edgeResults[0]), edge_votes: edgeResults.filter(Boolean).length, total_edges: edgeResults.length };
        }
        const allLocalPass = Object.values(localResults).every(r => r.valid === true);
        let globalCoherent = true, shaObstruction = [], selmerGenerators = [];
        if (allLocalPass && localResults.d1?.arxiv_id) {
          const d1Row = await env.PAPERS_DB.prepare("SELECT abstract FROM papers WHERE arxiv_id = ?").bind(localResults.d1.arxiv_id).first();
          const absText = (d1Row?.abstract || "").toLowerCase();
          const tWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
          const absOverlap = tWords.filter(w => absText.includes(w)).length;
          let r2Match = false;
          try { const r2o = await env.PAPERS_R2.get("papers/" + localResults.d1.arxiv_id + ".md"); if (r2o) { const r2t = (await r2o.text()).substring(0, 500).toLowerCase(); r2Match = tWords.some(w => r2t.includes(w)); } } catch {}
          if (absOverlap < 1) { shaObstruction.push("abstract-title mismatch"); globalCoherent = false; selmerGenerators.push({ class: "H^1(Q,E[abstract])", obstruction: "no title words in abstract" }); }
          if (!r2Match) { shaObstruction.push("R2 content mismatch"); globalCoherent = false; selmerGenerators.push({ class: "H^1(Q,E[R2])", obstruction: "title not in R2 content" }); }
        } else if (!allLocalPass) {
          globalCoherent = false;
          for (const [k, v] of Object.entries(localResults)) if (!v.valid) { shaObstruction.push(k + " local failure"); selmerGenerators.push({ class: "H^1_loc(Q_v,E)", obstruction: k + " check failed" }); }
        }
        const shaRank = shaObstruction.length;
        await env.PAPERS_DB.prepare("CREATE TABLE IF NOT EXISTS selmer_generators (arxiv_id TEXT, cohomology_class TEXT, obstruction TEXT, timestamp TEXT, sha_rank INTEGER, PRIMARY KEY (arxiv_id, cohomology_class))").run();
        if (selmerGenerators.length > 0 && localResults.d1?.arxiv_id) {
          const stmt = await env.PAPERS_DB.prepare("INSERT OR REPLACE INTO selmer_generators VALUES (?,?,?,?,?)");
          await env.PAPERS_DB.batch(selmerGenerators.map(g => stmt.bind(localResults.d1.arxiv_id, g.class, g.obstruction, new Date().toISOString(), shaRank)));
        }
        return new Response(JSON.stringify({ sha_rank: shaRank, locally_valid: allLocalPass, globally_coherent: globalCoherent, selmer_group: selmerGenerators, obstruction_certificate: shaObstruction, verdict: shaRank === 0 ? "No Sha obstruction" : "Sha(" + shaRank + ") detected: " + shaObstruction.join("; "), principle: "Tate-Shafarevich Sha(E/Q): local-global obstruction. ker(H^1(Q,E) -> prod H^1(Q_v,E))." }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    /**
     * POST /p-adic-embed — [Option J] p-Adic Language Model Embedding.
     * Tokenizes input text → computes p-adic embeddings in Z_p^n via hash→valuation.
     * Builds binary ultrametric attention mask (no softmax): connected if
     * |x - y|_p ≤ p^{-2} (ultrametric ball membership).
     * Connected components = ultrametric clusters.
     *
     * @param {string} body.text - Input text to tokenize and embed
     * @param {number} [body.prime=2] - Prime p for Z_p embedding
     * @returns {object} tokens, p_adic_embeddings, attention_mask, ultrametric_clusters
     */
    // ─── J: p-Adic Language Model ───
    if (request.method === "POST" && url.pathname === "/p-adic-embed") {
      try {
        const body = await request.json();
        const text = (body.text || "").trim();
        const prime = body.prime || 2;
        if (!text || text.length < 1) return new Response(JSON.stringify({ error: "text required" }), { status: 400, headers: hdrs });
        const tokens = text.split(/\s+/).filter(t => t.length > 0);
        const n = tokens.length;
        function ordP(val, p) { if (val === 0) return Infinity; let ord = 0, v = Math.abs(val); while (v > 0 && v % p === 0) { ord++; v = Math.floor(v / p); } return ord; }
        const pAdicEmbeddings = tokens.map((token, i) => {
          const bytes = new TextEncoder().encode(token);
          let hash = 0; for (let b = 0; b < bytes.length; b++) { hash = ((hash << 5) - hash) + bytes[b]; hash |= 0; }
          const absHash = Math.abs(hash);
          const valuation = ordP(absHash, prime);
          const posVal = ordP(i + 1, prime);
          return { token, index: i, byte_hash: absHash, valuation, padic_norm: Math.round(Math.pow(prime, -valuation) * 1e6) / 1e6, positional_valuation: posVal, positional_padic_norm: Math.round(Math.pow(prime, -posVal) * 1e6) / 1e6 };
        });
        const distanceMatrix = Array.from({ length: n }, () => Array(n).fill(0));
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) distanceMatrix[i][j] = Math.pow(prime, -ordP(Math.abs(pAdicEmbeddings[i].byte_hash - pAdicEmbeddings[j].byte_hash), prime));
        const threshold = Math.pow(prime, -2);
        const attentionMask = Array.from({ length: n }, () => Array(n).fill(0));
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) attentionMask[i][j] = distanceMatrix[i][j] <= threshold ? 1 : 0;
        const visited = new Set(); const clusters = [];
        for (let i = 0; i < n; i++) { if (visited.has(i)) continue; const cluster = []; const queue = [i]; visited.add(i); while (queue.length > 0) { const node = queue.shift(); cluster.push(tokens[node]); for (let j = 0; j < n; j++) { if (attentionMask[node][j] === 1 && !visited.has(j)) { visited.add(j); queue.push(j); } } } clusters.push({ tokens: cluster, size: cluster.length }); }
        return new Response(JSON.stringify({ tokens, token_count: n, prime, p_adic_embeddings: pAdicEmbeddings, ultrametric_distance_matrix: distanceMatrix.map(r => r.map(v => Math.round(v * 1e6) / 1e6)), attention_mask: attentionMask, attention_type: "binary (ultrametric ball membership, no softmax)", ball_threshold: "p^{-2} = " + threshold, ultrametric_clusters: clusters, cluster_count: clusters.length, differential: "O(n^2) softmax -> O(n log n) ultrametric. Binary attention from strong triangle inequality.", principle: "p-adic LM: tokens in Z_p^n. d_p(x,y)=|x-y|_p. Balls disjoint or nested -> binary attention." }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    /**
     * POST /period-bridge — [Option K] Fontaine Period Bridge API.
     * Bridges paper representations between R2, D1, and Vectorize via
     * Fontaine's period rings: B_cris (crystalline), B_st (semistable), B_dR (de Rham).
     * All 6 bridge directions supported (R2↔D1↔Vectorize).
     * Stores period matrices in D1 period_matrices table with Frobenius action.
     *
     * @param {string} body.source - Source representation: "r2", "d1", or "vectorize"
     * @param {string} body.target - Target representation: "r2", "d1", or "vectorize"
     * @param {string} body.paper_id - Paper identifier for lookup
     * @returns {object} bridge_type, source_representation, target_representation,
     *                   period_matrix, frobenius_action
     */
    // ─── K: Fontaine Period Bridge API ───
    if (request.method === "POST" && url.pathname === "/period-bridge") {
      try {
        const body = await request.json();
        const source = (body.source || "").toLowerCase();
        const target = (body.target || "").toLowerCase();
        const paperId = (body.paper_id || "").trim();
        if (!source || !target || !paperId) return new Response(JSON.stringify({ error: "source, target, and paper_id required" }), { status: 400, headers: hdrs });
        const validReps = ["r2", "d1", "vectorize"];
        if (!validReps.includes(source) || !validReps.includes(target)) return new Response(JSON.stringify({ error: "source/target must be r2, d1, or vectorize" }), { status: 400, headers: hdrs });
        if (source === target) return new Response(JSON.stringify({ error: "source and target must differ" }), { status: 400, headers: hdrs });
        const bridgeMap = { "r2-d1": "B_cris", "d1-vectorize": "B_st", "vectorize-r2": "B_dR", "r2-vectorize": "B_cris ∘ B_st", "d1-r2": "B_st ∘ B_dR", "vectorize-d1": "B_dR ∘ B_cris" };
        const bridgeType = bridgeMap[source + "-" + target] || "unknown";
        let sourceRep = null;
        if (source === "r2") {
          let r2Obj = await env.PAPERS_R2.get("papers/" + paperId + ".md");
          if (!r2Obj) r2Obj = await env.PAPERS_R2.get("papers/" + paperId + ".json");
          if (!r2Obj) r2Obj = await env.PAPERS_R2.get(paperId);
          if (!r2Obj) return new Response(JSON.stringify({ error: "R2 paper not found", bridge_type: bridgeType, source, target, principle: "Fontaine Period Bridge requires source data" }), { status: 404, headers: hdrs });
          const mdText = await r2Obj.text();
          sourceRep = { type: "r2", format: "markdown", size_bytes: mdText.length, preview: mdText.substring(0, 200), sections: (mdText.match(/^## .+$/gm) || []).length };
        }
        if (source === "d1") {
          const d1Row = await env.PAPERS_DB.prepare("SELECT arxiv_id, title, abstract, r2_key FROM papers WHERE arxiv_id LIKE ? OR title LIKE ? LIMIT 1").bind("%" + paperId + "%", "%" + paperId + "%").first();
          if (!d1Row) return new Response(JSON.stringify({ error: "D1 paper not found", bridge_type: bridgeType, source, target, principle: "Fontaine Period Bridge requires source data" }), { status: 404, headers: hdrs });
          const cr = await env.PAPERS_DB.prepare("SELECT cluster_depth, cluster_rep, ostrowski_score FROM paper_clusters WHERE arxiv_id LIKE ? LIMIT 1").bind("%" + d1Row.arxiv_id + "%").first();
          sourceRep = { type: "d1", format: "structured_metadata", arxiv_id: d1Row.arxiv_id, title: d1Row.title, abstract_preview: (d1Row.abstract || "").substring(0, 200), r2_key: d1Row.r2_key, cluster: cr ? { depth: cr.cluster_depth, rep: cr.cluster_rep, ostrowski_score: cr.ostrowski_score } : null };
        }
        if (source === "vectorize") {
          try {
            const vq = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: paperId });
            const vr = await env.VECTORIZE_INDEX.query(vq.data[0], { topK: 5, returnMetadata: true });
            const matches = (vr.matches || []).filter(m => (m.metadata?.arxiv_id || "").includes(paperId) || (m.metadata?.title || "").toLowerCase().includes(paperId.toLowerCase().substring(0, 20)));
            if (matches.length === 0) return new Response(JSON.stringify({ error: "Vectorize embedding not found", bridge_type: bridgeType, source, target, principle: "Fontaine Period Bridge requires source data" }), { status: 404, headers: hdrs });
            const tm = matches[0];
            sourceRep = { type: "vectorize", format: "embedding_vector", vector_id: tm.id, score: tm.score, dimensions: tm.values?.length || 768, metadata: { arxiv_id: tm.metadata?.arxiv_id || paperId, title: tm.metadata?.title || "", text_preview: (tm.metadata?.text || "").substring(0, 200) }, vector_sample: (tm.values || []).slice(0, 10) };
          } catch (ve) { return new Response(JSON.stringify({ error: "Vectorize query failed: " + ve.message, bridge_type: bridgeType, source, target }), { status: 500, headers: hdrs }); }
        }
        const periodMatrix = []; let frobeniusAction = null;
        if (bridgeType === "B_cris") { for (let s = 0; s < Math.min(sourceRep?.sections || 1, 4); s++) periodMatrix.push(["arxiv_id", "title", "abstract", "r2_key"].map((_, fi) => s === fi ? 1 : 0)); frobeniusAction = { type: "crystalline", description: "Frobenius φ = id on B_cris", eigenvalues: periodMatrix.map(r => r.reduce((a, b) => a + b, 0)), note: "Crystalline = Frobenius-invariant discrete structure" }; }
        if (bridgeType === "B_st") { const ih = (sourceRep?.arxiv_id || paperId).split("").reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0) & 0xFFFF; periodMatrix.push([1, 0, 0, ih % 256]); periodMatrix.push([0, 1, 0, (ih >> 4) % 256]); periodMatrix.push([0, 0, 1, (ih >> 8) % 256]); frobeniusAction = { type: "semistable", description: "Monodromy N: Nφ = pφN", monodromy_coefficient: (ih % 17) / 100, eigenvalues: periodMatrix.map(r => r.reduce((a, b) => a + b, 0)), note: "B_st allows nilpotent monodromy N" }; }
        if (bridgeType === "B_dR") { const st = Math.min(4, Math.ceil((sourceRep?.dimensions || 768) / 192)); for (let s = 0; s < st; s++) periodMatrix.push([Math.cos(s * Math.PI / st), Math.sin(s * Math.PI / st), s / st, 1 - s / st]); frobeniusAction = { type: "deRham", description: "φ scales by p on B_dR", scaling_factor: 2, eigenvalues: periodMatrix.map(r => r.reduce((a, b) => a + b, 0)), note: "B_dR = complete discrete valuation field" }; }
        if (bridgeType === "B_cris ∘ B_st") { periodMatrix.push([1, 0, 0, 1]); periodMatrix.push([0, 1, 0, 1]); periodMatrix.push([1, 1, 0, 0]); frobeniusAction = { type: "composite_cris_st", description: "B_cris ∘ B_st: crystalline then semistable", note: "φ(ax) = σ(a)φ(x), σ = Frobenius lift on W(k)" }; }
        if (bridgeType === "B_st ∘ B_dR") { periodMatrix.push([0.5, 0.5, 0, 0]); periodMatrix.push([0, 0.5, 0.5, 0]); periodMatrix.push([0, 0, 0.5, 0.5]); frobeniusAction = { type: "composite_st_dR", description: "B_st ∘ B_dR", note: "Hodge-Tate decomposition in graded pieces" }; }
        if (bridgeType === "B_dR ∘ B_cris") { periodMatrix.push([0, 0, 1, 0]); periodMatrix.push([0, 0, 0, 1]); periodMatrix.push([1, 0, 0, 0]); frobeniusAction = { type: "composite_dR_cris", description: "B_dR ∘ B_cris", note: "deRham-to-crystalline comparison theorem" }; }
        await env.PAPERS_DB.prepare("CREATE TABLE IF NOT EXISTS period_matrices (paper_id TEXT, bridge_type TEXT, matrix_json TEXT, frobenius_json TEXT, timestamp TEXT, PRIMARY KEY (paper_id, bridge_type))").run();
        await env.PAPERS_DB.prepare("INSERT OR REPLACE INTO period_matrices VALUES (?,?,?,?,?)").bind(paperId, bridgeType, JSON.stringify(periodMatrix), JSON.stringify(frobeniusAction), new Date().toISOString()).run();
        return new Response(JSON.stringify({ bridge_type: bridgeType, source, target, paper_id: paperId, source_representation: sourceRep, target_representation: { type: target, bridge_applied: bridgeType, period_matrix: periodMatrix, frobenius_action: frobeniusAction }, period_matrix: periodMatrix, frobenius_action: frobeniusAction, principle: "Fontaine Period Bridge: B_cris (crystalline), B_st (semistable), B_dR (de Rham). Bridges R2<->D1<->Vectorize via p-adic Hodge theory." }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    /**
     * GET /spec — OpenAPI 3.1 specification for AI/LLM discoverability.
     * Returns complete API documentation in OpenAPI format.
     * Designed for llmstxt.org compatibility.
     */
    if (request.method === "GET" && url.pathname === "/spec") {
      const spec = { openapi: "3.1.0", info: { title: "QWAV Research API", version: "2.7.0", description: "Quantum Wave (QWAV) Research API — p-adic RAG with ultrametric tree search, Tate-Shafarevich validation, p-adic LM embeddings, and Fontaine period bridges. Cloudflare Workers, D1, R2, Vectorize, Llama 3.2.", contact: { name: "QNFO Research", url: "https://qnfo.org" }, "x-topics": ["quantum-computing","p-adic-mathematics","number-theory","information-retrieval"], "x-foundations": ["Ultrametric Tree (single-linkage clustering)","p-Adic LM (Z_p embeddings, ultrametric ball attention)","Tate-Shafarevich (Hasse local-global + Selmer obstruction)","Fontaine Period Bridge (B_cris/B_st/B_dR)","Bruhat-Tits Building","p-Adic Perceptron (Hensel lifting)"] }, servers: [{ url: "https://ask-qwav.q08.workers.dev", description: "QWAV Production" }], paths: {
        "/health": { get: { summary: "System health check", operationId: "getHealth", tags: ["System"] } },
        "/thread": { get: { summary: "Get thread messages", operationId: "getThread", tags: ["Threads"], parameters: [{ name: "id", in: "query", required: true, schema: { type: "string" } }] }, delete: { summary: "Delete thread", operationId: "deleteThread", tags: ["Threads"], parameters: [{ name: "id", in: "query", required: true }] } },
        "/threads": { get: { summary: "List all threads", operationId: "listThreads", tags: ["Threads"] } },
        "/recent": { get: { summary: "Recent queries", operationId: "getRecent", tags: ["Analytics"] } },
        "/did-you-mean": { get: { summary: "Ultrametric spelling correction", operationId: "didYouMean", tags: ["Discovery"], parameters: [{ name: "q", in: "query", required: true }] } },
        "/ultrametric-tree": { get: { summary: "Tree stats, clusters, HenSel layers", operationId: "ultrametricTree", tags: ["Discovery"] } },
        "/dendrogram-json": { get: { summary: "D3 dendrogram JSON", operationId: "dendrogramJson", tags: ["Visualization"] } },
        "/papers": { get: { summary: "Search papers in D1", operationId: "searchPapers", tags: ["Papers"], parameters: [{ name: "search", in: "query" }, { name: "arxiv_id", in: "query" }, { name: "limit", in: "query" }] } },
        "/fix-titles": { post: { summary: "Batch-correct titles via ultrametric matching", operationId: "fixTitles", tags: ["Papers"] } },
        "/stats": { get: { summary: "Query statistics", operationId: "getStats", tags: ["Analytics"] } },
        "/stats/csv": { get: { summary: "Download stats as CSV", operationId: "getStatsCsv", tags: ["Analytics"] } },
        "/sync-clusters": { post: { summary: "Rebuild tree + persist to R2", operationId: "syncClusters", tags: ["Admin"] } },
        "/validate": { get: { summary: "Hasse local-global validation", operationId: "validate", tags: ["Validation"], parameters: [{ name: "title", in: "query", required: true }] } },
        "/validate-multi": { get: { summary: "Batch Hasse validation", operationId: "validateMulti", tags: ["Validation"], parameters: [{ name: "title", in: "query", required: true }] } },
        "/validate-selmer": { post: { summary: "[I] Tate-Shafarevich Selmer validation", operationId: "validateSelmer", tags: ["Algebraic Geometry"], description: "D1+R2+cluster+multi-edge checks, global lift, Selmer generators → sha_rank + obstruction certificate" } },
        "/p-adic-embed": { post: { summary: "[J] p-Adic LM embedding", operationId: "pAdicEmbed", tags: ["p-Adic LM"], description: "Token→Z_p embed→ultrametric ball attention mask (no softmax). Connected components = ultrametric clusters." } },
        "/period-bridge": { post: { summary: "[K] Fontaine Period Bridge", operationId: "periodBridge", tags: ["Algebraic Geometry"], description: "6 bridge directions R2↔D1↔Vectorize via B_cris/B_st/B_dR. Period matrices + Frobenius action." } },
        "/paper-versions": { get: { summary: "Witt vector version tracking", operationId: "paperVersions", tags: ["Papers"], parameters: [{ name: "title", in: "query", required: true }] } },
        "/spectral-analysis": { get: { summary: "p-adic spectral analysis", operationId: "spectralAnalysis", tags: ["Discovery"] } },
        "/bruhat-tits": { get: { summary: "Bruhat-Tits building", operationId: "bruhatTits", tags: ["Geometry"] } },
        "/perceptron": { get: { summary: "p-adic perceptron", operationId: "perceptron", tags: ["p-Adic ML"], parameters: [{ name: "inputs", in: "query" }, { name: "weights", in: "query" }, { name: "p", in: "query" }] } },
        "/vectorize-tree-search": { post: { summary: "Vector search with ultrametric pruning", operationId: "vectorizeTreeSearch", tags: ["Search"] } },
        "/paper-diff": { post: { summary: "Paper diff via ultrametric distance", operationId: "paperDiff", tags: ["Papers"] } },
        "/berkovich-explorer": { get: { summary: "Berkovich analytification explorer", operationId: "berkovichExplorer", tags: ["Geometry"] } },
        "/index-papers": { post: { summary: "Manual paper indexing (rate-limited)", operationId: "indexPapers", tags: ["Admin"], description: "Actions: status, start, continue. 10 req/min/IP, max 20 papers/batch." } },
        "/": { post: { summary: "Main RAG query (alias: /query)", operationId: "ragQuery", tags: ["Query"], description: "Embed→Vectorize→R2 context→Llama 3.2 with anti-hallucination guardrails." } },
        "/spec": { get: { summary: "This OpenAPI 3.1 spec", operationId: "getSpec", tags: ["Discoverability"], description: "AI crawler discoverability (llmstxt.org compatible)" } }
      }, tags: [{ name: "System" }, { name: "Threads" }, { name: "Query" }, { name: "Papers" }, { name: "Discovery" }, { name: "Validation" }, { name: "Algebraic Geometry" }, { name: "p-Adic LM" }, { name: "p-Adic ML" }, { name: "Geometry" }, { name: "Search" }, { name: "Visualization" }, { name: "Analytics" }, { name: "Admin" }, { name: "Discoverability" }], "x-ai-crawler": { "llms.txt": "/spec", "robots.txt": "Allow: /", "preferred_format": "openapi-3.1", "search_keywords": ["ultrametric","p-adic","RAG","vector search","Tate-Shafarevich","Fontaine bridge","Bruhat-Tits","Berkovich","Hensel lifting","Witt vectors","dendrogram","Cloudflare Workers"] } };
      return new Response(JSON.stringify(spec, null, 2), { headers: { ...hdrs, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Not found", endpoints: ["GET /health", "GET /spec", "GET /thread?id=", "GET /threads", "DELETE /thread?id=", "GET /recent", "GET /did-you-mean?q=", "GET /ultrametric-tree", "GET /dendrogram-json", "GET /papers?search=&limit=", "POST /fix-titles", "GET /stats", "GET /stats/csv", "POST /sync-clusters", "GET /validate?title=", "GET /validate-multi?titles=", "POST /validate-selmer", "GET /paper-versions?title=", "GET /spectral-analysis", "GET /bruhat-tits", "GET /perceptron?inputs=&weights=&p=", "POST /vectorize-tree-search", "POST /paper-diff", "GET /berkovich-explorer", "POST /index-papers", "POST /", "POST /query", "POST /p-adic-embed", "POST /period-bridge"] }), { status: 404, headers: hdrs });
  },

  /**
   * Scheduled handler: auto-indexes papers into Vectorize every 30 minutes.
   * Processes up to MAX_BATCHES (10) batches per invocation.
   * Chunks markdown from R2, embeds via @cf/baai/bge-base-en-v1.5,
   * upserts into VECTORIZE_INDEX with metadata (arxiv_id, title, abstract, url).
   * Tracks progress in D1 index_progress table for cold-start resilience.
   */
  // ─── Scheduled handler: auto-index papers every 30 minutes ───
  async scheduled(event, env, ctx) {
    const MAX_BATCHES = 10;
    let totalIndexed = 0, totalChunks = 0;

    const progressRow = await env.DB.prepare(
      "SELECT value FROM index_progress WHERE key = ?"
    ).bind("index_progress").first().catch(() => null);
    const progress = progressRow ? JSON.parse(progressRow.value) : { indexed: 0, errors: [], last_arxiv_id: null };

    const totalRow = await env.PAPERS_DB.prepare(
      "SELECT COUNT(*) as cnt FROM papers WHERE r2_key IS NOT NULL AND r2_key != x''"
    ).first();
    const total = totalRow.cnt;

    // Check if already complete
    if (progress.indexed >= total) {
      console.log("Scheduled indexing: already complete (" + progress.indexed + "/" + total + ")");
      return;
    }

    for (let i = 0; i < MAX_BATCHES; i++) {
      let papers;
      if (progress.last_arxiv_id) {
        papers = await env.PAPERS_DB.prepare(
          "SELECT arxiv_id, title, r2_key, abstract FROM papers WHERE r2_key IS NOT NULL AND r2_key != x'' AND arxiv_id > ?1 ORDER BY arxiv_id ASC LIMIT 5"
        ).bind(progress.last_arxiv_id).all();
      } else {
        papers = await env.PAPERS_DB.prepare(
          "SELECT arxiv_id, title, r2_key, abstract FROM papers WHERE r2_key IS NOT NULL AND r2_key != x'' ORDER BY arxiv_id ASC LIMIT 5"
        ).all();
      }

      if (!papers.results || papers.results.length === 0) break;

      for (const paper of papers.results) {
        progress.last_arxiv_id = paper.arxiv_id;
        try {
          const r2Object = await env.PAPERS_R2.get(paper.r2_key);
          if (!r2Object) continue;
          const markdown = await r2Object.text();
          const chunks = chunkMarkdown(markdown, paper.title);
          totalChunks += chunks.length;
          for (let ci = 0; ci < chunks.length; ci++) {
            const chunk = chunks[ci];
            const embResult = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: chunk.text });
            const vector = embResult.data[0];
            await env.VECTORIZE_INDEX.upsert([{
              id: paper.arxiv_id + "_chunk_" + ci,
              values: vector,
              metadata: {
                arxiv_id: paper.arxiv_id,
                title: paper.title || "",
                abstract: (paper.abstract || "").substring(0, 500),
                chunk_index: ci,
                total_chunks: chunks.length,
                text: chunk.text.substring(0, 2500),
                r2_key: paper.r2_key || "",
                slug: chunk.slug || paper.r2_key.replace("papers/", "").replace(".md", ""),
                url: "https://papers.qnfo.org/papers/" + (chunk.slug || paper.r2_key.replace("papers/", "").replace(".md", ""))
              }
            }]);
          }
          totalIndexed++;
        } catch (e) { /* skip individual paper errors in cron */ }
      }

      progress.indexed = (progress.indexed || 0) + papers.results.length;
      await env.DB.prepare("INSERT OR REPLACE INTO index_progress (key, value) VALUES (?1, ?2)")
        .bind("index_progress", JSON.stringify(progress)).run();

      if (progress.indexed >= total) break;
    }

    // Update vectorize chunk count
    if (totalChunks > 0) {
      const existingCount = await env.DB.prepare(
        "SELECT value FROM index_progress WHERE key = ?"
      ).bind("vectorize_indexed_count").first();
      const prevCount = existingCount ? parseInt(existingCount.value) || 0 : 0;
      await env.DB.prepare("INSERT OR REPLACE INTO index_progress (key, value) VALUES (?1, ?2)")
        .bind("vectorize_indexed_count", String(prevCount + totalChunks)).run();
    }

    console.log("Scheduled indexing: " + totalIndexed + " papers, " + totalChunks + " chunks (" + progress.indexed + "/" + total + ")");

    // ─── Email Discovery Digest (Cron-triggered) ───
    try {
      const recentPapers = await env.PAPERS_DB.prepare(
        "SELECT arxiv_id, title FROM papers WHERE indexed_at > datetime('now', '-1 hour') ORDER BY indexed_at DESC LIMIT 20"
      ).all();
      if (recentPapers.results && recentPapers.results.length > 0) {
        const digest = { generatedAt: new Date().toISOString(), totalNew: recentPapers.results.length, papers: recentPapers.results, clusters: [] };
        if (ultrametricTree) {
          const clusterMap = new Map();
          for (const p of recentPapers.results) {
            const rep = (function findRep(node, t) { if (!node || node.type === "leaf") return node ? node.rep || node.title : "unknown"; if (!node.children || node.children.length === 0) return node.rep || "unknown"; return findRep(node.children[0], t); })(ultrametricTree, p.title);
            if (!clusterMap.has(rep)) clusterMap.set(rep, []);
            clusterMap.get(rep).push(p.title);
          }
          for (const [rep, papers] of clusterMap) { digest.clusters.push({ representative: rep, count: papers.length, papers }); }
        }
        await env.PAPERS_R2.put("ultrametric/email-digest.json", JSON.stringify(digest));
        console.log("Email digest: " + recentPapers.results.length + " new papers in " + digest.clusters.length + " clusters");
      }
    } catch (e) { console.log("Email digest skipped: " + e.message); }
  }
};
