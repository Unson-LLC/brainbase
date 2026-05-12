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

    it('accepts command-collected top-level section arrays', () => {
        const report = normalizeDailyOpsReport({
            mode: 'ohayo',
            date: '2026-05-12',
            calendar: [{ title: 'CxO会議', summary: '12:00-13:00' }],
            mail: [{ subject: 'Docusign再送のお願い', status: 'needs_reply' }],
            slack: [{ title: '小数点以下確認', status: 'needs_reply' }],
            archiveBlocked: [{ title: 'infisical調整', status: 'blocked' }],
            priorityTasks: [{ title: '請求方針を回答', status: 'urgent' }]
        });

        expect(Object.fromEntries(report.sections.map((section) => [section.id, section.items.length]))).toEqual({
            calendar: 1,
            mail: 1,
            slack: 1,
            archiveBlocked: 1,
            priorityTasks: 1
        });
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

    it('renders copy-only AI instruction handoff without dead Inbox API wiring', () => {
        const report = normalizeDailyOpsReport({
            mode: 'ohayo',
            date: '2026-05-10'
        });

        const html = buildDailyOpsReportHtml(report);

        expect(html).toContain('指示をコピー');
        expect(html).not.toContain("fetch(endpoint + '/api/inbox'");
        expect(html).not.toContain('Brainbase Inboxへ送る');
    });

    it('renders safe links for calendar mail and slack report items', () => {
        const report = normalizeDailyOpsReport({
            mode: 'ohayo',
            date: '2026-05-10',
            sections: {
                calendar: [{
                    title: '定例',
                    summary: '準備あり',
                    htmlLink: 'https://calendar.google.com/calendar/event?eid=abc'
                }],
                mail: [{
                    title: '確認依頼',
                    summary: '返信候補',
                    evidence: [{ type: 'gmail_thread_id', ref: 'thread-1' }]
                }],
                slack: [{
                    title: '未対応',
                    summary: '返信必要',
                    evidence: [{ type: 'slack_thread_ts', ref: 'C123/1760000000.000000' }]
                }],
                priorityTasks: [{
                    title: 'unsafe',
                    summary: 'javascript link is ignored',
                    url: 'javascript:alert(1)'
                }]
            },
            evidence: [{
                label: 'Calendar raw',
                ref: 'event abc',
                url: 'https://calendar.google.com/calendar/event?eid=abc'
            }]
        });

        const html = buildDailyOpsReportHtml(report);

        expect(html).toContain('href="https://calendar.google.com/calendar/event?eid=abc"');
        expect(html).toContain('href="https://mail.google.com/mail/u/0/#inbox/thread-1"');
        expect(html).toContain('href="slack://channel?team=T08EUJKQY07&amp;id=C123&amp;message=1760000000.000000"');
        expect(html).not.toContain('javascript:alert(1)');
    });

    it('converts Slack web permalinks to app deep links', () => {
        const report = normalizeDailyOpsReport({
            mode: 'ohayo',
            date: '2026-05-10',
            sections: {
                slack: [{
                    title: 'Slack確認',
                    links: [{
                        label: 'Slack web',
                        url: 'https://salestailor.slack.com/archives/C08SX913NER/p1778324649001229'
                    }]
                }]
            }
        });

        const html = buildDailyOpsReportHtml(report);

        expect(html).toContain('href="slack://channel?team=T08EUJKQY07&amp;id=C08SX913NER&amp;message=1778324649.001229"');
        expect(html).not.toContain('href="https://salestailor.slack.com/archives/C08SX913NER/p1778324649001229"');
    });
});
