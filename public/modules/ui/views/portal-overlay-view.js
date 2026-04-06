// @ts-check
/**
 * PortalOverlayView - 全画面フレームワーク駆動ポータル
 *
 * 経営フレームワーク（Frame/Story/Event + Decision/Work/Ship/Learn）を
 * そのまま5セクションとして表示する。
 */
import { BaseView } from './base-view.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { renderFrameSection } from './portal-sections/frame-section.js';
import { renderStoryMapSection } from './portal-sections/story-map-section.js';
import { renderValueLoopSection } from './portal-sections/value-loop-section.js';
import { renderEventsSection } from './portal-sections/events-section.js';
import { renderTeamSection } from './portal-sections/team-section.js';

export class PortalOverlayView extends BaseView {
    constructor({ portalService, configProjects }) {
        super();
        this.portalService = portalService;
        this.configProjects = configProjects || [];
        this._collapsedSections = new Set();
    }

    _setupEventListeners() {
        this._renderOn(eventBus, EVENTS.PORTAL_OVERLAY_DATA_LOADED);
    }

    async render() {
        if (!this.container) return;

        const data = this.portalService.getOverlayData();

        this.container.innerHTML = `
            <div class="portal-overlay-content">
                ${data ? this._renderKPIBar(data) : ''}
                ${data ? this._renderSections(data) : this._renderEmpty()}
            </div>
        `;

        this._attachHandlers();

        if (typeof window.lucide !== 'undefined') {
            window.lucide.createIcons({ attrs: { class: 'lucide-icon' } });
        }
    }

    _renderEmpty() {
        return '<div style="padding:64px 0;text-align:center;color:var(--text-secondary)">プロジェクトを選択してください</div>';
    }

    _renderKPIBar(data) {
        const health = data.health?.score ?? 0;
        const healthClass = health >= 70 ? 'success' : health >= 50 ? 'warning' : 'danger';

        const blocked = (data.tasks?.items || []).filter(t => t.status === 'ブロック' || t.status === '保留').length;
        const shipped = (data.valueLoop?.ship?.items || []).filter(s => s.status === 'shipped').length;
        const activeTasks = (data.tasks?.items || []).filter(t => t.status !== '完了').length;

        return `
            <div class="portal-kpi-bar">
                <div class="portal-kpi-card">
                    <div class="portal-kpi-card-label">Health</div>
                    <div class="portal-kpi-card-value ${healthClass}">${health}</div>
                </div>
                <div class="portal-kpi-card">
                    <div class="portal-kpi-card-label">Blocked</div>
                    <div class="portal-kpi-card-value ${blocked > 0 ? 'danger' : ''}">${blocked}</div>
                </div>
                <div class="portal-kpi-card">
                    <div class="portal-kpi-card-label">Shipped</div>
                    <div class="portal-kpi-card-value ${shipped > 0 ? 'success' : ''}">${shipped}</div>
                </div>
                <div class="portal-kpi-card">
                    <div class="portal-kpi-card-label">Active Tasks</div>
                    <div class="portal-kpi-card-value">${activeTasks}</div>
                </div>
            </div>
        `;
    }

    _renderSections(data) {
        const sections = [
            { id: 'frame', title: 'Frame', icon: 'target', render: () => renderFrameSection(data.frame || data.direction, { renderMarkdown: this._renderMarkdown.bind(this), escapeHtml: this._escapeHtml }) },
            { id: 'storyMap', title: 'Story Map', icon: 'git-branch', render: () => renderStoryMapSection(data.storyMap, { escapeHtml: this._escapeHtml }) },
            { id: 'valueLoop', title: 'Value Loop', icon: 'repeat', badge: this._vlBadge(data), render: () => renderValueLoopSection(data.valueLoop, { escapeHtml: this._escapeHtml }) },
            { id: 'events', title: 'Events', icon: 'activity', badge: data.events?.stats?.thisWeek ? `${data.events.stats.thisWeek} this week` : '', render: () => renderEventsSection(data.events, { escapeHtml: this._escapeHtml }) },
            { id: 'team', title: 'Team', icon: 'users', badge: `${(data.members || data.team?.members || []).length}`, render: () => renderTeamSection(data.members || data.team?.members || [], data.tasks, { escapeHtml: this._escapeHtml }) }
        ];

        return sections.map(s => this._renderSection(s)).join('');
    }

    _vlBadge(data) {
        if (!data.valueLoop) return '';
        const d = (data.valueLoop.decision?.milestones?.length || 0) + (data.valueLoop.decision?.issues?.length || 0);
        const w = data.valueLoop.work?.tasks?.length || 0;
        const s = data.valueLoop.ship?.items?.length || 0;
        const l = data.valueLoop.learn?.retrospectives?.length || 0;
        return `D:${d} W:${w} S:${s} L:${l}`;
    }

    _renderSection({ id, title, icon, badge, render }) {
        const collapsed = this._collapsedSections.has(id);
        const chevron = collapsed ? 'chevron-right' : 'chevron-down';

        return `
            <div class="portal-ov-section ${collapsed ? 'collapsed' : ''}" data-section="${id}">
                <div class="portal-ov-section-header" data-toggle="${id}">
                    <i data-lucide="${chevron}"></i>
                    <i data-lucide="${icon}"></i>
                    <span class="portal-ov-section-title">${title}</span>
                    ${badge ? `<span class="portal-ov-section-badge">${badge}</span>` : ''}
                </div>
                <div class="portal-ov-section-content">
                    ${render()}
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
        // Project selector in overlay header
        const select = document.getElementById('portal-overlay-project-select');
        if (select && this.configProjects.length) {
            // Populate options if empty
            if (select.options.length <= 1) {
                for (const p of this.configProjects) {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name || p.id;
                    select.appendChild(opt);
                }
            }
            // Set current selection
            const current = this.portalService.getCurrentProject();
            if (current) select.value = current;

            select.onchange = (e) => {
                const projectCode = e.target.value;
                if (projectCode) {
                    this.portalService.loadPortalOverlay(projectCode);
                }
            };
        }

        // Refresh button
        const refreshBtn = document.getElementById('portal-overlay-refresh');
        if (refreshBtn) {
            refreshBtn.onclick = () => {
                const current = this.portalService.getCurrentProject();
                if (current) this.portalService.loadPortalOverlay(current);
            };
        }

        // Section collapse toggles
        const headers = this.container?.querySelectorAll('.portal-ov-section-header[data-toggle]') || [];
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
