import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveRoutineReceiptPaths } from '../../scripts/routines/runtime-paths.mjs';

describe('routine receipt runtime paths', () => {
    it('cwdではなくresolveRuntimePathsのcanonical varDir配下を使う', () => {
        const paths = resolveRoutineReceiptPaths({
            repoDir: '/Users/ksato/workspace/code/brainbase',
            env: {
                BRAINBASE_VAR_DIR: '/tmp/brainbase-canonical-var'
            }
        });

        expect(paths).toEqual({
            outboxDir: '/tmp/brainbase-canonical-var/run-receipt-outbox/codex-automations',
            deadLetterDir: '/tmp/brainbase-canonical-var/run-receipt-dead-letter/codex-automations'
        });
        expect(paths.outboxDir).not.toBe(path.resolve('var/run-receipt-outbox/codex-automations'));
        expect(paths.deadLetterDir).not.toBe(path.resolve('var/run-receipt-dead-letter/codex-automations'));
    });

    it('BRAINBASE_STATE_PATHをBRAINBASE_VAR_DIRより優先する', () => {
        const paths = resolveRoutineReceiptPaths({
            repoDir: '/Users/ksato/workspace/code/brainbase',
            env: {
                BRAINBASE_STATE_PATH: '/tmp/brainbase-state-owner/state.json',
                BRAINBASE_VAR_DIR: '/tmp/brainbase-must-not-win'
            }
        });

        expect(paths).toEqual({
            outboxDir: '/tmp/brainbase-state-owner/run-receipt-outbox/codex-automations',
            deadLetterDir: '/tmp/brainbase-state-owner/run-receipt-dead-letter/codex-automations'
        });
    });

    it('CODEXのOutboxとDead Letterの個別指定だけを明示overrideとして使う', () => {
        const paths = resolveRoutineReceiptPaths({
            repoDir: '/Users/ksato/workspace/code/brainbase',
            env: {
                BRAINBASE_VAR_DIR: '/tmp/brainbase-canonical-var',
                CODEX_RUN_RECEIPT_OUTBOX_DIR: '/tmp/codex-explicit-outbox',
                CODEX_RUN_RECEIPT_DEAD_LETTER_DIR: '/tmp/codex-explicit-dead-letter'
            }
        });

        expect(paths).toEqual({
            outboxDir: '/tmp/codex-explicit-outbox',
            deadLetterDir: '/tmp/codex-explicit-dead-letter'
        });
    });
});
