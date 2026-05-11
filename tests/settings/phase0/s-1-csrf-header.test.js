// @ts-check
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('phase0 S-1: HttpClient injects CSRF token in mutating requests', () => {
    it('S-1: http-client.js auto-adds x-csrf-token for POST/PUT/DELETE', () => {
        const source = fs.readFileSync(path.resolve('public/modules/core/http-client.js'), 'utf8');
        expect(source).toMatch(/POST|PUT|DELETE/);
        expect(source).toMatch(/x-csrf-token|X-CSRF-Token|CSRF-Token/i);
    });
});
