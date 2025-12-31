export class ProjectCard {
    constructor(container, project) {
        this.container = container;
        this.project = project;
        this.render();
    }

    getColor(score) {
        if (score >= 70) return '#35a670';
        if (score >= 50) return '#ff9b26';
        return '#ee4f27';
    }

    render() {
        const card = document.createElement('div');
        card.className = 'project-card';
        card.innerHTML = `
      <div class="project-card-score" style="color: ${this.getColor(this.project.healthScore)}">
        ${this.project.healthScore}%
      </div>
      <div class="project-card-name">${this.project.name}</div>
      <div class="project-card-overdue" style="color: ${this.project.overdue > 0 ? '#ee4f27' : '#6f87a0'}">
        ${this.project.overdue} 超過
      </div>
    `;
        card.addEventListener('click', () => this.showDetails());
        this.container.appendChild(card);
    }

    showDetails() {
        // プロジェクト詳細モーダル表示（Phase 2で実装）
        console.log('Project details clicked:', this.project);
    }
}
