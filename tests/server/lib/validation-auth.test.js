import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isInsecureHeaderAuthAllowed } from '../../../server/lib/validation.js';

describe('isInsecureHeaderAuthAllowed', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllowHeaders = process.env.ALLOW_INSECURE_SSOT_HEADERS;

    afterEach(() => {
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalNodeEnv;
        if (originalAllowHeaders === undefined) delete process.env.ALLOW_INSECURE_SSOT_HEADERS;
        else process.env.ALLOW_INSECURE_SSOT_HEADERS = originalAllowHeaders;
    });

    it('never enables self-asserted authorization headers in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_INSECURE_SSOT_HEADERS = 'true';

        expect(isInsecureHeaderAuthAllowed()).toBe(false);
    });

    it('keeps the explicit development-only compatibility mode', () => {
        process.env.NODE_ENV = 'development';
        process.env.ALLOW_INSECURE_SSOT_HEADERS = 'true';

        expect(isInsecureHeaderAuthAllowed()).toBe(true);
    });

    it('keeps fresh installations secure by default', () => {
        const setupScript = readFileSync(
            resolve(process.cwd(), 'scripts/setup.sh'),
            'utf8'
        );

        expect(setupScript).toContain('ALLOW_INSECURE_SSOT_HEADERS="false"');
        expect(setupScript).not.toContain('ALLOW_INSECURE_SSOT_HEADERS="true"');
    });
});
