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
    :root { color-scheme: light; --bg: #f7f8fa; --panel: #fff; --text: #18202f; --muted: #667085; --line: #d9dee7; --accent: #2563eb; --warn: #b45309; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px 18px 48px; }
    header { display: grid; gap: 8px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: 28px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
    p { margin: 0; line-height: 1.6; }
    .meta { color: var(--muted); font-size: 13px; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 18px; align-items: start; }
    .sections { display: grid; gap: 14px; }
    section, aside { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
    .item { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 12px; }
    .item:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }
    .item-title { font-weight: 700; }
    .item-meta, .evidence { color: var(--muted); font-size: 12px; margin-top: 6px; }
    .empty { color: var(--muted); }
    .actions { position: sticky; top: 16px; display: grid; gap: 12px; }
    .action-grid { display: grid; gap: 8px; }
    button { border: 1px solid var(--line); background: #fff; color: var(--text); border-radius: 6px; min-height: 36px; padding: 8px 10px; font: inherit; cursor: pointer; text-align: left; }
    button:hover { border-color: var(--accent); }
    .copy-btn { background: var(--accent); color: #fff; border-color: var(--accent); text-align: center; }
    textarea { width: 100%; min-height: 220px; box-sizing: border-box; border: 1px solid var(--line); border-radius: 6px; padding: 10px; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; }
    input { width: 100%; box-sizing: border-box; border: 1px solid var(--line); border-radius: 6px; min-height: 34px; padding: 7px 9px; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .safety { color: var(--warn); font-size: 12px; }
    .status { color: var(--muted); font-size: 12px; min-height: 18px; }
    @media (max-width: 860px) { .layout { grid-template-columns: 1fr; } .actions { position: static; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="meta">${escapeHtml(report.modeLabel)} / ${escapeHtml(report.date)}</p>
      <h1>${escapeHtml(report.title)}</h1>
      <p>${escapeHtml(report.summary)}</p>
      <p class="meta">Generated: ${escapeHtml(report.generatedAt)}</p>
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
        <button type="button" id="send-inbox">Brainbase Inboxへ送る</button>
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
    document.getElementById('send-inbox').addEventListener('click', async () => {
      if (!selectedAction || !textarea.value) {
        sendStatus.textContent = '先に指示ボタンを選んでください';
        return;
      }
      const endpoint = document.getElementById('brainbase-endpoint').value.replace(/\\/$/, '');
      sendStatus.textContent = '送信中...';
      try {
        const csrfResponse = await fetch(endpoint + '/api/csrf-token', { credentials: 'include' });
        const csrf = csrfResponse.ok ? await csrfResponse.json() : {};
        const response = await fetch(endpoint + '/api/inbox', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf.token ? { 'X-CSRF-Token': csrf.token } : {})
          },
          body: JSON.stringify({
            source: 'daily_ops_html_report',
            title: selectedAction.label,
            sender: '${escapeJs(report.modeLabel)} Report',
            channel: 'daily-ops',
            message: '${escapeJs(report.modeLabel)} ${escapeJs(report.date)}: ' + selectedAction.label + ' を確認待ちにしました。実送信・実更新は別確認が必要です。',
            instruction: selectedAction.instruction
          })
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        sendStatus.textContent = 'Brainbase Inboxへ追加しました';
      } catch (error) {
        sendStatus.textContent = '送信できませんでした: ' + error.message;
      }
    });
  </script>
</body>
</html>
`;
}

function renderSection(section) {
    const items = section.items || [];
    return `<section>
  <h2>${escapeHtml(section.title)}</h2>
  ${items.length ? items.map(renderItem).join('\n') : '<p class="empty">記録なし</p>'}
</section>`;
}

function renderItem(item) {
    const meta = Object.entries(item.meta || {})
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(String(value))}`)
        .join(' / ');
    const evidence = normalizeEvidence(item.evidence || [])
        .map((entry) => `${escapeHtml(entry.type || 'ref')}: ${escapeHtml(entry.ref || entry.label || '')}`)
        .join(' / ');
    return `<article class="item">
  <p class="item-title">${escapeHtml(item.title || 'Untitled')}</p>
  <p>${escapeHtml(item.summary || '')}</p>
  ${meta ? `<p class="item-meta">${meta}</p>` : ''}
  ${evidence ? `<p class="evidence">${evidence}</p>` : ''}
</article>`;
}

function renderEvidenceSection(evidence) {
    if (!evidence.length) return '';
    return `<section>
  <h2>証跡</h2>
  ${evidence.map((entry) => `<article class="item"><p class="item-title">${escapeHtml(entry.label || entry.type || 'Evidence')}</p><p>${escapeHtml(entry.ref || '')}</p></article>`).join('\n')}
</section>`;
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
    return {
        title: value.title || value.name || value.subject || 'Untitled',
        summary: value.summary || value.body || value.description || '',
        meta: value.meta || {},
        evidence: normalizeEvidence(value.evidence || [])
    };
}

function normalizeEvidence(value) {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
        if (typeof entry === 'string') return { label: entry, ref: entry, type: 'ref' };
        return {
            label: entry.label || entry.type || entry.ref || '',
            type: entry.type || 'ref',
            ref: entry.ref || entry.id || entry.url || '',
            url: entry.url || ''
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
