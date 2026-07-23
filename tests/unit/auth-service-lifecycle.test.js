import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('AuthService lifecycle', () => {
    it('allows a one-off Node process to exit after constructing AuthService', async () => {
        const run = promisify(execFile);
        const moduleUrl = pathToFileURL(
            path.resolve(process.cwd(), 'server/services/auth-service.js')
        ).href;
        const script = `
            const { AuthService } = await import(${JSON.stringify(moduleUrl)});
            new AuthService();
            process.stdout.write('constructed');
        `;
        const env = { ...process.env };
        delete env.INFO_SSOT_DATABASE_URL;
        delete env.INFO_SSOT_DB_URL;

        const result = await run(process.execPath, [
            '--input-type=module',
            '--eval',
            script
        ], {
            env,
            timeout: 2000
        });

        expect(result.stdout).toBe('constructed');
    });
});
