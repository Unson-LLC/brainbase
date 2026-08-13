import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listRoutineDeadLetters } from '../../server/services/routine-runtime/dead-letter-reader.js';

const temporaryDirectories = [];

function createTemporaryDirectory() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-routine-dead-letter-'));
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('routine dead-letter reader', () => {
    it('workflow_idを優先し、監視に必要な3項目だけを返して本文を漏らさない', async () => {
        const directory = createTemporaryDirectory();
        const filePath = path.join(directory, 'workflow-id.json');
        fs.writeFileSync(filePath, JSON.stringify({
            source: { workflow_id: 'brainbase-ohayo', name: 'must-not-win' },
            run: { summary: 'secret meeting content', blocker_reason: 'sensitive failure detail' }
        }));
        const createdAt = new Date('2026-08-13T00:00:00.000Z');
        fs.utimesSync(filePath, createdAt, createdAt);

        const result = await listRoutineDeadLetters({ directory });

        expect(result).toEqual([{
            automation_id: 'brainbase-ohayo',
            created_at: createdAt.toISOString(),
            path: filePath
        }]);
        expect(JSON.stringify(result)).not.toContain('secret meeting content');
        expect(JSON.stringify(result)).not.toContain('sensitive failure detail');
    });

    it('workflow_idがない場合はsource.nameをautomation_idとして使う', async () => {
        const directory = createTemporaryDirectory();
        const filePath = path.join(directory, 'source-name.json');
        fs.writeFileSync(filePath, JSON.stringify({
            source: { name: 'brainbase-oyasumi' },
            run: { summary: 'must remain inside the dead-letter file' }
        }));
        const createdAt = new Date('2026-08-13T01:00:00.000Z');
        fs.utimesSync(filePath, createdAt, createdAt);

        await expect(listRoutineDeadLetters({ directory })).resolves.toEqual([{
            automation_id: 'brainbase-oyasumi',
            created_at: createdAt.toISOString(),
            path: filePath
        }]);
    });
});
