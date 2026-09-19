# Runbook: Update auth_grants.project_codes

Use this when a user needs access to additional projects.

## Preconditions

- Confirm the target project identity and Registry binding. `/api/config` local topology is not proof of organization membership or authenticated project access.
- Confirm the target user has exactly one active grant row unless intentionally managing multiple grants.
- Do not print database secrets in logs or chat.
- Load the effective local Brainbase connection from
  `~/.brainbase/runtime-env/brainbase-production.env` or the active launchd
  environment. A repository `.env` is not proof of the running process's
  connection.
- Before mutation, read back the database identity and expected tables. Do not
  confuse the Lightsail Brainbase SSOT database with a separate Docker
  PostgreSQL used by NocoDB.

## Project-code migration boundary

Changing a project or app code is not an entity-only rename. Reconcile the
Graph entity and Registry binding, `auth_grants.project_codes`, token/JWT
refresh, authenticated Project Catalog API/MCP scopes, and any owning
capability or Skill reference. `/api/config` is local runtime topology, not an
organization access source. The old browser selector is retired; do not
preserve aliases for it. Any alias used by an active API/MCP contract requires
an explicit owner and removal condition.

## Example Update

```bash
set -a
source /Users/ksato/.brainbase/runtime-env/brainbase-production.env >/dev/null 2>&1
set +a

node --input-type=module - <<'NODE'
import pg from 'pg';

const additions = ['mana', 'fx', 'keiba', 'senpainurse'];
const slackUserId = 'U07LNUP582X';
const url = process.env.INFO_SSOT_DATABASE_URL || process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString: url });

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      `SELECT project_codes FROM auth_grants WHERE slack_user_id = $1 AND active = true FOR UPDATE`,
      [slackUserId]
    );
    if (before.rowCount !== 1) {
      throw new Error(`Expected exactly one active grant row, got ${before.rowCount}`);
    }
    const current = before.rows[0].project_codes || [];
    const merged = Array.from(new Set([...current, ...additions]));
    const updated = await client.query(
      `UPDATE auth_grants
       SET project_codes = $2,
           updated_at = now()
       WHERE slack_user_id = $1 AND active = true
       RETURNING person_id, person_name, slack_user_id, role, project_codes, active`,
      [slackUserId, merged]
    );
    await client.query('COMMIT');
    console.log(JSON.stringify(updated.rows[0], null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
NODE
```

## Post-Update Verification

1. Re-read `auth_grants.project_codes`.
2. Issue or refresh a token through the supported client flow, then verify its
   `access.projectCodes` claim where available.
3. Read the authenticated Project Catalog API and `brainbase_projects` MCP
   result with the appropriate token. Confirm status, effective scope, and
   project inclusion independently; do not use the retired browser selector
   as a verification surface.
