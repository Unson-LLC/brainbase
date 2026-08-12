CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS canonical_tasks_title_trgm_idx
    ON canonical_tasks USING GIN (title gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS canonical_tasks_search_cursor_idx
    ON canonical_tasks (created_at DESC, id DESC);
