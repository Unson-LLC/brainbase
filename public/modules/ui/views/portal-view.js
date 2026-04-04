// @ts-check
/**
 * PortalView - プロジェクトポータル
 *
 * メンバーが「向かう先」「課題」「現在地」「チーム」を1画面で見るビュー。
 * Info Drawer の portal タブとして表示される。
 */
import { BaseView } from './base-view.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';

export class PortalView extends BaseView {
    constructor({ portalService, configProjects }) {
        super();
        this.portalService = portalService;
        this.configProjects = configProjects || [];
        this._collapsedSections = new Set();
    }

    _setupEventListeners() {
        this._renderOn(eventBus, EVENTS.PORTAL_DATA_LOADED);
    }

    async render() {
        if (!this.container) return;

        const data = this.portalService.getPortalData();
        const currentProject = this.portalService.getCurrentProject();

        this.container.innerHTML = `
            <div class="portal-view">
                ${this._renderHeader(currentProject)}
                <div class="portal-body">
                    ${data ? this._renderPortalContent(data) : this._renderEmpty()}
                </div>
            </div>
        `;

        this._attachHandlers();

        if (typeof window.lucide !== 'undefined') {
            window.lucide.createIcons({ attrs: { class: 'lucide-icon' } });
        }
    }

    _renderHeader(currentProject) {
        const options = this.configProjects
            .map(p => `<option value="${p.id}" ${p.id === currentProject ? 'selected' : ''}>${p.name || p.id}</option>`)
            .join('');

        return `
            <div class="portal-header">
                <select class="portal-project-selector" id="portal-project-select">
                    <option value="">-- Select Project --</option>
                    ${options}
                </select>
                <button class="icon-btn portal-refresh-btn" id="portal-refresh" title="更新">
                    <i data-lucide="refresh-cw"></i>
                </button>
            </div>
        `;
    }

    _renderEmpty() {
        return `<div class="portal-empty">プロジェクトを選択してください</div>`;
    }

    _renderPortalContent(data) {
        return [
            this._renderDirectionSection(data.direction),
            this._renderIssuesSection(data.issues),
            this._renderPositionSection(data.milestones, data.tasks, data.health),
            this._renderTeamSection(data.members, data.tasks)
        ].join('');
    }

    // ==================== Direction ====================

    _renderDirectionSection(direction) {
        const collapsed = this._collapsedSections.has('direction');
        const content = direction?.available
            ? `<div class="portal-markdown">${this._renderMarkdown(direction.content)}</div>`
            : `<div class="portal-section-empty">project.md が見つかりません</div>`;

        return this._renderSection('direction', '向かう先', 'compass', content, collapsed);
    }

    // ==================== Issues ====================

    _renderIssuesSection(issues) {
        const collapsed = this._collapsedSections.has('issues');
        const stats = issues?.stats || { open: 0, highImpact: 0 };
        const badge = stats.open > 0
            ? `<span class="portal-badge">${stats.open} open${stats.highImpact > 0 ? `, ${stats.highImpact} high` : ''}</span>`
            : '';

        const items = (issues?.items || []).map(issue => {
            const impactIcon = issue.impact === 'high' ? '🔴' : issue.impact === 'medium' ? '🟡' : '🔵';
            const statusClass = `portal-issue-status-${issue.status}`;
            return `
                <div class="portal-issue-item ${statusClass}">
                    <span class="portal-issue-impact">${impactIcon}</span>
                    <div class="portal-issue-info">
                        <div class="portal-issue-title">${this._escapeHtml(issue.title)}</div>
                        <div class="portal-issue-meta">
                            <span class="portal-issue-type">${this._escapeHtml(issue.type)}</span>
                            <span class="portal-issue-status">${this._escapeHtml(issue.status)}</span>
                            ${issue.assignee ? `<span class="portal-issue-assignee">@${this._escapeHtml(issue.assignee)}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const content = items || '<div class="portal-section-empty">課題はありません</div>';
        return this._renderSection('issues', `課題 ${badge}`, 'alert-triangle', content, collapsed);
    }

    // ==================== Position ====================

    _renderPositionSection(milestones, tasks, health) {
        const collapsed = this._collapsedSections.has('position');
        const stats = tasks?.stats || {};

        const healthColor = (health?.score ?? 0) >= 70 ? 'var(--success-color)' : (health?.score ?? 0) >= 50 ? 'var(--warning-color)' : 'var(--danger-color)';

        const milestonesHtml = (milestones || []).map(m => {
            const pct = Math.min(100, Math.max(0, m.progress || 0));
            return `
                <div class="portal-milestone">
                    <div class="portal-milestone-header">
                        <span>${this._escapeHtml(m.name)}</span>
                        <span>${pct}%</span>
                    </div>
                    <div class="portal-progress-bar">
                        <div class="portal-progress-fill" style="width: ${pct}%"></div>
                    </div>
                </div>
            `;
        }).join('');

        const content = `
            <div class="portal-health-score" style="border-left: 3px solid ${healthColor}">
                Health Score: <strong>${health?.score ?? '-'}</strong>
            </div>
            ${milestonesHtml || '<div class="portal-section-empty">マイルストーンなし</div>'}
            <div class="portal-task-stats">
                <div class="portal-stat">
                    <span class="portal-stat-value">${stats.total || 0}</span>
                    <span class="portal-stat-label">合計</span>
                </div>
                <div class="portal-stat">
                    <span class="portal-stat-value" style="color: var(--success-color)">${stats.completed || 0}</span>
                    <span class="portal-stat-label">完了</span>
                </div>
                <div class="portal-stat">
                    <span class="portal-stat-value" style="color: var(--accent-color)">${stats.inProgress || 0}</span>
                    <span class="portal-stat-label">進行中</span>
                </div>
                <div class="portal-stat">
                    <span class="portal-stat-value" style="color: var(--danger-color)">${stats.overdue || 0}</span>
                    <span class="portal-stat-label">期限超過</span>
                </div>
            </div>
        `;

        return this._renderSection('position', '現在地', 'map-pin', content, collapsed);
    }

    // ==================== Team ====================

    _renderTeamSection(members, tasks) {
        const collapsed = this._collapsedSections.has('team');
        const taskItems = tasks?.items || [];

        const membersHtml = (members || []).map(m => {
            const taskCount = taskItems.filter(t => t.assignee === m.name && t.status !== '完了').length;
            const raciLabel = (m.raciRoles || []).map(r => r.roleCode).join(', ');
            return `
                <div class="portal-member">
                    <div class="portal-member-name">${this._escapeHtml(m.name)}</div>
                    <div class="portal-member-meta">
                        <span class="portal-member-role">${this._escapeHtml(m.role)}</span>
                        ${raciLabel ? `<span class="portal-member-raci">${this._escapeHtml(raciLabel)}</span>` : ''}
                        <span class="portal-member-tasks">${taskCount}件</span>
                    </div>
                </div>
            `;
        }).join('');

        const content = membersHtml || '<div class="portal-section-empty">メンバー情報なし</div>';
        return this._renderSection('team', 'チーム', 'users', content, collapsed);
    }

    // ==================== Helpers ====================

    _renderSection(id, title, icon, content, collapsed) {
        return `
            <div class="portal-section ${collapsed ? 'collapsed' : ''}" data-section="${id}">
                <div class="portal-section-header" data-toggle="${id}">
                    <i data-lucide="${collapsed ? 'chevron-right' : 'chevron-down'}" class="portal-section-chevron"></i>
                    <i data-lucide="${icon}"></i>
                    <span>${title}</span>
                </div>
                <div class="portal-section-content" ${collapsed ? 'style="display:none"' : ''}>
                    ${content}
                </div>
            </div>
        `;
    }

    _renderMarkdown(content) {
        if (!content) return '';
        if (typeof window.marked !== 'undefined') {
            const html = window.marked.parse(content);
            if (typeof window.DOMPurify !== 'undefined') {
                return window.DOMPurify.sanitize(html);
            }
            return html;
        }
        return `<pre>${this._escapeHtml(content)}</pre>`;
    }

    _escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _attachHandlers() {
        // Project selector
        const select = this.container?.querySelector('#portal-project-select');
        if (select) {
            select.addEventListener('change', (e) => {
                const projectCode = e.target.value;
                if (projectCode) {
                    this.portalService.loadPortal(projectCode);
                }
            });
        }

        // Refresh button
        const refreshBtn = this.container?.querySelector('#portal-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                const current = this.portalService.getCurrentProject();
                if (current) {
                    this.portalService.loadPortal(current);
                }
            });
        }

        // Section collapse toggles
        const headers = this.container?.querySelectorAll('.portal-section-header[data-toggle]') || [];
        headers.forEach(header => {
            header.addEventListener('click', () => {
                const sectionId = header.getAttribute('data-toggle');
                if (this._collapsedSections.has(sectionId)) {
                    this._collapsedSections.delete(sectionId);
                } else {
                    this._collapsedSections.add(sectionId);
                }
                this.render();
            });
        });
    }
}
