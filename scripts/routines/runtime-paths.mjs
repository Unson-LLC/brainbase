import path from 'node:path';

import { resolveRuntimePaths } from '../../lib/runtime-paths.js';

export function resolveRoutineReceiptPaths({ repoDir, env = process.env } = {}) {
    const { varDir } = resolveRuntimePaths({ repoDir, env });
    return {
        outboxDir: path.resolve(env.CODEX_RUN_RECEIPT_OUTBOX_DIR
            || path.join(varDir, 'run-receipt-outbox', 'codex-automations')),
        deadLetterDir: path.resolve(env.CODEX_RUN_RECEIPT_DEAD_LETTER_DIR
            || path.join(varDir, 'run-receipt-dead-letter', 'codex-automations'))
    };
}
