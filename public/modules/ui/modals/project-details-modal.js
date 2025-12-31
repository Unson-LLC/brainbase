import { LineChart } from '../../components/line-chart.js';

export class ProjectDetailsModal {
    constructor() {
        this.modal = document.getElementById('project-details-modal');
        this.closeBtns = this.modal.querySelectorAll('.close-modal-btn');
        this.openBtn = document.getElementById('open-project-btn');

        this.setupEventListeners();
    }

    setupEventListeners() {
        if (!this.modal) return;

        this.closeBtns.forEach(btn => {
            btn.onclick = () => this.close();
        });

        // Close on background click
        this.modal.onclick = (e) => {
            if (e.target === this.modal) this.close();
        };

        // Close on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.style.display === 'flex') {
                this.close();
            }
        });
    }

    open(project) {
        if (!this.modal) return;
        this.currentProject = project;
        this.render(project);
        this.modal.style.display = 'flex';
    }

    close() {
        if (!this.modal) return;
        this.modal.style.display = 'none';

        // Clear graph to prevent duplicate overlapping on re-open
        const graphContainer = document.getElementById('modal-trend-graph');
        if (graphContainer) graphContainer.innerHTML = '';
    }

    render(project) {
        // Headers
        document.getElementById('project-modal-title').textContent = project.name;
        const badge = document.getElementById('project-modal-badge');
        badge.textContent = `Health: ${project.healthScore}%`;

        // Dynamic Badge Color
        badge.style.backgroundColor = this.getHealthColor(project.healthScore);

        // Score Breakdown
        document.getElementById('modal-overdue').textContent = project.overdue;
        document.getElementById('modal-blocked').textContent = project.blocked;
        document.getElementById('modal-completion').textContent = `${project.completionRate}%`;
        // Mock Mana Score based on health if not present
        const manaScore = project.manaScore || Math.min(100, project.healthScore + 10);
        document.getElementById('modal-mana').textContent = `${manaScore}%`;

        // Render Trend Graph
        this.renderTrendGraph(project);

        // Render Lists
        this.renderTaskList(project);
        this.renderActionList(project);

        // Open Button Action
        this.openBtn.onclick = () => {
            this.close();
            // Switch to console view logic if needed, or trigger global event
            // For now just logs, user might want specialized navigation later
            console.log(`Opening console for ${project.name}`);
            const consoleBtn = document.getElementById('nav-console-btn');
            if (consoleBtn) consoleBtn.click();
        };
    }

    renderTrendGraph(project) {
        const container = document.getElementById('modal-trend-graph');
        if (!container) return;
        container.innerHTML = '';

        // Generate consistent mock history based on current score
        const history = [
            Math.max(0, Math.min(100, project.healthScore + Math.floor(Math.random() * 20 - 10))),
            Math.max(0, Math.min(100, project.healthScore + Math.floor(Math.random() * 10 - 5))),
            Math.max(0, Math.min(100, project.healthScore + Math.floor(Math.random() * 5 - 2))),
            project.healthScore
        ];

        new LineChart(container, {
            label: 'Health Trend',
            labels: ['Week 1', 'Week 2', 'Week 3', 'Current'],
            data: history,
            color: this.getHealthColor(project.healthScore),
            height: 150,
            yAxisMax: 100
        });
    }

    renderTaskList(project) {
        const list = document.getElementById('modal-task-list');
        list.innerHTML = '';

        // Generate dummy critical tasks
        const tasks = [];
        if (project.overdue > 0) tasks.push({ title: 'Fix critical bug in auth flow', type: 'Overdue', color: 'text-danger' });
        if (project.blocked > 0) tasks.push({ title: 'Wait for API spec from backend', type: 'Blocked', color: 'text-warning' });
        tasks.push({ title: 'Update documentation', type: 'Todo', color: 'text-secondary' });

        tasks.forEach(task => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${task.title}</span>
                <span style="font-size:0.75rem; font-weight:bold; color: var(--${task.type === 'Overdue' ? 'danger' : task.type === 'Blocked' ? 'warning-color' : 'text-secondary'})">
                    ${task.type}
                </span>
            `;
            list.appendChild(li);
        });
    }

    renderActionList(project) {
        const list = document.getElementById('modal-action-list');
        list.innerHTML = '';

        const actions = [];
        if (project.healthScore < 50) actions.push('Schedule emergency review meeting');
        if (project.overdue > 2) actions.push('Reassign overdue tasks');
        actions.push('Run full test suite');

        actions.forEach(action => {
            const li = document.createElement('li');
            li.textContent = action;
            list.appendChild(li);
        });
    }

    getHealthColor(score) {
        if (score >= 70) return 'var(--success-color)';
        if (score >= 50) return 'var(--warning-color)';
        return 'var(--danger-color)';
    }
}
