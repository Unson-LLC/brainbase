#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { Pool } from 'pg';
import { ulid } from 'ulid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const dbUrl = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL || '';
if (!dbUrl) {
  console.error('INFO_SSOT_DATABASE_URL is not set');
  process.exit(1);
}

const detectBrainbaseRoot = () => {
  if (process.env.BRAINBASE_ROOT) return process.env.BRAINBASE_ROOT;
  const repoRoot = path.resolve(__dirname, '..');
  if (repoRoot.includes('.worktrees')) {
    const match = repoRoot.match(/(.+)\/\.worktrees\//);
    if (match) return match[1];
  }
  return path.join(repoRoot, 'data');
};

const BRAINBASE_ROOT = detectBrainbaseRoot();
const CODEX_ROOT = path.join(BRAINBASE_ROOT, '_codex');

const loadYaml = async (filePath) => {
  const content = await fs.readFile(filePath, 'utf-8');
  return yaml.load(content);
};

const roleFromText = (text) => {
  const value = (text || '').toLowerCase();
  if (value.includes('ceo') || value.includes('cto') || value.includes('代表') || value.includes('founder')) {
    return 'ceo';
  }
  if (value.includes('gm')) {
    return 'gm';
  }
  return 'member';
};

const clearanceForRole = (role) => {
  return role === 'member'
    ? ['internal', 'restricted']
    : ['internal', 'restricted', 'finance', 'hr', 'contract'];
};

const projectExists = async (projectCode) => {
  try {
    const stat = await fs.stat(path.join(CODEX_ROOT, 'projects', projectCode));
    return stat.isDirectory();
  } catch (error) {
    return false;
  }
};

const pool = new Pool({ connectionString: dbUrl });

const main = async () => {
  const membersPath = path.join(CODEX_ROOT, 'common', 'meta', 'slack', 'members.yml');
  const workspacesPath = path.join(CODEX_ROOT, 'common', 'meta', 'slack', 'workspaces.yml');
  const membersData = await loadYaml(membersPath);
  const workspacesData = await loadYaml(workspacesPath);

  const members = membersData?.members || [];
  const workspaceMap = workspacesData?.workspaces || {};

  const workspaceIdByName = new Map(
    Object.entries(workspaceMap).map(([name, data]) => [name, data?.id || null])
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.role', 'ceo', true)`);
    await client.query(`SELECT set_config('app.project_codes', '', true)`);
    await client.query(`SELECT set_config('app.clearance', 'internal,restricted,finance,hr,contract', true)`);

    for (const member of members) {
      if (member?.status === 'inactive') continue;
      const slackWorkspaceId = workspaceIdByName.get(member.workspace);
      if (!slackWorkspaceId) {
        console.warn(`[skip] workspace id missing: ${member.workspace}`);
        continue;
      }
      const slackUserId = member.slack_id;
      if (!slackUserId) continue;

      const role = roleFromText(member.role);
      const clearance = clearanceForRole(role);

      let projectCodes = [];
      if (Array.isArray(member.projects) && member.projects.length > 0) {
        projectCodes = member.projects.map(p => p?.name).filter(Boolean);
      } else if (member.workspace && await projectExists(member.workspace)) {
        projectCodes = [member.workspace];
      }

      const personName = member.brainbase_name || member.person_id || member.slack_name || slackUserId;

      let personId = null;
      const existing = await client.query(
        'SELECT id FROM people WHERE name = $1 LIMIT 1',
        [personName]
      );
      if (existing.rows.length > 0) {
        personId = existing.rows[0].id;
      } else {
        personId = `per_${ulid()}`;
        if (!dryRun) {
          await client.query(
            'INSERT INTO people (id, name, status) VALUES ($1, $2, $3)',
            [personId, personName, 'active']
          );
        }
      }

      if (!dryRun) {
        await client.query(
          `INSERT INTO graph_entities (
              id,
              entity_type,
              project_id,
              payload,
              role_min,
              sensitivity,
              created_at,
              updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
            ON CONFLICT (id)
            DO UPDATE SET
              payload = EXCLUDED.payload,
              updated_at = NOW()`,
          [
            personId,
            'person',
            null,
            JSON.stringify({
              name: personName,
              slack_user_id: slackUserId,
              slack_workspace_id: slackWorkspaceId
            }),
            'member',
            'internal'
          ]
        );

        await client.query(
          `INSERT INTO auth_grants (
              id,
              person_id,
              person_name,
              slack_user_id,
              slack_workspace_id,
              role,
              project_codes,
              clearance,
              active,
              created_at,
              updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW(),NOW())
            ON CONFLICT (slack_user_id, slack_workspace_id)
            DO UPDATE SET
              person_id = EXCLUDED.person_id,
              person_name = EXCLUDED.person_name,
              role = EXCLUDED.role,
              project_codes = EXCLUDED.project_codes,
              clearance = EXCLUDED.clearance,
              active = true,
              updated_at = NOW()`,
          [
            `grt_${ulid()}`,
            personId,
            personName,
            slackUserId,
            slackWorkspaceId,
            role,
            projectCodes,
            clearance
          ]
        );
      }

      console.log(`[sync] ${personName} (${slackUserId}) role=${role} projects=${projectCodes.join(',') || '-'}`);
    }

    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

main()
  .then(() => {
    console.log('slack auth sync complete');
    pool.end();
  })
  .catch((error) => {
    console.error(error);
    pool.end();
    process.exit(1);
  });
