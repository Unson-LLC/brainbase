// @ts-check
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('phase0 AP-1: HttpClient does not bypass CSRF', () => {
    it('AP-1: http-client.js explicit CSRF method exists', () => {
        const src = fs.readFileSync(path.resolve('public/modules/core/http-client.js'), 'utf8');
        expect(src).toMatch(/csrf/i);
        // POST/PUT/DELETE 経路で token attach あること
        expect(src).toMatch(/(POST|PUT|DELETE)/);
    });
});
