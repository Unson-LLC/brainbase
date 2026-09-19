import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('GitHub organization connection wiring', () => {
    it('constructs fail-closed production ports and passes them through server registration', () => {
        const core = read('server/bootstrap/core-services.js');
        const server = read('server.js');
        expect(core).toContain('createGitHubAppVerifierFromEnv({ env: process.env })');
        expect(core).toContain('createPostgresGitHubAuthorizationLedger({ pool: infoSSOTService.pool })');
        expect(core).toContain('isRemoteCredentialStoreConfigured(process.env)');
        expect(core).toContain('new MultitenantPostgresRepository({ pool: infoSSOTService.pool })');
        for (const port of [
            'organizationConnectionRepository', 'githubAppVerifier',
            'githubCredentialStore', 'githubAuthorizationLedger'
        ]) {
            expect(core).toContain(`${port},`);
            expect(server.match(new RegExp(`\\b${port}\\b`, 'gu'))?.length ?? 0).toBeGreaterThanOrEqual(2);
        }
    });
});
