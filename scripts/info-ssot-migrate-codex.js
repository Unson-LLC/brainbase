#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import fm from 'front-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const opts = {
  dryRun: args.includes('--dry-run'),
  only: null,
  project: null,
  baseUrl: process.env.INFO_SSOT_BASE_URL || 'http://localhost:55123'
};

const CSRF_SESSION_ID = process.env.INFO_SSOT_CSRF_SESSION || 'codex-migration';

for (const arg of args) {
  if (arg.startsWith('--only=')) opts.only = arg.split('=')[1];
  if (arg.startsWith('--project=')) opts.project = arg.split('=')[1];
}

const ROLE_HEADER = 'ceo';
const CLEARANCE_HEADER = 'internal,restricted,finance,hr,contract';

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

let cachedCsrfToken = null;

const fetchJson = async (url, options) => {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
};

const fetchCsrfToken = async () => {
  const data = await fetchJson(`${opts.baseUrl}/api/csrf-token`, {
    method: 'GET',
    headers: {
      'x-session-id': CSRF_SESSION_ID
    }
  });
  if (!data?.token) {
    throw new Error('Failed to fetch CSRF token');
  }
  return data.token;
};

const postInfo = async (pathName, projectCode, payload) => {
  if (opts.dryRun) {
    console.log('[dry-run]', pathName, projectCode, payload.title || payload.roleCode || payload.personName);
    return null;
  }
  if (!cachedCsrfToken) {
    cachedCsrfToken = await fetchCsrfToken();
  }
  const headers = {
    'content-type': 'application/json',
    'x-brainbase-role': ROLE_HEADER,
    'x-brainbase-projects': projectCode,
    'x-brainbase-clearance': CLEARANCE_HEADER,
    'x-session-id': CSRF_SESSION_ID,
    'x-csrf-token': cachedCsrfToken
  };

  try {
    return await fetchJson(`${opts.baseUrl}${pathName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('CSRF token')) {
      cachedCsrfToken = await fetchCsrfToken();
      headers['x-csrf-token'] = cachedCsrfToken;
      return fetchJson(`${opts.baseUrl}${pathName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
    }
    throw error;
  }
};

const extractSection = (body, heading) => {
  const marker = `## ${heading}`;
  const start = body.indexOf(marker);
  if (start === -1) return '';
  const nextIndex = body.indexOf('\n## ', start + marker.length);
  return nextIndex === -1 ? body.slice(start) : body.slice(start, nextIndex);
};

const parseTable = (section) => {
  const lines = section.split('\n').filter(line => line.trim().startsWith('|'));
  const rows = [];
  for (const line of lines) {
    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (!cols.length) continue;
    if (cols[0].includes('---')) continue;
    if (cols[0] === '人' || cols[0] === '領域') continue;
    rows.push(cols);
  }
  return rows;
};

const migrateRaci = async () => {
  const raciDir = path.join(CODEX_ROOT, 'common', 'meta', 'raci');
  const files = (await fs.readdir(raciDir)).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const filePath = path.join(raciDir, file);
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = fm(raw);
    const orgId = parsed.attributes.org_id || path.basename(file, '.md');
    if (opts.project && opts.project !== orgId) continue;

    const orgName = parsed.attributes.name || orgId;
    const body = parsed.body || '';

    const positionSection = extractSection(body, '立ち位置');
    const decisionSection = extractSection(body, '決裁');
    const responsibilitySection = extractSection(body, '主な担当');

    const positionRows = parseTable(positionSection);
    const decisionRows = parseTable(decisionSection);
    const responsibilityRows = parseTable(responsibilitySection);

    for (const row of positionRows) {
      const [person, assets, rights] = row;
      if (!person) continue;
      await postInfo('/api/info/raci', orgId, {
        projectCode: orgId,
        projectName: orgName,
        personName: person,
        roleCode: 'position',
        authorityScope: `${assets || ''} | ${rights || ''}`.trim(),
        roleMin: 'member',
        sensitivity: 'internal',
        source: 'codex-migration'
      });
    }

    for (const row of decisionRows) {
      const [domain, decisionOwner] = row;
      if (!domain || !decisionOwner) continue;
      await postInfo('/api/info/raci', orgId, {
        projectCode: orgId,
        projectName: orgName,
        personName: decisionOwner,
        roleCode: `decision:${domain}`,
        authorityScope: `決裁:${domain}`,
        roleMin: 'gm',
        sensitivity: 'internal',
        source: 'codex-migration'
      });
    }

    for (const row of responsibilityRows) {
      const [person, domain] = row;
      if (!person || !domain) continue;
      await postInfo('/api/info/raci', orgId, {
        projectCode: orgId,
        projectName: orgName,
        personName: person,
        roleCode: `responsibility:${domain}`,
        authorityScope: domain,
        roleMin: 'member',
        sensitivity: 'internal',
        source: 'codex-migration'
      });
    }
  }
};

const parseDecision = (content) => {
  const lines = content.split('\n');
  const findValue = (prefix) => {
    const line = lines.find(l => l.trim().startsWith(prefix));
    return line ? line.replace(prefix, '').trim() : null;
  };
  const decidedAt = findValue('- Date:') || null;
  const owner = findValue('- Decision Owner:') || null;
  const decisionType = findValue('- Decision Type:') || null;

  const goalSection = extractSection(content, '1. Goal');
  const goalLine = goalSection.split('\n').find(l => l.trim().startsWith('- '));
  const goal = goalLine ? goalLine.replace('- ', '').trim() : null;

  const options = lines
    .filter(l => l.trim().startsWith('- Option'))
    .map(l => l.replace('- ', '').trim());

  const chosenLine = lines.find(l => l.trim().startsWith('- 採用:'));
  const chosen = chosenLine ? chosenLine.replace('- 採用:', '').trim() : null;

  let reason = '';
  const reasonIndex = lines.findIndex(l => l.includes('理由'));
  if (reasonIndex !== -1) {
    for (let i = reasonIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('##')) break;
      if (line.trim().startsWith('-')) {
        reason += `${line.replace('-', '').trim()} `;
      }
    }
    reason = reason.trim();
  }

  return {
    decidedAt,
    owner,
    decisionType,
    goal,
    options,
    chosen,
    reason
  };
};

const migrateDecisions = async () => {
  const projectsDir = path.join(CODEX_ROOT, 'projects');
  const projectDirs = await fs.readdir(projectsDir, { withFileTypes: true });
  for (const dirent of projectDirs) {
    if (!dirent.isDirectory()) continue;
    const projectCode = dirent.name;
    if (opts.project && opts.project !== projectCode) continue;

    const decisionsDir = path.join(projectsDir, projectCode, 'decisions');
    try {
      const files = (await fs.readdir(decisionsDir)).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const filePath = path.join(decisionsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = parseDecision(content);
        const slug = file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}_?/, '');
        const title = slug.replace(/[_-]+/g, ' ').trim() || 'Decision';
        const decidedAt = parsed.decidedAt || file.slice(0, 10);

        await postInfo('/api/info/decisions', projectCode, {
          projectCode,
          projectName: projectCode,
          ownerPersonName: parsed.owner || 'Unknown',
          roleMin: 'gm',
          sensitivity: 'internal',
          title,
          context: {
            decision_type: parsed.decisionType || null,
            goal: parsed.goal || null,
            source_path: filePath
          },
          decisionDomain: parsed.decisionType || null,
          enforceRaci: false,
          options: parsed.options || [],
          chosen: parsed.chosen ? { selection: parsed.chosen } : {},
          reason: parsed.reason || '',
          decidedAt: decidedAt ? new Date(decidedAt).toISOString() : new Date().toISOString(),
          source: 'codex-migration'
        });
      }
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
  }
};

const main = async () => {
  if (!opts.only || opts.only === 'raci') {
    await migrateRaci();
  }
  if (!opts.only || opts.only === 'decisions') {
    await migrateDecisions();
  }
  console.log('codex -> graph ssot migration complete');
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});
