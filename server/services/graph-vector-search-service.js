import { createGraphEmbeddingProvider } from './graph-embedding-provider.js';

const TYPES = ['decision', 'project', 'org', 'app', 'philosophy', 'glossary_term', 'document', 'person', 'brand'];
const INACTIVE = ['retired', 'merged', 'inactive', 'superseded'];
const fail = (code, status = 400) => Object.assign(new Error(code), { code, status });
const validText = x => typeof x === 'string' && x.trim() && x.length <= 1000;

// RLS enforces role, clearance and authorized projects. The additional project
// predicate narrows the request, including people linked through member_of.
const ELIGIBLE = `SELECT g.*, p.code AS project_code,
 brainbase_graph_embedding_text(g.payload) AS embedding_text
 FROM graph_entities g LEFT JOIN projects p ON p.id = g.project_id
 WHERE g.entity_type = ANY($1::text[])
 AND ($2::text IS NULL OR p.code = $2 OR (g.entity_type = 'person' AND EXISTS (
   SELECT 1 FROM graph_edges e JOIN projects ep ON ep.id = e.project_id
   WHERE e.from_id = g.id AND e.rel_type = 'member_of' AND e.lifecycle_status = 'active' AND ep.code = $2)))
 AND ($3::text[] IS NULL OR g.id = ANY($3::text[]))
 AND COALESCE(g.payload->>'searchable', 'true') <> 'false'
 AND NOT (lower(trim(g.lifecycle_status)) = ANY($4::text[]))
 AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY[g.payload->>'status', g.payload->>'lifecycle_status',
   g.payload->>'lifecycle_state', g.payload->>'semantic_state']) s WHERE lower(trim(s)) = ANY($4::text[]))`;

export class GraphVectorSearchService {
    constructor(infoService, { provider = null } = {}) {
        this.info = infoService;
        this.provider = provider;
        this.indexing = null;
    }
    getProvider() {
        this.provider ??= createGraphEmbeddingProvider();
        return this.provider;
    }
    options(access, input = {}) {
        const types = input.types ?? TYPES;
        if (!Array.isArray(types) || !types.length || types.length > 10 || !types.every(validText)) throw fail('graph_search_types_invalid');
        if (input.project !== undefined && (!validText(input.project) || !access.projectCodes.includes(input.project))) throw fail('graph_search_project_denied', 403);
        if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.length > 500 || !input.ids.every(validText))) throw fail('graph_search_ids_invalid');
        return [types, input.project ?? null, input.ids ?? null, INACTIVE];
    }
    async search(access, input) {
        const params = this.options(access, input);
        if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 6000) throw fail('graph_search_query_invalid');
        const topK = input.top_k ?? 10;
        if (!Number.isInteger(topK) || topK < 1 || topK > 500) throw fail('graph_search_top_k_invalid');
        const provider = this.getProvider();
        // Query only: no passage generation or index writes in the request path.
        const [vector] = await provider.embed([input.query], 'query');
        return this.info.withAccessContext(access, async client => {
            await client.query("SET LOCAL statement_timeout = '5s'");
            const { rows: [counts] } = await client.query(`WITH eligible AS (${ELIGIBLE})
              SELECT count(*)::int AS total, count(v.entity_id)::int AS ready,
                count(*) FILTER (WHERE length(g.embedding_text) > 6000)::int AS truncated
              FROM eligible g LEFT JOIN graph_entity_embeddings v ON v.entity_id = g.id
                AND v.model_id = $5 AND v.content_hash = md5(g.embedding_text)`, [...params, provider.modelId]);
            const { rows } = await client.query(`WITH eligible AS (${ELIGIBLE})
              SELECT g.*, 1 - (v.embedding <=> $6::vector) AS score
              FROM eligible g JOIN graph_entity_embeddings v ON v.entity_id = g.id
                AND v.model_id = $5 AND v.content_hash = md5(g.embedding_text)
              ORDER BY v.embedding <=> $6::vector, g.id LIMIT $7`, [...params, provider.modelId, JSON.stringify(vector), topK]);
            const pending = counts.total - counts.ready;
            const reasons = [...(pending ? ['embedding_index_pending'] : []), ...(counts.truncated ? ['embedding_text_truncated'] : [])];
            return { records: rows.map(({ embedding_text, ...row }) => row),
                coverage: reasons.length ? 'partial' : 'complete', partial_reasons: reasons,
                index: { model: provider.modelId, ready: counts.ready, pending } };
        });
    }
    async indexBatch(access, { limit = 32, ...input } = {}) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('graph_index_limit_invalid');
        if (this.indexing) throw fail('graph_index_busy', 409);
        const operation = this.runIndexBatch(access, input, limit);
        this.indexing = operation;
        try { return await operation; } finally { this.indexing = null; }
    }
    async runIndexBatch(access, input, limit) {
        const params = this.options(access, input);
        const provider = this.getProvider();
        const pending = await this.info.withAccessContext(access, async client => {
            const { rows } = await client.query(`WITH eligible AS (${ELIGIBLE})
              SELECT g.id, g.embedding_text, md5(g.embedding_text) AS content_hash
              FROM eligible g LEFT JOIN graph_entity_embeddings v ON v.entity_id = g.id
                AND v.model_id = $5 AND v.content_hash = md5(g.embedding_text)
              WHERE v.entity_id IS NULL ORDER BY g.id LIMIT $6`, [...params, provider.modelId, limit]);
            return rows;
        });
        if (!pending.length) return { selected: 0, indexed: 0, changed_during_generation: 0, model: provider.modelId };
        const vectors = await provider.embed(pending.map(row => row.embedding_text.slice(0, 6000) || '(empty)'), 'passage');
        let indexed = 0;
        await this.info.withAccessContext(access, async client => {
            for (const [i, row] of pending.entries()) {
                // Re-read visibility and text after the external API call. A concurrent
                // edit cannot publish a vector under the new content's identity.
                const result = await client.query(`WITH eligible AS (${ELIGIBLE})
                  INSERT INTO graph_entity_embeddings(entity_id, model_id, content_hash, embedding)
                  SELECT id, $6, $7, $8::vector FROM eligible
                  WHERE id = $5 AND md5(embedding_text) = $7
                  ON CONFLICT(entity_id, model_id) DO UPDATE SET content_hash = excluded.content_hash,
                    embedding = excluded.embedding, indexed_at = now()`, [...params, row.id, provider.modelId, row.content_hash, JSON.stringify(vectors[i])]);
                indexed += result.rowCount;
            }
        });
        return { selected: pending.length, indexed, changed_during_generation: pending.length - indexed, model: provider.modelId };
    }
}
