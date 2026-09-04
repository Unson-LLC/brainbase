import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    VIBEPRO_HANDOFF_BOOTSTRAP_CONFIGURATION_ERROR,
    createVibeproHandoffBootstrap
} from '../../../server/bootstrap/vibepro-handoff-runtime.js';
import { JudgmentReceiptPostgresRepository } from '../../../server/services/judgment-receipt/judgment-receipt-postgres-repository.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(dirname, '../../..');

function configuredDependencies() {
    return {
        pool: { query() {} },
        infoSSOTService: { withAccessContext() {} },
        outcomeCaseService: { read() {} },
        env: {
            BRAINBASE_VIBEPRO_HANDOFF_ENABLED: '1',
            BRAINBASE_VIBEPRO_HANDOFF_SIGNING_KEY: 'a'.repeat(32),
            BRAINBASE_VIBEPRO_HANDOFF_KEY_ID: 'handoff-key-1'
        }
    };
}

describe('VibePro handoff bootstrap composition', () => {
    it.each([undefined, '0'])('keeps both persistence and issuance disabled for enabled=%j', (enabled) => {
        const env = enabled === undefined ? {} : { BRAINBASE_VIBEPRO_HANDOFF_ENABLED: enabled };

        expect(createVibeproHandoffBootstrap({ env })).toEqual({
            judgmentReceiptWriter: null,
            vibeproHandoffRuntime: null
        });
    });

    it('creates the scoped receipt writer and actual issuer runtime only for explicit enabled configuration', () => {
        const composition = createVibeproHandoffBootstrap(configuredDependencies());

        expect(composition.judgmentReceiptWriter).toBeInstanceOf(JudgmentReceiptPostgresRepository);
        expect(composition.vibeproHandoffRuntime).toEqual(expect.objectContaining({
            adopt: expect.any(Function),
            issue: expect.any(Function)
        }));
    });

    it.each([
        [{ BRAINBASE_VIBEPRO_HANDOFF_ENABLED: 'true' }],
        [{ BRAINBASE_VIBEPRO_HANDOFF_ENABLED: '1' }]
    ])('fails closed with an opaque fixed configuration code', (env) => {
        const input = { ...configuredDependencies(), env };

        expect(() => createVibeproHandoffBootstrap(input)).toThrow(expect.objectContaining({
            code: VIBEPRO_HANDOFF_BOOTSTRAP_CONFIGURATION_ERROR,
            message: 'VibePro handoff bootstrap configuration is invalid'
        }));
    });

    it.each(['pool', 'infoSSOTService', 'outcomeCaseService'])('rejects missing %s when enabled', (dependency) => {
        const input = configuredDependencies();
        delete input[dependency];
        expect(() => createVibeproHandoffBootstrap(input)).toThrow(expect.objectContaining({
            code: VIBEPRO_HANDOFF_BOOTSTRAP_CONFIGURATION_ERROR
        }));
    });

    it.each([
        ['BRAINBASE_VIBEPRO_HANDOFF_SIGNING_KEY', 'secret-too-short'],
        ['BRAINBASE_VIBEPRO_HANDOFF_SIGNING_KEY', `${'s'.repeat(32)}\n`],
        ['BRAINBASE_VIBEPRO_HANDOFF_KEY_ID', 'invalid key id']
    ])('rejects malformed %s without leaking configuration', (field, value) => {
        const input = configuredDependencies();
        input.env[field] = value;
        let failure;
        try {
            createVibeproHandoffBootstrap(input);
        } catch (error) {
            failure = error;
        }
        expect(failure).toMatchObject({
            code: VIBEPRO_HANDOFF_BOOTSTRAP_CONFIGURATION_ERROR,
            message: 'VibePro handoff bootstrap configuration is invalid'
        });
        expect(failure.cause).toBeUndefined();
        expect(String(failure)).not.toContain(value);
    });

    it('connects bootstrap artifacts from core services through server registration', () => {
        const coreSource = fs.readFileSync(path.join(repositoryRoot, 'server/bootstrap/core-services.js'), 'utf8');
        const serverSource = fs.readFileSync(path.join(repositoryRoot, 'server.js'), 'utf8');
        const routesSource = fs.readFileSync(path.join(repositoryRoot, 'server/bootstrap/register-api-routes.js'), 'utf8');
        const binding = serverSource.match(/const\s*\{([^{}]*)\}\s*=\s*createCoreServices\(/u)?.[1] || '';
        const registration = serverSource.match(/registerApiRoutes\(app,\s*\{([\s\S]*?)\n\}\);/u)?.[1] || '';

        expect(coreSource).toContain('createVibeproHandoffBootstrap');
        expect(coreSource).toContain('judgmentReceiptWriter');
        expect(coreSource).toContain('vibeproHandoffRuntime');
        expect(binding).toContain('judgmentReceiptWriter');
        expect(binding).toContain('vibeproHandoffRuntime');
        expect(registration).toContain('judgmentReceiptWriter');
        expect(registration).toContain('vibeproHandoffRuntime');
        expect(routesSource).toContain('registerJudgmentResolutionApiRoute(app, { authService, receiptWriter: judgmentReceiptWriter });');
    });
});
