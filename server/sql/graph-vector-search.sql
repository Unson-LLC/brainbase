-- Additive derived index. The Graph remains authoritative; no Graph writer changes.
-- pgvector must be installed by the database operator before this migration.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE OR REPLACE FUNCTION brainbase_graph_embedding_text(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT concat_ws(E'\n', p->>'name', p->>'title', p->>'statement',
   p->>'summary', p->>'description', p->>'content', p->>'body',
   p->>'decision', p->>'rationale', p->>'aliases', p->>'code', p->>'affected_terms')
$$;

CREATE TABLE IF NOT EXISTS graph_entity_embeddings (
 entity_id text NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
 model_id text NOT NULL,
 content_hash text NOT NULL,
 embedding vector(768) NOT NULL,
 indexed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(entity_id, model_id)
);
ALTER TABLE graph_entity_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_entity_embeddings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS graph_embeddings_visible_entity ON graph_entity_embeddings;
CREATE POLICY graph_embeddings_visible_entity ON graph_entity_embeddings
 USING (EXISTS (SELECT 1 FROM graph_entities g WHERE g.id = entity_id))
 WITH CHECK (EXISTS (SELECT 1 FROM graph_entities g WHERE g.id = entity_id));
-- Exact cosine ranking intentionally preserves ACL-filtered recall at current
-- Graph size. Add ANN only after measuring its recall under the same RLS policy.
