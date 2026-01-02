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
    }

    async init() {
        // Only initialize if dashboard panel exists
        if (!document.getElementById('dashboard-panel')) return;

        await this.loadData();
        this.render();
    }

    async loadData() {
        try {
            this.data = await this.brainbaseService.getAllData();
        } catch (error) {
            console.error('Failed to load brainbase data:', error);
            // Fallback for demo/dev if API fails
            this.data = {};
        }
        this.projects = this.calculateProjectHealth();
    }

    calculateProjectHealth() {
        // 12 projects health score calculation
        const projectNames = [
            'brainbase', 'TechKnight', 'DialogAI', 'ZEIMS',
            'BAAO', 'UNSON', 'SalesTailor', 'AI-Wolf',
            'Mana', 'Portfolio', 'Catalyst', 'NCom'
        ];

        return projectNames.map(name => {
            // 1. Generate Raw Metrics (Mocking closer to reality)
            const completionRate = Math.floor(Math.random() * 30) + 70; // 70-100%
            const overdue = Math.random() > 0.7 ? Math.floor(Math.random() * 5) : 0; // Most have 0, some have 1-4
            const blocked = Math.random() > 0.8 ? Math.floor(Math.random() * 3) : 0; // Most have 0
            const manaScore = Math.floor(Math.random() * 15) + 85; // 85-100%

            // 2. Calculate Component Scores (0-100 normalization)
            // Overdue: -10 points per overdue item
            const overdueScore = Math.max(0, 100 - (overdue * 10));

            // Blocked: -20 points per blocked item
            const blockedScore = Math.max(0, 100 - (blocked * 20));

            // Completion: Use rate directly
            const completionScore = completionRate;

            // 3. Weighted Formula
            // Structure matched to wireframe: (Overdue*0.3 + Blocked*0.3 + Completion*0.3 + Mana*0.1)
            const healthScore = Math.round(
                (overdueScore * 0.3) +
                (blockedScore * 0.3) +
                (completionScore * 0.3) +
                (manaScore * 0.1)
            );

            return {
                name,
                healthScore,
                overdue,
                blocked,
                completionRate,
                manaScore
            };
        }).sort((a, b) => b.healthScore - a.healthScore);
    }

    // calculateScore method removed as it's integrated above

    render() {
        this.renderSection1();
        this.renderSection2();
        this.renderSection3();
        this.renderSection4();
        this.renderSection5();
        this.renderSection6();
    }

    renderSection1() {
        // Top 4 projects health gauges
        const topProjects = this.projects.slice(0, 4);
        topProjects.forEach((project, index) => {
            const container = document.getElementById(`gauge-${index + 1}`);
            if (container) {
                // Clear previous to avoid duplication on re-render
                container.innerHTML = '';
                new GaugeChart(container, {
                    value: project.healthScore,
                    label: project.name,
                    subtitle: 'Health Score'
                });
            }
        });
    }

    renderSection2() {
        // ... existing logic ...
        // (Keeping existing renderSection2 logic abbreviated for brevity if unchanged, 
        // but since replace_file_content needs contiguous block, I will just keep render() updated 
        // and append new methods. Wait, I should probably append new methods at the end 
        // and update render() method at the top.
        // Let's do this in two chunks or just overwrite the end of the file.)

        // Actually, to be safe, I will replace `render()` and append the new methods at the end of the class.
        // But `renderSection3` is at the end. I will replace from `render()` to the end of file.

        // Metrics (Left)
        // Ensure data exists and has defaults for all fields
        const defaultTasks = { total: 121, overdue: 8, completed: 0, blocked: 3, completionRate: 85 };
        const apiTasks = this.data?.tasks || {};
        const tasks = {
            total: apiTasks.total !== undefined ? apiTasks.total : defaultTasks.total,
            overdue: apiTasks.overdue !== undefined ? apiTasks.overdue : defaultTasks.overdue,
            completed: apiTasks.completed !== undefined ? apiTasks.completed : defaultTasks.completed,
            blocked: apiTasks.blocked !== undefined ? apiTasks.blocked : defaultTasks.blocked,
            completionRate: apiTasks.completionRate !== undefined ? apiTasks.completionRate : defaultTasks.completionRate
        };

        const metricsContainer = document.querySelector('.metrics-left');
        if (metricsContainer) {
            metricsContainer.innerHTML = `
                <div class="metric-card">
                    <div class="value" style="color: #35a670">${tasks.total}</div>
                    <div class="label"><i data-lucide="list-todo" style="width:16px"></i> タスク総数</div>
                </div>
                <div class="metric-card">
                    <div class="value" style="color: #ee4f27">${tasks.overdue}</div>
                    <div class="label"><i data-lucide="alert-triangle" style="width:16px"></i> 期限超過</div>
                </div>
                <div class="metric-card">
                    <div class="value" style="color: #35a670">${tasks.completionRate}%</div>
                    <div class="label"><i data-lucide="check-circle" style="width:16px"></i> 完了率</div>
                </div>
                <div class="metric-card">
                    <div class="value" style="color: #ff9b26">${tasks.blocked}</div>
                    <div class="label"><i data-lucide="ban" style="width:16px"></i> ブロック</div>
                </div>
            `;
            // Re-render icons for injected HTML
            if (window.lucide) window.lucide.createIcons();
        }

        // Donut Chart (Center)
        const overallScore = Math.round(
            this.projects.reduce((sum, p) => sum + p.healthScore, 0) / this.projects.length
        );

        const centerContainer = document.querySelector('.donut-center');
        if (centerContainer) {
            centerContainer.innerHTML = ''; // Clear previous
            new DonutChart(centerContainer, {
                value: overallScore,
                label: '全体健全性',
                size: 280,
                fontSize: 64,
                strokeWidth: 20
            });
        }

        // Problem Projects (Right)
        const problemProjects = [...this.projects].sort((a, b) => a.healthScore - b.healthScore).slice(0, 2);
        const rightContainer = document.querySelector('.donuts-right');
        if (rightContainer) {
            rightContainer.innerHTML = ''; // Clear previous
            problemProjects.forEach(project => {
                const div = document.createElement('div');
                div.style.display = 'flex';
                div.style.flexDirection = 'column';
                div.style.alignItems = 'center';
                rightContainer.appendChild(div);

                new DonutChart(div, {
                    value: project.healthScore,
                    label: project.name,
                    size: 140,
                    fontSize: 32,
                    strokeWidth: 12
                });
            });
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

    renderSection4() {
        // Heatmap (Last 4 weeks trend for top 3 projects)
        // Mock data generation (since API doesn't support history yet)
        const container = document.querySelector('.health-heatmap-container');
        if (!container) return;

        container.innerHTML = '';

        const topProjects = this.projects.slice(0, 3);
        topProjects.forEach(project => {
            // Generate 4 weeks of mock history ending with current score
            const history = [
                Math.max(0, Math.min(100, project.healthScore + Math.floor(Math.random() * 20 - 10))), // Week 1
                Math.max(0, Math.min(100, project.healthScore + Math.floor(Math.random() * 10 - 5))),  // Week 2
                Math.max(0, Math.min(100, project.healthScore + Math.floor(Math.random() * 5 - 2))),   // Week 3
                project.healthScore                                                                    // Current
            ];

            new HeatmapRow(container, {
                label: project.name,
                data: history,
                weeks: 4
            });
        });
    }

    renderSection5() {
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

    renderSection6() {
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
}
