#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Pool } = pg;
async function snapshot(client) {
  const identity = await client.query("SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS host, inet_server_port() AS port");
  const counts = await client.query("SELECT status, count(*)::int AS count FROM knowledge_promotion_requests GROUP BY status ORDER BY status");
  const targets = await client.query(`
    SELECT request_id
    FROM knowledge_promotion_requests
    WHERE status = 'pending_org_review'
      AND (normalized_payload IS NULL OR normalized_payload_hash IS NULL)
    ORDER BY request_id
  `);
  const total = counts.rows.reduce((sum, row) => sum + row.count, 0);
  return {
    database: identity.rows[0],
    total,
    status_counts: Object.fromEntries(counts.rows.map((row) => [row.status, row.count])),
    target_request_ids: targets.rows.map((row) => row.request_id)
  };
}

export function assertPostflight(before, after, targetRows, rls) {
  const targetCount = before.target_request_ids.length;
  const expected = { ...before.status_counts };
  expected.pending_org_review = (expected.pending_org_review || 0) - targetCount;
  expected.pending_owner_approval = (expected.pending_owner_approval || 0) + targetCount;
  const keys = new Set([...Object.keys(expected), ...Object.keys(after.status_counts)]);
  const errors = [];
  for (const key of ['database', 'role', 'host', 'port']) {
    if (after.database?.[key] !== before.database?.[key]) errors.push(`database identity ${key} changed`);
  }
  if (after.total !== before.total) errors.push(`total changed: ${before.total} -> ${after.total}`);
  for (const key of keys) {
    if ((after.status_counts[key] || 0) !== (expected[key] || 0)) {
      errors.push(`status ${key}: expected ${expected[key] || 0}, got ${after.status_counts[key] || 0}`);
    }
  }
  if (targetRows.length !== targetCount) errors.push(`target rows: expected ${targetCount}, got ${targetRows.length}`);
  for (const row of targetRows) {
    if (row.status !== 'pending_owner_approval' || row.owner_decided_by !== null || row.owner_decided_at !== null || row.owner_consent_receipt_id !== null || row.decided_at !== null) {
      errors.push(`target ${row.request_id} did not fail closed exactly`);
    }
  }
  if (!rls?.relrowsecurity || !rls?.relforcerowsecurity) errors.push('knowledge_promotion_authority_uses RLS is not ENABLE/FORCE');
  if (errors.length) throw new Error(errors.join('; '));
}

export function assertReceiptBinding(receipt, targetSha) {
  if (receipt.schema_version !== 'personal_knowledge_migration_release.v1' || receipt.target_sha !== targetSha || !receipt.before) {
    throw new Error('preflight Receipt does not match TARGET_SHA');
  }
}

export async function writeReceipt(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

async function main() {
  const mode = process.argv[2];
  const receiptPath = path.resolve(process.argv[3] || 'var/personal-knowledge-migration-release-receipt.json');
  const targetSha = process.env.TARGET_SHA || '';
  const databaseUrl = process.env.M5A_DATABASE_URL || process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL || process.env.DATABASE_URL;
  if (!['preflight', 'postflight'].includes(mode)) throw new Error('usage: personal-knowledge-migration-release-gate.mjs preflight|postflight [receipt-path]');
  if (!/^[0-9a-f]{40}$/.test(targetSha)) throw new Error('TARGET_SHA must be a 40-character Git SHA');
  if (!databaseUrl) throw new Error('INFO_SSOT_DATABASE_URL, INFO_SSOT_DB_URL, or DATABASE_URL is required');
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
  if (mode === 'preflight') {
    const before = await snapshot(client);
    const receipt = { schema_version: 'personal_knowledge_migration_release.v1', status: 'preflight_recorded', target_sha: targetSha, recorded_at: new Date().toISOString(), before };
    await writeReceipt(receiptPath, receipt);
    console.log(JSON.stringify({ status: receipt.status, target_sha: targetSha, target_count: before.target_request_ids.length, total: before.total, receipt_path: receiptPath }));
  } else {
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    assertReceiptBinding(receipt, targetSha);
    const after = await snapshot(client);
    const ids = receipt.before.target_request_ids;
    const targetRows = ids.length === 0 ? [] : (await client.query(`
      SELECT request_id, status, owner_decided_by, owner_decided_at, owner_consent_receipt_id, decided_at
      FROM knowledge_promotion_requests WHERE request_id = ANY($1::text[]) ORDER BY request_id
    `, [ids])).rows;
    const rls = (await client.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'knowledge_promotion_authority_uses'::regclass")).rows[0];
    assertPostflight(receipt.before, after, targetRows, rls);
    const completed = { ...receipt, status: 'passed', completed_at: new Date().toISOString(), after, rls: { enabled: rls.relrowsecurity, forced: rls.relforcerowsecurity } };
    await writeReceipt(receiptPath, completed);
    console.log(JSON.stringify({ status: completed.status, target_sha: targetSha, target_count: ids.length, total: after.total, receipt_path: receiptPath }));
  }
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
