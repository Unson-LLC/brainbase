import { describe, expect, it, vi } from 'vitest';

import { checkCanonicalTaskOperationSchema } from '../../../scripts/migrate-canonical-task-operations.js';

const tables = ['canonical_task_writer', 'canonical_task_readiness', 'canonical_task_operations'];

function completePool(overrides = {}) {
  return {
    query: vi.fn(async (sql) => {
      if (sql.includes('constraint_type')) throw new Error('invalid pg_constraint column');
      if (sql.includes('pg_constraint') && !sql.includes('att.attname::text')) {
        throw new Error('constraint columns must be returned as text[]');
      }
      if (sql.includes('information_schema.tables')) return { rows: tables.map((table_name) => ({ table_name })) };
      if (sql.includes('information_schema.columns')) {
        return { rows: [
          { table_name: 'canonical_task_writer', column_name: 'writer_token' },
          { table_name: 'canonical_task_writer', column_name: 'process_identity' },
          { table_name: 'canonical_task_writer', column_name: 'source_head' },
          { table_name: 'canonical_task_readiness', column_name: 'ready' },
          { table_name: 'canonical_task_readiness', column_name: 'writer_token' },
          { table_name: 'canonical_task_readiness', column_name: 'manifest_hash' },
          { table_name: 'canonical_task_readiness', column_name: 'schema_version' },
          { table_name: 'canonical_task_readiness', column_name: 'source_head' },
          { table_name: 'canonical_task_readiness', column_name: 'evidence_hash' },
          { table_name: 'canonical_task_readiness', column_name: 'evidence_path' },
          { table_name: 'canonical_task_operations', column_name: 'scope' },
          { table_name: 'canonical_task_operations', column_name: 'operation_key' },
          { table_name: 'canonical_task_operations', column_name: 'state' },
          { table_name: 'canonical_task_operations', column_name: 'writer_token' },
          { table_name: 'canonical_task_operations', column_name: 'authorization_snapshot' },
          { table_name: 'canonical_task_operations', column_name: 'recovery_checkpoint' },
        ].filter((column) => column.column_name !== overrides.missingColumn) };
      }
      if (sql.includes('pg_constraint')) return { rows: overrides.constraints ?? [{ contype: 'u', columns: ['scope', 'operation_key'] }, { contype: 'c', columns: ['state'] }] };
      if (sql.includes('pg_indexes')) return { rows: overrides.index === false ? [] : [{ indexname: 'canonical_task_operations_state_idx' }] };
      throw new Error(`Unexpected query: ${sql}`);
    }),
  };
}

describe('Canonical Task Postgres schema check', () => {
  it('verifies required tables, columns, constraints, and index', async () => {
    await expect(checkCanonicalTaskOperationSchema(completePool())).resolves.toMatchObject({
      ok: true,
      tables,
      constraints: ['operations_scope_operation_key_unique', 'operations_state_check'],
      indexes: ['canonical_task_operations_state_idx'],
    });
  });

  it('fails when a required column or database constraint is absent', async () => {
    await expect(checkCanonicalTaskOperationSchema(completePool({ missingColumn: 'evidence_hash' })))
      .rejects.toThrow(/evidence_hash/);
    await expect(checkCanonicalTaskOperationSchema(completePool({ constraints: [] })))
      .rejects.toThrow(/constraint/i);
  });
});
