#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="brainbase-project-provisioning-it-$$"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --rm \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=brainbase \
  -v "$REPO_ROOT:/workspace:ro" \
  postgres:16 >/dev/null

for _ in {1..30}; do
  if docker exec "$CONTAINER_NAME" psql -X -Atq -U postgres -d brainbase -c 'SELECT 1' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER_NAME" psql -X -Atq -U postgres -d brainbase -c 'SELECT 1' >/dev/null

PSQL=(docker exec -i "$CONTAINER_NAME" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d brainbase)
"${PSQL[@]}" -c 'CREATE ROLE brainbase_app NOLOGIN;' >/dev/null
"${PSQL[@]}" -f /workspace/server/sql/info-ssot-schema.sql >/dev/null
"${PSQL[@]}" -c "INSERT INTO projects(id,code,name,organization_id) VALUES ('it_a','it-a','IT A','org_a'),('it_b','it-b','IT B','org_b') ON CONFLICT DO NOTHING; INSERT INTO graph_entities(id,entity_type,project_id,payload,role_min,sensitivity,lifecycle_status,version) VALUES ('integration-graph-same','project','it_a','{\"name\":\"Same Project\",\"catalog_project_id\":\"integration-graph-same\",\"catalog_version\":1,\"source_ref\":\"project-catalog:integration-graph-same@1\"}','member','internal','active',2), ('integration-graph-other','project','it_b','{\"name\":\"Other Secret\",\"catalog_project_id\":\"integration-graph-other\",\"catalog_version\":1,\"source_ref\":\"project-catalog:integration-graph-other@1\"}','member','internal','active',3)" >/dev/null
"${PSQL[@]}" --single-transaction \
  -f /workspace/server/sql/project-provisioning-schema.sql \
  -f /workspace/server/sql/info-ssot-rls.sql \
  -f /workspace/server/sql/info-ssot-readback.sql >/tmp/project-provisioning-postgres-integration.log

"${PSQL[@]}" <<'SQL' >/dev/null
CREATE ROLE brainbase_project_it NOLOGIN;
CREATE ROLE brainbase_project_unprivileged NOLOGIN;
GRANT USAGE ON SCHEMA public TO brainbase_project_it;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO brainbase_project_it;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO brainbase_project_it;
GRANT EXECUTE ON FUNCTION project_code_collision_sources(text,text), project_graph_identity_probe(text), claim_project_code(text,text) TO brainbase_project_it;
REVOKE ALL ON project_code_claims FROM brainbase_project_it;
SQL

if ! "${PSQL[@]}" -c "SELECT has_function_privilege('brainbase_app', 'project_graph_identity_probe(text)', 'EXECUTE')" | grep -Fxq t; then
  echo 'brainbase_app is missing project_graph_identity_probe EXECUTE privilege' >&2
  exit 1
fi

if "${PSQL[@]}" -c "SET ROLE brainbase_project_unprivileged; SELECT claim_project_code('forbidden','org_a')" >/dev/null 2>&1; then
  echo 'unprivileged role unexpectedly executed claim_project_code' >&2
  exit 1
fi

if "${PSQL[@]}" -c "SET ROLE brainbase_project_unprivileged; SELECT * FROM project_graph_identity_probe('forbidden')" >/dev/null 2>&1; then
  echo 'unprivileged role unexpectedly executed project_graph_identity_probe' >&2
  exit 1
fi
if "${PSQL[@]}" -c "SET ROLE brainbase_project_it; SELECT * FROM project_graph_identity_probe('forbidden')" >/dev/null 2>&1; then
  echo 'graph identity probe unexpectedly ran without app.organization_id' >&2
  exit 1
fi

"${PSQL[@]}" --single-transaction \
  -c "SET ROLE brainbase_project_it" \
  -f /workspace/server/sql/info-ssot-negative-smoke.sql >>/tmp/project-provisioning-postgres-integration.log

"${PSQL[@]}" <<'SQL' >/dev/null
SET ROLE brainbase_project_it;
SELECT set_config('app.organization_id','org_a',false);
INSERT INTO project_registry(project_code,organization_id,display_name,kind,catalog_version,organization_entity_id,owner_person_id)
VALUES ('integration-project','org_a','Integration Project','internal',1,'org_a','person_a');
SELECT claim_project_code('integration-project','org_a');
SELECT set_config('app.organization_id','org_a',false);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM project_code_collision_sources('integration-project','org_b')) THEN
    RAISE EXCEPTION 'sanitized global project-code collision was hidden';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM project_graph_identity_probe('integration-graph-same')
    WHERE scope_relation='same_organization' AND project_code='it-a'
      AND display_name='Same Project' AND entity_version=2
  ) THEN
    RAISE EXCEPTION 'same-organization graph identity was not returned';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM project_graph_identity_probe('integration-graph-other')
    WHERE scope_relation='other_organization' AND project_code IS NULL
      AND display_name IS NULL AND catalog_project_id IS NULL
  ) THEN
    RAISE EXCEPTION 'cross-organization graph identity details were not sanitized';
  END IF;
  PERFORM set_config('app.organization_id','org_b',false);
  IF EXISTS (SELECT 1 FROM project_registry WHERE project_code='integration-project') THEN
    RAISE EXCEPTION 'cross-organization registry row was visible';
  END IF;
  BEGIN
    PERFORM claim_project_code('integration-project','org_b');
    RAISE EXCEPTION 'cross-organization project-code claim unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;
SQL

grep -Fqx 'INFO_SSOT_READBACK_OK' /tmp/project-provisioning-postgres-integration.log
grep -Fqx 'INFO_SSOT_NEGATIVE_SMOKE_OK' /tmp/project-provisioning-postgres-integration.log
echo PROJECT_PROVISIONING_POSTGRES_INTEGRATION_OK
