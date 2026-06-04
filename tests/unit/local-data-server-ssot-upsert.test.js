// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    applyUpsertPlan,
    assertExecuteAllowed,
    buildUpsertPlan
} from '../../scripts/local-data-server-ssot-upsert.js';

let tmp;

function write(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

function item(overrides = {}) {
    const filePath = path.join(tmp, overrides.source_path || 'projects/brainbase/doc.md');
    if (!fs.existsSync(filePath)) write(filePath, '# Local Document\n');
    return {
        source_path: 'projects/brainbase/doc.md',
        absolute_path: filePath,
        source_root: tmp,
        source_kind: 'codex',
        source_subtype: 'project_document',
        target_table: 'graph_entities',
        target_type: 'document',
        target_key: 'codex:projects/brainbase/doc.md',
        title: 'Local Document',
        content_hash: 'hash-local',
        migration_status: 'local_only',
        ...overrides
    };
}

describe('local data server SSOT additive upsert', () => {
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ssot-upsert-'));
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('plans only local-only graph and wiki inserts, while skipping review states', () => {
        const wikiPath = path.join(tmp, 'wiki/brainbase/page.md');
        write(wikiPath, '# Wiki Page\n');

        const plan = buildUpsertPlan([
            item(),
            item({
                source_path: 'brainbase/page',
                absolute_path: wikiPath,
                source_kind: 'wiki',
                source_subtype: 'wiki_page',
                target_table: 'wiki_pages',
                target_type: 'wiki_page',
                target_key: 'wiki:brainbase/page',
                title: 'Wiki Page'
            }),
            item({ source_path: '.codex/history.jsonl', target_table: 'memory_candidates', target_type: 'personal_kg_candidate', migration_status: 'needs_extraction' }),
            item({ source_path: 'projects/brainbase/conflict.md', migration_status: 'conflict', review_reason: 'server row has different hash' }),
            item({ source_path: 'projects/brainbase/existing.md', migration_status: 'existing_server_match' }),
            item({ source_path: 'projects/brainbase/path-only.md', migration_status: 'existing_server_path_only' }),
            item({
                source_path: 'sns/rules.md',
                source_root: path.join(tmp, 'workspace'),
                migration_status: 'needs_review',
                review_reason: 'duplicate local source path suppressed by root priority',
                duplicate_of_source_root: path.join(tmp, '_codex'),
                duplicate_resolution: 'suppressed_by_root_priority'
            })
        ]);

        expect(plan.operations).toHaveLength(2);
        expect(plan.operations).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'insert', target_table: 'graph_entities', target_type: 'document' }),
            expect.objectContaining({ action: 'insert', target_table: 'wiki_pages', target_type: 'wiki_page' })
        ]));
        expect(plan.skips.map((skip) => skip.reason)).toEqual(expect.arrayContaining([
            'status:needs_extraction',
            'status:conflict',
            'status:existing_server_match',
            'status:existing_server_path_only',
            'status:needs_review'
        ]));
        expect(plan.skips).toEqual(expect.arrayContaining([
            expect.objectContaining({
                source_path: 'sns/rules.md',
                source_root: path.join(tmp, 'workspace'),
                duplicate_of_source_root: path.join(tmp, '_codex'),
                duplicate_resolution: 'suppressed_by_root_priority'
            })
        ]));
    });

    it('does not query the database in dry-run apply', async () => {
        const plan = buildUpsertPlan([item()]);
        const client = {
            query() {
                throw new Error('dry-run must not query');
            }
        };

        const result = await applyUpsertPlan(plan, { execute: false, client });

        expect(result).toEqual({ dry_run: true, inserted: 0, skipped_existing: 0, operations: 1 });
    });

    it('requires explicit confirmation, connection string, and max write guard for execute', () => {
        const plan = buildUpsertPlan([item(), item({ source_path: 'projects/brainbase/doc-2.md' })]);

        expect(() => assertExecuteAllowed({ execute: true, confirm: false, connectionString: 'postgres://example', maxWrites: 10 }, plan))
            .toThrow(/confirm-additive-upsert/u);
        expect(() => assertExecuteAllowed({ execute: true, confirm: true, connectionString: null, maxWrites: 10 }, plan))
            .toThrow(/requires INFO_SSOT_DATABASE_URL/u);
        expect(() => assertExecuteAllowed({ execute: true, confirm: true, connectionString: 'postgres://example', maxWrites: 1 }, plan))
            .toThrow(/exceed --max-writes/u);
        expect(() => assertExecuteAllowed({ execute: true, confirm: true, connectionString: 'postgres://example', maxWrites: 2 }, plan))
            .not.toThrow();
    });

    it('executes insert-only SQL for graph entities and wiki pages', async () => {
        const wikiPath = path.join(tmp, 'wiki/brainbase/page.md');
        write(wikiPath, '# Wiki Page\n');
        const plan = buildUpsertPlan([
            item(),
            item({
                source_path: 'brainbase/page',
                absolute_path: wikiPath,
                source_kind: 'wiki',
                source_subtype: 'wiki_page',
                target_table: 'wiki_pages',
                target_type: 'wiki_page',
                target_key: 'wiki:brainbase/page',
                title: 'Wiki Page'
            })
        ]);
        const sql = [];
        const client = {
            async query(statement) {
                sql.push(statement);
                return { rows: [{ id: 'inserted' }] };
            }
        };

        const result = await applyUpsertPlan(plan, { execute: true, client });

        expect(result.inserted).toBe(2);
        expect(sql).toHaveLength(2);
        expect(sql.every((statement) => /^\s*INSERT\b/iu.test(statement))).toBe(true);
        expect(sql.join('\n')).not.toMatch(/\bDELETE\b/iu);
        expect(sql.join('\n')).not.toMatch(/\bUPDATE\b/iu);
        expect(sql.join('\n')).toMatch(/ON CONFLICT \(id\) DO NOTHING/u);
        expect(sql.join('\n')).toMatch(/ON CONFLICT \(path\) DO NOTHING/u);
    });
});
