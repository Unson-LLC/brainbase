#!/usr/bin/env node
/**
 * Seed 佐藤圭吾の個人実績データを GraphDB に投入。
 * 正本は GraphDB、common/meta/people/sato_keigo/*.yaml は派生（ミラー）。
 *
 * 投入対象:
 *   speaking (登壇)         -> entity_type: speaking,         id prefix: spk_
 *   media (メディア出演)    -> entity_type: media_appearance, id prefix: med_
 *   roles (役職)            -> entity_type: role_assignment,  id prefix: rol_
 *   products (プロダクト)    -> entity_type: product,          id prefix: prd_
 *   publications (著書)     -> entity_type: publication,      id prefix: pub_
 *   press (紙面)            -> entity_type: press_mention,    id prefix: prs_
 *
 * 関係性 (graph_edges):
 *   person -[spoke_at]-> speaking
 *   person -[appeared_in]-> media_appearance
 *   person -[holds_role]-> role_assignment
 *   person -[created]-> product
 *   person -[authored]-> publication
 *   person -[mentioned_in]-> press_mention
 *
 * 冪等: 全エンティティは決定論的IDを使うため、再実行で安全に upsert される。
 *
 * Usage:
 *   INFO_SSOT_DATABASE_URL=postgres://... node scripts/seed-sato-personal-records.js [--dry-run]
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import yaml from "js-yaml";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

const WORKSPACE_ROOT = process.env.BRAINBASE_ROOT || repoRoot;
const PERSON_DIR = join(WORKSPACE_ROOT, "common/meta/people/sato_keigo");

const PERSON_ID = "per_01KGS5F2HGJSWMZX68QJEQB0BB";
const PROJECT_ID = "prj_sato_portfolio";
const PROJECT_PAYLOAD = {
  code: "sato_portfolio",
  name: "佐藤圭吾ポートフォリオ",
  status: "active",
  description: "佐藤圭吾の個人実績（登壇・メディア・役職・プロダクト・著書・プレス）を集約するprojectスコープ。可読ミラー: common/meta/people/sato_keigo/",
};

const ORG_ID_BY_TAG = {
  雲孫: "org_unson",
  TechKnight: "org_techknight",
};

const DRY_RUN = process.argv.includes("--dry-run");
const DATABASE_URL =
  process.env.INFO_SSOT_DATABASE_URL ||
  process.env.INFO_SSOT_DB_URL ||
  "postgres://localhost/brainbase_ssot";

const ROLE_MIN = "member";
const SENSITIVITY = "internal";

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);

const toDateString = (v) => {
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return v;
};

const normalize = (rec) => {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = v instanceof Date ? toDateString(v) : v;
  }
  return out;
};

const loadYaml = (name) => {
  const path = join(PERSON_DIR, `${name}.yaml`);
  const raw = yaml.load(readFileSync(path, "utf-8")) || [];
  return raw.map(normalize);
};

const idFor = {
  speaking: (r) => `spk_${r.date}_${slug(r.event)}`,
  media: (r) => `med_${slug(r.medium)}_${slug(r.program)}`,
  role: (r) => `rol_${slug(r.org_tag || r.org)}_${slug(r.role)}`,
  product: (r) => `prd_${slug(r.name)}`,
  publication: (r) => `pub_${slug(r.title).slice(0, 40)}`,
  press: (r) => `prs_${r.date}_${slug(r.medium)}`,
};

async function upsertEntity(client, id, entityType, payload) {
  if (DRY_RUN) {
    console.log(`  [dry] entity ${id} (${entityType})`);
    return;
  }
  await client.query(
    `INSERT INTO graph_entities (id, entity_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       entity_type = EXCLUDED.entity_type,
       project_id = EXCLUDED.project_id,
       payload = EXCLUDED.payload,
       updated_at = NOW()`,
    [id, entityType, PROJECT_ID, JSON.stringify(payload), ROLE_MIN, SENSITIVITY],
  );
}

async function upsertEdge(client, fromId, toId, relType, payload = {}) {
  if (DRY_RUN) {
    console.log(`  [dry] edge ${fromId} -[${relType}]-> ${toId}`);
    return;
  }
  const edgeId = `edg_${createHash("sha1").update(`${relType}|${fromId}|${toId}`).digest("hex").slice(0, 24)}`;
  await client.query(
    `INSERT INTO graph_edges (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
     ON CONFLICT (from_id, to_id, rel_type) DO UPDATE SET
       payload = EXCLUDED.payload,
       updated_at = NOW()`,
    [edgeId, fromId, toId, relType, PROJECT_ID, JSON.stringify(payload), ROLE_MIN, SENSITIVITY],
  );
}

async function seedProject(client) {
  console.log(`[project] ${PROJECT_ID}`);
  if (DRY_RUN) {
    console.log(`  [dry] would upsert project ${PROJECT_ID}`);
    return;
  }
  await client.query(
    `INSERT INTO projects (id, code, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       code = EXCLUDED.code,
       name = EXCLUDED.name`,
    [PROJECT_ID, PROJECT_PAYLOAD.code, PROJECT_PAYLOAD.name],
  );
  await upsertEntity(client, PROJECT_ID, "project", PROJECT_PAYLOAD);
}

async function seedSpeaking(client) {
  const records = loadYaml("speaking");
  console.log(`[speaking] ${records.length} entries`);
  for (const r of records) {
    const id = idFor.speaking(r);
    await upsertEntity(client, id, "speaking", { ...r, person_id: "sato_keigo" });
    await upsertEdge(client, PERSON_ID, id, "spoke_at", { date: r.date });
  }
}

async function seedMedia(client) {
  const records = loadYaml("media");
  console.log(`[media] ${records.length} entries`);
  for (const r of records) {
    const id = idFor.media(r);
    await upsertEntity(client, id, "media_appearance", { ...r, person_id: "sato_keigo" });
    await upsertEdge(client, PERSON_ID, id, "appeared_in", { date: r.date });
  }
}

async function seedRoles(client) {
  const records = loadYaml("roles");
  console.log(`[roles] ${records.length} entries`);
  for (const r of records) {
    const id = idFor.role(r);
    const orgId = ORG_ID_BY_TAG[r.org_tag] || null;
    await upsertEntity(client, id, "role_assignment", {
      ...r,
      person_id: "sato_keigo",
      org_id: orgId,
    });
    await upsertEdge(client, PERSON_ID, id, "holds_role", { period: r.period });
    if (orgId) {
      await upsertEdge(client, id, orgId, "role_at", { period: r.period });
    }
  }
}

async function seedProducts(client) {
  const records = loadYaml("products");
  console.log(`[products] ${records.length} entries`);
  for (const r of records) {
    const id = idFor.product(r);
    await upsertEntity(client, id, "product", { ...r, person_id: "sato_keigo" });
    await upsertEdge(client, PERSON_ID, id, "created", { role: r.role });
  }
}

async function seedPublications(client) {
  const records = loadYaml("publications");
  console.log(`[publications] ${records.length} entries`);
  for (const r of records) {
    const id = idFor.publication(r);
    await upsertEntity(client, id, "publication", { ...r, person_id: "sato_keigo" });
    await upsertEdge(client, PERSON_ID, id, "authored");
  }
}

async function seedPress(client) {
  const records = loadYaml("press");
  console.log(`[press] ${records.length} entries`);
  for (const r of records) {
    const id = idFor.press(r);
    await upsertEntity(client, id, "press_mention", { ...r, person_id: "sato_keigo" });
    await upsertEdge(client, PERSON_ID, id, "mentioned_in", { date: r.date });
  }
}

async function main() {
  console.log(`[seed] source: ${PERSON_DIR}`);
  console.log(`[seed] target: ${DATABASE_URL.replace(/:[^@/]*@/, ":***@")}${DRY_RUN ? " (DRY RUN)" : ""}`);
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();
  try {
    if (!DRY_RUN) await client.query("BEGIN");
    await seedProject(client);
    await seedSpeaking(client);
    await seedMedia(client);
    await seedRoles(client);
    await seedProducts(client);
    await seedPublications(client);
    await seedPress(client);
    if (!DRY_RUN) await client.query("COMMIT");
    console.log("[seed] done");
  } catch (err) {
    if (!DRY_RUN) await client.query("ROLLBACK");
    console.error("[seed] failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
