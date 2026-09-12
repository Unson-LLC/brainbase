#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const MODE_CONFIG = {
    ohayo: {
        label: 'おはよう',
        defaultTitle: '朝のブリーフィング',
        sections: [
            ['calendar', 'Calendar'],
            ['mail', 'Mail'],
            ['slack', 'Slack'],
            ['priorityTasks', '今日の優先タスク']
        ],
        actions: []
    },
    oyasumi: {
        label: 'おやすみ',
        defaultTitle: '夜の振り返り',
        sections: [
            ['meetings', '会議'],
            ['decisions', '判断'],
            ['wikiNocodb', '記録への反映'],
            ['personalKg', '個人の記憶候補'],
            ['failures', '失敗・未完了'],
            ['carryovers', '翌日持ち越し']
        ],
        actions: []
    },
    retro: {
        label: 'レトロ',
        defaultTitle: '週次レトロ',
        sections: [
            ['outcomes', '今週変わった現実'],
            ['decisionReplays', '判断の振り返り'],
            ['changedJudgments', '過去判断との違い'],
            ['mistakenAssumptions', '誤っていた前提'],
            ['repeatedPatterns', '繰り返した問題'],
            ['systemChanges', '来週から変える仕組み'],
            ['personalKgReviews', '個人の記憶候補の見直し'],
            ['graphPromotionReviews', '組織知識への昇格候補'],
            ['sourceCoverage', '未確認・取得不能']
        ],
        actions: []
    }
};

const OHAYO_PRIORITY_GROUPS = [
    { id: 'todayDecisions', title: '今日決めること' },
    { id: 'todayOutcomes', title: '今日の到達点' },
    { id: 'aiWork', title: 'AIが進めること' },
    { id: 'carryovers', title: '持ち越し・未確認' }
];

const SLACK_TEAM_IDS_BY_DOMAIN = {
    salestailor: process.env.SLACK_TEAM_ID_SALESTAILOR
        || process.env.SLACK_SALESTAILOR_TEAM_ID
        || 'T08EUJKQY07'
};

export function normalizeDailyOpsReport(input = {}, options = {}) {
    const mode = options.mode || input.mode;
    const config = MODE_CONFIG[mode];
    if (!config) {
        throw new Error(`Unsupported report mode: ${mode || '(missing)'}`);
    }

    const date = options.date || input.date || new Date().toISOString().slice(0, 10);
    const sectionsInput = input.sections || {};
    const sectionList = Array.isArray(sectionsInput)
        ? sectionsInput
        : config.sections.map(([id, title]) => {
            if (mode === 'oyasumi' && id === 'personalKg') {
                return normalizePersonalKgSection(title, sectionsInput[id] ?? input[id] ?? input.personal_kg ?? input.oyasumi_personal_kg);
            }
            return normalizeSection(id, title, sectionsInput[id] ?? input[id]);
        });

    const canonicalTitles = new Map([
        ...config.sections,
        ...(mode === 'ohayo' ? OHAYO_PRIORITY_GROUPS.map(({ id, title }) => [id, title]) : [])
    ]);
    const normalizedSections = sectionList.map((section) => {
        const normalized = normalizeSection(section.id, section.title, section);
        return canonicalTitles.has(normalized.id)
            ? { ...normalized, title: canonicalTitles.get(normalized.id) }
            : normalized;
    });
    return {
        mode,
        modeLabel: config.label,
        title: input.title || config.defaultTitle,
        date,
        generatedAt: input.generatedAt || new Date().toISOString(),
        summary: input.summary || '',
        sections: mode === 'ohayo' ? organizeOhayoSections(normalizedSections) : normalizedSections,
        evidence: normalizeEvidence(input.evidence || []),
        actions: []
    };
}

function organizeOhayoSections(sections) {
    const groupIds = new Set(OHAYO_PRIORITY_GROUPS.map((group) => group.id));
    const groupedItems = Object.fromEntries(OHAYO_PRIORITY_GROUPS.map((group) => [group.id, []]));
    const baseSections = [];

    for (const section of sections) {
        if (groupIds.has(section.id)) {
            groupedItems[section.id].push(...section.items);
        } else if (section.id === 'priorityTasks') {
            for (const item of section.items) groupedItems[classifyOhayoPriority(item)].push(item);
        } else {
            baseSections.push(section);
        }
    }

    return [
        ...baseSections,
        ...OHAYO_PRIORITY_GROUPS.map((group) => ({ ...group, items: dedupeItems(groupedItems[group.id]) }))
    ];
}

function classifyOhayoPriority(item) {
    const status = String(item.meta?.status || '').toLowerCase();
    if (status.includes('要判断')) return 'todayDecisions';
    if (status.includes('aiが進める')) return 'aiWork';
    if (/(持ち越し|未確認|要確認|partial|waiting|blocked)/i.test(status)) return 'carryovers';
    return 'todayOutcomes';
}

function dedupeItems(items) {
    const seen = new Set();
    return items.filter((item) => {
        const key = JSON.stringify([
            item.title,
            item.summary,
            item.details || [],
            item.meta || {},
            item.links || [],
            item.evidence || []
        ]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function buildDailyOpsReportHtml(report) {
    return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.modeLabel)} ${escapeHtml(report.date)} - ${escapeHtml(report.title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f1eb;
      --paper: #fffdf8;
      --panel: #ffffff;
      --text: #20242c;
      --heading: #111827;
      --muted: #68707d;
      --faint: #8a929e;
      --line: #ded8cd;
      --line-soft: #ece6dc;
      --accent: #0f766e;
      --accent-soft: #e6f2ef;
      --warn: #9a5b13;
      --warn-soft: #fff4df;
      --shadow: 0 18px 42px rgba(39, 33, 24, 0.07);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        linear-gradient(180deg, rgba(255, 253, 248, 0.82), rgba(244, 241, 235, 0.96) 300px),
        var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif;
      font-size: 15px;
      line-height: 1.75;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }
    main { max-width: 1040px; margin: 0 auto; padding: 44px 22px 64px; }
    header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px 28px;
      align-items: end;
      margin-bottom: 28px;
      padding-bottom: 22px;
      border-bottom: 1px solid var(--line);
    }
    .eyebrow {
      margin: 0 0 8px;
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      max-width: 760px;
      color: var(--heading);
      font-size: clamp(30px, 4vw, 48px);
      font-weight: 760;
      letter-spacing: 0;
      line-height: 1.08;
    }
    h2 {
      margin: 0;
      color: var(--heading);
      font-size: 17px;
      font-weight: 740;
      letter-spacing: 0;
      line-height: 1.35;
    }
    p { margin: 0; }
    a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 3px; }
    .summary {
      max-width: 74ch;
      margin-top: 16px;
      color: #343a45;
      font-size: 16px;
      line-height: 1.85;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .generated {
      justify-self: end;
      min-width: 180px;
      padding: 10px 12px;
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.56);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      text-align: right;
    }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; align-items: start; }
    .layout-single { grid-template-columns: minmax(0, 1fr); }
    .sections { display: grid; gap: 28px; }
    section, aside {
      background: transparent;
      border: 0;
      border-top: 1px solid var(--line);
      border-radius: 0;
      box-shadow: none;
    }
    section { display: grid; grid-template-columns: 180px minmax(0, 1fr); padding: 20px 0 0; }
    .section-heading {
      padding: 0 24px 0 0;
    }
    .section-count {
      display: inline-block;
      margin-top: 8px;
      color: var(--faint);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
    }
    .section-body { min-width: 0; padding: 0; }
    .item {
      display: grid;
      gap: 7px;
      padding: 18px 0;
      border-top: 1px solid var(--line-soft);
    }
    .item:first-of-type { border-top: 0; }
    .item-head {
      display: flex;
      gap: 10px;
      align-items: baseline;
      justify-content: space-between;
    }
    .item-title {
      min-width: 0;
      color: var(--heading);
      font-weight: 720;
      line-height: 1.45;
    }
    .item-summary {
      max-width: 68ch;
      color: #3e4652;
      font-size: 15px;
      font-weight: 400;
      line-height: 1.9;
      white-space: pre-wrap;
    }
    .item-details {
      display: grid;
      gap: 8px;
      max-width: 65ch;
      margin: 0;
    }
    .item-detail {
      display: grid;
      grid-template-columns: 7em minmax(0, 1fr);
      gap: 14px;
      align-items: start;
    }
    .item-detail dt {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      line-height: 1.8;
    }
    .item-detail dd {
      margin: 0;
      color: #343b46;
      font-size: 14px;
      font-weight: 400;
      line-height: 1.85;
    }
    .item-more {
      max-width: 65ch;
      margin-top: 2px;
      color: var(--muted);
      font-size: 13px;
    }
    .item-more summary {
      width: fit-content;
      cursor: pointer;
      color: var(--accent);
      font-weight: 700;
    }
    .item-more[open] summary { margin-bottom: 10px; }
    .badge {
      flex: 0 0 auto;
      max-width: 46%;
      padding: 2px 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #f8f4ec;
      color: #5d6470;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.6;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badge[data-tone="done"], .badge[data-tone="ok"] {
      border-color: #b8d8d1;
      background: var(--accent-soft);
      color: #0f615b;
    }
    .badge[data-tone="warn"], .badge[data-tone="hold"] {
      border-color: #efd5a6;
      background: var(--warn-soft);
      color: var(--warn);
    }
    .item-meta, .evidence {
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1.65;
      overflow-wrap: anywhere;
    }
    .evidence { color: var(--faint); }
    .item-links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .item-link {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      padding: 3px 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--accent-soft);
      color: var(--accent);
      text-decoration: none;
      font-size: 12px;
      font-weight: 700;
    }
    .item-link:hover { border-color: var(--accent); background: #eef8f5; }
    .empty { padding: 18px 0; color: var(--muted); }
    @media (max-width: 900px) {
      main { padding: 28px 14px 44px; }
      header { grid-template-columns: 1fr; }
      .generated { justify-self: stretch; text-align: left; }
      .layout { grid-template-columns: 1fr; }
      section { grid-template-columns: 1fr; }
      .section-heading { padding: 0 0 12px; }
      .item-head { display: grid; }
      .item-detail { grid-template-columns: 1fr; gap: 2px; }
      .badge { max-width: 100%; justify-self: start; }
    }
    @media print {
      body { background: #fff; }
      main { max-width: none; padding: 0; }
      aside { display: none; }
      section { break-inside: avoid; box-shadow: none; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <p class="eyebrow">${escapeHtml(report.modeLabel)} / ${escapeHtml(report.date)}</p>
        <h1>${escapeHtml(report.title)}</h1>
        <p class="summary">${escapeHtml(report.summary)}</p>
      </div>
      <p class="meta generated">生成日時<br>${escapeHtml(formatGeneratedAt(report.generatedAt))}</p>
    </header>
    <div class="layout layout-single">
      <div class="sections">
        ${report.sections.filter((section) => section.items?.length).map(renderSection).join('\n')}
        ${renderEvidenceSection(report.evidence)}
      </div>
    </div>
  </main>
</body>
</html>
`;
}

function renderSection(section) {
    const items = section.items || [];
    const statuses = [...new Set(items.map((item) => String(item.meta?.status || '')).filter(Boolean))];
    const sharedStatus = statuses.length === 1 && items.every((item) => item.meta?.status) ? statuses[0] : '';
    return `<section>
  <div class="section-heading">
    <h2>${escapeHtml(section.title)}</h2>
    <span class="section-count">${items.length}件${sharedStatus ? `・${escapeHtml(sharedStatus)}` : ''}</span>
  </div>
  <div class="section-body">
    ${items.map((item) => renderItem(item, sharedStatus)).join('\n')}
  </div>
</section>`;
}

function renderItem(item, sharedStatus = '') {
    const meta = Object.entries(item.meta || {})
        .filter(([key, value]) => key !== 'status' && value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(String(value))}`)
        .join(' / ');
    const evidence = normalizeEvidence(item.evidence || [])
        .map((entry) => `${escapeHtml(entry.type || 'ref')}: ${escapeHtml(entry.ref || entry.label || '')}`)
        .join(' / ');
    const links = renderLinks(item.links || []);
    const status = item.meta?.status && item.meta.status !== sharedStatus ? String(item.meta.status) : '';
    const tone = getStatusTone(status);
    const hasHead = Boolean(item.title || status);
    const details = renderDetails(item.details || []);
    return `<article class="item">
  ${hasHead ? `<div class="item-head">
    ${item.title ? `<p class="item-title">${escapeHtml(item.title)}</p>` : '<span></span>'}
    ${status ? `<span class="badge" data-tone="${escapeHtml(tone)}">${escapeHtml(status)}</span>` : ''}
  </div>` : ''}
  ${item.summary ? `<p class="item-summary">${escapeHtml(item.summary)}</p>` : ''}
  ${details}
  ${meta ? `<p class="item-meta">${meta}</p>` : ''}
  ${links}
  ${evidence ? `<p class="evidence">${evidence}</p>` : ''}
</article>`;
}

function renderDetails(details) {
    if (!Array.isArray(details) || details.length === 0) return '';
    const primaryLabels = new Set(['判断', '再利用できる考え方']);
    const primary = details.filter((detail) => primaryLabels.has(detail.label));
    const secondary = details.filter((detail) => !primaryLabels.has(detail.label));
    const renderList = (items) => `<dl class="item-details">${items.map((detail) => `<div class="item-detail"><dt>${escapeHtml(detail.label)}</dt><dd>${escapeHtml(detail.text)}</dd></div>`).join('')}</dl>`;
    if (!primary.length) return renderList(details);
    return `${renderList(primary)}${secondary.length ? `<details class="item-more"><summary>背景と適用条件</summary>${renderList(secondary)}</details>` : ''}`;
}

function renderEvidenceSection(evidence) {
    if (!evidence.length) return '';
    return `<section>
  <div class="section-heading">
    <h2>証跡</h2>
    <span class="section-count">${evidence.length}件</span>
  </div>
  <div class="section-body">
    ${evidence.map((entry) => `<article class="item"><p class="item-title">${escapeHtml(entry.label || entry.type || 'Evidence')}</p><p class="item-summary">${escapeHtml(entry.ref || '')}</p>${renderLinks(entry.url ? [{ label: 'Open', url: entry.url }] : [])}</article>`).join('\n')}
  </div>
</section>`;
}

function renderLinks(links) {
    if (!Array.isArray(links) || links.length === 0) return '';
    return `<div class="item-links">${links.map((link) => `<a class="item-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label || link.url)}</a>`).join('')}</div>`;
}

function normalizeSection(id, fallbackTitle, value) {
    if (!value) return { id, title: fallbackTitle || id, items: [] };
    if (Array.isArray(value)) return { id, title: fallbackTitle || id, items: dedupeItems(value.map(normalizeItem)) };
    if (typeof value === 'string') return { id, title: fallbackTitle || id, items: [{ title: fallbackTitle || id, summary: value, meta: {}, evidence: [] }] };
    return {
        id: value.id || id,
        title: value.title || fallbackTitle || id,
        items: Array.isArray(value.items) ? dedupeItems(value.items.map(normalizeItem)) : []
    };
}

function normalizePersonalKgSection(fallbackTitle, value) {
    if (!value) return { id: 'personalKg', title: fallbackTitle || 'Personal KG', items: [] };
    if (Array.isArray(value) || typeof value === 'string' || value.items) {
        return normalizeSection('personalKg', fallbackTitle || 'Personal KG', value);
    }
    const counts = value.counts || value;
    const items = [
        {
            title: 'personal_kg_core',
            summary: '判断再現用のowner-visible core candidate。詳細保持はowner_judgmentに限定。',
            meta: {
                count: numberOrZero(counts.personal_kg_core ?? counts.core ?? counts.core_count),
                status: 'owner-only'
            }
        },
        {
            title: 'sns_ready',
            summary: 'SNS生成Contextで読めるprojection candidate。',
            meta: {
                count: numberOrZero(counts.sns_ready ?? counts.snsReady ?? counts.sns_ready_count),
                status: 'projection'
            }
        },
        {
            title: 'needs_redaction',
            summary: 'private / medical / counterparty confidential など、projection前にredactionまたはapprovalが必要なcandidate。',
            meta: {
                count: numberOrZero(counts.needs_redaction ?? counts.needsRedaction ?? counts.needs_redaction_count),
                status: 'hold'
            }
        },
        {
            title: 'projection_allowed',
            summary: 'SNS/team/orgへ別instance化できる候補。core本文を直接外部化しない。',
            meta: {
                count: numberOrZero(counts.projection_allowed ?? counts.projectionAllowed ?? counts.projection_allowed_count),
                status: 'candidate'
            }
        }
    ];
    return { id: 'personalKg', title: fallbackTitle || 'Personal KG', items };
}

function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function normalizeItem(value) {
    if (typeof value === 'string') return { title: value, summary: '', meta: {}, evidence: [] };
    const meta = normalizeMeta(value.meta);
    for (const key of ['status', 'deadline', 'assignee', 'source']) {
        if (value[key] !== undefined && value[key] !== null && value[key] !== '' && meta[key] === undefined) {
            meta[key] = value[key];
        }
    }
    const evidence = normalizeEvidence(value.evidence || []);
    const titleCandidate = value.title || value.name || value.subject || '';
    const explicitTitle = isPlaceholderTitle(titleCandidate) ? '' : titleCandidate;
    const body = value.summary || value.detail || value.body || value.description || '';
    const details = normalizeDetails(value.details).length
        ? normalizeDetails(value.details)
        : parseStructuredSummary(body);
    const judgment = details.find((detail) => detail.label === '判断')?.text || '';
    const promoteBody = !explicitTitle && !details.length && body.length <= 80;
    return {
        title: explicitTitle || (judgment ? shortenTitle(judgment) : (promoteBody ? body : '')),
        summary: details.length || promoteBody ? '' : body,
        details,
        meta,
        links: mergeLinks(
            normalizeLinks(value.links || value.link || value.url || value.htmlLink || value.permalink || []),
            inferLinksFromEvidence(evidence)
        ),
        evidence
    };
}

function shortenTitle(value, maxLength = 44) {
    const text = String(value || '').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function parseStructuredSummary(value) {
    const text = String(value || '').trim();
    const labelMap = {
        Context: '背景',
        Judgment: '判断',
        'Reusable Pattern': '再利用できる考え方',
        'Apply When': '使う場面',
        'Do Not Apply When': '使わない場面'
    };
    const matches = [...text.matchAll(/(?:^|\s)(Context|Judgment|Reusable Pattern|Apply When|Do Not Apply When):\s*/g)]
        .map((match) => ({
            label: labelMap[match[1]],
            index: match.index,
            valueStart: match.index + match[0].length
        }));
    if (matches.length < 2) return [];
    return matches.map((entry, index) => {
        const end = matches[index + 1]?.index ?? text.length;
        return { label: entry.label, text: text.slice(entry.valueStart, end).trim() };
    }).filter((entry) => entry.text);
}

function normalizeDetails(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => ({
            label: String(entry?.label || '').trim(),
            text: String(entry?.text || '').trim()
        }))
        .filter((entry) => entry.label && entry.text);
}

function isPlaceholderTitle(value) {
    return /^untitled(?:\s+item)?$/i.test(String(value || '').trim());
}

function normalizeMeta(value) {
    if (!value) return {};
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return { info: String(value) };
    }
    if (Array.isArray(value)) {
        return {
            info: value
                .filter((entry) => entry !== undefined && entry !== null && entry !== '')
                .map((entry) => String(entry))
                .join(' / ')
        };
    }
    if (typeof value !== 'object') return {};
    return { ...value };
}

function inferLinksFromEvidence(evidence) {
    return normalizeLinks(evidence.flatMap((entry) => {
        if (entry.url) return [{ label: entry.label || 'Open', url: entry.url }];
        if (entry.type === 'gmail_thread_id' && entry.ref) {
            return [{ label: 'Gmail thread', url: `https://mail.google.com/mail/u/0/#inbox/${entry.ref}` }];
        }
        const slackUrl = inferSlackDeepLink(entry);
        if (slackUrl) return [{ label: 'Slack app', url: slackUrl }];
        return [];
    }));
}

function inferSlackDeepLink(entry) {
    if (!entry || !String(entry.type || '').startsWith('slack_')) return '';
    const channelAndTs = parseSlackChannelAndTs(entry);
    if (!channelAndTs) return '';
    return buildSlackDeepLink({
        team: channelAndTs.team,
        channel: channelAndTs.channel,
        ts: channelAndTs.ts
    });
}

function parseSlackChannelAndTs(entry) {
    const ref = String(entry.ref || '').trim();
    const refMatch = ref.match(/\b([CDG][A-Z0-9]+)\/([0-9]{10,}\.[0-9]+)\b/);
    if (refMatch) return { team: resolveSlackTeamId(entry), channel: refMatch[1], ts: refMatch[2] };

    const channel = String(entry.channel_id || entry.channelId || entry.channel || '').trim();
    const ts = String(entry.ts || entry.message_ts || entry.thread_ts || '').trim();
    if (/^[CDG][A-Z0-9]+$/.test(channel) && /^[0-9]{10,}\.[0-9]+$/.test(ts)) {
        return { team: resolveSlackTeamId(entry), channel, ts };
    }
    return null;
}

function resolveSlackTeamId(entry = {}) {
    const explicit = String(entry.team_id || entry.teamId || entry.team || '').trim();
    if (/^T[A-Z0-9]+$/.test(explicit)) return explicit;

    const workspace = String(entry.workspace || entry.domain || 'salestailor').trim().toLowerCase();
    return SLACK_TEAM_IDS_BY_DOMAIN[workspace] || '';
}

function buildSlackDeepLink({ team, channel, ts }) {
    if (!/^T[A-Z0-9]+$/.test(String(team || ''))) return '';
    if (!/^[CDG][A-Z0-9]+$/.test(String(channel || ''))) return '';
    if (!/^[0-9]{10,}\.[0-9]+$/.test(String(ts || ''))) return '';

    const params = new URLSearchParams({
        team,
        id: channel,
        message: ts
    });
    return `slack://channel?${params.toString()}`;
}

function normalizeSlackArchiveUrl(url) {
    const parsed = new URL(url);
    const hostMatch = parsed.hostname.match(/^([a-z0-9-]+)\.slack\.com$/i);
    if (!hostMatch) return '';

    const pathMatch = parsed.pathname.match(/^\/archives\/([CDG][A-Z0-9]+)\/p([0-9]{10})([0-9]{6})$/);
    if (!pathMatch) return '';

    const workspace = hostMatch[1].toLowerCase();
    const team = SLACK_TEAM_IDS_BY_DOMAIN[workspace] || '';
    const channel = pathMatch[1];
    const ts = `${pathMatch[2]}.${pathMatch[3]}`;
    return buildSlackDeepLink({ team, channel, ts });
}

function mergeLinks(...linkGroups) {
    const seen = new Set();
    return linkGroups
        .flat()
        .filter((link) => {
            if (!link?.url || seen.has(link.url)) return false;
            seen.add(link.url);
            return true;
        });
}

function normalizeLinks(value) {
    const items = Array.isArray(value) ? value : [value];
    return items
        .map((entry) => {
            if (!entry) return null;
            if (typeof entry === 'string') {
                const url = normalizeLinkUrl(entry);
                return url ? { label: url, url } : null;
            }
            const rawUrl = entry.url || entry.href || entry.htmlLink || entry.permalink || '';
            const url = normalizeLinkUrl(rawUrl);
            if (!url) return null;
            return {
                label: entry.label || entry.title || entry.kind || entry.type || url,
                url
            };
        })
        .filter(Boolean);
}

function normalizeLinkUrl(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'slack:') return url;
        const slackDeepLink = parsed.protocol === 'https:' ? normalizeSlackArchiveUrl(url) : '';
        if (slackDeepLink) return slackDeepLink;
        if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return url;
    } catch {
        // Relative links are intentionally not accepted in generated local reports.
    }
    return '';
}

function getStatusTone(status) {
    const text = String(status || '').toLowerCase();
    if (/完了|成功|取得済み|done|success|ok|passed/.test(text)) return 'done';
    if (/未投入|候補|未完了|失敗|要|保留|task化|pending|failed|hold|warn/.test(text)) return 'hold';
    return 'neutral';
}

function formatGeneratedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function normalizeEvidence(value) {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
        if (typeof entry === 'string') return { label: entry, ref: entry, type: 'ref' };
        const url = normalizeLinkUrl(entry.url || entry.href || entry.htmlLink || entry.permalink || '');
        return {
            label: entry.label || entry.type || entry.ref || '',
            type: entry.type || 'ref',
            ref: entry.ref || entry.id || url || '',
            url,
            channel_id: entry.channel_id || entry.channelId || entry.channel || '',
            ts: entry.ts || entry.message_ts || entry.thread_ts || ''
        };
    });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parseArgs(argv) {
    const options = { mode: null, date: null, input: null, outputDir: path.join(repoRoot, 'var', 'daily-ops-reports') };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--') && !options.mode) {
            options.mode = arg;
        } else if (arg === '--date') {
            options.date = argv[++i];
        } else if (arg === '--input') {
            options.input = argv[++i];
        } else if (arg === '--output-dir') {
            options.outputDir = path.resolve(argv[++i]);
        }
    }
    return options;
}

async function readInput(inputPath) {
    if (!inputPath || inputPath === '-') {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        const text = Buffer.concat(chunks).toString('utf8').trim();
        return text ? JSON.parse(text) : {};
    }
    return JSON.parse(await fs.readFile(path.resolve(inputPath), 'utf8'));
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const input = await readInput(options.input);
    const report = normalizeDailyOpsReport(input, options);
    const html = buildDailyOpsReportHtml(report);
    await fs.mkdir(options.outputDir, { recursive: true });
    const baseName = `${report.mode}-${report.date}`;
    const htmlPath = path.join(options.outputDir, `${baseName}.html`);
    const jsonPath = path.join(options.outputDir, `${baseName}.json`);
    await fs.writeFile(htmlPath, html);
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
    console.log(htmlPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
