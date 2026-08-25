import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPostflight, assertReceiptBinding, writeReceipt } from '../../../scripts/personal-knowledge-migration-release-gate.mjs';

const identity = { database: 'brainbase', role: 'brainbase', host: '127.0.0.1', port: 5432 };
const before = {
  database: identity,
  total: 5,
  status_counts: { pending_org_review: 2, pending_owner_approval: 1, org_accepted: 2 },
  target_request_ids: ['req_1', 'req_2']
};
const after = {
  database: identity,
  total: 5,
  status_counts: { pending_owner_approval: 3, org_accepted: 2 },
  target_request_ids: []
};
const rows = ['req_1', 'req_2'].map((request_id) => ({
  request_id,
  status: 'pending_owner_approval',
  owner_decided_by: null,
  owner_decided_at: null,
  owner_consent_receipt_id: null,
  decided_at: null
}));
const rls = { relrowsecurity: true, relforcerowsecurity: true };

describe('personal knowledge migration release gate', () => {
  it('repairs an existing Receipt to mode 0600', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'personal-kg-release-'));
    const file = path.join(directory, 'receipt.json');
    await fs.writeFile(file, '{}\n', { mode: 0o644 });
    await fs.chmod(file, 0o644);
    await writeReceipt(file, { status: 'passed' });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    await fs.rm(directory, { recursive: true });
  });

  it('rejects a Receipt from another target SHA', () => {
    expect(() => assertReceiptBinding({ schema_version: 'personal_knowledge_migration_release.v1', target_sha: 'a'.repeat(40), before }, 'b'.repeat(40))).toThrow('does not match TARGET_SHA');
  });

  it('accepts the exact fail-closed transition', () => expect(() => assertPostflight(before, after, rows, rls)).not.toThrow());

  it.each([
    ['database identity mismatch', { ...after, database: { ...identity, database: 'other' } }, rows, rls, 'database identity database changed'],
    ['missing target row', after, rows.slice(1), rls, 'target rows'],
    ['wrong target status', after, [{ ...rows[0], status: 'org_rejected' }, rows[1]], rls, 'did not fail closed exactly'],
    ['owner evidence remains', after, [{ ...rows[0], owner_decided_by: 'per_1' }, rows[1]], rls, 'did not fail closed exactly'],
    ['total changes', { ...after, total: 4 }, rows, rls, 'total changed'],
    ['unrelated status changes', { ...after, status_counts: { pending_owner_approval: 3, org_accepted: 1, org_rejected: 1 } }, rows, rls, 'status org_accepted'],
    ['RLS disabled', after, rows, { relrowsecurity: false, relforcerowsecurity: true }, 'RLS is not ENABLE/FORCE']
  ])('rejects %s', (_label, actualAfter, actualRows, actualRls, message) => {
    expect(() => assertPostflight(before, actualAfter, actualRows, actualRls)).toThrow(message);
  });
});
