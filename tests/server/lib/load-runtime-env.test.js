import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRuntimeEnv } from '../../../lib/load-runtime-env.js';

const originalGeneration = process.env.BRAINBASE_SERVER_GENERATION;
const originalCanonicalRuntimeTest = process.env.BRAINBASE_CANONICAL_RUNTIME_TEST;

afterEach(() => {
    if (originalGeneration == null) delete process.env.BRAINBASE_SERVER_GENERATION;
    else process.env.BRAINBASE_SERVER_GENERATION = originalGeneration;

    if (originalCanonicalRuntimeTest == null) delete process.env.BRAINBASE_CANONICAL_RUNTIME_TEST;
    else process.env.BRAINBASE_CANONICAL_RUNTIME_TEST = originalCanonicalRuntimeTest;
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

    it('loads the canonical personal runtime projection without a caller-specific env flag', () => {
        const homeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-runtime-home-'));
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-runtime-cwd-'));
        const envDirectory = path.join(homeDirectory, '.brainbase', 'runtime-env');
        fs.mkdirSync(envDirectory, { recursive: true });
        fs.writeFileSync(
            path.join(envDirectory, 'brainbase-production.env'),
            'BRAINBASE_CANONICAL_RUNTIME_TEST=canonical-runtime\n'
        );
        delete process.env.BRAINBASE_CANONICAL_RUNTIME_TEST;

        loadRuntimeEnv({ explicitPath: null, homeDir: homeDirectory, cwd });

        expect(process.env.BRAINBASE_CANONICAL_RUNTIME_TEST).toBe('canonical-runtime');
        fs.rmSync(homeDirectory, { recursive: true, force: true });
        fs.rmSync(cwd, { recursive: true, force: true });
    });
});
