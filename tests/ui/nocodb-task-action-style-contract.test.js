import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(process.cwd(), 'public/style.css'), 'utf8');

function getRulesContainingSelector(selector) {
    const matches = [];
    const rulePattern = /([^{}]+)\{([^{}]*)\}/gm;
    let match;
    while ((match = rulePattern.exec(css)) !== null) {
        if (match[1].includes(selector)) {
            matches.push({ selector: match[1].trim(), body: match[2] });
        }
    }
    return matches;
}

function getLastRule(selector) {
    const rules = getRulesContainingSelector(selector)
        .filter(rule => rule.selector === selector);
    return rules.at(-1)?.body || '';
}

describe('NocoDB task action style contract', () => {
    it('タスク操作ボタンはhoverでhit targetを移動しない', () => {
        const hoverRules = getRulesContainingSelector('.nocodb-task-action-btn:hover');

        expect(hoverRules.length).toBeGreaterThan(0);
        hoverRules.forEach(({ body }) => {
            expect(body).not.toMatch(/transform\s*:/);
        });
    });

    it('Command Centerのタスク操作ボタンは押しやすい固定サイズを持つ', () => {
        const actionRule = getLastRule('.command-center-theme #tasks-tab-content .nocodb-task-item .nocodb-task-action-btn');
        const actionsRule = getLastRule('.command-center-theme #tasks-tab-content .nocodb-task-item .nocodb-task-actions');
        const rowRule = getLastRule('.command-center-theme #tasks-tab-content .nocodb-task-item');

        expect(actionRule).toContain('width: 28px');
        expect(actionRule).toContain('height: 28px');
        expect(actionsRule).toContain('gap: 4px');
        expect(rowRule).toContain('grid-template-columns: 36px minmax(0, 1fr) 72px 94px 96px');
    });
});
