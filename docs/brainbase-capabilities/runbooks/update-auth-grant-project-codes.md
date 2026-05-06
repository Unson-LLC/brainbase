# Runbook: Update auth_grants.project_codes

Use this when a user needs access to additional projects.

## Preconditions

- Confirm the target projects exist in `/api/config`.
- Confirm the target user has exactly one active grant row unless intentionally managing multiple grants.
- Do not print database secrets in logs or chat.

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
2. Run `getSessionSelectableProjects(projectCodes)` with the new codes.
3. Refresh browser auth so local JWT/localStorage access is not stale.
