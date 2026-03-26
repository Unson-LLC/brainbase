import pg from 'pg';
import { readFileSync } from 'fs';
import jsYaml from 'js-yaml';
const parse = (str) => jsYaml.load(str);

const DB_URL = 'postgresql://localhost:5432/brainbase_ssot';
const MEMBERS_PATH = '/Users/ksato/workspace/common/meta/slack/members.yml';

// Role mapping: members.yml role → auth_grants role (member/gm/ceo)
function deriveRole(ymlRole) {
  const r = (ymlRole || '').toLowerCase();
  if (r.includes('ceo') || r.includes('cto') || r.includes('cso') || r.includes('代表')) return 'ceo';
  if (r.includes('gm') || r.includes('マネジメント')) return 'gm';
  return 'member';
}

// Clearance based on role
function deriveClearance(role, ymlRole) {
  if (role === 'ceo') return ['internal', 'restricted', 'finance', 'hr', 'contract'];
  if (role === 'gm') return ['internal', 'restricted'];
  const r = (ymlRole || '').toLowerCase();
  if (r.includes('税理士') || r.includes('経理')) return ['internal', 'finance'];
  if (r.includes('弁護士')) return ['internal', 'contract'];
  return ['internal'];
}

// Derive project codes from workspace + explicit projects
function deriveProjectCodes(member) {
  const codes = new Set();
  // Workspace implies project access
  const wsMap = { salestailor: 'salestailor', techknight: 'tech-knight', unson: 'unson', baao: 'baao' };
  if (wsMap[member.workspace]) codes.add(wsMap[member.workspace]);
  // Explicit projects
  if (member.projects) {
    for (const p of member.projects) {
      const name = typeof p === 'object' ? p.name : p;
      codes.add(name);
    }
  }
  return [...codes];
}

const data = parse(readFileSync(MEMBERS_PATH, 'utf-8'));
const pool = new pg.Pool({ connectionString: DB_URL });

// Group by person_id to merge across workspaces
const personMap = new Map();
for (const m of data.members) {
  if (m.status === 'inactive') continue;
  const existing = personMap.get(m.person_id);
  if (existing) {
    // Merge: higher role wins, merge projects and slack IDs
    const newRole = deriveRole(m.role);
    const existRole = deriveRole(existing.role);
    const roleRank = { member: 1, gm: 2, ceo: 3 };
    if ((roleRank[newRole] || 0) > (roleRank[existRole] || 0)) {
      existing.role = m.role;
    }
    existing.slackIds.push({ id: m.slack_id, workspace: m.workspace });
    for (const p of deriveProjectCodes(m)) existing.projectCodes.add(p);
  } else {
    personMap.set(m.person_id, {
      person_id: m.person_id,
      name: m.brainbase_name,
      role: m.role,
      slackIds: [{ id: m.slack_id, workspace: m.workspace }],
      projectCodes: new Set(deriveProjectCodes(m))
    });
  }
}

let count = 0;
for (const [personId, person] of personMap) {
  const role = deriveRole(person.role);
  const clearance = deriveClearance(role, person.role);
  const projectCodes = [...person.projectCodes];
  // CEO gets all projects
  const allProjects = ['salestailor', 'zeims', 'tech-knight', 'baao', 'unson', 'brainbase', 'dialogai', 'aitle', 'mywa', 'mana', 'senrigan', 'back_office', 'vibepro'];
  const finalProjects = role === 'ceo' ? allProjects : projectCodes;

  // Insert one row per slack ID
  for (const slack of person.slackIds) {
    await pool.query(
      `INSERT INTO auth_grants (id, person_id, person_name, slack_user_id, slack_workspace_id, role, project_codes, clearance, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       ON CONFLICT (id) DO UPDATE SET
         person_name = EXCLUDED.person_name,
         role = EXCLUDED.role,
         project_codes = EXCLUDED.project_codes,
         clearance = EXCLUDED.clearance,
         updated_at = NOW()`,
      [`grant_${personId}_${slack.workspace}`, personId, person.name, slack.id, slack.workspace, role, finalProjects, clearance]
    );
    count++;
    console.log(`  ${person.name} (${slack.workspace}) → role=${role} projects=[${finalProjects.join(',')}]`);
  }
}

const { rows } = await pool.query('SELECT count(*) FROM auth_grants WHERE active = true');
console.log(`\nInserted: ${count} grants, Total active: ${rows[0].count}`);
await pool.end();
