#!/usr/bin/env node
/**
 * GraphDB の人物紐付き個人実績エンティティを読んで
 * common/meta/people/<person>/*.yaml に書き出す（一方向ミラー生成）。
 *
 * 正本: GraphDB graph_entities + graph_edges
 * 派生: common/meta/people/<person>/{speaking,media,roles,products,publications,press}.yaml
 *
 * Usage:
 *   INFO_SSOT_DATABASE_URL=postgres://... node scripts/sync-person-records-to-mirror.js [person_source_id]
 *   default person_source_id: sato_keigo
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import yaml from "js-yaml";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

const WORKSPACE_ROOT = process.env.BRAINBASE_ROOT || repoRoot;
const PERSON_SOURCE_ID = process.argv[2] || "sato_keigo";
const PERSON_DIR = join(WORKSPACE_ROOT, "common/meta/people", PERSON_SOURCE_ID);

const DATABASE_URL =
  process.env.INFO_SSOT_DATABASE_URL ||
  process.env.INFO_SSOT_DB_URL ||
  "postgres://localhost/brainbase_ssot";

// entity_type -> { fileName, sortKey }
const TYPE_MAP = {
  speaking: { file: "speaking", sortKey: "date" },
  media_appearance: { file: "media", sortKey: "date" },
  role_assignment: { file: "roles", sortKey: null },
  product: { file: "products", sortKey: null },
  publication: { file: "publications", sortKey: null },
  press_mention: { file: "press", sortKey: "date" },
};

// payload から内部フィールドを除いて出力用に整える
const stripInternal = (payload) => {
  const { person_id, org_id, ...rest } = payload;
  return rest;
};

const headerByFile = {
  speaking: "# 登壇実績 - 佐藤圭吾\n# 正本: GraphDB graph_entities (entity_type=speaking) — このファイルは派生（ミラー）。編集は seed → mirror sync 経由で。\n# date順（古い→新しい）\n",
  media: "# メディア出演 - 佐藤圭吾\n# 正本: GraphDB (entity_type=media_appearance) — 派生（ミラー）。\n",
  roles: "# 現職・役職 - 佐藤圭吾\n# 正本: GraphDB (entity_type=role_assignment) — 派生（ミラー）。SalesTailor CTO は事業売却に伴い終了。products.yaml を参照。\n",
  products: "# プロダクト実績 - 佐藤圭吾\n# 正本: GraphDB (entity_type=product) — 派生（ミラー）。status: active / sold / in_dev\n",
  publications: "# 著書 - 佐藤圭吾\n# 正本: GraphDB (entity_type=publication) — 派生（ミラー）。\n",
  press: "# 紙面・プレス掲載 - 佐藤圭吾\n# 正本: GraphDB (entity_type=press_mention) — 派生（ミラー）。\n",
};

async function main() {
  console.log(`[mirror] source: GraphDB (${DATABASE_URL.replace(/:[^@/]*@/, ":***@")})`);
  console.log(`[mirror] target: ${PERSON_DIR}`);
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    if (!existsSync(PERSON_DIR)) mkdirSync(PERSON_DIR, { recursive: true });

    // 人物に紐付くエンティティを payload.person_id で引く
    const { rows } = await pool.query(
      `SELECT id, entity_type, payload
       FROM graph_entities
       WHERE entity_type = ANY($1)
         AND payload->>'person_id' = $2
       ORDER BY entity_type, id`,
      [Object.keys(TYPE_MAP), PERSON_SOURCE_ID],
    );

    // entity_type ごとに分類
    const grouped = {};
    for (const row of rows) {
      const cfg = TYPE_MAP[row.entity_type];
      if (!cfg) continue;
      grouped[cfg.file] ??= { records: [], sortKey: cfg.sortKey };
      grouped[cfg.file].records.push(stripInternal(row.payload));
    }

    // ソート + 書き出し
    for (const [file, { records, sortKey }] of Object.entries(grouped)) {
      if (sortKey) {
        records.sort((a, b) => String(a[sortKey] || "").localeCompare(String(b[sortKey] || "")));
      }
      const header = headerByFile[file] || "";
      const body = yaml.dump(records, { lineWidth: -1, noRefs: true, sortKeys: false });
      const path = join(PERSON_DIR, `${file}.yaml`);
      writeFileSync(path, header + body);
      console.log(`  ${file}.yaml <- ${records.length} entries`);
    }
    console.log("[mirror] done");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[mirror] failed:", err);
  process.exit(1);
});
