#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { Pool } from 'pg';
import { ulid } from 'ulid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

const dbUrl = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL || '';
const GLOBAL_PROJECT_CODE = process.env.INFO_SSOT_GLOBAL_PROJECT || 'unson';
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

const normalizeToken = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const hashId = (prefix, value) => {
  const digest = crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
  return `${prefix}_${digest}`;
};

const parseFrontmatter = (content) => {
  if (!content.startsWith('---')) {
    return { data: {}, body: content };
  }
  const marker = '\n---';
  const end = content.indexOf(marker, 3);
  if (end === -1) {
    return { data: {}, body: content };
  }
  const raw = content.slice(3, end).trim();
  let data = {};
  try {
    data = yaml.load(raw) || {};
  } catch (error) {
    data = {};
  }
  const body = content.slice(end + marker.length).trimStart();
  return { data, body };
};

const extractTitle = (body, fallback) => {
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)/);
    if (match) return match[1].trim();
  }
  return fallback;
};

const classifyDoc = (relPath) => {
  const lower = relPath.toLowerCase();
  const base = path.basename(lower);
  if (lower.includes('/contracts/') || base.includes('contract') || base.includes('agreement')) {
    return { kind: 'contract', sensitivity: 'contract', roleMin: 'ceo' };
  }
  if (lower.includes('/finance') || base.includes('finance')) {
    return { kind: 'finance', sensitivity: 'finance', roleMin: 'ceo' };
  }
  if (lower.includes('/hr') || base.includes('hr')) {
    return { kind: 'hr', sensitivity: 'hr', roleMin: 'ceo' };
  }
  if (base.startsWith('01_strategy')) return { kind: 'strategy', sensitivity: 'internal', roleMin: 'member' };
  if (base.startsWith('02_offer')) return { kind: 'offer', sensitivity: 'internal', roleMin: 'member' };
  if (base.startsWith('03_sales_ops')) return { kind: 'sales_ops', sensitivity: 'internal', roleMin: 'member' };
  if (base.startsWith('04_delivery')) return { kind: 'delivery', sensitivity: 'internal', roleMin: 'member' };
  if (base.startsWith('05_kpi')) return { kind: 'kpi', sensitivity: 'internal', roleMin: 'member' };
  if (lower.includes('/decisions/')) return { kind: 'decision_record', sensitivity: 'internal', roleMin: 'gm' };
  return { kind: 'document', sensitivity: 'internal', roleMin: 'member' };
};

const listProjectDirs = async (projectsRoot) => {
  const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const full = path.join(projectsRoot, entry.name);
    const stat = await fs.lstat(full);
    if (stat.isSymbolicLink()) continue;
    dirs.push({ name: entry.name, path: full });
  }
  return dirs;
};

const collectMarkdownFiles = async (rootDir, options = {}) => {
  const results = [];
  const stack = [rootDir];
  const skipDirs = new Set(options.skipDirs || []);
  while (stack.length) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '_legacy') continue;
        if (skipDirs.has(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
  }
  return results;
};

const normalizeProjectCode = (value, codeMap) => {
  const token = normalizeToken(value);
  if (!token) return null;
  return codeMap.get(token) || null;
};

const pickProjectCode = (data, projectCodeMap) => {
  const candidates = [];
  if (data && data.project_id) candidates.push(data.project_id);
  if (data && data.project) candidates.push(data.project);
  if (data && Array.isArray(data.projects)) candidates.push(...data.projects);
  for (const candidate of candidates) {
    const code = normalizeProjectCode(candidate, projectCodeMap);
    if (code) return code;
  }
  return null;
};

const pool = new Pool({ connectionString: dbUrl });

const main = async () => {
  const projectsRoot = path.join(CODEX_ROOT, 'projects');
  const peopleRoot = path.join(CODEX_ROOT, 'common', 'meta', 'people');
  const orgsRoot = path.join(CODEX_ROOT, 'common', 'meta', 'orgs');

  const projectDirs = await listProjectDirs(projectsRoot);

  const projectRecords = new Map();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const project of projectDirs) {
      const projectMd = path.join(project.path, 'project.md');
      let projectData = {};
      try {
        const content = await fs.readFile(projectMd, 'utf-8');
        projectData = parseFrontmatter(content).data || {};
      } catch (error) {
        projectData = {};
      }

      const code = String(projectData.project_id || project.name).trim();
      const name = String(projectData.name || project.name).trim();
      const existing = await client.query('SELECT id FROM projects WHERE code = $1 LIMIT 1', [code]);
      let projectId = null;
      if (existing.rows.length) {
        projectId = existing.rows[0].id;
      } else {
        projectId = `prj_${ulid()}`;
        if (!dryRun) {
          await client.query('INSERT INTO projects (id, code, name) VALUES ($1,$2,$3)', [projectId, code, name]);
        }
      }
      projectRecords.set(code, { id: projectId, name, code, path: project.path });

      console.log(`[project] ${code} (${projectId})`);
    }

    const projectCodeMap = new Map();
    for (const code of projectRecords.keys()) {
      projectCodeMap.set(normalizeToken(code), code);
    }
    projectCodeMap.set('techknight', projectCodeMap.get('techknight') || 'techknight');
    projectCodeMap.set('salestailor', projectCodeMap.get('salestailor') || 'salestailor');
    projectCodeMap.set('unson', projectCodeMap.get('unson') || 'unson');
    projectCodeMap.set('unsonos', projectCodeMap.get('unsonos') || 'unson-os');
    projectCodeMap.set('baao', projectCodeMap.get('baao') || 'baao');
    projectCodeMap.set('brainbase', projectCodeMap.get('brainbase') || 'brainbase');
    projectCodeMap.set('zeims', projectCodeMap.get('zeims') || 'zeims');

    const projectCodes = [...projectRecords.keys()].join(',');
    await client.query(`SELECT set_config('app.role', 'ceo', false)`);
    await client.query(`SELECT set_config('app.project_codes', $1, false)`, [projectCodes]);
    await client.query(`SELECT set_config('app.clearance', 'internal,restricted,finance,hr,contract', false)`);

    const rlsSettings = await client.query(
      `SELECT current_setting('app.role', true) AS role,
              current_setting('app.project_codes', true) AS projects,
              current_setting('app.clearance', true) AS clearance`
    );
    const settingsRow = rlsSettings.rows[0] || {};
    console.log(`[rls] role=${settingsRow.role || '-'} projects=${settingsRow.projects || '-'} clearance=${settingsRow.clearance || '-'}`);

    if (!dryRun) {
      for (const project of projectRecords.values()) {
        await client.query(
          `INSERT INTO graph_entities (id, entity_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
           ON CONFLICT (id)
           DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
          [
            project.id,
            'project',
            project.id,
            JSON.stringify({ code: project.code, name: project.name }),
            'member',
            'internal'
          ]
        );
      }
    }

    const peopleEntries = await fs.readdir(peopleRoot, { withFileTypes: true });
    const peopleMap = new Map();

    for (const entry of peopleEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const filePath = path.join(peopleRoot, entry.name);
      const content = await fs.readFile(filePath, 'utf-8');
      const { data, body } = parseFrontmatter(content);
      const name = String(data.name || '').trim();
      if (!name) continue;

      const key = String(data.person_id || normalizeToken(name) || entry.name).trim();
      const existing = peopleMap.get(key) || {
        name,
        aliases: new Set(),
        projects: new Set(),
        orgs: new Set(),
        sources: new Set(),
        rawIds: new Set()
      };

      existing.name = name || existing.name;
      if (Array.isArray(data.aliases)) {
        data.aliases.forEach((alias) => existing.aliases.add(String(alias)));
      }
      if (Array.isArray(data.projects)) {
        data.projects.forEach((proj) => existing.projects.add(String(proj)));
      }
      if (Array.isArray(data.orgs)) {
        data.orgs.forEach((org) => existing.orgs.add(String(org)));
      }
      existing.sources.add(path.relative(CODEX_ROOT, filePath));
      if (data.person_id) existing.rawIds.add(String(data.person_id));

      peopleMap.set(key, existing);
    }

    for (const person of peopleMap.values()) {
      const existing = await client.query('SELECT id FROM people WHERE name = $1 LIMIT 1', [person.name]);
      let personId = null;
      if (existing.rows.length) {
        personId = existing.rows[0].id;
      } else {
        personId = `per_${ulid()}`;
        if (!dryRun) {
          await client.query('INSERT INTO people (id, name, status) VALUES ($1,$2,$3)', [personId, person.name, 'active']);
        }
      }

      const projectCodesList = [...person.projects]
        .map((proj) => normalizeProjectCode(proj, projectCodeMap))
        .filter(Boolean);
      const personPayload = JSON.stringify({
        name: person.name,
        aliases: [...person.aliases],
        projects: projectCodesList,
        orgs: [...person.orgs],
        sources: [...person.sources],
        source_ids: [...person.rawIds]
      });

      if (!dryRun) {
        await client.query(
          `INSERT INTO graph_entities (id, entity_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
           ON CONFLICT (id)
           DO NOTHING`,
          [
            personId,
            'person',
            null,
            personPayload,
            'member',
            'internal'
          ]
        );
      }

      for (const code of projectCodesList) {
        const project = projectRecords.get(code);
        if (!project) continue;
        if (!dryRun) {
          await client.query(
            `INSERT INTO graph_edges (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
             ON CONFLICT (from_id, to_id, rel_type)
             DO UPDATE SET updated_at = NOW()`,
            [
              `edg_${ulid()}`,
              personId,
              project.id,
              'member_of',
              project.id,
              JSON.stringify({}),
              'member',
              'internal'
            ]
          );
        }
      }

      if (!dryRun && projectCodesList.length > 0) {
        await client.query(
          `UPDATE graph_entities
             SET payload = $2,
                 updated_at = NOW()
           WHERE id = $1`,
          [personId, personPayload]
        );
      }

      console.log(`[person] ${person.name} (${personId}) projects=${projectCodesList.join(',') || '-'}`);
    }

    try {
      const orgEntries = await fs.readdir(orgsRoot, { withFileTypes: true });
      for (const entry of orgEntries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const filePath = path.join(orgsRoot, entry.name);
        const content = await fs.readFile(filePath, 'utf-8');
        const { data, body } = parseFrontmatter(content);
        const name = String(data.name || '').trim();
        if (!name) continue;
        const orgIdRaw = String(data.org_id || normalizeToken(name) || entry.name).trim();
        const orgId = `org_${normalizeToken(orgIdRaw) || hashId('org', filePath).slice(4)}`;

        const projectCode = normalizeProjectCode(data.org_id || name, projectCodeMap);
        const project = projectCode ? projectRecords.get(projectCode) : projectRecords.get('unson');
        if (!project) continue;

        if (!dryRun) {
          await client.query(
            `INSERT INTO graph_entities (id, entity_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
             ON CONFLICT (id)
             DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
            [
              orgId,
              'org',
              project.id,
              JSON.stringify({
                name,
                org_id: data.org_id || null,
                aliases: Array.isArray(data.aliases) ? data.aliases : [],
                type: data.type || null,
                source: path.relative(CODEX_ROOT, filePath)
              }),
              'member',
              'internal'
            ]
          );
        }

        console.log(`[org] ${name} (${orgId}) project=${project.code}`);
      }
    } catch (error) {
      // orgs folder may not exist in older structures
    }

    const upsertDocument = async (doc, project, rootLabel) => {
      const { relPath, title, classification } = doc;
      const docId = hashId('doc', relPath);

      if (dryRun) return;

      await client.query(
        `INSERT INTO graph_entities (id, entity_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
         ON CONFLICT (id)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
        [
          docId,
          'document',
          project.id,
          JSON.stringify({
            path: relPath,
            title,
            kind: classification.kind,
            source: 'codex',
            root: rootLabel
          }),
          classification.roleMin,
          classification.sensitivity
        ]
      );

      await client.query(
        `INSERT INTO graph_edges (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
         ON CONFLICT (from_id, to_id, rel_type)
         DO UPDATE SET updated_at = NOW()`,
        [
          `edg_${ulid()}`,
          docId,
          project.id,
          'belongs_to_project',
          project.id,
          JSON.stringify({}),
          classification.roleMin,
          classification.sensitivity
        ]
      );
    };

    const ingestDocs = async (rootDir, { projectFallback, rootLabel, skipDirs = [] }) => {
      const markdownFiles = await collectMarkdownFiles(rootDir, { skipDirs });
      let count = 0;
      for (const filePath of markdownFiles) {
        const relPath = path.relative(CODEX_ROOT, filePath).replace(/\\/g, '/');
        const content = await fs.readFile(filePath, 'utf-8');
        const { data, body } = parseFrontmatter(content);
        const title = String(data.title || extractTitle(body, path.basename(filePath))).trim();
        const classification = classifyDoc(relPath);
        const projectCode = pickProjectCode(data, projectCodeMap);
        const project = projectCode ? projectRecords.get(projectCode) : projectFallback;
        if (!project) continue;
        await upsertDocument({ relPath, title, classification }, project, rootLabel);
        count += 1;
      }
      return count;
    };

    for (const project of projectRecords.values()) {
      const count = await ingestDocs(project.path, { projectFallback: project, rootLabel: `projects/${project.code}` });
      console.log(`[docs] ${project.code} files=${count}`);
    }

    const globalProject = projectRecords.get(GLOBAL_PROJECT_CODE) || projectRecords.values().next().value;
    if (!globalProject) {
      throw new Error(`Global project not found: ${GLOBAL_PROJECT_CODE}`);
    }

    const sharedRoots = [
      { label: 'common', path: path.join(CODEX_ROOT, 'common'), skipDirs: ['people', 'orgs'] },
      { label: 'brand', path: path.join(CODEX_ROOT, 'brand') },
      { label: 'knowledge', path: path.join(CODEX_ROOT, 'knowledge') },
      { label: 'sns', path: path.join(CODEX_ROOT, 'sns') },
      { label: 'decisions', path: path.join(CODEX_ROOT, 'decisions') },
      { label: 'sources', path: path.join(CODEX_ROOT, 'sources') }
    ];

    for (const root of sharedRoots) {
      try {
        await fs.access(root.path);
      } catch (error) {
        continue;
      }
      const count = await ingestDocs(root.path, { projectFallback: globalProject, rootLabel: root.label, skipDirs: root.skipDirs || [] });
      console.log(`[docs] ${root.label} files=${count}`);
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
    console.log('codex migration complete');
    pool.end();
  })
  .catch((error) => {
    console.error(error);
    pool.end();
    process.exit(1);
  });
