// @ts-check
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('feedback AP-1: feedback service does not mutate existing events', () => {
    it('AP-1: source does not call any update/delete on graphWriter', () => {
        const src = fs.readFileSync(path.resolve('server/services/sns/feedback-service.js'), 'utf8');
        expect(src).not.toMatch(/graphWriter\.(update|delete|remove|edit)/);
        expect(src).toMatch(/graphWriter\.appendEvent/);
    });
});
