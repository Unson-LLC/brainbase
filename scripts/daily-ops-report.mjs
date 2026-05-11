#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const MODE_CONFIG = {
    ohayo: {
        label: 'Ohayo',
        defaultTitle: '朝のブリーフィング',
        sections: [
            ['calendar', 'Calendar'],
            ['mail', 'Mail'],
            ['slack', 'Slack'],
            ['archiveBlocked', 'Archive Blocked'],
            ['priorityTasks', '今日の優先タスク']
        ],
        actions: [
            {
                id: 'draft-slack-replies',
                label: 'Slack返信ドラフト',
                intent: 'slack_reply_draft',
                safety: { draft_only: true, dry_run: true, requires_confirmation: true }
            },
            {
                id: 'create-focus-tasks',
                label: 'タスク化案を作る',
                intent: 'task_draft',
                safety: { draft_only: true, dry_run: true, requires_confirmation: true }
            }
        ]
    },
    oyasumi: {
        label: 'Oyasumi',
        defaultTitle: '夜の振り返り',
        sections: [
            ['meetings', '会議'],
            ['decisions', 'Decision'],
            ['wikiNocodb', 'Wiki/NocoDB反映'],
            ['failures', '失敗・未完了'],
            ['carryovers', '翌日持ち越し']
        ],
        actions: [
            {
                id: 'draft-decisions',
                label: 'Decision下書き',
                intent: 'decision_draft',
                safety: { draft_only: true, dry_run: true, requires_confirmation: true }
            },
            {
                id: 'draft-next-day-tasks',
                label: '持ち越しタスク案',
                intent: 'carryover_task_draft',
                safety: { draft_only: true, dry_run: true, requires_confirmation: true }
            }
        ]
    }
};

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
        : config.sections.map(([id, title]) => normalizeSection(id, title, sectionsInput[id]));

    return {
        mode,
        modeLabel: config.label,
        title: input.title || config.defaultTitle,
        date,
        generatedAt: input.generatedAt || new Date().toISOString(),
        summary: input.summary || '',
        sections: sectionList.map((section) => normalizeSection(section.id, section.title, section)),
        evidence: normalizeEvidence(input.evidence || []),
        actions: normalizeActions([...(input.actions || []), ...config.actions], { mode, date })
    };
}

export function buildDailyOpsReportHtml(report) {
    const actionJson = safeJsonForScript(report.actions);
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
    main { max-width: 1180px; margin: 0 auto; padding: 44px 22px 64px; }
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
    .sections { display: grid; gap: 18px; }
    section, aside {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 10px;
      box-shadow: var(--shadow);
    }
    section { display: grid; grid-template-columns: 190px minmax(0, 1fr); padding: 0; overflow: hidden; }
    .section-heading {
      padding: 18px 18px 18px 20px;
      border-right: 1px solid var(--line-soft);
      background: rgba(255, 255, 255, 0.42);
    }
    .section-count {
      display: inline-block;
      margin-top: 8px;
      color: var(--faint);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
    }
    .section-body { min-width: 0; padding: 2px 20px; }
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
      max-width: 78ch;
      color: #3e4652;
      font-size: 14px;
      line-height: 1.8;
      white-space: pre-wrap;
    }
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
    .actions {
      position: sticky;
      top: 18px;
      display: grid;
      gap: 14px;
      padding: 18px;
      background: #fffdf9;
    }
    .actions h2 { margin-bottom: 7px; }
    .action-grid { display: grid; gap: 8px; }
    button {
      border: 1px solid var(--line);
      background: #ffffff;
      color: var(--text);
      border-radius: 8px;
      min-height: 38px;
      padding: 9px 11px;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      text-align: left;
      transition: border-color .16s ease, background-color .16s ease, transform .16s ease;
    }
    button:hover { border-color: var(--accent); background: #fbfffd; }
    button:active { transform: translateY(1px); }
    .copy-btn { background: var(--accent); color: #fff; border-color: var(--accent); text-align: center; font-weight: 700; }
    textarea {
      width: 100%;
      min-height: 230px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfaf7;
      color: #252b35;
      padding: 12px;
      font: 12px/1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      resize: vertical;
    }
    input {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #ffffff;
      min-height: 36px;
      padding: 8px 10px;
      font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .safety { color: var(--warn); font-size: 12px; line-height: 1.7; }
    .status { color: var(--muted); font-size: 12px; min-height: 18px; }
    @media (max-width: 900px) {
      main { padding: 28px 14px 44px; }
      header { grid-template-columns: 1fr; }
      .generated { justify-self: stretch; text-align: left; }
      .layout { grid-template-columns: 1fr; }
      .actions { position: static; }
      section { grid-template-columns: 1fr; }
      .section-heading { border-right: 0; border-bottom: 1px solid var(--line-soft); }
      .item-head { display: grid; }
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
      <p class="meta generated">Generated<br>${escapeHtml(formatGeneratedAt(report.generatedAt))}</p>
    </header>
    <div class="layout">
      <div class="sections">
        ${report.sections.map(renderSection).join('\n')}
        ${renderEvidenceSection(report.evidence)}
      </div>
      <aside class="actions">
        <div>
          <h2>AIに渡す次の指示</h2>
          <p class="safety">外部副作用は既定で draft_only / dry_run。実送信・実削除・実更新は別確認が必要。</p>
        </div>
        <div class="action-grid">
          ${report.actions.map((action) => `<button type="button" data-action-id="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`).join('\n')}
        </div>
        <textarea id="ai-instruction" readonly placeholder="ボタンを押すと、AIに渡す構造化指示が入ります"></textarea>
        <input id="brainbase-endpoint" value="http://127.0.0.1:31013" aria-label="Brainbase API endpoint">
        <button type="button" class="copy-btn" id="copy-instruction">指示をコピー</button>
        <p class="status" id="send-status"></p>
      </aside>
    </div>
  </main>
  <script type="application/json" id="action-data">${actionJson}</script>
  <script>
    const actions = JSON.parse(document.getElementById('action-data').textContent);
    const textarea = document.getElementById('ai-instruction');
    const sendStatus = document.getElementById('send-status');
    let selectedAction = null;
    document.querySelectorAll('[data-action-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = actions.find((item) => item.id === button.dataset.actionId);
        if (!action) return;
        selectedAction = action;
        textarea.value = JSON.stringify(action.instruction, null, 2);
      });
    });
    document.getElementById('copy-instruction').addEventListener('click', async () => {
      if (!textarea.value) return;
      await navigator.clipboard.writeText(textarea.value);
      sendStatus.textContent = 'コピーしました';
    });
  </script>
</body>
</html>
`;
}

function renderSection(section) {
    const items = section.items || [];
    return `<section>
  <div class="section-heading">
    <h2>${escapeHtml(section.title)}</h2>
    <span class="section-count">${items.length} item${items.length === 1 ? '' : 's'}</span>
  </div>
  <div class="section-body">
    ${items.length ? items.map(renderItem).join('\n') : '<p class="empty">記録なし</p>'}
  </div>
</section>`;
}

function renderItem(item) {
    const meta = Object.entries(item.meta || {})
        .filter(([key, value]) => key !== 'status' && value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(String(value))}`)
        .join(' / ');
    const evidence = normalizeEvidence(item.evidence || [])
        .map((entry) => `${escapeHtml(entry.type || 'ref')}: ${escapeHtml(entry.ref || entry.label || '')}`)
        .join(' / ');
    const links = renderLinks(item.links || []);
    const status = item.meta?.status ? String(item.meta.status) : '';
    const tone = getStatusTone(status);
    return `<article class="item">
  <div class="item-head">
    <p class="item-title">${escapeHtml(item.title || 'Untitled')}</p>
    ${status ? `<span class="badge" data-tone="${escapeHtml(tone)}">${escapeHtml(status)}</span>` : ''}
  </div>
  ${item.summary ? `<p class="item-summary">${escapeHtml(item.summary)}</p>` : ''}
  ${meta ? `<p class="item-meta">${meta}</p>` : ''}
  ${links}
  ${evidence ? `<p class="evidence">${evidence}</p>` : ''}
</article>`;
}

function renderEvidenceSection(evidence) {
    if (!evidence.length) return '';
    return `<section>
  <div class="section-heading">
    <h2>証跡</h2>
    <span class="section-count">${evidence.length} item${evidence.length === 1 ? '' : 's'}</span>
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
    if (Array.isArray(value)) return { id, title: fallbackTitle || id, items: value.map(normalizeItem) };
    if (typeof value === 'string') return { id, title: fallbackTitle || id, items: [{ title: fallbackTitle || id, summary: value, meta: {}, evidence: [] }] };
    return {
        id: value.id || id,
        title: value.title || fallbackTitle || id,
        items: Array.isArray(value.items) ? value.items.map(normalizeItem) : []
    };
}

function normalizeItem(value) {
    if (typeof value === 'string') return { title: value, summary: '', meta: {}, evidence: [] };
    const meta = { ...(value.meta || {}) };
    for (const key of ['status', 'deadline', 'assignee', 'source']) {
        if (value[key] !== undefined && value[key] !== null && value[key] !== '' && meta[key] === undefined) {
            meta[key] = value[key];
        }
    }
    const evidence = normalizeEvidence(value.evidence || []);
    return {
        title: value.title || value.name || value.subject || 'Untitled',
        summary: value.summary || value.detail || value.body || value.description || '',
        meta,
        links: mergeLinks(
            normalizeLinks(value.links || value.link || value.url || value.htmlLink || value.permalink || []),
            inferLinksFromEvidence(evidence)
        ),
        evidence
    };
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

function normalizeActions(actions, { mode, date }) {
    const seen = new Set();
    return actions
        .filter((action) => action && action.id && !seen.has(action.id) && seen.add(action.id))
        .map((action) => {
            const safety = {
                draft_only: true,
                dry_run: true,
                requires_confirmation: true,
                ...(action.safety || {})
            };
            return {
                id: action.id,
                label: action.label || action.id,
                instruction: {
                    source: 'daily_ops_html_report',
                    mode,
                    date,
                    intent: action.intent || action.id,
                    safety,
                    payload: action.payload || {},
                    required_user_confirmation_for: ['send', 'delete', 'update_external_service']
                }
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

function safeJsonForScript(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function escapeJs(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, ' ');
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
