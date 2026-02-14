#!/usr/bin/env node
/**
 * migrate-codex-phase1.js
 * Phase 1: brand, ops, specs, templates, frameworks を graph に移行するスクリプト
 *
 * 新規entity_type:
 * - brand_guide: ブランドガイドライン
 * - ops_guide: 運用ガイド
 * - spec: 技術仕様書
 * - template: テンプレート
 * - framework: フレームワーク
 *
 * Usage:
 *   # 本番DB（Lightsail）へ接続する場合
 *   INFO_SSOT_DATABASE_URL="postgres://user:pass@host:5432/db" node scripts/migrate-codex-phase1.js --dry-run
 *
 *   # Docker環境（ローカル）で実行する場合
 *   docker-compose -f docker-compose.graph-api.yml up -d
 *   INFO_SSOT_DATABASE_URL="postgresql://brainbase_user:password@localhost:5432/brainbase_ssot" node scripts/migrate-codex-phase1.js --dry-run
 *
 * Requirements:
 *   - pg, js-yaml パッケージ（npm install pg js-yaml ulid --save-dev）
 */
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
  console.error('ERROR: INFO_SSOT_DATABASE_URL is not set');
  console.error('');
  console.error('Usage:');
  console.error('  INFO_SSOT_DATABASE_URL="postgres://user:pass@host:5432/db" node scripts/migrate-codex-phase1.js');
  console.error('');
  console.error('For local Docker:');
  console.error('  INFO_SSOT_DATABASE_URL="postgresql://brainbase_user:password@localhost:5432/brainbase_ssot" node scripts/migrate-codex-phase1.js');
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

console.log(`CODEX_ROOT: ${CODEX_ROOT}`);
console.log(`DB URL: ${dbUrl.replace(/:[^:@]+@/, ':****@')}`); // パスワードを隠す
console.log(`Dry Run: ${dryRun}`);

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

// ops_guide のカテゴリ分類
const classifyOpsGuide = (filename, content) => {
  const lower = filename.toLowerCase();
  const bodyLower = content.toLowerCase();

  if (lower.includes('nocodb') || bodyLower.includes('nocodb')) return 'project_management';
  if (lower.includes('github') || lower.includes('actions') || lower.includes('workflow')) return 'ci_cd';
  if (lower.includes('dns') || lower.includes('cloudflare') || lower.includes('tunnel')) return 'infrastructure';
  if (lower.includes('brainbase') || lower.includes('launchd') || lower.includes('mobile')) return 'brainbase_ops';
  if (lower.includes('meeting') || lower.includes('kpi') || lower.includes('scheduled') || lower.includes('job')) return 'monitoring';
  if (lower.includes('playbook') || lower.includes('guide') || lower.includes('automation')) return 'operations';

  return 'general';
};

const pool = new Pool({ connectionString: dbUrl });

const main = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL plan_cache_mode = 'force_custom_plan'`);

    // プロジェクト取得
    const projectRows = await client.query('SELECT id, code, name FROM projects');
    const projectRecords = new Map();
    const projectCodeMap = new Map();

    for (const row of projectRows.rows) {
      projectRecords.set(row.code, { id: row.id, name: row.name, code: row.code });
      projectCodeMap.set(normalizeToken(row.code), row.code);
    }

    // フォールバック用グローバルプロジェクト
    const globalProject = projectRecords.get(GLOBAL_PROJECT_CODE) || projectRecords.values().next().value;
    if (!globalProject) {
      throw new Error(`Global project not found: ${GLOBAL_PROJECT_CODE}`);
    }

    console.log(`Found ${projectRecords.size} projects`);
    console.log(`Global project: ${globalProject.code}`);

    // 組織取得
    const orgRows = await client.query("SELECT id, payload FROM graph_entities WHERE entity_type = 'org'");
    const orgMap = new Map();
    for (const row of orgRows.rows) {
      const orgId = row.payload?.org_id || row.id;
      orgMap.set(orgId, row);
      orgMap.set(normalizeToken(orgId), row);
    }
    console.log(`Found ${orgRows.rows.length} orgs`);

    // RLS設定
    const projectCodes = [...projectRecords.keys()].join(',');
    await client.query(`SELECT set_config('app.role', 'ceo', true)`);
    await client.query(`SELECT set_config('app.project_codes', $1, true)`, [projectCodes]);
    await client.query(`SELECT set_config('app.clearance', 'internal,restricted,finance,hr,contract', true)`);

    // ヘルパー関数
    const ensureProject = (code) => {
      if (!code) return globalProject;
      return projectRecords.get(code) || projectRecords.get(normalizeToken(code)) || globalProject;
    };

    const ensureOrg = (orgId) => {
      if (!orgId) return null;
      return orgMap.get(orgId) || orgMap.get(normalizeToken(orgId)) || null;
    };

    const upsertGraphEntity = async ({ id, entityType, projectId, payload, roleMin, sensitivity }) => {
      if (dryRun) {
        console.log(`  [DRY-RUN] Would create entity: ${id} (${entityType})`);
        return;
      }

      const existing = await client.query('SELECT id FROM graph_entities WHERE id = $1', [id]);
      const payloadJson = JSON.stringify(payload || {});

      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO graph_entities (id, entity_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
          [id, entityType, projectId, payloadJson, roleMin, sensitivity]
        );
      } else {
        await client.query(
          `UPDATE graph_entities SET project_id = $1, payload = $2, updated_at = NOW() WHERE id = $3`,
          [projectId, payloadJson, id]
        );
      }
    };

    const upsertGraphEdge = async ({ fromId, toId, relType, projectId, roleMin, sensitivity }) => {
      if (dryRun) {
        console.log(`  [DRY-RUN] Would create edge: ${fromId} -> ${toId} (${relType})`);
        return;
      }

      await client.query(
        `INSERT INTO graph_edges (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
         ON CONFLICT (from_id, to_id, rel_type) DO UPDATE SET updated_at = NOW()`,
        [`edg_${ulid()}`, fromId, toId, relType, projectId, JSON.stringify({}), roleMin, sensitivity]
      );
    };

    // 統計
    const stats = { brand_guide: 0, ops_guide: 0, spec: 0, template: 0, framework: 0 };

    // ========================================
    // 1. brand/ 移行 → brand_guide entity
    // ========================================
    console.log('\n=== Brand Guides ===');
    const brandRoot = path.join(CODEX_ROOT, 'brand');

    try {
      const entries = await fs.readdir(brandRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue;

        const filePath = path.join(brandRoot, entry.name);
        const content = await fs.readFile(filePath, 'utf-8');
        const { data, body } = parseFrontmatter(content);
        const title = extractTitle(body, entry.name);
        const slug = path.basename(entry.name, '.md');

        const brandIdRaw = String(data.brand_id || slug).trim();
        const brandId = `brdg_${normalizeToken(brandIdRaw) || hashId('brandguide', filePath).slice(5)}`;

        // プロジェクト特定
        let projectCode = data.project_id || data.project || null;
        if (!projectCode) {
          const lower = slug.toLowerCase();
          if (lower.includes('unson')) projectCode = 'unson';
          else if (lower.includes('baao')) projectCode = 'baao';
          else if (lower.includes('salestailor')) projectCode = 'salestailor';
          else if (lower.includes('techknight') || lower.includes('aitle') || lower.includes('smartfront')) projectCode = 'techknight';
          else if (lower.includes('zeims')) projectCode = 'zeims';
          else projectCode = 'unson';
        }
        const project = ensureProject(projectCode);

        // セクション抽出
        const sections = {};
        const bodyLower = body.toLowerCase();
        if (bodyLower.includes('## core') || bodyLower.includes('## コア')) sections.core = true;
        if (bodyLower.includes('## voice') || bodyLower.includes('## tone') || bodyLower.includes('## 口調')) sections.voice_tone = true;
        if (bodyLower.includes('## color') || bodyLower.includes('## 色')) sections.colors = true;
        if (bodyLower.includes('## typography') || bodyLower.includes('## フォント')) sections.typography = true;

        const payload = {
          title,
          brand_id: data.brand_id || slug,
          version: data.version || null,
          org_id: data.org_id || projectCode,
          sections,
          source: path.relative(CODEX_ROOT, filePath)
        };

        await upsertGraphEntity({
          id: brandId,
          entityType: 'brand_guide',
          projectId: project.id,
          payload,
          roleMin: 'member',
          sensitivity: 'internal'
        });

        await upsertGraphEdge({
          fromId: brandId,
          toId: project.id,
          relType: 'belongs_to_project',
          projectId: project.id,
          roleMin: 'member',
          sensitivity: 'internal'
        });

        stats.brand_guide++;
        console.log(`[brand_guide] ${title} (${brandId}) project=${project.code}`);
      }
    } catch (error) {
      console.error(`[ERROR] brand migration failed: ${error.message}`);
    }
    console.log(`[brand_guide] total=${stats.brand_guide}`);

    // ========================================
    // 2. common/ops/ 移行 → ops_guide entity
    // ========================================
    console.log('\n=== Ops Guides ===');
    const opsRoot = path.join(CODEX_ROOT, 'common', 'ops');

    try {
      const entries = await fs.readdir(opsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue;
        if (entry.name === 'README.md') continue;

        const filePath = path.join(opsRoot, entry.name);
        const content = await fs.readFile(filePath, 'utf-8');

        if (content.trim().length === 0) {
          console.log(`[ops_guide] SKIP empty: ${entry.name}`);
          continue;
        }

        const { data, body } = parseFrontmatter(content);
        const title = extractTitle(body, entry.name);
        const opsId = `opsg_${hashId('opsguide', filePath).slice(5)}`;
        const category = classifyOpsGuide(entry.name, body);

        const projectCode = data.project_id || data.project || null;
        const project = ensureProject(projectCode);

        const payload = {
          title,
          category,
          filename: entry.name,
          tags: Array.isArray(data.tags) ? data.tags : [],
          source: path.relative(CODEX_ROOT, filePath)
        };

        await upsertGraphEntity({
          id: opsId,
          entityType: 'ops_guide',
          projectId: project.id,
          payload,
          roleMin: 'member',
          sensitivity: 'internal'
        });

        await upsertGraphEdge({
          fromId: opsId,
          toId: project.id,
          relType: 'belongs_to_project',
          projectId: project.id,
          roleMin: 'member',
          sensitivity: 'internal'
        });

        stats.ops_guide++;
        console.log(`[ops_guide] ${title} (${opsId}) category=${category}`);
      }
    } catch (error) {
      console.error(`[ERROR] ops migration failed: ${error.message}`);
    }
    console.log(`[ops_guide] total=${stats.ops_guide}`);

    // ========================================
    // 3. common/specs/ 移行 → spec entity
    // ========================================
    console.log('\n=== Specs ===');
    const specsRoot = path.join(CODEX_ROOT, 'common', 'specs');

    try {
      const entries = await fs.readdir(specsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue;
        if (entry.name === 'README.md') continue;

        const filePath = path.join(specsRoot, entry.name);
        const content = await fs.readFile(filePath, 'utf-8');

        if (content.trim().length === 0) {
          console.log(`[spec] SKIP empty: ${entry.name}`);
          continue;
        }

        const { data, body } = parseFrontmatter(content);
        const title = extractTitle(body, entry.name);
        const specId = `spec_${hashId('spec', filePath).slice(5)}`;

        // spec type 推定
        const lower = entry.name.toLowerCase();
        let specType = 'general';
        if (lower.includes('tdd') || lower.includes('test')) specType = 'tdd';
        else if (lower.includes('graph')) specType = 'graph';
        else if (lower.includes('slack')) specType = 'slack';
        else if (lower.includes('diagram')) specType = 'diagram';
        else if (lower.includes('id')) specType = 'id_design';
        else if (lower.includes('ledger')) specType = 'run_ledger';

        const projectCode = data.project_id || data.project || null;
        const project = ensureProject(projectCode);

        const payload = {
          title,
          spec_type: specType,
          filename: entry.name,
          version: data.version || null,
          status: data.status || 'draft',
          source: path.relative(CODEX_ROOT, filePath)
        };

        await upsertGraphEntity({
          id: specId,
          entityType: 'spec',
          projectId: project.id,
          payload,
          roleMin: 'member',
          sensitivity: 'internal'
        });

        await upsertGraphEdge({
          fromId: specId,
          toId: project.id,
          relType: 'belongs_to_project',
          projectId: project.id,
          roleMin: 'member',
          sensitivity: 'internal'
        });

        stats.spec++;
        console.log(`[spec] ${title} (${specId}) type=${specType}`);
      }
    } catch (error) {
      console.error(`[ERROR] specs migration failed: ${error.message}`);
    }
    console.log(`[spec] total=${stats.spec}`);

    // ========================================
    // 4. common/templates/ 移行 → template entity
    // ========================================
    console.log('\n=== Templates ===');
    const templatesRoot = path.join(CODEX_ROOT, 'common', 'templates');

    try {
      const entries = await fs.readdir(templatesRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue;

        const filePath = path.join(templatesRoot, entry.name);
        const content = await fs.readFile(filePath, 'utf-8');

        if (content.trim().length === 0) continue;

        const { data, body } = parseFrontmatter(content);
        const title = extractTitle(body, entry.name);
        const templateId = `tmpl_${hashId('template', filePath).slice(5)}`;

        // template type 推定
        const lower = entry.name.toLowerCase();
        let templateType = 'general';
        if (lower.includes('project')) templateType = 'project';
        else if (lower.includes('raci')) templateType = 'raci';
        else if (lower.includes('meeting')) templateType = 'meeting';
        else if (lower.includes('brand')) templateType = 'brand';
        else if (lower.includes('org')) templateType = 'org';
        else if (lower.includes('kpi') || lower.includes('scorecard')) templateType = 'kpi';
        else if (lower.includes('delegation')) templateType = 'delegation';
        else if (lower.includes('brainbase')) templateType = 'brainbase';
        else if (lower.includes('revenue')) templateType = 'revenue';

        const projectCode = data.project_id || data.project || null;
        const project = ensureProject(projectCode);

        const payload = {
          title,
          template_type: templateType,
          filename: entry.name,
          source: path.relative(CODEX_ROOT, filePath)
        };

        await upsertGraphEntity({
          id: templateId,
          entityType: 'template',
          projectId: project.id,
          payload,
          roleMin: 'member',
          sensitivity: 'internal'
        });

        await upsertGraphEdge({
          fromId: templateId,
          toId: project.id,
          relType: 'belongs_to_project',
          projectId: project.id,
          roleMin: 'member',
          sensitivity: 'internal'
        });

        stats.template++;
        console.log(`[template] ${title} (${templateId}) type=${templateType}`);
      }
    } catch (error) {
      console.error(`[ERROR] templates migration failed: ${error.message}`);
    }
    console.log(`[template] total=${stats.template}`);

    // ========================================
    // 5. common/frameworks/ 移行 → framework entity
    // ========================================
    console.log('\n=== Frameworks ===');
    const frameworksRoot = path.join(CODEX_ROOT, 'common', 'frameworks');

    try {
      const entries = await fs.readdir(frameworksRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue;

        const filePath = path.join(frameworksRoot, entry.name);
        const content = await fs.readFile(filePath, 'utf-8');

        if (content.trim().length === 0) continue;

        const { data, body } = parseFrontmatter(content);
        const title = extractTitle(body, entry.name);
        const frameworkId = `frmw_${hashId('framework', filePath).slice(5)}`;

        const projectCode = data.project_id || data.project || null;
        const project = ensureProject(projectCode);

        const payload = {
          title,
          filename: entry.name,
          version: data.version || null,
          source: path.relative(CODEX_ROOT, filePath)
        };

        await upsertGraphEntity({
          id: frameworkId,
          entityType: 'framework',
          projectId: project.id,
          payload,
          roleMin: 'member',
          sensitivity: 'internal'
        });

        await upsertGraphEdge({
          fromId: frameworkId,
          toId: project.id,
          relType: 'belongs_to_project',
          projectId: project.id,
          roleMin: 'member',
          sensitivity: 'internal'
        });

        stats.framework++;
        console.log(`[framework] ${title} (${frameworkId})`);
      }
    } catch (error) {
      console.error(`[ERROR] frameworks migration failed: ${error.message}`);
    }
    console.log(`[framework] total=${stats.framework}`);

    // ========================================
    // Commit or Rollback
    // ========================================
    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\n[DRY RUN] Changes rolled back');
    } else {
      await client.query('COMMIT');
      console.log('\n[COMMIT] Changes committed');
    }

    // ========================================
    // Summary
    // ========================================
    console.log('\n=== Migration Summary ===');
    console.log(`brand_guide: ${stats.brand_guide}`);
    console.log(`ops_guide: ${stats.ops_guide}`);
    console.log(`spec: ${stats.spec}`);
    console.log(`template: ${stats.template}`);
    console.log(`framework: ${stats.framework}`);
    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    console.log(`TOTAL: ${total}`);

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

main()
  .then(() => {
    console.log('\nmigration complete');
    pool.end();
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    pool.end();
    process.exit(1);
  });
