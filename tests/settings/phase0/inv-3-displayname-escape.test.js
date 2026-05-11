// @ts-check
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SETTINGS_UI_PATH = path.resolve('public/modules/settings/settings-ui.js');

describe('phase0 INV-3: displayName escape before innerHTML', () => {
    it('INV-3: settings-ui.js imports escapeHtml and uses _escapeText for displayName', () => {
        const source = fs.readFileSync(SETTINGS_UI_PATH, 'utf8');
        expect(source).toMatch(/import .*escapeHtml.* from '\.\.\/ui-helpers\.js'/);
        expect(source).toMatch(/_escapeText\(tab\.displayName\)/);
    });
});
