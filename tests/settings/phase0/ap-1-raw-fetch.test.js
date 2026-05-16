// @ts-check
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('phase0 AP-1: HttpClient does not bypass CSRF', () => {
    it('AP-1: CoreApiClient does not call raw fetch directly', () => {
        const src = fs.readFileSync(path.resolve('public/modules/settings/settings-core.js'), 'utf8');
        const coreApiClient = src.slice(src.indexOf('export class CoreApiClient'));
        expect(coreApiClient).not.toMatch(/\bfetch\s*\(/);
        expect(coreApiClient).toMatch(/this\.client\.(get|post|put|delete)\(/);
    });
});
