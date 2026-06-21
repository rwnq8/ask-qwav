/**
 * @module index_endpoint
 * @description POST /index-papers endpoint — CRON-like manual indexing of papers
 *              from R2 markdown → AI embeddings (bge-base-en-v1.5) → Vectorize upsert.
 *              Supports status/start/continue/clear actions with progress persistence
 *              in D1's _cf_KV key-value store. Processes papers in configurable batches.
 *
 * @integration Inserted before the 404 catch-all in worker.js main fetch handler.
 * @route   POST /index-papers
 * @input   { action: "status"|"start"|"continue"|"clear", batch_size?: number (≤20) }
 *
 * @actions
 *   status   — Returns { indexed_papers, total_papers, chunks_in_vectorize, last_arxiv_id,
 *              errors (last 20), complete (bool) } from D1 index_progress + PAPERS_DB
 *   start    — Begins indexing from arxiv_id ASC. Reads papers from PAPERS_DB, fetches
 *              markdown from R2, chunks via chunkMarkdown(), embeds via AI binding,
 *              upserts into VECTORIZE_INDEX. Tracks progress in D1.
 *   continue — Resumes from last_arxiv_id saved in D1 index_progress
 *   clear    — Resets index_progress and vectorize_indexed_count in D1
 *
 * @pipeline  PAPERS_DB → R2 fetch → chunkMarkdown(2000-char) → AI.run(@cf/baai/bge-base-en-v1.5)
 *            → VECTORIZE_INDEX.upsert → D1 progress save → D1 batch errors
 *
 * @cloudflare
 *   - AI: @cf/baai/bge-base-en-v1.5 for embedding generation
 *   - Vectorize: qwav-research index via VECTORIZE_INDEX binding
 *   - D1: PAP_DB for paper listing, DB (qnfo-audit) for progress persistence
 *   - R2: PAPERS_R2 (qnfo bucket) for raw markdown content
 */
// ─── INDEXING ENDPOINT ───
// Inserted before the 404 catch-all in worker.js

    if (request.method === "POST" && url.pathname === "/index-papers") {
      let action, batchSize;
      try {
        const body = await request.json();
        action = body.action || "status";
        batchSize = Math.min(body.batch_size || 5, 20);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: hdrs });
      }

      if (action === "status") {
        try {
          const row = await env.DB.prepare("SELECT value FROM _cf_KV WHERE key = ?").bind("index_progress").first();
          const kvRow = await env.DB.prepare("SELECT value FROM _cf_KV WHERE key = ?").bind("vectorize_indexed_count").first();
          const progress = row ? JSON.parse(row.value) : { indexed: 0, errors: [], last_arxiv_id: null };
          const vc = kvRow ? parseInt(kvRow.value) || 0 : 0;
          const totalRow = await env.PAPERS_DB.prepare(
            "SELECT COUNT(*) as cnt FROM papers WHERE r2_key IS NOT NULL AND r2_key != ''"
          ).first();
          return new Response(JSON.stringify({
            indexed_papers: progress.indexed,
            total_papers: totalRow.cnt,
            chunks_in_vectorize: vc,
            last_arxiv_id: progress.last_arxiv_id,
            errors: (progress.errors || []).slice(-20),
            complete: progress.indexed >= totalRow.cnt
          }), { headers: hdrs });
        } catch (e) {
          return new Response(JSON.stringify({ error: "Status query failed: " + e.message }), { status: 500, headers: hdrs });
        }
      }

      if (action === "start" || action === "continue") {
        try {
          let row = await env.DB.prepare("SELECT value FROM _cf_KV WHERE key = ?").bind("index_progress").first();
          let progress = row ? JSON.parse(row.value) : { indexed: 0, errors: [], last_arxiv_id: null };

          const totalRow = await env.PAPERS_DB.prepare(
            "SELECT COUNT(*) as cnt FROM papers WHERE r2_key IS NOT NULL AND r2_key != ''"
          ).first();
          const total = totalRow.cnt;

          let papers;
          if (progress.last_arxiv_id) {
            papers = await env.PAPERS_DB.prepare(
              "SELECT arxiv_id, title, r2_key, abstract FROM papers WHERE r2_key IS NOT NULL AND r2_key != '' AND arxiv_id > ? ORDER BY arxiv_id ASC LIMIT ?"
            ).bind(progress.last_arxiv_id, batchSize).all();
          } else {
            papers = await env.PAPERS_DB.prepare(
              "SELECT arxiv_id, title, r2_key, abstract FROM papers WHERE r2_key IS NOT NULL AND r2_key != '' ORDER BY arxiv_id ASC LIMIT ?"
            ).bind(batchSize).all();
          }

          if (!papers.results || papers.results.length === 0) {
            return new Response(JSON.stringify({
              message: "No more papers to index",
              indexed: progress.indexed,
              total: total,
              complete: true
            }), { headers: hdrs });
          }

          let indexed = 0;
          let newErrors = [];
          let lastArxivId = progress.last_arxiv_id;
          let totalChunks = 0;

          for (const paper of papers.results) {
            lastArxivId = paper.arxiv_id;
            try {
              const r2Object = await env.PAPERS_R2.get(paper.r2_key);
              if (!r2Object) {
                newErrors.push({ arxiv_id: paper.arxiv_id, error: "R2 object not found: " + paper.r2_key });
                continue;
              }
              const markdown = await r2Object.text();

              const chunks = chunkMarkdown(markdown, paper.title);
              totalChunks += chunks.length;

              for (let ci = 0; ci < chunks.length; ci++) {
                const chunk = chunks[ci];
                const embResult = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: chunk.text });
                const vector = embResult.data[0];

                const vectorId = paper.arxiv_id + "_chunk_" + ci;
                await env.VECTORIZE_INDEX.upsert([{
                  id: vectorId,
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

              indexed++;
            } catch (paperErr) {
              newErrors.push({ arxiv_id: paper.arxiv_id, error: paperErr.message });
            }
          }

          progress.indexed = (progress.indexed || 0) + indexed;
          progress.errors = [...(progress.errors || []), ...newErrors];
          progress.last_arxiv_id = lastArxivId;

          await env.DB.prepare(
            "INSERT OR REPLACE INTO _cf_KV (key, value) VALUES (?, ?)"
          ).bind("index_progress", JSON.stringify(progress)).run();

          const existingCount = await env.DB.prepare("SELECT value FROM _cf_KV WHERE key = ?").bind("vectorize_indexed_count").first();
          const prevCount = existingCount ? parseInt(existingCount.value) || 0 : 0;
          await env.DB.prepare(
            "INSERT OR REPLACE INTO _cf_KV (key, value) VALUES (?, ?)"
          ).bind("vectorize_indexed_count", String(prevCount + totalChunks)).run();

          return new Response(JSON.stringify({
            batch_indexed: indexed,
            total_indexed: progress.indexed,
            total_papers: total,
            chunks_created: totalChunks,
            last_arxiv_id: lastArxivId,
            errors: newErrors.slice(0, 10),
            complete: progress.indexed >= total,
            progress_pct: Math.round((progress.indexed / total) * 100)
          }), { headers: hdrs });

        } catch (e) {
          return new Response(JSON.stringify({ error: "Index batch failed: " + e.message }), { status: 500, headers: hdrs });
        }
      }

      if (action === "reset") {
        try {
          await env.DB.prepare("DELETE FROM _cf_KV WHERE key = ?").bind("index_progress").run();
          await env.DB.prepare("DELETE FROM _cf_KV WHERE key = ?").bind("vectorize_indexed_count").run();
          return new Response(JSON.stringify({ message: "Index progress reset. Vectorize data preserved." }), { headers: hdrs });
        } catch (e) {
          return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: hdrs });
        }
      }

      return new Response(JSON.stringify({
        error: "Unknown action",
        valid_actions: ["status", "start", "continue", "reset"]
      }), { status: 400, headers: hdrs });
    }
