import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRuntimeEnv } from '../../../lib/load-runtime-env.js';

const originalGeneration = process.env.BRAINBASE_SERVER_GENERATION;

afterEach(() => {
    if (originalGeneration == null) delete process.env.BRAINBASE_SERVER_GENERATION;
    else process.env.BRAINBASE_SERVER_GENERATION = originalGeneration;
});

describe('loadRuntimeEnv', () => {
    it('loads the configured writer generation before startup creates a fallback', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-runtime-env-'));
        const envPath = path.join(directory, 'runtime.env');
        fs.writeFileSync(envPath, 'BRAINBASE_SERVER_GENERATION=configured-generation\n');
        delete process.env.BRAINBASE_SERVER_GENERATION;

        loadRuntimeEnv({ explicitPath: envPath, homeDir: directory, cwd: directory });

        expect(process.env.BRAINBASE_SERVER_GENERATION).toBe('configured-generation');
        fs.rmSync(directory, { recursive: true, force: true });
    });
});
