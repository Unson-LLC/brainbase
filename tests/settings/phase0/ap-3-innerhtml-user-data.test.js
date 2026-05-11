// @ts-check
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('phase0 AP-3: user-supplied displayName not directly innerHTML embedded', () => {
    it('AP-3: settings-ui.js does not embed ${tab.displayName} without escape', () => {
        const src = fs.readFileSync(path.resolve('public/modules/settings/settings-ui.js'), 'utf8');
        // 旧 pattern: bare ${tab.displayName} → 禁止
        expect(src).not.toMatch(/`[\s\S]{0,80}\$\{tab\.displayName\}[\s\S]{0,80}`/);
        // 新 pattern: escape 経由
        expect(src).toMatch(/_escapeText\(tab\.displayName\)/);
    });
});
