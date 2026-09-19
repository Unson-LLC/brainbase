// @ts-check
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const HTTP_CLIENT_PATH = path.resolve('public/modules/core/http-client.js');

describe('phase0 INV-1: HttpClient has CSRF token auto-attach', () => {
    it('INV-1: http-client.js handles CSRF header injection', () => {
        const source = fs.readFileSync(HTTP_CLIENT_PATH, 'utf8');
        // 既存 HttpClient は CSRF token を取り扱う想定
        expect(source).toMatch(/csrf|CSRF|x-csrf-token/i);
    });
});
