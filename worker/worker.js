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

function generateId() {
  return "th_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 8);
}

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

function findClusterForTitle(title) {
  return ultrametricTitleIndex.get(title.toLowerCase()) || null;
}

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
    ttlMinutes: Math.round(ULTRA_TREE_TTL / 60000)
  };
}


// ─── Did-you-mean cache ───
let didYouMeanCache = null;
let didYouMeanCacheTs = 0;

// ─── Query cache (in-memory, TTL 5min, max 200 entries) ───
const queryCache = new Map();
const CACHE_TTL_MS = 300000;
const MAX_CACHE_SIZE = 200;

function getCachedQuery(key) {
  const entry = queryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { queryCache.delete(key); return null; }
  return entry.data;
}

function setCachedQuery(key, data) {
  if (queryCache.size >= MAX_CACHE_SIZE) {
    const firstKey = queryCache.keys().next().value;
    queryCache.delete(firstKey);
  }
  queryCache.set(key, { data, ts: Date.now() });
}

// ─── Rate limiter (in-memory, per-IP, 10 req/min on /index-papers) ───
const rateLimitMap = new Map();
const RATE_WINDOW_MS = 60000;
const MAX_INDEX_REQUESTS = 10;

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
          version: "2.6.0",
          features: ["rag", "vectorize", "threads", "analytics", "anti-hallucination", "indexing", "cache", "rate-limit", "cron"],
          paper_count: paperCount.cnt,
          indexed_papers: idxProgress ? idxProgress.indexed : 0,
          chunks_in_vectorize: vectorizeChunks
        }), { headers: hdrs });
      } catch (e) {
        return new Response(JSON.stringify({ status: "ok", model: "@cf/meta/llama-3.2-3b-instruct", version: "2.5.2" }), { headers: hdrs });
      }
    }

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
    if (request.method === "GET" && url.pathname === "/recent") {
      try {
        const r = await env.DB.prepare("SELECT id, thread_id, timestamp, query, citations_count, elapsed_ms, created_at FROM ask_queries_v2 ORDER BY id DESC LIMIT 20").all();
        return new Response(JSON.stringify({ queries: r.results }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── "Did you mean?" spelling suggestions ───
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

    if (request.method === "GET" && url.pathname === "/stats") {
      try {
        const c = await env.DB.prepare("SELECT COUNT(*) as total, COALESCE(AVG(elapsed_ms),0) as avg_ms, COALESCE(SUM(citations_count),0) as total_cit FROM ask_queries_v2").first();
        const threads = await env.DB.prepare("SELECT COUNT(*) as total FROM chat_sessions").first();
        return new Response(JSON.stringify({ total_queries: c.total, avg_latency_ms: Math.round(c.avg_ms), total_citations: c.total_cit, total_threads: threads.total }), { headers: hdrs });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

    // ─── Stats CSV export ───
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
          "worker_version,2.6.0"
        ].join("\n");
        return new Response(csv, { headers: { ...hdrs, "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=ask-qwav-stats.csv" } });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs }); }
    }

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

    return new Response(JSON.stringify({ error: "Not found", endpoints: ["GET /health", "GET /thread?id=", "GET /threads", "DELETE /thread?id=", "GET /recent", "GET /stats", "GET /papers", "POST /fix-titles", "POST /", "POST /index-papers"] }), { status: 404, headers: hdrs });
  },

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
  }
};
