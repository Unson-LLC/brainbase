import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const routines = ['ohayo', 'oyasumi', 'retro'];

describe('routine command entrypoints', () => {
    it.each(routines)('%s commandはRoutine Runnerだけを呼ぶ薄い入口である', (routine) => {
        const command = fs.readFileSync(path.resolve(`.claude/commands/${routine}.md`), 'utf8');

        expect(command).toContain(`node scripts/routines/run.mjs ${routine}`);
        expect(command).not.toMatch(/\/api\//);
        expect(command).not.toMatch(/Graph SSOT|Personal KG|knowledge_event|Run Receipt履歴/);
        expect(command.split('\n').filter((line) => line.trim())).toHaveLength(3);
    });
});
