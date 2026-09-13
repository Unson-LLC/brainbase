import { describe, expect, it } from 'vitest';

import {
    buildDailyOpsReportHtml,
    normalizeDailyOpsReport
} from '../../scripts/daily-ops-report.mjs';

describe('daily-ops-report', () => {
    it('retro report exposes the weekly judgment and outcome sections without write actions', () => {
        const report = normalizeDailyOpsReport({ mode: 'retro', date: '2026-09-07' });

        expect(report.sections.map((section) => section.id)).toEqual([
            'outcomes', 'decisionReplays', 'changedJudgments', 'mistakenAssumptions',
            'repeatedPatterns', 'systemChanges', 'personalKgReviews',
            'graphPromotionReviews', 'sourceCoverage'
        ]);
        expect(report.actions).toEqual([]);
    });

    it('ohayo report has decision-oriented sections without AI handoff actions', () => {
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
            'todayDecisions',
            'todayOutcomes',
            'aiWork',
            'carryovers'
        ]);
        expect(report.actions).toEqual([]);
    });

    it('accepts command-collected top-level section arrays', () => {
        const report = normalizeDailyOpsReport({
            mode: 'ohayo',
            date: '2026-05-12',
            calendar: [{ title: 'CxO会議', summary: '12:00-13:00' }],
            mail: [{ subject: 'Docusign再送のお願い', status: 'needs_reply' }],
            slack: [{ title: '小数点以下確認', status: 'needs_reply' }],
            priorityTasks: [{ title: '請求方針を回答', status: 'urgent' }]
        });

        expect(Object.fromEntries(report.sections.map((section) => [section.id, section.items.length]))).toEqual({
            calendar: 1,
            mail: 1,
            slack: 1,
            todayDecisions: 0,
            todayOutcomes: 1,
            aiWork: 0,
            carryovers: 0
        });
    });

    it('removes AI instruction UI and Untitled placeholders from every report mode', () => {
        for (const mode of ['ohayo', 'oyasumi', 'retro']) {
            const report = normalizeDailyOpsReport({
                mode,
                sections: [{
                    id: 'sample',
                    title: '確認',
                    items: [
                        { summary: '本文だけの項目' },
                        { title: 'Untitled', summary: '保存済みプレースホルダーの本文' }
                    ]
                }]
            });
            const html = buildDailyOpsReportHtml(report);

            expect(report.actions).toEqual([]);
            expect(html).not.toContain('AIに渡す次の指示');
            expect(html).not.toContain('Untitled');
            expect(html).not.toContain('id="action-data"');
            expect(html).toContain('class="app-shell"');
            expect(html.match(/本文だけの項目/g)).toHaveLength(1);
            expect(html.match(/保存済みプレースホルダーの本文/g)).toHaveLength(1);
        }
    });

    it('turns judgment capsules into readable labeled rows instead of one bold paragraph', () => {
        const report = normalizeDailyOpsReport({
            mode: 'oyasumi',
            sections: [{
                id: 'personalKg',
                title: '記憶候補',
                items: [{
                    title: 'Untitled',
                    summary: 'Context: セッションが止まった。 Judgment: 原因も調べる。 Reusable Pattern: 復旧と再発防止を分ける。 Apply When: 障害時。 Do Not Apply When: 一時停止のみ。',
                    status: '登録候補'
                }]
            }]
        });
        const item = report.sections[0].items[0];
        const html = buildDailyOpsReportHtml(report);

        expect(item.title).toBe('原因も調べる。');
        expect(item.summary).toBe('');
        expect(item.details).toEqual([
            { label: '背景', text: 'セッションが止まった。' },
            { label: '判断', text: '原因も調べる。' },
            { label: '再利用できる考え方', text: '復旧と再発防止を分ける。' },
            { label: '使う場面', text: '障害時。' },
            { label: '使わない場面', text: '一時停止のみ。' }
        ]);
        expect(html).toContain('<dt>判断</dt><dd>原因も調べる。</dd>');
        expect(html).toContain('<details class="item-more">');
        expect(html).toContain('<summary>背景と適用条件</summary>');
        expect(html).toContain('<span class="section-count">1件・登録候補</span>');
        expect(html).not.toContain('<span class="badge" data-tone="hold">登録候補</span>');
        expect(html).toContain('<h2>個人の記憶候補</h2>');
        expect(html).toContain('生成日時<br>');
        expect(html).not.toContain('Context:');
    });

    it('deduplicates identical judgment candidates and hides empty sections', () => {
        const candidate = {
            title: 'Untitled',
            summary: 'Context: 背景。 Judgment: 同じ判断。 Reusable Pattern: 同じ考え方。 Apply When: 対象。 Do Not Apply When: 対象外。',
            status: '登録候補'
        };
        const report = normalizeDailyOpsReport({
            mode: 'oyasumi',
            sections: [
                { id: 'personalKg', title: '個人の記憶候補', items: [candidate, candidate] },
                { id: 'failures', title: '失敗・未完了', items: [] }
            ]
        });
        const html = buildDailyOpsReportHtml(report);

        expect(report.sections[0].items).toHaveLength(1);
        expect(html.match(/同じ判断。/g)).toHaveLength(2);
        expect(html).not.toContain('失敗・未完了');
        expect(html).not.toContain('記録なし');
    });

    it('reduces retro reading load without hiding the first three items', () => {
        const report = normalizeDailyOpsReport({
            mode: 'retro',
            sections: [{
                id: 'outcomes',
                title: '今週の結果',
                items: ['一件目', '二件目', '三件目', '四件目', '五件目'].map((title) => ({ title }))
            }]
        });
        const html = buildDailyOpsReportHtml(report);

        expect(html).toContain('<details class="section-more">');
        expect(html).toContain('<summary>残り2件を表示</summary>');
        expect(html.indexOf('三件目')).toBeLessThan(html.indexOf('<details class="section-more">'));
        expect(html.indexOf('四件目')).toBeGreaterThan(html.indexOf('<details class="section-more">'));
        expect(html).toContain('font-weight: 500;');
    });

    it('adds a compact report overview and linked section index in every mode', () => {
        for (const mode of ['ohayo', 'oyasumi', 'retro']) {
            const report = normalizeDailyOpsReport({
                mode,
                sections: [
                    { id: 'first', title: '最初の確認', items: [{ title: '一件目' }, { title: '二件目' }] },
                    { id: 'empty', title: '空欄', items: [] },
                    { id: 'next', title: '次の確認', items: [{ title: '三件目' }] }
                ]
            });
            const html = buildDailyOpsReportHtml(report);

            expect(html).toContain('<nav class="report-index" aria-label="レポート内の目次">');
            expect(html).toContain('<strong>3</strong><span>表示中の項目</span>');
            expect(html).toContain('<strong>2</strong><span>セクション</span>');
            expect(html).toContain('href="#section-first"');
            expect(html).toContain('href="#section-next"');
            expect(html).toContain('<section id="section-first"');
            expect(html).toContain('<section id="section-next"');
            expect(html).not.toContain('href="#section-empty"');
        }
    });

    it('puts mode-specific focus sections before source and supporting sections', () => {
        const cases = [
            { mode: 'ohayo', focus: 'todayDecisions', support: 'calendar' },
            { mode: 'oyasumi', focus: 'failures', support: 'meetings' },
            { mode: 'retro', focus: 'systemChanges', support: 'decisionReplays' }
        ];

        for (const { mode, focus, support } of cases) {
            const report = normalizeDailyOpsReport({
                mode,
                sections: [
                    { id: support, title: '補足', items: [{ title: '補足情報' }] },
                    { id: focus, title: '重点', items: [{ title: '重点情報' }] }
                ]
            });
            const html = buildDailyOpsReportHtml(report);

            expect(html.indexOf(`id="section-${focus}" class="focus-section"`)).toBeLessThan(html.indexOf(`id="section-${support}"`));
            expect(html).toContain('<span class="focus-label">重点</span>');
            expect(html).toContain(`href="#section-${focus}" data-focus="true"`);
        }
    });

    it('progressively discloses long morning source sections', () => {
        const report = normalizeDailyOpsReport({
            mode: 'ohayo',
            sections: [{
                id: 'mail',
                title: 'Mail',
                items: ['一件目', '二件目', '三件目', '四件目', '五件目'].map((title) => ({ title }))
            }]
        });
        const html = buildDailyOpsReportHtml(report);

        expect(html).toContain('<summary>残り1件を表示</summary>');
        expect(html.indexOf('四件目')).toBeLessThan(html.indexOf('<details class="section-more">'));
        expect(html.indexOf('五件目')).toBeGreaterThan(html.indexOf('<details class="section-more">'));
    });

    it('omits evidence rows that have no usable reference', () => {
        const report = normalizeDailyOpsReport({
            mode: 'retro',
            evidence: [
                { type: 'ref', label: 'ref' },
                { type: 'log', label: '実行ログ', ref: '/tmp/run.log' }
            ]
        });
        const html = buildDailyOpsReportHtml(report);

        expect(html).toContain('実行ログ');
        expect(html).toContain('/tmp/run.log');
        expect(html).not.toContain('<p class="item-title">ref</p>');
        expect(html).toContain('<span class="section-count">1件</span>');
        expect(html).toContain('href="#section-evidence"');
        expect(html).toContain('<section id="section-evidence">');
    });

    it('preserves structured rows when a normalized report is normalized again', () => {
        const once = normalizeDailyOpsReport({
            mode: 'retro',
            sections: [{
                id: 'sample',
                title: '判断',
                items: [{ summary: 'Context: 背景。 Judgment: 判断。 Do Not Apply When: 対象外。' }]
            }]
        });
        const twice = normalizeDailyOpsReport(once);

        expect(twice.sections[0].items[0].details).toEqual(once.sections[0].items[0].details);
        expect(twice.sections[0].items[0].details).toHaveLength(3);
    });

    it('separates ohayo priorities into decisions, outcomes, AI work, and carryovers', () => {
        const report = normalizeDailyOpsReport({
            mode: 'ohayo',
            priorityTasks: [
                { summary: '復旧順を決める', status: '要判断' },
                { summary: '失敗境界を確定する', status: '今日の到達点' },
                { summary: 'ログを読む', status: 'AIが進める' },
                { summary: '配信確認', status: '未確認' }
            ]
        });

        expect(Object.fromEntries(report.sections.slice(3).map((section) => [section.id, section.items.map((item) => item.title)]))).toEqual({
            todayDecisions: ['復旧順を決める'],
            todayOutcomes: ['失敗境界を確定する'],
            aiWork: ['ログを読む'],
            carryovers: ['配信確認']
        });
    });

    it('escapes report content after action payloads are removed', () => {
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
        expect(html).not.toContain('Custom');
    });

    it('does not render the retired AI instruction handoff', () => {
        const report = normalizeDailyOpsReport({
            mode: 'ohayo',
            date: '2026-05-10'
        });

        const html = buildDailyOpsReportHtml(report);

        expect(html).not.toContain('指示をコピー');
        expect(html).not.toContain('AIに渡す次の指示');
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

    it('normalizes scalar meta without spreading strings into character keys', () => {
        const report = normalizeDailyOpsReport({
            mode: 'oyasumi',
            date: '2026-05-11',
            sections: {
                meetings: [{
                    title: 'Zeimsオンラインデモ',
                    meta: 'Unson-LLC/zeims-project'
                }]
            }
        });

        const html = buildDailyOpsReportHtml(report);

        expect(html).toContain('info: Unson-LLC/zeims-project');
        expect(html).not.toContain('0: U');
        expect(html).not.toContain('1: n');
    });

    it('adds oyasumi Personal KG count section from aggregate input', () => {
        const report = normalizeDailyOpsReport({
            mode: 'oyasumi',
            date: '2026-05-18',
            personalKg: {
                personal_kg_core: 11,
                sns_ready: 4,
                needs_redaction: 3,
                projection_allowed: 8
            }
        });

        const section = report.sections.find((item) => item.id === 'personalKg');
        const html = buildDailyOpsReportHtml(report);

        expect(section.items).toHaveLength(4);
        expect(section.items.map((item) => item.title)).toEqual([
            'personal_kg_core',
            'sns_ready',
            'needs_redaction',
            'projection_allowed'
        ]);
        expect(html).toContain('count: 11');
        expect(html).toContain('count: 4');
        expect(html).toContain('owner_judgment');
    });
});
