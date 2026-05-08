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

        // Auto-load project when portal opens with autoProject
        const unsub = eventBus.on(EVENTS.PANEL_TOGGLED, (e) => {
            const { panel, open, autoProject } = /** @type {CustomEvent} */ (e).detail || {};
            if (panel === 'portal-overlay' && open && autoProject) {
                const current = this.portalService.getCurrentProject();
                if (autoProject !== current) {
                    this.portalService.loadPortalOverlay(autoProject);
                    // Update selector
                    const select = /** @type {HTMLSelectElement | null} */ (document.getElementById('portal-overlay-project-select'));
                    if (select) select.value = autoProject;
                    this._syncProjectChrome(autoProject);
                }
            }
        });
        this._unsubscribers.push(unsub);
    }

    async render() {
        if (!this.container) return;

        const data = this.portalService.getOverlayData();

        this.container.innerHTML = `
            <div class="portal-overlay-content">
                ${data ? this._renderPortalShell(data) : this._renderEmpty()}
            </div>
        `;

        this._attachHandlers();

        const lucide = /** @type {any} */ (window).lucide;
        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ attrs: { class: 'lucide-icon' } });
        }
    }

    _renderEmpty() {
        return '<div class="portal-overlay-empty">プロジェクトを選択してください</div>';
    }

    _renderPortalShell(data) {
        return `
            ${this._renderKPIBar(data)}
            <div class="portal-command-grid">
                <div class="portal-command-main">
                    ${this._renderSection({
                        id: 'valueLoop',
                        title: 'Value Loop',
                        icon: 'repeat',
                        badge: this._vlBadge(data),
                        className: 'portal-ov-value-loop',
                        render: () => renderValueLoopSection(data.valueLoop, { escapeHtml: this._escapeHtml })
                    })}
                    ${this._renderSection({
                        id: 'events',
                        title: 'Recent Events',
                        icon: 'activity',
                        badge: data.events?.stats?.thisWeek ? `${data.events.stats.thisWeek} this week` : '',
                        className: 'portal-ov-events',
                        render: () => renderEventsSection(data.events, { escapeHtml: this._escapeHtml })
                    })}
                </div>
                <aside class="portal-command-side">
                    ${this._renderSection({
                        id: 'storyMap',
                        title: 'Story Map',
                        icon: 'git-branch',
                        className: 'portal-ov-story',
                        render: () => renderStoryMapSection(data.storyMap, { escapeHtml: this._escapeHtml })
                    })}
                    ${this._renderSection({
                        id: 'team',
                        title: 'Team / RACI',
                        icon: 'users',
                        badge: `${(data.members || data.team?.members || []).length}`,
                        className: 'portal-ov-team',
                        render: () => renderTeamSection(data.members || data.team?.members || [], data.tasks, { escapeHtml: this._escapeHtml })
                    })}
                    ${this._renderSection({
                        id: 'frame',
                        title: 'Frame',
                        icon: 'target',
                        className: 'portal-ov-frame',
                        render: () => renderFrameSection(data.frame, data.direction, { renderMarkdown: this._renderMarkdown.bind(this), escapeHtml: this._escapeHtml })
                    })}
                </aside>
            </div>
        `;
    }

    _renderKPIBar(data) {
        const openDecisions = (data.valueLoop?.decision?.milestones?.length || 0)
            + (data.valueLoop?.decision?.issues?.length || 0)
            + (data.valueLoop?.decision?.decisions?.length || 0);
        const blocked = (data.tasks?.items || []).filter(t => t.status === 'ブロック' || t.status === '保留').length;
        const shipped = (data.valueLoop?.ship?.items || []).length;
        const activeWork = (data.valueLoop?.work?.tasks || []).filter(t => t.status !== '完了').length
            || (data.tasks?.items || []).filter(t => t.status !== '完了').length;

        const metrics = [
            { label: 'Open Decisions', value: openDecisions, tone: 'blue', delta: `${openDecisions} in loop` },
            { label: 'Active Work', value: activeWork, tone: 'green', delta: `${activeWork} running` },
            { label: 'Blocked', value: blocked, tone: 'red', delta: blocked ? 'needs decision' : 'clear' },
            { label: 'Shipped', value: shipped, tone: 'blue', delta: `${shipped} releases` }
        ];

        return `
            <div class="portal-kpi-bar">
                ${metrics.map(m => `
                    <div class="portal-kpi-card" data-tone="${m.tone}">
                        <div class="portal-kpi-card-label"><span class="portal-kpi-dot"></span>${m.label}</div>
                        <div class="portal-kpi-card-row">
                            <div class="portal-kpi-card-value ${m.tone === 'red' ? 'danger' : m.tone === 'green' ? 'success' : ''}">${m.value}</div>
                            <div class="portal-kpi-card-delta">${m.delta}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    _renderSections(data) {
        /** @type {Array<{ id: string, title: string, icon: string, badge?: string, render: () => string }>} */
        const sections = [
            { id: 'frame', title: 'Frame', icon: 'target', render: () => renderFrameSection(data.frame, data.direction, { renderMarkdown: this._renderMarkdown.bind(this), escapeHtml: this._escapeHtml }) },
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

    /**
     * @param {{ id: string, title: string, icon: string, badge?: string, className?: string, render: () => string }} section
     */
    _renderSection({ id, title, icon, badge, className = '', render }) {
        const collapsed = this._collapsedSections.has(id);
        const chevron = collapsed ? 'chevron-right' : 'chevron-down';

        return `
            <section class="portal-ov-section ${className} ${collapsed ? 'collapsed' : ''}" data-section="${id}">
                <div class="portal-ov-section-header" data-toggle="${id}">
                    <i data-lucide="${chevron}"></i>
                    <i data-lucide="${icon}"></i>
                    <span class="portal-ov-section-title">${title}</span>
                    ${badge ? `<span class="portal-ov-section-badge">${badge}</span>` : ''}
                </div>
                <div class="portal-ov-section-content">
                    ${render()}
                </div>
            </section>
        `;
    }

    _renderMarkdown(content) {
        if (!content) return '';
        const marked = /** @type {any} */ (window).marked;
        const purifier = /** @type {any} */ (window).DOMPurify;
        if (typeof marked !== 'undefined') {
            const html = marked.parse(content);
            if (typeof purifier !== 'undefined') {
                return purifier.sanitize(html);
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
        const select = /** @type {HTMLSelectElement | null} */ (document.getElementById('portal-overlay-project-select'));
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
            this._syncProjectChrome(current);

            select.onchange = (e) => {
                const projectCode = /** @type {HTMLSelectElement} */ (e.target).value;
                if (projectCode) {
                    this._syncProjectChrome(projectCode);
                    this.portalService.loadPortalOverlay(projectCode);
                }
            };
        }

        const search = /** @type {HTMLInputElement | null} */ (document.getElementById('workspace-project-search'));
        if (search && select) {
            search.onkeydown = (event) => {
                if (event.key !== 'Enter') return;
                const projectCode = this._findProjectCode(search.value);
                if (!projectCode) return;

                select.value = projectCode;
                this._syncProjectChrome(projectCode);
                this.portalService.loadPortalOverlay(projectCode);
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

    _findProjectCode(query) {
        const normalized = String(query || '').trim().toLowerCase();
        if (!normalized) return '';
        const project = this.configProjects.find((p) => {
            const id = String(p.id || '').toLowerCase();
            const name = String(p.name || '').toLowerCase();
            return id.includes(normalized) || name.includes(normalized);
        });
        return project?.id || '';
    }

    _syncProjectChrome(projectCode) {
        const label = document.getElementById('portal-current-project-label');
        const search = /** @type {HTMLInputElement | null} */ (document.getElementById('workspace-project-search'));
        const project = this.configProjects.find((p) => p.id === projectCode);
        const name = project?.name || projectCode || 'Project';
        if (label) label.textContent = name;
        if (search && projectCode) search.value = name;
    }
}
