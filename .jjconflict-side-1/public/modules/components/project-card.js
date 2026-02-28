export class ProjectCard {
  constructor(container, project) {
    this.container = container;
    this.project = project;
    this.render();
  }

  /**
   * 異常検知基準に基づいてアラートレベルを判定
   * @returns {{ level: string, color: string, label: string }}
   */
  getAlertStatus() {
    const { healthScore, blocked } = this.project;

    // Critical: healthScore < 50 OR blocked > 0（ブロッカーがある）
    if (healthScore < 50 || (blocked && blocked > 0)) {
      return {
        level: 'critical',
        color: '#ee4f27',
        label: 'Critical'
      };
    }

    // Warning: 50 ≤ healthScore < 70
    if (healthScore < 70) {
      return {
        level: 'warning',
        color: '#ff9b26',
        label: 'Warning'
      };
    }

    // Healthy: healthScore ≥ 70
    return {
      level: 'healthy',
      color: '#35a670',
      label: 'Healthy'
    };
  }

  render() {
    const card = document.createElement('div');
    card.className = 'project-card';

    const alertStatus = this.getAlertStatus();

    // グラスモーフィズムカードスタイル
    card.style.cssText = `
      background: linear-gradient(to bottom, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0));
      backdrop-filter: blur(30px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 20px;
      cursor: pointer;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.3s ease;
    `;

    // ホバー時のスタイル
    card.addEventListener('mouseenter', () => {
      card.style.background = 'linear-gradient(to bottom, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0))';
      card.style.borderColor = 'rgba(255, 255, 255, 0.2)';
      card.style.transform = 'translateY(-4px)';
    });

    card.addEventListener('mouseleave', () => {
      card.style.background = 'linear-gradient(to bottom, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0))';
      card.style.borderColor = 'rgba(255, 255, 255, 0.1)';
      card.style.transform = 'translateY(0)';
    });

    // 異常検知が必要な場合のみ、詳細情報を表示
    const issuesHTML = alertStatus.level !== 'healthy' ? `
      <div class="project-card-issues" style="display: flex; gap: 8px; margin-top: 12px;">
        ${this.project.overdue > 0 ? `<span style="color: #ee4f27; font-size: 12px;">超過: ${this.project.overdue}</span>` : ''}
        ${this.project.blocked > 0 ? `<span style="color: #ee4f27; font-size: 12px;">ブロック: ${this.project.blocked}</span>` : ''}
      </div>
    ` : '';

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div class="project-card-name" style="color: var(--text-primary); font-size: 16px; font-weight: 600;">
          ${this.project.name}
        </div>
        <span class="alert-badge" style="
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          background-color: ${alertStatus.color};
          color: white;
        ">${alertStatus.label}</span>
      </div>
      <div class="project-card-score" style="
        color: ${alertStatus.color};
        font-size: 32px;
        font-weight: 700;
        margin-bottom: 4px;
      ">
        ${this.project.healthScore}%
      </div>
      <div style="color: var(--text-secondary); font-size: 13px;">Health Score</div>
      ${issuesHTML}
    `;

    requestAnimationFrame(() => {
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    });

    card.addEventListener('click', () => this.showDetails());
    this.container.appendChild(card);
  }

  showDetails() {
    // プロジェクト詳細モーダル表示（Phase 2で実装）
    console.log('Project details clicked:', this.project);
  }
}
