import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const thinRoutines = ['ohayo', 'oyasumi'];

describe('routine command entrypoints', () => {
    it.each(thinRoutines)('%s commandはRoutine Runnerだけを呼ぶ薄い入口である', (routine) => {
        const command = fs.readFileSync(path.resolve(`.claude/commands/${routine}.md`), 'utf8');

        expect(command).toContain(`node scripts/routines/run.mjs ${routine}`);
        expect(command).not.toMatch(/\/api\//);
        expect(command).not.toMatch(/Graph SSOT|Personal KG|knowledge_event|Run Receipt履歴/);
        expect(command.split('\n').filter((line) => line.trim())).toHaveLength(3);
    });

    it('retro commandは週次の入力契約を組み立ててRoutine Runnerを1回呼ぶ', () => {
        const command = fs.readFileSync(path.resolve('.claude/commands/retro.md'), 'utf8');

        expect(command).toContain('node scripts/routines/run.mjs retro');
        expect(command).toContain('"week_view"');
        expect(command).toContain('"source_coverage"');
        expect(command).toContain('Run Receiptを受信側で読み戻す');
        expect(command).not.toMatch(/\/api\//);
    });
});
