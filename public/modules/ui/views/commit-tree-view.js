/**
 * CommitTreeView
 * コミットツリーパネル — 1枚SVGグラフ描画
 * 参考: vscode-git-graph (single SVG + continuous paths)
 */
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';
import { escapeHtml } from '../../ui-helpers.js';

const LANE_W = 16;
const DOT_R = 4;
const ROW_H = 54;

const COLORS = [
    '#4a9eff', // blue
    '#ff6b6b', // red
    '#50c878', // green
    '#ffa500', // orange
    '#da70d6', // orchid
    '#40e0d0', // turquoise
    '#ffdf00', // yellow
    '#ff69b4', // hot pink
    '#87ceeb', // sky blue
    '#deb887', // burlywood
];

export class CommitTreeView {
    constructor({ commitTreeService }) {
        this.commitTreeService = commitTreeService;
        this.container = null;
        this._unsubscribers = [];
    }

    mount(container) {
        this.container = container;
        this._setupEventListeners();
        this.render();
    }

    _setupEventListeners() {
        const unsub1 = eventBus.on(EVENTS.SESSION_CHANGED, (e) => {
            const sessionId = e.detail?.sessionId || appStore.getState().currentSessionId;
            this._lastNotify = 0;
            this.commitTreeService.loadCommitLog(sessionId);
        });
        const unsub2 = eventBus.on(EVENTS.COMMIT_LOG_LOADED, () => {
            this.render();
        });
        this._unsubscribers.push(unsub1, unsub2);

        // リフレッシュボタン
        const refreshBtn = document.getElementById('refresh-commit-tree');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                const sessionId = appStore.getState().currentSessionId;
                if (sessionId) this.commitTreeService.loadCommitLog(sessionId);
            });
        }

        // commit-notify ポーリング（5秒間隔）
        this._lastNotify = 0;
        this._pollInterval = setInterval(async () => {
            const sessionId = appStore.getState().currentSessionId;
            if (!sessionId) return;
            const ts = await this.commitTreeService.checkCommitNotify(sessionId);
            if (ts > this._lastNotify) {
                this._lastNotify = ts;
                this.commitTreeService.loadCommitLog(sessionId);
            }
        }, 5000);
    }

    render() {
        if (!this.container) return;
        const commitLog = appStore.getState().commitLog;

        if (!commitLog) {
            this._renderEmpty('セッションを選択してください');
            return;
        }

        const { commits, repoType, repoName } = commitLog;
        if (!commits || commits.length === 0) {
            this._renderEmpty('コミットなし');
            this._updatePanelHeader(repoType, repoName);
            return;
        }

        this._updatePanelHeader(repoType, repoName);

        const graphRows = this._calculateGraphLayout(commits);
        const maxCols = Math.max(...graphRows.map(r => r.maxLanes), 1);
        const graphW = maxCols * LANE_W + 8;
        const totalH = graphRows.length * ROW_H;

        // 1枚SVG
        const graphSvg = this._renderFullGraph(graphRows, maxCols, totalH);

        // コミット情報行（1行表示 + 色分け）
        const rowsHtml = graphRows.map(row => {
            const c = row.commit;
            const cls = c.isWorkingCopy ? ' current' : '';
            const wcBadge = c.isWorkingCopy ? '<span class="commit-wc-badge">@</span>' : '';
            const bm = c.bookmarks.length > 0
                ? c.bookmarks.map(b => `<span class="commit-bookmark">${escapeHtml(b)}</span>`).join(' ')
                : '';
            const t = this._formatTime(c.timestamp);
            // グラフレーンの色を取得（COLORS配列）
            const laneColor = COLORS[row.column % COLORS.length];
            return `<div class="commit-row${cls}" style="color: ${laneColor}">
                <span class="commit-hash">${escapeHtml(c.hash)}</span>${wcBadge}
                <span class="commit-author">${escapeHtml(c.author)}</span>
                <span class="commit-time">${escapeHtml(t)}</span>
                ${bm}
                <span class="commit-desc">${escapeHtml(c.description)}</span>
            </div>`;
        }).join('');

        this.container.innerHTML = `<div class="commit-tree-content">
            ${graphSvg}
            <div class="commit-tree-rows" style="margin-left:${graphW}px">${rowsHtml}</div>
        </div>`;
    }

    _renderEmpty(msg) {
        if (!this.container) return;
        this.container.innerHTML = `<div class="commit-tree-empty">${escapeHtml(msg)}</div>`;
        this._updatePanelHeader(null, null);
    }

    // ─── グラフレイアウト計算 ───

    _calculateGraphLayout(commits) {
        let lanes = [];
        const rows = [];

        for (const commit of commits) {
            const hash = commit.hash;
            const parents = commit.parents || [];

            let col = lanes.indexOf(hash);
            if (col === -1) {
                col = lanes.indexOf(null);
                if (col === -1) { col = lanes.length; lanes.push(null); }
            }

            const prevLanes = [...lanes];
            const connections = [];

            if (parents.length === 0) {
                lanes[col] = null;
            } else {
                const fp = parents[0];
                let existing = -1;
                for (let j = 0; j < lanes.length; j++) {
                    if (j !== col && lanes[j] === fp) { existing = j; break; }
                }
                if (existing !== -1) {
                    connections.push({ to: existing });
                    lanes[col] = null;
                } else {
                    lanes[col] = fp;
                    connections.push({ to: col });
                }

                for (let p = 1; p < parents.length; p++) {
                    const par = parents[p];
                    let pLane = -1;
                    for (let j = 0; j < lanes.length; j++) {
                        if (lanes[j] === par) { pLane = j; break; }
                    }
                    if (pLane === -1) {
                        pLane = lanes.indexOf(null);
                        if (pLane === -1) { pLane = lanes.length; lanes.push(par); }
                        else { lanes[pLane] = par; }
                    }
                    connections.push({ to: pLane });
                }
            }

            while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

            rows.push({
                commit, column: col, prevLanes, nextLanes: [...lanes], connections,
                maxLanes: Math.max(prevLanes.length, lanes.length, col + 1)
            });
        }
        return rows;
    }

    // ─── 1枚SVG描画 ───

    _renderFullGraph(rows, maxCols, totalH) {
        const W = maxCols * LANE_W + 8;
        let lines = '';
        let dots = '';

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const y0 = i * ROW_H;
            const mid = y0 + ROW_H / 2;
            const y1 = y0 + ROW_H;
            const cx = row.column * LANE_W + LANE_W / 2 + 4;
            const cc = COLORS[row.column % COLORS.length];

            // パススルーレーン
            const connectionTargets = new Set(row.connections.map(c => c.to));
            const maxJ = Math.max(row.prevLanes.length, row.nextLanes.length);
            for (let j = 0; j < maxJ; j++) {
                if (j === row.column) continue;
                const inP = j < row.prevLanes.length && row.prevLanes[j] !== null;
                const inN = j < row.nextLanes.length && row.nextLanes[j] !== null;
                if (!inP && !inN) continue;
                // 新規レーンかつ接続先 → ベジェカーブが描画するのでhalf-lineスキップ
                if (!inP && inN && connectionTargets.has(j)) continue;
                const x = j * LANE_W + LANE_W / 2 + 4;
                const c = COLORS[j % COLORS.length];
                if (inP && inN) {
                    lines += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="${c}" stroke-width="2"/>`;
                } else if (inP) {
                    lines += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${mid}" stroke="${c}" stroke-width="2"/>`;
                } else {
                    lines += `<line x1="${x}" y1="${mid}" x2="${x}" y2="${y1}" stroke="${c}" stroke-width="2"/>`;
                }
            }

            // コミットレーン上半分
            if (row.column < row.prevLanes.length && row.prevLanes[row.column] !== null) {
                lines += `<line x1="${cx}" y1="${y0}" x2="${cx}" y2="${mid}" stroke="${cc}" stroke-width="2"/>`;
            }

            // 接続線
            for (const conn of row.connections) {
                const tx = conn.to * LANE_W + LANE_W / 2 + 4;
                const tc = COLORS[conn.to % COLORS.length];
                if (conn.to === row.column) {
                    // 直線下
                    lines += `<line x1="${cx}" y1="${mid}" x2="${tx}" y2="${y1}" stroke="${tc}" stroke-width="2"/>`;
                } else {
                    // ベジェカーブ
                    const d = ROW_H * 0.4;
                    lines += `<path d="M${cx},${mid} C${cx},${mid + d} ${tx},${y1 - d} ${tx},${y1}" stroke="${tc}" stroke-width="2" fill="none"/>`;
                }
            }

            // ドット（上レイヤー）
            const fill = row.commit.isWorkingCopy ? cc : 'var(--bg-primary, #0f0f23)';
            dots += `<circle cx="${cx}" cy="${mid}" r="${DOT_R}" fill="${fill}" stroke="${cc}" stroke-width="2"/>`;
        }

        return `<svg class="commit-tree-graph" width="${W}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">
            <g class="graph-lines">${lines}</g>
            <g class="graph-dots">${dots}</g>
        </svg>`;
    }

    // ─── ヘルパー ───

    _updatePanelHeader(repoType, repoName) {
        const badge = document.getElementById('commit-tree-repo-type');
        if (badge) {
            if (repoType) { badge.textContent = repoType; badge.classList.remove('hidden'); }
            else { badge.classList.add('hidden'); }
        }

        // リポジトリ名サブタイトル
        const header = badge?.closest('.section-header');
        if (header) {
            let sub = header.querySelector('.commit-tree-repo-name');
            if (!sub) {
                sub = document.createElement('div');
                sub.className = 'commit-tree-repo-name';
                header.appendChild(sub);
            }
            if (repoName) { sub.textContent = repoName; sub.classList.remove('hidden'); }
            else { sub.classList.add('hidden'); }
        }
    }

    _formatTime(ts) {
        if (!ts) return '';
        try {
            const d = new Date(ts);
            if (isNaN(d.getTime())) return ts;
            return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        } catch { return ts; }
    }

    unmount() {
        this._unsubscribers.forEach(fn => fn());
        this._unsubscribers = [];
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
        if (this.container) this.container.innerHTML = '';
    }
}
