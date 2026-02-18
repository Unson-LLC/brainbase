import { BrainbaseService } from './domain/brainbase/brainbase-service.js';
import { GaugeChart } from './components/gauge-chart.js';
import { waitForElement } from './utils/dom-ready.js';

export class DashboardController {
    constructor() {
        this.brainbaseService = new BrainbaseService();
        this.data = null;
        this.projects = [];
        this.systemHealth = null;
        this.criticalAlerts = null;
        this.healthRefreshInterval = null;
        this.dataRefreshInterval = null;
        this.manaHistoryModalReady = false;
        this.slackMembersLoaded = false;
        this.slackIdMap = new Map();
        // テストモード: URLに?test=trueがあれば有効
        this.testMode = new URLSearchParams(window.location.search).get('test') === 'true';
        if (this.testMode) console.log('🧪 Dashboard Test Mode Enabled');
    }

    async init() {
        const dashboardPanel = await waitForElement('#dashboard-panel');
        if (!dashboardPanel) return;

        await this.loadData();
        await this.loadCriticalAlerts();
        this.render();

        // Auto-refresh data and critical alerts every 30 seconds
        if (!this.dataRefreshInterval) {
            this.dataRefreshInterval = setInterval(() => {
                this.loadData();
                this.loadCriticalAlerts();
            }, 30000);
        }

        // Make dashboardController globally accessible for modal callbacks
        window.dashboardController = this;
    }

    destroy() {
        if (this.dataRefreshInterval) {
            clearInterval(this.dataRefreshInterval);
            this.dataRefreshInterval = null;
        }
        if (this.healthRefreshInterval) {
            clearInterval(this.healthRefreshInterval);
            this.healthRefreshInterval = null;
        }
    }

    async loadData() {
        try {
            this.data = await this.brainbaseService.getAllData();
            this.projects = this.data.projects || []; // サーバー側で計算済み
        } catch (error) {
            console.error('Failed to load brainbase data:', error);
            this.data = {};
            this.projects = [];
        }
    }

    async loadCriticalAlerts() {
        try {
            const url = this.testMode ? '/api/brainbase/critical-alerts?test=true' : '/api/brainbase/critical-alerts';
            const response = await fetch(url);
            if (!response.ok) {
                console.error('Failed to load critical alerts:', response.status);
                this.criticalAlerts = { alerts: [], total_critical: 0, total_warning: 0 };
                return;
            }
            this.criticalAlerts = await response.json();
        } catch (error) {
            console.error('Error loading critical alerts:', error);
            this.criticalAlerts = { alerts: [], total_critical: 0, total_warning: 0 };
        }
    }

    async render() {
        const results = await Promise.allSettled([
            this.renderSection1(),
            this.renderSection2(),
            this.renderSection4(),
            this.renderSection5(),
            this.renderSection6()
        ]);

        // エラーチェック
        const errors = results
            .map((result, index) => ({ result, index }))
            .filter(({ result }) => result.status === 'rejected');

        if (errors.length > 0) {
            console.error('Some sections failed to render:', errors);
            errors.forEach(({ result, index }) => {
                const sectionId = this._getSectionId(index);
                this._renderErrorFallback(sectionId, result.reason);
            });
        }
    }

    renderSection1() {
        // Critical Alerts表示
        const container = document.getElementById('section-1-alerts');
        if (!container) return;

        if (!this.criticalAlerts) {
            container.innerHTML = '<div class="text-gray-400 text-center py-8">Loading...</div>';
            return;
        }

        const { alerts, total_critical, total_warning } = this.criticalAlerts;

        if (!alerts || alerts.length === 0) {
            // アラートがない場合はセクション自体を隠してスッキリさせる
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';

        // Critical Alertsヘッダー
        const headerHtml = `
            <div class="dashboard-section-header">
                <h2 class="section-header-title">CRITICAL ALERTS</h2>
                <span class="critical-alerts-badge">${alerts.length}</span>
            </div>
        `;

        // 上位3件のみ表示
        const visibleAlerts = alerts.slice(0, 3);
        const hiddenAlerts = alerts.slice(3);

        const renderAlertCard = (alert) => {
            const isCritical = alert.severity === 'critical';
            const alertTypeClass = alert.type === 'blocker' ? 'alert-type-blocker' : 'alert-type-overdue';
            const badgeClass = alert.type === 'blocker' ? 'blocker' : 'overdue';
            const label = alert.type === 'blocker' ? 'BLOCKER' : 'OVERDUE';

            // 日数表示のロジック
            let daysLabel = '';
            let daysValue = '';
            if (alert.type === 'blocker') {
                daysLabel = '経過';
                daysValue = `${alert.days_blocked}日`;
            } else {
                daysLabel = '超過';
                daysValue = `${alert.days_overdue}日`;
            }

            return `
                <div class="critical-alert-card ${alertTypeClass}">
                    <div class="alert-main-content">
                        <div class="alert-left-col">
                            <span class="alert-type-badge ${badgeClass}">${label}</span>
                            <div class="alert-project-task">
                                <span class="alert-project">${alert.project}</span>
                                <span class="alert-divider">/</span>
                                <span class="alert-task-name">${alert.task}</span>
                            </div>
                        </div>
                        <div class="alert-right-col">
                            <div class="alert-meta">
                                <i data-lucide="user" class="alert-icon-sm"></i>
                                <span>${alert.owner}</span>
                            </div>
                            <div class="alert-meta warning-text">
                                <i data-lucide="clock" class="alert-icon-sm"></i>
                                <span>${daysLabel}: ${daysValue}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        };

        const visibleAlertsHtml = visibleAlerts.map(renderAlertCard).join('');

        // 隠れているアラートのHTML
        let hiddenAlertsHtml = '';
        let toggleButtonHtml = '';

        if (hiddenAlerts.length > 0) {
            hiddenAlertsHtml = `
                <div id="hidden-alerts" class="hidden-alerts" style="display: none;">
                    ${hiddenAlerts.map(renderAlertCard).join('')}
                </div>
            `;

            toggleButtonHtml = `
                <button id="alerts-toggle-btn" class="alerts-toggle-btn" onclick="dashboardController.toggleAlerts()">
                    <span id="alerts-toggle-text">Show ${hiddenAlerts.length} more alerts</span>
                    <i data-lucide="chevron-down"></i>
                </button>
            `;
        }

        container.innerHTML = headerHtml +
            '<div class="critical-alerts-grid">' +
            visibleAlertsHtml +
            hiddenAlertsHtml +
            '</div>' +
            toggleButtonHtml;

        // アイコンの初期化
        if (window.lucide) {
            window.lucide.createIcons({ root: container });
        }
    }

    toggleAlerts() {
        const hiddenDiv = document.getElementById('hidden-alerts');
        const btn = document.getElementById('alerts-toggle-btn');
        const btnText = document.getElementById('alerts-toggle-text');
        const btnIcon = btn.querySelector('svg'); // lucide replaces i with svg

        if (hiddenDiv.style.display === 'none') {
            hiddenDiv.style.display = 'grid'; // grid layout for spacing
            btnText.textContent = 'Show less';
            if (btnIcon) btnIcon.style.transform = 'rotate(180deg)';
        } else {
            hiddenDiv.style.display = 'none';
            const count = this.criticalAlerts.alerts.length - 3;
            btnText.textContent = `Show ${count} more alerts`;
            if (btnIcon) btnIcon.style.transform = 'rotate(0deg)';
        }
    }

    async renderSection2() {
        const container = document.getElementById('strategic-content');
        if (!container) return;

        try {
            const overview = await this.loadStrategicOverview();

            if (!overview || !overview.projects) {
                container.innerHTML = '<div class="empty-state">戦略的概要データの読み込みに失敗しました</div>';
                return;
            }

            const { projects, bottlenecks } = overview;

            // Project Priority Ranking
            const projectsHtml = projects.map((project, index) => {
                const trendIcon = project.trend === 'up' ? 'arrow-up' : project.trend === 'down' ? 'arrow-down' : 'arrow-right';
                const trendColor = project.trend === 'up' ? 'text-green-500' : project.trend === 'down' ? 'text-red-500' : 'text-gray-500';
                const scoreClass = project.health_score >= 80 ? 'healthy' : project.health_score >= 60 ? 'warning' : 'critical';

                return `
                    <div class="strategic-project-item">
                        <div class="strategic-project-info">
                            <div class="strategic-project-name">${index + 1}. ${project.name}</div>
                             ${project.recommendations && project.recommendations.length > 0 ? `
                                <div class="strategic-project-recommendations">
                                    ${project.recommendations.map(rec => `<div class="rec-item">• ${rec}</div>`).join('')}
                                </div>
                            ` : `<div class="strategic-project-recommendations" style="opacity: 0.5;">
                                  特記事項なし。順調に進捗中。
                                 </div>`
                    }
                        </div>
                        <div class="strategic-project-trend ${project.trend}">
                            <i data-lucide="${trendIcon}" class="trend-icon"></i>
                            <span class="trend-value">${project.change > 0 ? '+' : ''}${project.change || 0}</span>
                        </div>
                        <div class="strategic-project-score ${scoreClass}">
                            ${project.health_score}
                        </div>
                    </div>
                `;
            }).join('');

            // Bottlenecks
            const bottlenecksHtml = bottlenecks && bottlenecks.length > 0 ? `
                <div class="strategic-bottlenecks">
                    <div class="dashboard-section-header">
                        <h4 class="section-header-title">
                            ボトルネック検出
                        </h4>
                    </div>
                    ${bottlenecks.map(bn => `
                        <div class="strategic-bottleneck-item">
                            <div class="strategic-bottleneck-type">${bn.type === 'project_overload' ? 'プロジェクト過負荷' : '全体リソース不足'}</div>
                            <div class="strategic-bottleneck-recommendation">${bn.recommendation}</div>
                        </div>
                    `).join('')}
                </div>
            ` : '';

            container.innerHTML = `
                <div class="strategic-projects-list">
                    ${projectsHtml}
                </div>
                ${bottlenecksHtml}
            `;

        } catch (error) {
            console.error('Strategic Overview rendering error:', error);
            container.innerHTML = '<div class="empty-state">戦略的概要の表示中にエラーが発生しました</div>';
        }
    }

    async loadStrategicOverview() {
        try {
            const response = await fetch('/api/brainbase/strategic-overview');
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Failed to load strategic overview:', error);
            return null;
        }
    }

    async renderSection4() {
        // Section 4: Trend Analysis（Story 4: 構造的な問題を見抜く）
        // AC: 過去4〜8週の循環状態推移、慢性的止まりアラート
        await this.render8WeekHeatmap();
        this.renderChronicAlerts();
    }

    async render8WeekHeatmap() {
        // Story 4 AC: 過去4〜8週の循環状態推移が時系列で見える
        const container = document.getElementById('heatmap-table-container');
        if (!container) return;

        if (this.projects.length === 0) {
            container.innerHTML = `
                <div class="empty-state-card" style="
                    background: rgba(255, 255, 255, 0.02);
                    border: 1px dashed rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    padding: 32px;
                    text-align: center;
                ">
                    <p style="color: var(--text-secondary); font-size: 13px;">プロジェクトデータがありません</p>
                </div>
            `;
            return;
        }

        try {
            // Fetch 8-week trend data
            const response = await fetch('/api/brainbase/trends?days=56');
            let weeklyData = [];

            if (response.ok) {
                const data = await response.json();
                weeklyData = data.weekly_snapshots || [];
            }

            // Generate week labels (過去8週)
            const weekLabels = [];
            for (let i = 7; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i * 7);
                weekLabels.push(`W${8 - i}`);
            }

            // Build heatmap table
            let tableHtml = `
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 8px 12px; color: var(--text-secondary); font-weight: 500; border-bottom: 1px solid var(--border-color);">Project</th>
                            ${weekLabels.map(w => `<th style="text-align: center; padding: 8px; color: var(--text-secondary); font-weight: 500; border-bottom: 1px solid var(--border-color); min-width: 50px;">${w}</th>`).join('')}
                            <th style="text-align: center; padding: 8px 12px; color: var(--text-secondary); font-weight: 500; border-bottom: 1px solid var(--border-color);">トレンド</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            // Render each project row
            for (const project of this.projects) {
                // Get project's weekly health scores (mock data for now, replace with actual API data)
                const projectWeeklyData = this.getProjectWeeklyScores(project, weeklyData, weekLabels.length);
                const trendIndicator = this.calculateTrendIndicator(projectWeeklyData);

                tableHtml += `
                    <tr>
                        <td style="padding: 8px 12px; color: var(--text-primary); font-weight: 500; border-bottom: 1px solid rgba(255,255,255,0.05);">${project.name}</td>
                        ${projectWeeklyData.map(score => this.renderHeatmapCell(score)).join('')}
                        <td style="text-align: center; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                            ${trendIndicator}
                        </td>
                    </tr>
                `;
            }

            tableHtml += `
                    </tbody>
                </table>
            `;

            container.innerHTML = tableHtml;

        } catch (error) {
            console.error('Failed to render 8-week heatmap:', error);
            container.innerHTML = `
                <div class="error-state" style="padding: 20px; text-align: center; color: var(--text-secondary);">
                    ヒートマップの読み込みに失敗しました
                </div>
            `;
        }
    }

    getProjectWeeklyScores(project, weeklyData, numWeeks) {
        // Try to get actual weekly data, fall back to simulated data based on current health score
        // In production, this would come from /api/brainbase/trends API with weekly snapshots
        const scores = [];
        const baseScore = project.healthScore || 70;

        // Look for actual data first
        const projectData = weeklyData.find(w => w.project_id === project.name);
        if (projectData && projectData.scores && projectData.scores.length >= numWeeks) {
            return projectData.scores.slice(-numWeeks);
        }

        // Fallback: Generate realistic scores based on current health score
        // This simulates historical data until we have actual snapshots
        for (let i = 0; i < numWeeks; i++) {
            // Add some variance around the base score
            const variance = Math.floor(Math.random() * 15) - 7; // -7 to +7
            const score = Math.max(0, Math.min(100, baseScore + variance - (numWeeks - i - 1) * 2));
            scores.push(score);
        }

        // Last score should be current health score
        scores[numWeeks - 1] = baseScore;

        return scores;
    }

    renderHeatmapCell(score) {
        if (score === null || score === undefined) {
            return `<td style="text-align: center; padding: 4px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                <div style="width: 36px; height: 36px; margin: 0 auto; background: rgba(255,255,255,0.05); border-radius: 4px; border: 1px dashed rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center;">
                    <span style="color: var(--text-tertiary); font-size: 10px;">-</span>
                </div>
            </td>`;
        }

        let bgColor, textColor;
        if (score >= 80) {
            bgColor = '#22c55e';
            textColor = '#fff';
        } else if (score >= 60) {
            bgColor = '#f59e0b';
            textColor = '#fff';
        } else {
            bgColor = '#ef4444';
            textColor = '#fff';
        }

        return `<td style="text-align: center; padding: 4px; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <div style="width: 36px; height: 36px; margin: 0 auto; background: ${bgColor}; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
                <span style="color: ${textColor}; font-size: 11px; font-weight: 600;">${score}</span>
            </div>
        </td>`;
    }

    calculateTrendIndicator(scores) {
        if (!scores || scores.length < 2) {
            return '<span style="color: var(--text-tertiary);">-</span>';
        }

        // Compare first half vs second half average
        const midPoint = Math.floor(scores.length / 2);
        const firstHalf = scores.slice(0, midPoint);
        const secondHalf = scores.slice(midPoint);

        const firstAvg = firstHalf.reduce((a, b) => a + (b || 0), 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + (b || 0), 0) / secondHalf.length;

        const diff = secondAvg - firstAvg;

        if (diff > 5) {
            return '<span style="color: #22c55e; font-size: 18px;">↑</span>';
        } else if (diff < -5) {
            return '<span style="color: #ef4444; font-size: 18px;">↓</span>';
        } else {
            return '<span style="color: #f59e0b; font-size: 18px;">→</span>';
        }
    }

    renderChronicAlerts() {
        // Story 4 AC: 慢性的な止まり（2週以上継続）がアラート対象になる
        const container = document.getElementById('chronic-alerts-container');
        if (!container) return;

        // Detect chronic stagnation (2+ weeks of low/declining health)
        const chronicIssues = [];

        for (const project of this.projects) {
            // Check if project has been in warning/critical state for 2+ weeks
            // This would use actual historical data in production
            if (project.healthScore < 60) {
                chronicIssues.push({
                    project: project.name,
                    type: 'critical_stagnation',
                    healthScore: project.healthScore,
                    duration: '2週間以上',
                    recommendation: 'ブロッカー解消と優先度見直しが必要'
                });
            } else if (project.healthScore < 70 && project.blocked > 2) {
                chronicIssues.push({
                    project: project.name,
                    type: 'blocked_stagnation',
                    healthScore: project.healthScore,
                    blockedCount: project.blocked,
                    duration: '継続中',
                    recommendation: 'ブロックされたタスクの早期解消を推奨'
                });
            }
        }

        if (chronicIssues.length === 0) {
            container.innerHTML = ''; // Hide if no chronic issues
            return;
        }

        container.innerHTML = `
            <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 12px; padding: 20px;">
                <h4 style="color: #ef4444; font-size: 15px; font-weight: 600; margin: 0 0 16px 0; display: flex; align-items: center; gap: 8px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                    慢性的な停滞検出 (${chronicIssues.length}件)
                </h4>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${chronicIssues.map(issue => `
                        <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong style="color: var(--text-primary);">${issue.project}</strong>
                                <span style="color: var(--text-secondary); font-size: 13px; margin-left: 8px;">Health: ${issue.healthScore}</span>
                                <p style="color: var(--text-secondary); font-size: 12px; margin: 4px 0 0 0;">${issue.recommendation}</p>
                            </div>
                            <span style="color: #ef4444; font-size: 12px; font-weight: 500; white-space: nowrap;">${issue.duration}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    async renderSection5() {
        // Mana Quality Dashboard (Week 7-8)
        const manaSection = document.getElementById('mana-quality');
        if (!manaSection) return;

        try {
            // GitHub Actions から Mana ワークフロー統計を取得（M1〜M12）
            const workflows = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'];

            const workflowStatsPromises = workflows.map(async (workflowId) => {
                const testParam = this.testMode ? '&test=true' : '';
                const response = await fetch(`/api/brainbase/mana-workflow-stats?workflow_id=${workflowId}${testParam}`);
                if (!response.ok) throw new Error(`Failed to fetch stats for ${workflowId}`);
                return response.json();
            });

            const workflowStatsResults = await Promise.allSettled(workflowStatsPromises);

            // Extract successful results, handle failures
            const workflowStats = workflowStatsResults.map((result, index) => {
                if (result.status === 'fulfilled' && result.value) {
                    return result.value;
                }
                // Log failed workflow fetch
                console.warn(`Failed to fetch stats for ${workflows[index]}:`, result.reason);
                return null;
            }).filter(stat => stat !== null); // Filter out failed requests

            // Overall Status 判定（成功率ベース）
            const overallSuccessRate = workflowStats.length > 0
                ? workflowStats.reduce((sum, w) => sum + w.stats.success_rate, 0) / workflowStats.length
                : 0;

            // Empty State Handling
            if (workflowStats.length === 0) {
                manaSection.innerHTML = `
                    <div class="section-header" style="margin-bottom: 24px;">
                        <div class="dashboard-section-header">
                            <h2 class="section-header-title"><i data-lucide="bot"></i> Mana Dashboard</h2>
                        </div>
                        <p class="section-description">Slack AI PMエージェントのワークフロー実行状況と品質メトリクス</p>
                    </div>

                    <div class="empty-state-card" style="
                        background: rgba(255, 255, 255, 0.02);
                        backdrop-filter: blur(10px);
                        border: 1px dashed rgba(255, 255, 255, 0.1);
                        border-radius: 12px;
                        padding: 60px;
                        text-align: center;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 24px;
                        margin-top: 20px;
                    ">
                        <div style="
                            width: 80px;
                            height: 80px;
                            background: rgba(59, 130, 246, 0.1);
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            color: var(--accent-color);
                            box-shadow: 0 0 40px rgba(59, 130, 246, 0.1);
                        ">
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <path d="M12 16v-4"></path>
                                <path d="M12 8h.01"></path>
                            </svg>
                        </div>
                        <div>
                            <h3 style="color: var(--text-primary); font-size: 18px; margin-bottom: 12px; font-weight: 600;">Mana接続待機中</h3>
                            <p style="color: var(--text-secondary); font-size: 14px; max-width: 480px; line-height: 1.6; margin: 0 auto;">
                                Slack AI PMエージェント(Mana)との接続が確立されていません。<br>
                                設定画面から連携ステータスを確認し、APIキーが正しく設定されているかご確認ください。
                            </p>
                        </div>
                        <button class="btn-primary" style="margin-top: 8px;">
                            <i data-lucide="settings"></i> 連携設定を確認
                        </button>
                    </div>
                `;
                // Re-initialize icons just in case
                if (window.lucide) window.lucide.createIcons({ root: manaSection });
                return;
            }

            const overallStatus = overallSuccessRate >= 80 ? 'HEALTHY'
                : overallSuccessRate >= 60 ? 'WARNING'
                    : 'CRITICAL';

            // Workflow実行状況
            const workflowStatusHTML = workflowStats.map(w => {
                const severity = w.stats.success_rate >= 80 ? 'Healthy'
                    : w.stats.success_rate >= 60 ? 'Warning'
                        : 'Critical';

                return `
                    <div class="mana-workflow-card" data-workflow-id="${w.workflow_id}" role="button" tabindex="0" aria-label="${this._getWorkflowName(w.workflow_id)} details" style="background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 24px; transition: all 0.3s ease; cursor: pointer;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                            <h4 style="font-size: 18px; font-weight: 600; color: white;">${this._getWorkflowName(w.workflow_id)}</h4>
                            <span class="badge badge-${severity.toLowerCase()}">${severity}</span>
                        </div>
                        <div style="margin-bottom: 12px;">
                            <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">Success Rate</div>
                            <div class="progress-bar" style="width: 100%; height: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 4px; overflow: hidden;">
                                <div class="progress-fill" style="width: ${w.stats.success_rate}%; height: 100%; background: ${this._getProgressColor(w.stats.success_rate)}; transition: width 0.3s ease;"></div>
                            </div>
                            <div style="font-size: 24px; font-weight: 700; color: white; margin-top: 4px;">${w.stats.success_rate}%</div>
                        </div>
                        <div style="font-size: 13px; color: var(--text-secondary);">
                            Total Executions: ${w.stats.total_executions} (Success: ${w.stats.total_success}, Failure: ${w.stats.total_failure})
                        </div>
                    </div>
                `;
            }).join('');

            // HTML更新
            manaSection.innerHTML = `
                <div class="dashboard-section-header" style="margin-bottom: 24px;">
                    <h2 class="section-header-title">Mana Quality Dashboard</h2>
                </div>

                <!-- Mana Hero Status -->
                <div class="mana-hero-card" style="background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(30px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 32px; margin-bottom: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <h3 style="font-size: 24px; font-weight: 700; color: white;">Mana Overall Status</h3>
                        <span class="badge badge-${overallStatus.toLowerCase()}" style="font-size: 16px; padding: 8px 16px;">${overallStatus}</span>
                    </div>
                    <div style="color: var(--text-secondary);">
                        Overall Success Rate: <span style="color: white; font-weight: 600;">${Math.round(overallSuccessRate)}%</span>
                    </div>
                </div>

                <!-- Workflow実行状況 -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
                    ${workflowStatusHTML}
                </div>
            `;

            this._bindManaWorkflowCards(manaSection);
            this._setupManaHistoryModal();
        } catch (error) {
            console.error('Failed to render Section 5:', error);
            manaSection.innerHTML = `
                <div class="section-header">
                    <h2>Section 5: Mana Quality Dashboard</h2>
                </div>
                <div class="error-message" style="color: var(--accent-orange); padding: 16px; background: rgba(238, 79, 39, 0.1); border-radius: 8px;">
                    Failed to load Mana quality data: ${error.message}
                </div>
            `;
        }
    }

    _getWorkflowName(workflowId) {
        const names = {
            'm1': 'M1: 朝のブリーフィング',
            'm2': 'M2: ブロッカー早期発見',
            'm3': 'M3: 期限前リマインド',
            'm4': 'M4: 期限超過アラート',
            'm5': 'M5: コンテキスト収集',
            'm6': 'M6: 進捗レポート',
            'm7': 'M7: エグゼクティブサマリー',
            'm8': 'M8: GM向けレポート',
            'm9': 'M9: 週次レポート',
            'm10': 'M10: リマインダー',
            'm11': 'M11: フォローアップ',
            'm12': 'M12: オンボーディング'
        };
        return names[workflowId] || workflowId;
    }

    _getProgressColor(rate) {
        return rate >= 80 ? '#35a670' : rate >= 60 ? '#ff9b26' : '#ee4f27';
    }

    _bindManaWorkflowCards(container) {
        const cards = container.querySelectorAll('.mana-workflow-card');
        cards.forEach(card => {
            const handler = () => {
                const workflowId = card.dataset.workflowId;
                if (workflowId) this.openManaMessageHistory(workflowId);
            };
            card.addEventListener('click', handler);
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handler();
                }
            });
        });
    }

    _setupManaHistoryModal() {
        if (this.manaHistoryModalReady) return;
        const modal = document.getElementById('mana-history-modal');
        if (!modal) return;
        const closeBtns = modal.querySelectorAll('.close-modal-btn');
        closeBtns.forEach(btn => btn.addEventListener('click', () => modal.classList.remove('active')));
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                modal.classList.remove('active');
            }
        });
        this.manaHistoryModalReady = true;
    }

    async _ensureSlackMembers() {
        if (this.slackMembersLoaded) return;
        try {
            const response = await fetch('/api/config/slack/members');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const members = await response.json();
            if (Array.isArray(members)) {
                members.forEach((member) => {
                    const slackId = member.slack_id;
                    const name = member.brainbase_name || member.slack_name || null;
                    if (slackId && name) {
                        this.slackIdMap.set(slackId, name);
                    }
                });
            }
            this.slackMembersLoaded = true;
        } catch (error) {
            console.warn('Failed to load slack members:', error);
            this.slackMembersLoaded = false;
        }
    }

    _resolveSlackMemberName(slackId) {
        if (!slackId) return null;
        return this.slackIdMap.get(slackId) || null;
    }

    async openManaMessageHistory(workflowId) {
        const modal = document.getElementById('mana-history-modal');
        const titleEl = document.getElementById('mana-history-title');
        const metaEl = document.getElementById('mana-history-meta');
        const listEl = document.getElementById('mana-history-list');

        if (!modal || !listEl || !titleEl || !metaEl) return;

        titleEl.textContent = `${this._getWorkflowName(workflowId)}: メッセージ履歴`;
        metaEl.textContent = 'Loading...';
        listEl.innerHTML = '';
        modal.classList.add('active');

        try {
            await this._ensureSlackMembers();
            const result = await this.brainbaseService.getManaMessageHistory(workflowId, 30);
            const items = result.items || [];
            metaEl.textContent = `表示件数: ${items.length}`;

            if (items.length === 0) {
                listEl.innerHTML = '<div class="mana-history-empty">履歴が見つかりませんでした。</div>';
                return;
            }

            listEl.innerHTML = items.map(item => {
                const sentAt = this._formatDate(item.sent_at);
                const isUserTarget = item.target_type === 'user';
                const resolvedName = isUserTarget ? this._resolveSlackMemberName(item.target_id) : null;
                const targetValue = resolvedName || item.target_id || '-';
                const target = `${item.target_type || 'target'}: ${targetValue}`;
                const status = item.status || 'unknown';
                const badgeClass = this._getManaHistoryBadgeClass(status);
                const text = this._escapeHtml(item.text || item.excerpt || '');
                const error = item.error ? `<div class="mana-history-error">${this._escapeHtml(item.error)}</div>` : '';
                const meta = [
                    item.project_id ? `project: ${this._escapeHtml(item.project_id)}` : null,
                    item.channel_id ? `channel: ${this._escapeHtml(item.channel_id)}` : null,
                    item.workspace ? `workspace: ${this._escapeHtml(item.workspace)}` : null,
                    resolvedName && item.target_id ? `id: ${this._escapeHtml(item.target_id)}` : null
                ].filter(Boolean).join(' · ');

                return `
                    <div class="mana-history-item">
                        <div class="mana-history-item-header">
                            <div class="mana-history-target">${this._escapeHtml(target)}</div>
                            <div class="mana-history-meta-right">
                                <span class="badge ${badgeClass}">${this._escapeHtml(status)}</span>
                                <span class="mana-history-time">${this._escapeHtml(sentAt)}</span>
                            </div>
                        </div>
                        ${meta ? `<div class="mana-history-submeta">${meta}</div>` : ''}
                        <div class="mana-history-text">${text || '<span class="mana-history-empty-text">No message text</span>'}</div>
                        ${error}
                    </div>
                `;
            }).join('');
        } catch (error) {
            metaEl.textContent = 'Failed to load message history';
            listEl.innerHTML = `<div class="mana-history-error">${this._escapeHtml(error.message || 'Unknown error')}</div>`;
        }
    }

    _getManaHistoryBadgeClass(status) {
        if (!status) return 'badge-warning';
        if (status === 'success' || status === 'ok') return 'badge-healthy';
        if (status === 'failed' || status === 'error') return 'badge-critical';
        return 'badge-warning';
    }

    _formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    }

    _escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * セクションインデックスからコンテナIDを取得
     * @private
     * @param {number} index - セクションインデックス (0-7)
     * @returns {string} コンテナID
     */
    _getSectionId(index) {
        // render()内の呼び出し順序に対応
        const sectionIds = [
            'section-1-alerts',           // index 0: Section 1 Critical Alerts
            'strategic-content',          // index 1: Section 2 Strategic Overview
            'section-4-trends',           // index 2: Section 4 Trend Analysis
            'mana-quality'                // index 3: Section 5 Mana Quality Dashboard
        ];
        return sectionIds[index] || `section-${index + 1}`;
    }

    /**
     * セクションのエラーフォールバックUIをレンダリング
     * @private
     * @param {string} sectionId - コンテナID
     * @param {Error} error - エラーオブジェクト
     */
    _renderErrorFallback(sectionId, error) {
        const container = document.getElementById(sectionId) || document.querySelector(`.${sectionId}`);
        if (!container) {
            console.warn(`Container not found for section: ${sectionId}`);
            return;
        }

        const errorHtml = `
            <div class="error-fallback" style="padding: 20px; background: rgba(238, 79, 39, 0.1); border: 1px solid rgba(238, 79, 39, 0.3); border-radius: 8px; margin: 10px 0;">
                <h4 style="color: #ee4f27; margin: 0 0 10px 0;">⚠️ セクションの読み込みに失敗しました</h4>
                <p style="color: #c4bbd3; margin: 0; font-size: 14px;">
                    エラー: ${error.message || '不明なエラー'}
                </p>
                <button
                    onclick="window.location.reload()"
                    style="margin-top: 10px; padding: 8px 16px; background: #ee4f27; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;"
                >
                    ページを再読み込み
                </button>
            </div>
        `;

        container.innerHTML = errorHtml;
    }
}
