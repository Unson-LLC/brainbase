-- Run this file outside a transaction.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- scripts/info-ssot-apply.sh invokes it without --single-transaction.

CREATE INDEX CONCURRENTLY IF NOT EXISTS graph_entities_updated_at_desc_idx
  ON public.graph_entities (updated_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS graph_edges_member_of_active_from_id_idx
  ON public.graph_edges (from_id)
  WHERE rel_type = 'member_of'
    AND lifecycle_status = 'active';
