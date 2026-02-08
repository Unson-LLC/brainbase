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

const parseTableLine = (line) => line
  .trim()
  .replace(/^\|/, '')
  .replace(/\|$/, '')
  .split('|')
  .map((cell) => cell.trim());

const isSeparatorRow = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());

const parseMarkdownTables = (content) => {
  const lines = content.split(/\r?\n/);
  const tables = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].trim().startsWith('|')) continue;
    if (!isSeparatorRow(lines[i + 1] || '')) continue;
    const headers = parseTableLine(lines[i]);
    const rows = [];
    let cursor = i + 2;
    while (cursor < lines.length && lines[cursor].trim().startsWith('|')) {
      const row = parseTableLine(lines[cursor]);
      if (row.length === headers.length) rows.push(row);
      cursor += 1;
    }
    tables.push({ headers, rows });
    i = cursor - 1;
  }
  return tables;
};

const splitStorySections = (content) => {
  const regex = /^####\s+([A-Z]\d-\d{3}):\s*(.+)$/gm;
  const sections = [];
  let match;
  let cursor = 0;
  let current = null;
  while ((match = regex.exec(content)) !== null) {
    if (current) {
      current.body = content.slice(cursor, match.index).trim();
      sections.push(current);
    }
    current = { storyId: match[1], title: match[2].trim(), body: '' };
    cursor = regex.lastIndex;
  }
  if (current) {
    current.body = content.slice(cursor).trim();
    sections.push(current);
  }
  return sections;
};

const extractBeatMapBlock = (body) => {
  if (!body) return null;
  const regex = /```(?:beat_map|yaml\s+beat_map|yml\s+beat_map)\s*\n([\s\S]*?)\n```/i;
  const match = body.match(regex);
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw) return null;
  try {
    const parsed = yaml.load(raw);
    return { raw, parsed };
  } catch (error) {
    return { raw, parsed: null, error: true };
  }
};

const parseCsvLine = (line) => {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
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
      } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
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

const extractProjectCodesFromText = (text, projectCodeMap) => {
  if (!text) return [];
  const tokens = String(text)
    .split(/[,\s/]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const codes = tokens
    .map((token) => normalizeProjectCode(token, projectCodeMap))
    .filter(Boolean);
  return [...new Set(codes)];
};

const inferProjectCodeFromPath = (relPath, projectCodeMap) => {
  const lower = relPath.toLowerCase();
  for (const [token, code] of projectCodeMap.entries()) {
    if (lower.includes(token)) return code;
  }
  return null;
};

const extractProjectCodesFromRefs = (refs, projectCodeMap) => {
  if (!Array.isArray(refs)) return [];
  const codes = new Set();
  for (const ref of refs) {
    if (!ref) continue;
    extractProjectCodesFromText(ref, projectCodeMap).forEach((code) => codes.add(code));
    const match = String(ref).match(/projects\/([a-z0-9_-]+)/i);
    if (match) {
      const code = normalizeProjectCode(match[1], projectCodeMap);
      if (code) codes.add(code);
    }
  }
  return [...codes];
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

    const globalProject = projectRecords.get(GLOBAL_PROJECT_CODE) || projectRecords.values().next().value;
    if (!globalProject) {
      throw new Error(`Global project not found: ${GLOBAL_PROJECT_CODE}`);
    }

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
          await client.query('INSERT INTO people (id, name) VALUES ($1,$2)', [personId, person.name]);
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

    const upsertGraphEntity = async ({
      id,
      entityType,
      projectId,
      payload,
      roleMin,
      sensitivity
    }) => {
      if (dryRun) return;
      await client.query(
        `INSERT INTO graph_entities (id, entity_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
         ON CONFLICT (id)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
        [id, entityType, projectId, JSON.stringify(payload || {}), roleMin, sensitivity]
      );
    };

    const upsertGraphEdge = async ({
      fromId,
      toId,
      relType,
      projectId,
      roleMin,
      sensitivity
    }) => {
      if (dryRun) return;
      await client.query(
        `INSERT INTO graph_edges (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
         ON CONFLICT (from_id, to_id, rel_type)
         DO UPDATE SET updated_at = NOW()`,
        [`edg_${ulid()}`, fromId, toId, relType, projectId, JSON.stringify({}), roleMin, sensitivity]
      );
    };

    const ensureProject = (code) => {
      if (!code) return globalProject;
      return projectRecords.get(code) || globalProject;
    };

    const upsertBelongsToProject = async (fromId, project, roleMin, sensitivity) => {
      if (!project) return;
      await upsertGraphEdge({
        fromId,
        toId: project.id,
        relType: 'belongs_to_project',
        projectId: project.id,
        roleMin,
        sensitivity
      });
    };

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

    const ingestApps = async () => {
      const appsPath = path.join(CODEX_ROOT, 'common', 'meta', 'apps.md');
      try {
        const content = await fs.readFile(appsPath, 'utf-8');
        const tables = parseMarkdownTables(content);
        const table = tables.find((t) => t.headers.some((h) => h.includes('app_id')));
        if (!table) return;
        const headerIndex = new Map(table.headers.map((h, idx) => [h, idx]));
        for (const row of table.rows) {
          const name = row[headerIndex.get('アプリ名')] || row[0];
          const appIdRaw = row[headerIndex.get('app_id')] || normalizeToken(name);
          if (!name || !appIdRaw) continue;
          const projectText = row[headerIndex.get('所属プロジェクト')] || '';
          const orgText = row[headerIndex.get('所属組織')] || '';
          const status = row[headerIndex.get('ステータス')] || '';
          const summary = row[headerIndex.get('概要')] || '';
          const appId = `app_${normalizeToken(appIdRaw) || hashId('app', name).slice(4)}`;
          const projectCodes = extractProjectCodesFromText(projectText, projectCodeMap);
          const projects = projectCodes.length ? projectCodes.map((code) => ensureProject(code)) : [globalProject];
          await upsertGraphEntity({
            id: appId,
            entityType: 'app',
            projectId: projects[0]?.id || null,
            payload: {
              name,
              app_id: appIdRaw,
              projects: projectCodes,
              orgs: orgText ? orgText.split('/').map((item) => item.trim()).filter(Boolean) : [],
              status,
              summary,
              source: path.relative(CODEX_ROOT, appsPath)
            },
            roleMin: 'member',
            sensitivity: 'internal'
          });
          for (const project of projects) {
            await upsertBelongsToProject(appId, project, 'member', 'internal');
          }
        }
      } catch (error) {
        // apps.md may not exist
      }
    };

    const ingestBrands = async () => {
      const brandRoot = path.join(CODEX_ROOT, 'brand');
      try {
        const entries = await fs.readdir(brandRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const filePath = path.join(brandRoot, entry.name);
          const content = await fs.readFile(filePath, 'utf-8');
          const { data, body } = parseFrontmatter(content);
          const title = extractTitle(body, entry.name);
          const slug = path.basename(entry.name, '.md');
          const brandIdRaw = String(data.brand_id || slug).trim();
          const brandId = `brd_${normalizeToken(brandIdRaw) || hashId('brand', filePath).slice(4)}`;

          const projectCodes = new Set();
          const picked = pickProjectCode(data, projectCodeMap);
          if (picked) projectCodes.add(picked);
          if (Array.isArray(data.projects)) {
            data.projects
              .map((proj) => normalizeProjectCode(proj, projectCodeMap))
              .filter(Boolean)
              .forEach((code) => projectCodes.add(code));
          }
          extractProjectCodesFromText(slug.replace(/[_-]/g, ' '), projectCodeMap)
            .forEach((code) => projectCodes.add(code));

          const projects = projectCodes.size
            ? [...projectCodes].map((code) => ensureProject(code))
            : [globalProject];

          await upsertGraphEntity({
            id: brandId,
            entityType: 'brand',
            projectId: projects[0]?.id || null,
            payload: {
              title,
              brand_id: data.brand_id || null,
              projects: [...projectCodes],
              source: path.relative(CODEX_ROOT, filePath)
            },
            roleMin: 'member',
            sensitivity: 'internal'
          });

          for (const project of projects) {
            await upsertBelongsToProject(brandId, project, 'member', 'internal');
          }
        }
      } catch (error) {
        // brand folder may not exist
      }
    };

    const ingestCustomers = async () => {
      const customersRoot = path.join(CODEX_ROOT, 'common', 'meta', 'customers');
      try {
        const entries = await fs.readdir(customersRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const filePath = path.join(customersRoot, entry.name);
          const content = await fs.readFile(filePath, 'utf-8');
          const { data } = parseFrontmatter(content);
          const name = String(data.name || '').trim();
          if (!name) continue;
          const rawId = String(data.customer_id || normalizeToken(name) || entry.name).trim();
          const customerId = `cus_${normalizeToken(rawId) || hashId('customer', filePath).slice(4)}`;
          const projectCodes = Array.isArray(data.projects)
            ? data.projects.map((proj) => normalizeProjectCode(proj, projectCodeMap)).filter(Boolean)
            : [];
          const projects = projectCodes.length ? projectCodes.map((code) => ensureProject(code)) : [globalProject];
          await upsertGraphEntity({
            id: customerId,
            entityType: 'customer',
            projectId: projects[0]?.id || null,
            payload: {
              name,
              customer_id: data.customer_id || null,
              status: data.status || null,
              updated: data.updated || null,
              projects: projectCodes,
              source: path.relative(CODEX_ROOT, filePath)
            },
            roleMin: 'member',
            sensitivity: 'internal'
          });
          for (const project of projects) {
            await upsertBelongsToProject(customerId, project, 'member', 'internal');
          }
        }
      } catch (error) {
        // customers folder may not exist
      }
    };

    const ingestPartners = async () => {
      const partnersRoot = path.join(CODEX_ROOT, 'common', 'meta', 'partners');
      try {
        const entries = await fs.readdir(partnersRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const filePath = path.join(partnersRoot, entry.name);
          const content = await fs.readFile(filePath, 'utf-8');
          const { data, body } = parseFrontmatter(content);
          if (data && data.name) {
            const rawId = String(data.partner_id || normalizeToken(data.name) || entry.name).trim();
            const partnerId = `par_${normalizeToken(rawId) || hashId('partner', filePath).slice(4)}`;
            const projectCodes = Array.isArray(data.projects)
              ? data.projects.map((proj) => normalizeProjectCode(proj, projectCodeMap)).filter(Boolean)
              : [];
            const projects = projectCodes.length ? projectCodes.map((code) => ensureProject(code)) : [globalProject];
            await upsertGraphEntity({
              id: partnerId,
              entityType: 'partner',
              projectId: projects[0]?.id || null,
              payload: {
                name: data.name,
                partner_id: data.partner_id || null,
                category: data.category || null,
                status: data.status || null,
                updated: data.updated || null,
                projects: projectCodes,
                source: path.relative(CODEX_ROOT, filePath)
              },
              roleMin: 'member',
              sensitivity: 'internal'
            });
            for (const project of projects) {
              await upsertBelongsToProject(partnerId, project, 'member', 'internal');
            }
            continue;
          }
          const tables = parseMarkdownTables(body || content);
          for (const table of tables) {
            if (!table.headers.some((h) => h.includes('事務所名') || h.includes('パートナー') || h.includes('担当者'))) continue;
            const headerIndex = new Map(table.headers.map((h, idx) => [h, idx]));
            for (const row of table.rows) {
              const name = row[headerIndex.get('事務所名')] || row[headerIndex.get('会社名')] || row[1];
              if (!name) continue;
              const partnerId = `par_${hashId('partner', `${entry.name}:${name}`).slice(4)}`;
              const projectCode = inferProjectCodeFromPath(path.relative(CODEX_ROOT, filePath), projectCodeMap) || 'zeims';
              const project = ensureProject(projectCode);
              await upsertGraphEntity({
                id: partnerId,
                entityType: 'partner',
                projectId: project?.id || null,
                payload: {
                  name,
                  contact: row[headerIndex.get('担当者')] || null,
                  location: row[headerIndex.get('所在地')] || null,
                  url: row[headerIndex.get('HP')] || null,
                  status: row[headerIndex.get('アンケート')] || null,
                  source: path.relative(CODEX_ROOT, filePath)
                },
                roleMin: 'member',
                sensitivity: 'internal'
              });
              await upsertBelongsToProject(partnerId, project, 'member', 'internal');
            }
          }
        }
      } catch (error) {
        // partners folder may not exist
      }
    };

    const ingestContacts = async () => {
      const contactsRoot = path.join(CODEX_ROOT, 'common', 'meta', 'contacts', 'data');
      const seen = new Set();
      try {
        const entries = await fs.readdir(contactsRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.csv')) continue;
          const filePath = path.join(contactsRoot, entry.name);
          const content = await fs.readFile(filePath, 'utf-8');
          const lines = content.split(/\r?\n/).filter(Boolean);
          let headers = null;
          let headerIndex = null;
          for (const line of lines) {
            const row = parseCsvLine(line.replace(/^\uFEFF/, ''));
            if (row.includes('氏名')) {
              headers = row;
              headerIndex = new Map(headers.map((h, idx) => [h, idx]));
              continue;
            }
            if (!headerIndex) continue;
            if (!row.some((cell) => cell && cell.trim())) continue;
            const name = row[headerIndex.get('氏名')] || '';
            const company = row[headerIndex.get('会社名')] || '';
            if (!name && !company) continue;
            const email = row[headerIndex.get('e-mail')] || '';
            const key = normalizeToken(`${name}|${company}|${email}`);
            if (key && seen.has(key)) continue;
            if (key) seen.add(key);
            const contactId = `con_${hashId('contact', `${entry.name}:${name}:${company}:${email}`).slice(4)}`;
            await upsertGraphEntity({
              id: contactId,
              entityType: 'contact',
              projectId: globalProject.id,
              payload: {
                name,
                company,
                department: row[headerIndex.get('部署名')] || null,
                role: row[headerIndex.get('役職')] || null,
                email,
                phone: row[headerIndex.get('携帯電話')] || row[headerIndex.get('TEL直通')] || row[headerIndex.get('TEL会社')] || null,
                url: row[headerIndex.get('URL')] || null,
                exchanged_at: row[headerIndex.get('名刺交換日')] || null,
                source: path.relative(CODEX_ROOT, filePath)
              },
              roleMin: 'gm',
              sensitivity: 'restricted'
            });
            await upsertBelongsToProject(contactId, globalProject, 'gm', 'restricted');
          }
        }
      } catch (error) {
        // contacts folder may not exist
      }
    };

    const ingestContracts = async () => {
      const contractsPath = path.join(CODEX_ROOT, 'common', 'meta', 'contracts', 'index.md');
      try {
        const content = await fs.readFile(contractsPath, 'utf-8');
        const tables = parseMarkdownTables(content);
        for (const table of tables) {
          if (!table.headers.some((h) => h.includes('contract_id'))) continue;
          const headerIndex = new Map(table.headers.map((h, idx) => [h, idx]));
          for (const row of table.rows) {
            const contractIdRaw = row[headerIndex.get('contract_id')] || row[0];
            if (!contractIdRaw) continue;
            const contractId = `ctr_${normalizeToken(contractIdRaw) || hashId('contract', `${contractsPath}:${contractIdRaw}`).slice(4)}`;
            const projectText = row[headerIndex.get('プロジェクト')] || '';
            const projectCodes = extractProjectCodesFromText(projectText, projectCodeMap);
            const projects = projectCodes.length ? projectCodes.map((code) => ensureProject(code)) : [globalProject];
            await upsertGraphEntity({
              id: contractId,
              entityType: 'contract',
              projectId: projects[0]?.id || null,
              payload: {
                contract_id: contractIdRaw,
                contract_type: row[headerIndex.get('契約種別')] || null,
                counterparty: row[headerIndex.get('相手方')] || null,
                org: row[headerIndex.get('当社法人')] || null,
                project: projectText || null,
                price: row[headerIndex.get('月額/単価')] || null,
                billing_cycle: row[headerIndex.get('入金サイクル')] || row[headerIndex.get('支払サイクル')] || null,
                duration: row[headerIndex.get('契約期間')] || null,
                status: row[headerIndex.get('ステータス')] || null,
                notes: row[headerIndex.get('備考')] || null,
                source: path.relative(CODEX_ROOT, contractsPath)
              },
              roleMin: 'ceo',
              sensitivity: 'contract'
            });
            for (const project of projects) {
              await upsertBelongsToProject(contractId, project, 'ceo', 'contract');
            }
          }
        }
      } catch (error) {
        // contracts file may not exist
      }
    };

    const ingestFinancials = async () => {
      const financialsRoot = path.join(CODEX_ROOT, 'common', 'meta', 'financials');
      try {
        const entries = await fs.readdir(financialsRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const filePath = path.join(financialsRoot, entry.name);
          const content = await fs.readFile(filePath, 'utf-8');
          const { data, body } = parseFrontmatter(content);
          const title = extractTitle(body, entry.name);
          const financeId = `fin_${hashId('finance', filePath).slice(4)}`;
          await upsertGraphEntity({
            id: financeId,
            entityType: 'finance',
            projectId: globalProject.id,
            payload: {
              title,
              source: path.relative(CODEX_ROOT, filePath),
              meta: data || {}
            },
            roleMin: 'ceo',
            sensitivity: 'finance'
          });
          await upsertBelongsToProject(financeId, globalProject, 'ceo', 'finance');
        }
      } catch (error) {
        // financials folder may not exist
      }
    };

    const ingestCapital = async () => {
      const capitalFiles = [
        path.join(CODEX_ROOT, 'common', 'meta', 'capital.md'),
        path.join(CODEX_ROOT, 'common', 'meta', 'capital_assessment.md')
      ];
      for (const filePath of capitalFiles) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const { data, body } = parseFrontmatter(content);
          const title = extractTitle(body, path.basename(filePath));
          const capitalId = `cap_${hashId('capital', filePath).slice(4)}`;
          await upsertGraphEntity({
            id: capitalId,
            entityType: 'capital',
            projectId: globalProject.id,
            payload: {
              title,
              source: path.relative(CODEX_ROOT, filePath),
              meta: data || {}
            },
            roleMin: 'ceo',
            sensitivity: 'finance'
          });
          await upsertBelongsToProject(capitalId, globalProject, 'ceo', 'finance');
        } catch (error) {
          // capital file may not exist
        }
      }
    };

    const ingestStories = async () => {
      const storiesPath = path.join(CODEX_ROOT, 'common', '00_stories.md');
      const storyIdMap = new Map();
      try {
        const content = await fs.readFile(storiesPath, 'utf-8');
        const sections = splitStorySections(content);
        for (const section of sections) {
          const storyId = section.storyId;
          const title = section.title.trim();
          const entityId = `story_${normalizeToken(storyId) || hashId('story', storyId).slice(4)}`;
          const beatMap = extractBeatMapBlock(section.body || '');
          const payload = {
            story_id: storyId,
            title,
            source: path.relative(CODEX_ROOT, storiesPath)
          };
          if (beatMap) {
            payload.beat_map_raw = beatMap.raw;
            if (beatMap.parsed) {
              payload.beat_map = beatMap.parsed;
            } else {
              payload.beat_map_parse_error = true;
            }
          }
          await upsertGraphEntity({
            id: entityId,
            entityType: 'story',
            projectId: globalProject.id,
            payload,
            roleMin: 'member',
            sensitivity: 'internal'
          });
          await upsertBelongsToProject(entityId, globalProject, 'member', 'internal');
          storyIdMap.set(storyId, entityId);
        }
      } catch (error) {
        // stories file may not exist
      }
      return storyIdMap;
    };

    const ingestFrames = async () => {
      for (const project of projectRecords.values()) {
        const frameId = `frm_${normalizeToken(project.code) || hashId('frame', project.code).slice(4)}`;
        await upsertGraphEntity({
          id: frameId,
          entityType: 'frame',
          projectId: project.id,
          payload: {
            code: project.code,
            name: project.name,
            source: 'project'
          },
          roleMin: 'member',
          sensitivity: 'internal'
        });
        await upsertBelongsToProject(frameId, project, 'member', 'internal');
      }
    };

    const ingestRunLedger = async (storyIdMap) => {
      const ledgerRoot = path.join(CODEX_ROOT, 'common', 'ops', 'run_ledger');
      const ledgerPath = path.join(ledgerRoot, 'ledger.jsonl');
      let content = '';
      try {
        content = await fs.readFile(ledgerPath, 'utf-8');
      } catch (error) {
        return;
      }
      const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
      for (const line of lines) {
        let record = null;
        try {
          record = JSON.parse(line);
        } catch (error) {
          continue;
        }
        const runId = String(record.run_id || record.runId || '').trim();
        const eventId = `evt_${normalizeToken(runId) || hashId('event', line).slice(4)}`;
        const refs = []
          .concat(record.input_refs || [])
          .concat(record.output_refs || [])
          .filter(Boolean);
        const projectCodes = extractProjectCodesFromRefs(refs, projectCodeMap);
        const project = projectCodes.length ? ensureProject(projectCodes[0]) : globalProject;
        const payload = {
          run_id: runId || null,
          pipeline: record.pipeline || null,
          phase: record.phase || null,
          status: record.status || null,
          input_refs: record.input_refs || [],
          output_refs: record.output_refs || [],
          story_id: record.story_id || record.storyId || null,
          started_at: record.started_at || record.startedAt || null,
          finished_at: record.finished_at || record.finishedAt || null,
          reviewer: record.reviewer || null,
          decision: record.decision || null,
          reason: record.reason || null,
          score: record.score || null,
          model: record.model || null,
          run_group: record.run_group || record.runGroup || null,
          project_codes: projectCodes,
          source: path.relative(CODEX_ROOT, ledgerPath)
        };
        await upsertGraphEntity({
          id: eventId,
          entityType: 'event',
          projectId: project.id,
          payload,
          roleMin: 'member',
          sensitivity: 'internal'
        });
        await upsertBelongsToProject(eventId, project, 'member', 'internal');
        const storyId = payload.story_id;
        if (storyId && storyIdMap && storyIdMap.has(storyId)) {
          await upsertGraphEdge({
            fromId: eventId,
            toId: storyIdMap.get(storyId),
            relType: 'references',
            projectId: project.id,
            roleMin: 'member',
            sensitivity: 'internal'
          });
        }
      }
    };

    const ingestGlossary = async () => {
      const glossaryPath = path.join(CODEX_ROOT, 'common', 'meta', 'glossary.md');
      let count = 0;
      try {
        const content = await fs.readFile(glossaryPath, 'utf-8');
        const tables = parseMarkdownTables(content);
        for (const table of tables) {
          const headerIndex = new Map(table.headers.map((h, idx) => [h, idx]));
          const termIdx = headerIndex.get('正しい表記') ?? 1;
          const patternIdx = headerIndex.get('誤認識パターン') ?? 0;
          const contextIdx = headerIndex.get('備考') ?? 2;
          for (const row of table.rows) {
            const term = row[termIdx] || '';
            const patterns = row[patternIdx] || '';
            const context = row[contextIdx] || '';
            if (!term) continue;
            const termId = `gls_${normalizeToken(term) || hashId('glossary', term).slice(4)}`;
            await upsertGraphEntity({
              id: termId,
              entityType: 'glossary_term',
              projectId: globalProject.id,
              payload: {
                term,
                definition: patterns,
                context,
                source: path.relative(CODEX_ROOT, glossaryPath)
              },
              roleMin: 'member',
              sensitivity: 'internal'
            });
            await upsertBelongsToProject(termId, globalProject, 'member', 'internal');
            count++;
          }
        }
      } catch (error) {
        // glossary.md may not exist
      }
      console.log(`[glossary] terms=${count}`);
    };

    const ingestRaci = async () => {
      const raciRoot = path.join(CODEX_ROOT, 'common', 'meta', 'raci');
      let count = 0;
      try {
        const entries = await fs.readdir(raciRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'README.md') continue;
          const filePath = path.join(raciRoot, entry.name);
          const content = await fs.readFile(filePath, 'utf-8');
          const { data, body } = parseFrontmatter(content);
          const orgId = data.org_id || path.basename(entry.name, '.md');
          const orgName = data.name || orgId;
          const tables = parseMarkdownTables(body);
          const decisionTable = tables.find((t) => t.headers.some((h) => h.includes('領域') || h.includes('決裁')));
          if (!decisionTable) continue;
          const headerIndex = new Map(decisionTable.headers.map((h, idx) => [h, idx]));
          const domainIdx = headerIndex.get('領域') ?? 0;
          const deciderIdx = headerIndex.get('決裁者') ?? headerIndex.get('決裁') ?? 1;
          for (const row of decisionTable.rows) {
            const domain = row[domainIdx] || '';
            const decider = row[deciderIdx] || '';
            if (!domain || domain === '---') continue;
            const raciId = `rac_${normalizeToken(`${orgId}_${domain}`) || hashId('raci', `${orgId}:${domain}`).slice(4)}`;
            const projectCode = normalizeProjectCode(orgId, projectCodeMap);
            const project = projectCode ? projectRecords.get(projectCode) : globalProject;
            await upsertGraphEntity({
              id: raciId,
              entityType: 'raci_assignment',
              projectId: project?.id || globalProject.id,
              payload: {
                org_id: orgId,
                org_name: orgName,
                domain,
                responsible: decider,
                accountable: decider,
                consulted: null,
                informed: null,
                source: path.relative(CODEX_ROOT, filePath)
              },
              roleMin: 'member',
              sensitivity: 'internal'
            });
            if (project) {
              await upsertBelongsToProject(raciId, project, 'member', 'internal');
            }
            count++;
          }
        }
      } catch (error) {
        // raci folder may not exist
      }
      console.log(`[raci] assignments=${count}`);
    };

    const ingestMetaDecisions = async () => {
      const decisionsRoot = path.join(CODEX_ROOT, 'common', 'meta', 'decisions');
      let count = 0;
      try {
        const entries = await fs.readdir(decisionsRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const filePath = path.join(decisionsRoot, entry.name);
          const content = await fs.readFile(filePath, 'utf-8');
          const { data, body } = parseFrontmatter(content);
          const decisionId = data.decision_id || path.basename(entry.name, '.md');
          const title = data.title || extractTitle(body, entry.name);
          const decidedAt = data.decided_at || data.date || null;
          const decider = data.decider || data.decided_by || null;
          const projectId = data.project_id || data.project || null;
          const status = data.status || 'decided';
          const tags = Array.isArray(data.tags) ? data.tags : [];
          const projectCode = normalizeProjectCode(projectId, projectCodeMap);
          const project = projectCode ? projectRecords.get(projectCode) : globalProject;
          const entityId = `dec_${normalizeToken(decisionId) || hashId('decision', filePath).slice(4)}`;
          await upsertGraphEntity({
            id: entityId,
            entityType: 'decision',
            projectId: project?.id || globalProject.id,
            payload: {
              decision_id: decisionId,
              title,
              decided_at: decidedAt,
              decided_by: decider,
              context: body.slice(0, 500),
              status,
              tags,
              source: path.relative(CODEX_ROOT, filePath)
            },
            roleMin: 'member',
            sensitivity: 'internal'
          });
          if (project) {
            await upsertBelongsToProject(entityId, project, 'member', 'internal');
          }
          count++;
        }
      } catch (error) {
        // decisions folder may not exist
      }
      console.log(`[meta_decisions] count=${count}`);
    };

    await ingestApps();
    await ingestBrands();
    await ingestCustomers();
    await ingestPartners();
    await ingestContacts();
    await ingestContracts();
    await ingestFinancials();
    await ingestCapital();
    const storyIdMap = await ingestStories();
    await ingestFrames();
    await ingestRunLedger(storyIdMap);
    await ingestGlossary();
    await ingestRaci();
    await ingestMetaDecisions();

    for (const project of projectRecords.values()) {
      const count = await ingestDocs(project.path, { projectFallback: project, rootLabel: `projects/${project.code}` });
      console.log(`[docs] ${project.code} files=${count}`);
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
