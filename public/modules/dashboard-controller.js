import { BrainbaseService } from './domain/brainbase/brainbase-service.js';
import { GaugeChart } from './components/gauge-chart.js';
import { DonutChart } from './components/donut-chart.js';
import { ProjectCard } from './components/project-card.js';
import { HeatmapRow } from './components/heatmap-row.js';
import { LineChart } from './components/line-chart.js';

export class DashboardController {
    constructor() {
        this.brainbaseService = new BrainbaseService();
        this.data = null;
        this.projects = [];
        this.systemHealth = null;
        this.criticalAlerts = null;
        this.healthRefreshInterval = null;
        this.dataRefreshInterval = null;
    }

    async init() {
        // Only initialize if dashboard panel exists
        if (!document.getElementById('dashboard-panel')) return;

        await this.loadData();
        await this.loadCriticalAlerts();
        this.render();

        // Load system health status
        await this.loadSystemHealth();

        // Setup Section 6 accordion
        this.setupSystemAccordion();

        // Auto-refresh data and critical alerts every 30 seconds
        if (!this.dataRefreshInterval) {
            this.dataRefreshInterval = setInterval(() => {
                this.loadData();
                this.loadCriticalAlerts();
            }, 30000);
        }

        // Auto-refresh system health every 5 minutes
        if (!this.healthRefreshInterval) {
            this.healthRefreshInterval = setInterval(() => {
                this.loadSystemHealth();
            }, 5 * 60 * 1000);
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
            const response = await fetch('/api/brainbase/critical-alerts');
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
            this.renderSection3(),
            this.renderSection4(),
            this.renderSection5(),
            this.renderSection6(),
            this.renderTrendGraphs(),
            this.renderManaDashboard()
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

    renderSection3() {
        // 12 Project Cards Grid
        const gridContainer = document.querySelector('.project-cards-grid');
        if (gridContainer) {
            gridContainer.innerHTML = ''; // Clear
            this.projects.forEach(project => {
                new ProjectCard(gridContainer, project);
            });
        }
    }

    async renderSection4() {
        // Section 4: Trend Analysis（Past 4 weeks）
        await this.renderProjectTrends();
        this.renderOverallMetricsTrend();
        this.renderValidationStageDistribution();
    }

    async renderProjectTrends() {
        const container = document.getElementById('project-trends-container');
        if (!container) return;

        const gridContainer = container.querySelector('.project-trends-grid');
        if (!gridContainer) return;

        try {
            // Get top 3 projects by health score
            const topProjects = this.projects
                .sort((a, b) => b.healthScore - a.healthScore)
                .slice(0, 3);

            if (topProjects.length === 0) {
                gridContainer.innerHTML = `
                    <div class="empty-state-card" style="
                        grid-column: 1 / -1;
                        background: rgba(255, 255, 255, 0.02);
                        backdrop-filter: blur(10px);
                        border: 1px dashed rgba(255, 255, 255, 0.1);
                        border-radius: 12px;
                        padding: 40px;
                        text-align: center;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 16px;
                    ">
                        <div style="
                            width: 64px;
                            height: 64px;
                            background: rgba(255, 255, 255, 0.05);
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            color: var(--text-tertiary);
                        ">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="20" x2="18" y2="10"></line>
                                <line x1="12" y1="20" x2="12" y2="4"></line>
                                <line x1="6" y1="20" x2="6" y2="14"></line>
                            </svg>
                        </div>
                        <div>
                            <h4 style="color: var(--text-primary); font-size: 16px; margin-bottom: 8px; font-weight: 600;">データ収集中</h4>
                            <p style="color: var(--text-secondary); font-size: 13px; max-width: 400px; line-height: 1.6;">
                                トレンド分析を表示するには、最低1週間のプロジェクトデータが必要です。<br>現在データを蓄積しています。
                            </p>
                        </div>
                    </div>
                `;
                return;
            }

            // Fetch trend data for each project
            const trendsPromises = topProjects.map(async (project) => {
                try {
                    const response = await fetch(`/api/brainbase/trends?project_id=${project.name}&days=30`);
                    if (!response.ok) return null;
                    return await response.json();
                } catch (error) {
                    console.error(`Failed to load trends for ${project.name}:`, error);
                    return null;
                }
            });

            const trendsResults = await Promise.allSettled(trendsPromises);

            // Extract successful results, handle failures
            const trendsData = trendsResults.map((result, index) => {
                if (result.status === 'fulfilled' && result.value) {
                    return result.value;
                }
                // Log failed trend fetch
                console.warn(`Failed to fetch trends for ${topProjects[index]?.name}:`, result.reason);
                return null;
            });

            // Render project trend cards
            gridContainer.innerHTML = topProjects.map((project, index) => {
                const trends = trendsData[index];
                const trendAnalysis = trends?.trend_analysis || { trend: 'insufficient_data', health_score_change: 0 };

                // Determine maturity stage based on project metrics
                const maturityStage = this.determineMaturityStage(project);

                // Trend badge
                const trendBadge = this.getTrendBadge(trendAnalysis.trend);

                // Health score change
                const changeSign = trendAnalysis.health_score_change >= 0 ? '+' : '';
                const changeColor = trendAnalysis.health_score_change >= 0 ? 'var(--accent-green)' : 'var(--accent-orange)';
                const changeArrow = trendAnalysis.health_score_change >= 0 ? '↑' : '↓';

                return `
                    <div class="project-trend-card" style="background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(30px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 20px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <h4 style="color: var(--text-primary); font-size: 16px; font-weight: 600;">${project.name}</h4>
                            <span class="trend-badge" style="padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; ${trendBadge.style}">${trendBadge.label}</span>
                        </div>

                        <!-- Maturity Heatmap (CPF/PSF/SPF/PMF) -->
                        <div class="maturity-heatmap" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px;">
                            ${this.renderMaturityCells(maturityStage)}
                        </div>

                        <!-- Health Score Trend -->
                        <div class="health-score-trend" style="display: flex; align-items: center; gap: 8px;">
                            <span style="color: var(--text-secondary); font-size: 13px;">Health Score:</span>
                            <span style="color: var(--text-primary); font-size: 16px; font-weight: 600;">${project.healthScore}</span>
                            <span class="trend-arrow" style="color: ${changeColor}; font-size: 14px;">${changeArrow} ${changeSign}${trendAnalysis.health_score_change}</span>
                        </div>
                    </div>
                `;
            }).join('');

        } catch (error) {
            console.error('Failed to render project trends:', error);
            gridContainer.innerHTML = '<div class="empty-state">Failed to load trend data</div>';
        }
    }

    determineMaturityStage(project) {
        // saas-ai-roadmap-playbook のバリデーション段階判定ロジック
        // CPF: Customer/Problem Fit - 課題が存在するか
        // PSF: Problem/Solution Fit - ソリューションが受け入れられるか
        // SPF: Solution/Product Fit - プロダクトとして磨かれているか
        // PMF: Product/Market Fit - 市場にフィットしているか

        const { healthScore, completionRate } = project;

        if (healthScore >= 90 && completionRate >= 90) {
            return 'PMF'; // Product/Market Fit
        } else if (healthScore >= 75 && completionRate >= 70) {
            return 'SPF'; // Solution/Product Fit
        } else if (healthScore >= 60 && completionRate >= 50) {
            return 'PSF'; // Problem/Solution Fit
        } else {
            return 'CPF'; // Customer/Problem Fit
        }
    }

    renderMaturityCells(currentStage) {
        const stages = ['CPF', 'PSF', 'SPF', 'PMF'];
        const stageColors = {
            'CPF': '#35a670',  // green
            'PSF': '#ff9b26',  // amber
            'SPF': '#6b21ef',  // purple
            'PMF': '#05f'      // blue
        };

        const currentIndex = stages.indexOf(currentStage);

        return stages.map((stage, index) => {
            const isActive = index <= currentIndex;
            const bgColor = isActive ? stageColors[stage] : 'rgba(255, 255, 255, 0.1)';
            const textColor = isActive ? '#fff' : 'var(--text-tertiary)';

            return `
                <div style="background: ${bgColor}; border-radius: 4px; padding: 8px; text-align: center;">
                    <div style="color: ${textColor}; font-size: 11px; font-weight: 600;">${stage}</div>
                </div>
            `;
        }).join('');
    }

    getTrendBadge(trend) {
        switch (trend) {
            case 'up':
                return { label: '改善中', style: 'background: rgba(53, 166, 112, 0.2); color: #35a670;' };
            case 'down':
                return { label: '悪化中', style: 'background: rgba(238, 79, 39, 0.2); color: #ee4f27;' };
            case 'stable':
                return { label: '安定', style: 'background: rgba(255, 155, 38, 0.2); color: #ff9b26;' };
            default:
                return { label: 'データ不足', style: 'background: rgba(255, 255, 255, 0.1); color: var(--text-tertiary);' };
        }
    }

    renderOverallMetricsTrend() {
        const container = document.getElementById('overall-metrics-trend');
        if (!container) return;

        const gridContainer = container.querySelector('.metrics-trend-grid');
        if (!gridContainer) return;

        // Check for empty data
        if (this.projects.length === 0) {
            gridContainer.innerHTML = `
                <div class="empty-state-card" style="
                    grid-column: 1 / -1;
                    background: rgba(255, 255, 255, 0.02);
                    backdrop-filter: blur(10px);
                    border: 1px dashed rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    padding: 40px;
                    text-align: center;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 16px;
                ">
                    <div style="
                        width: 64px;
                        height: 64px;
                        background: rgba(255, 255, 255, 0.05);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: var(--text-tertiary);
                    ">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                             <line x1="18" y1="20" x2="18" y2="10"></line>
                             <line x1="12" y1="20" x2="12" y2="4"></line>
                             <line x1="6" y1="20" x2="6" y2="14"></line>
                        </svg>
                    </div>
                    <div>
                        <h4 style="color: var(--text-primary); font-size: 16px; margin-bottom: 8px; font-weight: 600;">データ収集中</h4>
                        <p style="color: var(--text-secondary); font-size: 13px; max-width: 400px; line-height: 1.6;">
                            全体トレンドを表示するには、プロジェクトデータの蓄積が必要です。
                        </p>
                    </div>
                </div>
            `;
            return;
        }

        // Calculate overall metrics from all projects
        const totalTasks = this.projects.reduce((sum, p) => sum + p.total, 0);
        const completedTasks = this.projects.reduce((sum, p) => sum + p.completed, 0);
        const overdueTasks = this.projects.reduce((sum, p) => sum + p.overdue, 0);
        const blockedTasks = this.projects.reduce((sum, p) => sum + p.blocked, 0);

        const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        // Mock trend data (replace with actual /api/brainbase/trends aggregation in the future)
        const metrics = [
            {
                label: 'タスク完了率',
                value: `${completionRate}%`,
                change: '+3%',
                trend: 'up'
            },
            {
                label: '期限超過数',
                value: overdueTasks,
                change: '-2',
                trend: 'down'
            },
            {
                label: 'ブロックタスク数',
                value: blockedTasks,
                change: '+1',
                trend: 'up'
            },
            {
                label: 'マイルストーン進捗',
                value: `${Math.round(this.projects.reduce((sum, p) => sum + (p.completionRate || 0), 0) / this.projects.length)}%`,
                change: '+5%',
                trend: 'up'
            }
        ];

        gridContainer.innerHTML = metrics.map(metric => {
            const changeColor = metric.trend === 'up' && metric.label === 'タスク完了率' ? 'var(--accent-green)' :
                metric.trend === 'down' && metric.label === '期限超過数' ? 'var(--accent-green)' :
                    metric.trend === 'up' ? 'var(--accent-orange)' : 'var(--accent-green)';

            return `
                <div class="metric-trend-item">
                    <div style="color: var(--text-secondary); font-size: 13px; margin-bottom: 8px;">${metric.label}</div>
                    <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px;">
                        <span style="color: var(--text-primary); font-size: 24px; font-weight: 600;">${metric.value}</span>
                        <span style="color: ${changeColor}; font-size: 14px;">${metric.change}</span>
                    </div>
                    <div class="mini-chart" style="height: 40px; background: rgba(255, 255, 255, 0.05); border-radius: 4px; display: flex; align-items: center; justify-content: center;">
                        <span style="color: var(--text-tertiary); font-size: 11px;">Chart placeholder</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderValidationStageDistribution() {
        const container = document.getElementById('validation-stage-distribution');
        if (!container) return;

        const chartContainer = container.querySelector('#validation-chart-container');
        if (!chartContainer) return;

        // Check for empty data
        if (this.projects.length === 0) {
            chartContainer.innerHTML = `
                <div class="empty-state-card" style="
                    height: 100%;
                    background: rgba(255, 255, 255, 0.02);
                    backdrop-filter: blur(10px);
                    border: 1px dashed rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 12px;
                ">
                    <p style="color: var(--text-secondary); font-size: 13px;">データ不足のため表示できません</p>
                </div>
            `;
            return;
        }

        // Count projects by maturity stage
        const stageCounts = { CPF: 0, PSF: 0, SPF: 0, PMF: 0 };

        this.projects.forEach(project => {
            const stage = this.determineMaturityStage(project);
            stageCounts[stage]++;
        });

        // Render simple bar chart (replace with Chart.js in future)
        const total = this.projects.length;
        chartContainer.innerHTML = `
            <div style="display: flex; gap: 8px; align-items: flex-end; height: 100%; padding: 0 20px;">
                ${Object.entries(stageCounts).map(([stage, count]) => {
            const percentage = total > 0 ? (count / total) * 100 : 0;
            const stageColors = {
                'CPF': '#35a670',
                'PSF': '#ff9b26',
                'SPF': '#6b21ef',
                'PMF': '#05f'
            };

            return `
                        <div style="flex: 1; display: flex; flex-direction: column; align-items: center;">
                            <div style="width: 100%; background: ${stageColors[stage]}; border-radius: 4px 4px 0 0; height: ${percentage}%; min-height: 20px; display: flex; align-items: center; justify-content: center;">
                                <span style="color: #fff; font-size: 12px; font-weight: 600;">${count}</span>
                            </div>
                            <div style="color: var(--text-secondary); font-size: 13px; margin-top: 8px;">${stage}</div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    }

    async renderSection5() {
        // Mana Quality Dashboard (Week 7-8)
        const manaSection = document.getElementById('mana-quality');
        if (!manaSection) return;

        try {
            // NocoDB から Mana ワークフロー統計を取得
            const workflows = ['m1_ceo_daily', 'm2_blocker_detection', 'm3_deadline_reminder', 'm4_overdue_alert', 'm9_weekly_report'];

            const workflowStatsPromises = workflows.map(async (workflowId) => {
                const response = await fetch(`/api/brainbase/mana-workflow-stats?workflow_id=${workflowId}`);
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
                    <div class="mana-workflow-card" style="background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 24px; transition: all 0.3s ease;">
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
            'm1_ceo_daily': 'M1: 朝のブリーフィング',
            'm2_blocker_detection': 'M2: ブロッカー早期発見',
            'm3_deadline_reminder': 'M3: 期限前リマインド',
            'm4_overdue_alert': 'M4: 期限超過アラート',
            'm9_weekly_report': 'M9: 週次レポート自動生成'
        };
        return names[workflowId] || workflowId;
    }

    _getProgressColor(rate) {
        return rate >= 80 ? '#35a670' : rate >= 60 ? '#ff9b26' : '#ee4f27';
    }

    renderSection6() {
        // System Resource Gauges (8 metrics)
        const container = document.querySelector('.system-grid');
        if (!container) return;

        container.innerHTML = '';

        // Mock System Data
        const metrics = [
            { label: 'CPU %', value: 67, color: '#ff9b26' },
            { label: 'MEM %', value: 92, color: '#ef4444' }, // Alert example
            { label: 'DISK %', value: 45, color: '#35a670' },
            { label: 'Mana Success', value: 98, color: '#35a670' },
            { label: 'Workspace', value: 45, suffix: 'GB', color: '#35a670' }, // 45GB used
            { label: 'Worktrees', value: 3.1, suffix: 'GB', color: '#35a670' },
            { label: 'Active WT', value: 4, color: '#35a670' },
            { label: 'Runners', value: 0, color: '#ef4444' } // Alert example
        ];

        metrics.forEach(metric => {
            const card = document.createElement('div');
            card.className = 'system-card';

            // Gauge Container
            const gaugeContainer = document.createElement('div');
            gaugeContainer.className = 'system-gauge-container';
            card.appendChild(gaugeContainer);

            // Value
            const valueDiv = document.createElement('div');
            valueDiv.className = 'system-value';
            valueDiv.textContent = metric.suffix ? `${metric.value}${metric.suffix}` : metric.value;
            valueDiv.style.color = metric.color;
            card.appendChild(valueDiv);

            // Label
            const labelDiv = document.createElement('div');
            labelDiv.className = 'system-label';
            labelDiv.textContent = metric.label;
            card.appendChild(labelDiv);

            container.appendChild(card);

            // Render Gauge
            new GaugeChart(gaugeContainer, {
                value: metric.suffix ? (metric.value / 100 * 100) : metric.value, // Simplified for now
                label: '',
                size: 80, // Smaller size
                fontSize: 0, // Hide default center text
                color: metric.color
            });
        });
    }

    renderTrendGraphs() {
        // Trend Graphs (3 metrics)
        // Mock Data for Phase 3
        const weeks = ['4w ago', '3w ago', '2w ago', '1w ago'];

        // 1. Overall Completion Rate
        const completionContainer = document.getElementById('trend-completion');
        if (completionContainer) {
            new LineChart(completionContainer, {
                label: '全体完了率',
                labels: weeks,
                data: [65, 72, 68, 85],
                color: '#35a670', // Green
                yAxisMax: 100,
                height: 250
            });
        }

        // 2. Overdue Trend
        const overdueContainer = document.getElementById('trend-overdue');
        if (overdueContainer) {
            new LineChart(overdueContainer, {
                label: '期限超過数',
                labels: weeks,
                data: [12, 15, 8, 5],
                color: '#ee4f27', // Red
                yAxisMax: 20,
                height: 250
            });
        }

        // 3. Mana Success Rate
        const manaContainer = document.getElementById('trend-mana');
        if (manaContainer) {
            new LineChart(manaContainer, {
                label: 'Mana応答成功率',
                labels: weeks,
                data: [88, 92, 95, 98],
                color: '#6b21ef', // Purple
                yAxisMax: 100,
                height: 250
            });
        }
    }

    async loadSystemHealth() {
        try {
            const response = await fetch('/api/brainbase/system-health');
            const result = await response.json();

            if (result.success) {
                this.systemHealth = result.data;
                this.renderSystemHealth();
            }
        } catch (error) {
            console.error('Failed to load system health:', error);
        }
    }

    renderSystemHealth() {
        const container = document.getElementById('system-health-status');
        if (!container || !this.systemHealth) return;

        const { mana, runners } = this.systemHealth;

        // 個別ステータスアイコン
        const getIcon = (status) => {
            if (status === 'healthy') return '✅';
            if (status === 'error') return '❌';
            if (status === 'warning') return '⚠️';
            return '❓'; // unknown
        };

        const manaIcon = getIcon(mana?.status);
        const runnersIcon = getIcon(runners?.status);

        container.innerHTML = `
            <div class="health-status-grid">
                <div class="health-item" onclick="window.dashboardController.openHealthModal('mana')">
                    <span class="health-icon">${manaIcon}</span>
                    <span class="health-label">mana (Slack Bot)</span>
                </div>
                <div class="health-item" onclick="window.dashboardController.openHealthModal('runners')">
                    <span class="health-icon">${runnersIcon}</span>
                    <span class="health-label">Self-hosted Runners</span>
                </div>
            </div>
        `;
    }

    openHealthModal(type) {
        const modal = document.getElementById('health-detail-modal');
        const content = document.getElementById('health-modal-content');

        if (type === 'mana') {
            content.innerHTML = this._renderManaHealthDetails();
        } else if (type === 'runners') {
            content.innerHTML = this._renderRunnersHealthDetails();
        }

        modal.classList.add('active');
    }

    closeHealthModal() {
        const modal = document.getElementById('health-detail-modal');
        modal.classList.remove('active');
    }

    _renderManaHealthDetails() {
        if (!this.systemHealth) return '<p>Loading...</p>';

        const { mana, lastRun } = this.systemHealth;

        const statusBadge = mana.status === 'healthy' ? 'healthy' : mana.status === 'error' ? 'error' : 'warning';
        const statusText = mana.status === 'healthy' ? '正常' : mana.status === 'error' ? 'エラー' : '警告';

        let html = `
            <div class="health-modal-header">
                <h3>mana (Slack Bot) ヘルスチェック</h3>
                <div class="health-status-badge ${statusBadge}">
                    ${mana.status === 'healthy' ? '✅' : mana.status === 'error' ? '❌' : '⚠️'} ${statusText}
                </div>
            </div>
        `;

        if (lastRun) {
            html += `
                <div class="health-details-section">
                    <h4>最終実行情報</h4>
                    <div class="health-detail-item">
                        <strong>実行日時:</strong>
                        <p>${new Date(lastRun.updated_at).toLocaleString('ja-JP')}</p>
                    </div>
                    <div class="health-detail-item">
                        <strong>チェック対象:</strong>
                        <p>Lambda関数 (mana) のエラー状況</p>
                    </div>
                    <div class="health-detail-item">
                        <strong>ステップ結果:</strong>
                        <p>${mana.step?.conclusion || 'unknown'}</p>
                    </div>
                    <div class="health-detail-item">
                        <strong>詳細を見る:</strong>
                        <p><a href="${lastRun.html_url}" target="_blank">GitHub Actions</a></p>
                    </div>
                </div>
            `;
        }

        if (mana.status === 'error' && mana.step) {
            html += `
                <div class="health-details-section">
                    <h4>エラー詳細</h4>
                    <div class="error-step">
                        <strong>${mana.step.stepName}</strong>
                        <p>Status: ${mana.step.conclusion}</p>
                    </div>
                </div>
            `;
        } else if (mana.status === 'healthy') {
            html += `<div class="no-errors-message">✅ Lambda関数のエラーチェックは正常です</div>`;
        }

        return html;
    }

    _renderRunnersHealthDetails() {
        if (!this.systemHealth) return '<p>Loading...</p>';

        const { runners, lastRun } = this.systemHealth;

        const statusBadge = runners.status === 'healthy' ? 'healthy' : runners.status === 'error' ? 'error' : 'warning';
        const statusText = runners.status === 'healthy' ? '正常' : runners.status === 'error' ? 'エラー' : '警告';

        let html = `
            <div class="health-modal-header">
                <h3>Self-hosted Runners ヘルスチェック</h3>
                <div class="health-status-badge ${statusBadge}">
                    ${runners.status === 'healthy' ? '✅' : runners.status === 'error' ? '❌' : '⚠️'} ${statusText}
                </div>
            </div>
        `;

        if (lastRun) {
            html += `
                <div class="health-details-section">
                    <h4>最終実行情報</h4>
                    <div class="health-detail-item">
                        <strong>実行日時:</strong>
                        <p>${new Date(lastRun.updated_at).toLocaleString('ja-JP')}</p>
                    </div>
                    <div class="health-detail-item">
                        <strong>チェック対象:</strong>
                        <p>GitHub Actions self-hosted runnersの稼働状況</p>
                    </div>
                    <div class="health-detail-item">
                        <strong>ステップ結果:</strong>
                        <p>${runners.step?.conclusion || 'unknown'}</p>
                    </div>
                    <div class="health-detail-item">
                        <strong>詳細を見る:</strong>
                        <p><a href="${lastRun.html_url}" target="_blank">GitHub Actions</a></p>
                    </div>
                </div>
            `;
        }

        if (runners.status === 'error' && runners.step) {
            html += `
                <div class="health-details-section">
                    <h4>エラー詳細</h4>
                    <div class="error-step">
                        <strong>${runners.step.stepName}</strong>
                        <p>Status: ${runners.step.conclusion}</p>
                    </div>
                </div>
            `;
        } else if (runners.status === 'healthy') {
            html += `<div class="no-errors-message">✅ すべてのランナーが正常に稼働しています</div>`;
        }

        return html;
    }

    async renderManaDashboard() {
        // Mana Dashboard Section
        await this.loadManaData();
        this.renderManaHero();
        this.renderManaQualityMetrics();
        this.renderManaWorkflows();
    }

    async loadManaData() {
        // Load mana workflow data from NocoDB-backed API
        const workflows = ['m1_ceo_daily', 'm2_blocker_detection', 'm3_deadline_reminder', 'm4_overdue_alert', 'm9_weekly_report'];

        try {
            const results = await Promise.allSettled(
                workflows.map(async (workflow) => {
                    const response = await fetch(`/api/brainbase/mana-workflow-stats?workflow_id=${workflow}`);
                    if (!response.ok) throw new Error(`Failed to fetch workflow ${workflow}`);
                    const data = await response.json();

                    return {
                        workflow,
                        data: {
                            displayName: this._getWorkflowName(workflow),
                            stats: {
                                successRate: data.stats?.success_rate ?? 0,
                                total: data.stats?.total_executions ?? 0
                            }
                        }
                    };
                })
            );

            const workflowData = results.map((result, index) => {
                if (result.status === 'fulfilled' && result.value) {
                    return result.value;
                }
                console.warn(`Failed to fetch mana data for ${workflows[index]}:`, result.reason);
                return null;
            }).filter(Boolean);

            this.manaData = {
                workflows: workflowData,
                // Mock quality metrics (replace with actual S3 data later)
                quality: {
                    usefulness: 4.2,
                    accuracy: 4.5,
                    conciseness: 3.9,
                    tone: 4.1
                }
            };
        } catch (error) {
            console.error('Failed to load mana data:', error);
            this.manaData = { workflows: [], quality: {} };
        }
    }

    renderManaHero() {
        const container = document.getElementById('mana-hero');
        if (!container || !this.manaData) return;

        const { workflows, quality } = this.manaData;
        const qualityAvg = quality.usefulness
            ? ((quality.usefulness + quality.accuracy + quality.conciseness + quality.tone) / 4).toFixed(1)
            : '---';

        const healthyCount = workflows.filter(w => w.data?.stats?.successRate >= 80).length;
        const warningCount = workflows.filter(w => w.data?.stats?.successRate >= 60 && w.data?.stats?.successRate < 80).length;
        const criticalCount = workflows.filter(w => w.data?.stats?.successRate < 60).length;

        const overallStatus = criticalCount > 0 ? '🚨 CRITICAL' : warningCount > 0 ? '⚠️ WARNING' : '🟢 HEALTHY';

        container.innerHTML = `
            <div style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary); margin-bottom: 12px;">
                    ${overallStatus}
                </div>
                <div style="font-size: 1rem; color: var(--text-secondary); margin-bottom: 8px;">
                    Quality: ${qualityAvg}/5 | Workflows: ${healthyCount}/${workflows.length} OK | Critical: ${criticalCount} | Warning: ${warningCount}
                </div>
                <div style="font-size: 0.9rem; color: var(--text-tertiary);">
                    Last 7 days: ${criticalCount === 0 && warningCount === 0 ? 'No critical issues detected' : `${criticalCount + warningCount} issue(s) need attention`}
                </div>
            </div>
        `;
    }

    renderManaQualityMetrics() {
        const container = document.getElementById('mana-quality-grid');
        if (!container || !this.manaData?.quality) return;

        const { quality } = this.manaData;
        const metrics = [
            { label: '有用性', value: quality.usefulness, color: '#22c55e' },
            { label: '正確性', value: quality.accuracy, color: '#3b82f6' },
            { label: '簡潔性', value: quality.conciseness, color: '#f59e0b' },
            { label: 'トーン', value: quality.tone, color: '#a855f7' }
        ];

        container.innerHTML = '';
        container.style.display = 'grid';
        container.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
        container.style.gap = '16px';
        container.style.marginBottom = '24px';

        // Wait for DOM to be ready before initializing charts
        requestAnimationFrame(() => {
            metrics.forEach(metric => {
                const metricDiv = document.createElement('div');
                metricDiv.style.cssText = 'min-height: 180px;';
                container.appendChild(metricDiv);

                // Ensure div is in DOM before creating chart
                requestAnimationFrame(() => {
                    new GaugeChart(metricDiv, {
                        value: (metric.value / 5) * 100, // Convert 0-5 to 0-100
                        label: metric.label,
                        subtitle: `${metric.value.toFixed(1)}/5.0`,
                        color: metric.color
                    });
                });
            });
        });
    }

    renderManaWorkflows() {
        const container = document.getElementById('mana-workflows-grid');
        if (!container || !this.manaData?.workflows) return;

        const { workflows } = this.manaData;

        // Classify workflows
        const critical = workflows.filter(w => w.data?.stats?.successRate < 60);
        const warning = workflows.filter(w => w.data?.stats?.successRate >= 60 && w.data?.stats?.successRate < 80);
        const healthy = workflows.filter(w => w.data?.stats?.successRate >= 80);

        let html = '';

        // Critical workflows (always show if any)
        if (critical.length > 0) {
            html += `
                <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
                    <h4 style="color: #ef4444; margin-bottom: 12px; font-size: 1rem; font-weight: 600;">
                        🚨 CRITICAL WORKFLOWS (${critical.length}/${workflows.length})
                    </h4>
                    <div style="display: grid; gap: 12px;">
                        ${critical.map(w => this.renderWorkflowCard(w, 'critical')).join('')}
                    </div>
                </div>
            `;
        }

        // Warning workflows
        if (warning.length > 0) {
            html += `
                <div style="background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
                    <h4 style="color: #fbbf24; margin-bottom: 12px; font-size: 1rem; font-weight: 600;">
                        ⚠️ WARNING WORKFLOWS (${warning.length}/${workflows.length})
                    </h4>
                    <div style="display: grid; gap: 12px;">
                        ${warning.map(w => this.renderWorkflowCard(w, 'warning')).join('')}
                    </div>
                </div>
            `;
        }

        // Healthy workflows (collapsed list)
        if (healthy.length > 0) {
            html += `
                <div style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 12px; padding: 16px;">
                    <h4 style="color: #22c55e; margin-bottom: 12px; font-size: 1rem; font-weight: 600;">
                        ✅ HEALTHY WORKFLOWS (${healthy.length}/${workflows.length})
                    </h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 8px;">
                        ${healthy.map(w => `
                            <div style="font-size: 0.9rem; color: var(--text-secondary);">
                                <strong style="color: var(--text-primary);">${w.data?.displayName || w.workflow}</strong>: ${w.data?.stats?.successRate || 0}%
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
    }

    renderWorkflowCard(workflowData, status) {
        const { workflow, data } = workflowData;
        const successRate = data?.stats?.successRate || 0;
        const totalRuns = data?.stats?.total || 0;
        const displayName = data?.displayName || workflow;

        return `
            <div style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <strong style="color: var(--text-primary); font-size: 0.95rem;">${displayName}</strong>
                    <span style="color: ${status === 'critical' ? '#ef4444' : '#fbbf24'}; font-weight: 600;">
                        ${successRate.toFixed(0)}%
                    </span>
                </div>
                <div style="font-size: 0.85rem; color: var(--text-tertiary);">
                    Total runs: ${totalRuns} | Last 30 days
                </div>
            </div>
        `;
    }

    /**
     * Section 6: System Health Accordion Setup
     * デフォルトで折りたたみ、クリックで展開/折りたたみ
     */
    setupSystemAccordion() {
        const header = document.getElementById('system-section-header');
        const content = document.getElementById('system-content');
        const chevron = document.getElementById('system-chevron');
        const section = document.getElementById('system-resources-section');

        if (!header || !content || !chevron || !section) {
            console.warn('Section 6 accordion elements not found');
            return;
        }

        let isOpen = false;

        header.addEventListener('click', () => {
            isOpen = !isOpen;

            if (isOpen) {
                // 展開
                content.style.maxHeight = `${content.scrollHeight}px`;
                chevron.style.transform = 'rotate(180deg)';
            } else {
                // 折りたたみ
                content.style.maxHeight = '0';
                chevron.style.transform = 'rotate(0deg)';
            }
        });

        // 異常検知時の自動展開（Phase 2で実装）
        // TODO: systemHealth取得後、異常があればisOpen = trueで自動展開
        // 異常時のハイライト: section.style.borderColor = '#ee4f27'; section.style.animation = 'pulse 2s infinite';
    }

    /**
     * セクションインデックスからコンテナIDを取得
     * @private
     * @param {number} index - セクションインデックス (0-7)
     * @returns {string} コンテナID
     */
    _getSectionId(index) {
        const sectionIds = [
            'section-1-alerts',           // Section 1: Critical Alerts
            'strategic-content',          // Section 2: Strategic Overview
            'project-cards-grid',         // Section 3: Project Health Grid
            'project-trends-container',   // Section 4: Trend Analysis
            'mana-quality',               // Section 5: Mana Quality Dashboard
            'system-resources-section',   // Section 6: System Health
            'trend-completion',           // Section 7: Trend Graphs
            'mana-hero'                   // Section 8: Mana Dashboard
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
