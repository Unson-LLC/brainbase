import { describe, expect, it } from 'vitest';

import {
    buildDailyOpsReportHtml,
    normalizeDailyOpsReport
} from '../../scripts/daily-ops-report.mjs';

describe('daily-ops-report', () => {
    it('ohayo report has required sections and draft-only default actions', () => {
        const report = normalizeDailyOpsReport({
            mode: 'ohayo',
            date: '2026-05-09',
            sections: {
                slack: [{ title: 'Slack確認', summary: '返信が必要' }]
            }
        });

        expect(report.sections.map((section) => section.id)).toEqual([
            'calendar',
            'mail',
            'slack',
            'archiveBlocked',
            'priorityTasks'
        ]);
        expect(report.actions[0].instruction.safety).toEqual(expect.objectContaining({
            draft_only: true,
            dry_run: true,
            requires_confirmation: true
        }));
    });

    it('escapes report content and script JSON payloads', () => {
        const report = normalizeDailyOpsReport({
            mode: 'oyasumi',
            date: '2026-05-09',
            summary: '<img src=x onerror=alert(1)>',
            actions: [{
                id: 'custom',
                label: 'Custom',
                intent: 'custom',
                payload: { text: '</script><script>alert(1)</script>' }
            }]
        });

        const html = buildDailyOpsReportHtml(report);

        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(html).not.toContain('</script><script>alert(1)</script>');
        expect(html).toContain('\\u003c/script\\u003e');
    });

    it('renders an Inbox handoff button for selected AI instructions', () => {
        const report = normalizeDailyOpsReport({
            mode: 'ohayo',
            date: '2026-05-10'
        });

        const html = buildDailyOpsReportHtml(report);

        expect(html).toContain('Brainbase Inboxへ送る');
        expect(html).toContain("fetch(endpoint + '/api/inbox'");
        expect(html).toContain('実送信・実更新は別確認が必要です');
    });
});
