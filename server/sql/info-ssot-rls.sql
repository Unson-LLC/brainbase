-- Graph entity visibility for GET /api/info/graph/entities.
--
-- The visibility predicate lives only in policy info_graph_entities_select.
-- Application SQL must not copy it. A second copy next to RLS left the
-- non-inlined function in the plan (estimate 52 rows, actual 6702).
--
-- public.app_foundation_row_visible is only the role and clearance check.
-- PostgreSQL does not inline a SQL function whose body contains a subquery,
-- even after SET search_path is removed. Membership stays in the policy so
-- the planner can see it, and the function body stays a scalar expression
-- so the role check is inlined. The policy is the only caller.
--
-- COST 1 keeps each function cheap enough to inline. A row-count hint is
-- rejected on a function that does not return a set, so these boolean and
-- scalar helpers omit that hint. A set-returning signature would block
-- replacement of the boolean policy function and the inlining that removes
-- it from the plan. The functions are not marked leak-proof.
-- Names inside the functions are schema-qualified, so SET search_path is omitted.

CREATE OR REPLACE FUNCTION public.app_role_rank(role text)
RETURNS integer
LANGUAGE sql
STABLE
COST 1
AS $body$
  SELECT CASE pg_catalog.lower(COALESCE(role, ''::text))
    WHEN 'member' THEN 1
    WHEN 'gm' THEN 2
    WHEN 'ceo' THEN 3
    ELSE 0
  END;
$body$;

CREATE OR REPLACE FUNCTION public.app_setting_array(setting text)
RETURNS text[]
LANGUAGE sql
STABLE
COST 1
AS $body$
  SELECT CASE
    WHEN pg_catalog.current_setting(setting, true) IS NULL
      OR pg_catalog.current_setting(setting, true) = ''::text
    THEN ARRAY[]::text[]
    ELSE pg_catalog.string_to_array(pg_catalog.current_setting(setting, true), ','::text)
  END;
$body$;

CREATE OR REPLACE FUNCTION public.app_current_role_rank()
RETURNS integer
LANGUAGE sql
STABLE
COST 1
AS $body$
  SELECT public.app_role_rank(pg_catalog.current_setting('app.role', true));
$body$;

CREATE OR REPLACE FUNCTION public.app_project_codes()
RETURNS text[]
LANGUAGE sql
STABLE
COST 1
AS $body$
  SELECT public.app_setting_array('app.project_codes');
$body$;

CREATE OR REPLACE FUNCTION public.app_clearance()
RETURNS text[]
LANGUAGE sql
STABLE
COST 1
AS $body$
  SELECT public.app_setting_array('app.clearance');
$body$;

CREATE OR REPLACE FUNCTION public.app_foundation_row_visible(
  entity_id text,
  entity_type text,
  project_id text,
  role_min text,
  sensitivity text
)
RETURNS boolean
LANGUAGE sql
STABLE
COST 1
AS $body$
  SELECT public.app_current_role_rank() >= public.app_role_rank(role_min)
    AND sensitivity = ANY(public.app_clearance());
$body$;

ALTER TABLE public.graph_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.graph_entities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS info_graph_entities_select ON public.graph_entities;
CREATE POLICY info_graph_entities_select ON public.graph_entities
  FOR SELECT
  USING (
    public.app_foundation_row_visible(
      graph_entities.id,
      graph_entities.entity_type,
      graph_entities.project_id,
      graph_entities.role_min,
      graph_entities.sensitivity
    )
    AND (
      (
        graph_entities.project_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.projects AS project
          WHERE project.id = graph_entities.project_id
            AND project.code = ANY(public.app_project_codes())
        )
      )
      OR (
        graph_entities.entity_type = 'person'
        AND EXISTS (
          SELECT 1
          FROM public.graph_edges AS membership
          JOIN public.projects AS project ON project.id = membership.project_id
          WHERE membership.from_id = graph_entities.id
            AND membership.rel_type = 'member_of'
            AND membership.lifecycle_status = 'active'
            AND public.app_foundation_row_visible(
              membership.from_id,
              'person',
              membership.project_id,
              membership.role_min,
              membership.sensitivity
            )
            AND project.code = ANY(public.app_project_codes())
        )
      )
    )
  );
