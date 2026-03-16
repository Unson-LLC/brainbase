function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
}

function statusSpecificFields(item) {
    if (!item) return '';

    if (item.status === 'artifact_missing' || item.status === 'artifact_requested') {
        return `<div class="lead-ops-row"><dt>必要証跡</dt><dd>${escapeHtml((item.requiredEvidence || []).join(' / '))}</dd></div>`;
    }

    if (item.status === 'approval_pending') {
        return `
            <div class="lead-ops-row"><dt>承認論点</dt><dd>${escapeHtml((item.approvalTopics || []).join(' / '))}</dd></div>
            <div class="lead-ops-row"><dt>必要証跡</dt><dd>${escapeHtml((item.requiredEvidence || []).join(' / '))}</dd></div>
        `;
    }

    if (item.status === 'execution_failed' || item.status === 'stabilizing' || item.status === 'stalled') {
        return `<div class="lead-ops-row"><dt>影響範囲</dt><dd>${escapeHtml(item.impactRange || '')}</dd></div>`;
    }

    return '';
}

function actionButtonsForStatus(item) {
    if (!item) return [];

    switch (item.status) {
        case 'artifact_missing':
        case 'artifact_requested':
            return [
                { label: '成果物を要求', command: 'requestArtifact' },
                { label: '期限を付ける', command: 'setArtifactDueDate' },
                { label: '代替証跡で進める', command: 'proceedWithAlternativeEvidence' },
                { label: '再割り振り', command: 'rerouteExecution' },
                { label: '上申資料を作成', command: 'createEscalationPacket' }
            ];
        case 'stalled':
            return [
                { label: '再割り振り', command: 'rerouteExecution' },
                { label: '範囲を縮小して進める', command: 'shrinkScopeAndContinue' },
                { label: '一時停止', command: 'pauseAndStabilize' },
                { label: '論点整理室へ送る', command: 'sendToBriefingRoom' }
            ];
        case 'approval_pending':
            return [
                { label: '承認', command: 'approveDecisionItem' },
                { label: '差戻し', command: 'returnDecisionItem' },
                { label: '条件付き承認', command: 'approveDecisionItemWithConstraint' },
                { label: '上申資料を作成', command: 'createEscalationPacket' }
            ];
        case 'execution_failed':
        case 'stabilizing':
            return [
                { label: '再実行', command: 'retryExecutionPlan' },
                { label: '別経路で実行', command: 'executeViaAlternateRoute' },
                { label: '回復担当に渡す', command: 'handoffToRecoveryOwner' },
                { label: '停止して整理', command: 'pauseAndStabilize' }
            ];
        default:
            return [
                { label: '保留', command: 'holdDecisionItem' }
            ];
    }
}

function buildingVisual(buildingId) {
    const map = {
        'building-execution-hall': { icon: '実', accent: 'execution', x: '10%', y: '18%' },
        'building-evidence-vault': { icon: '証', accent: 'evidence', x: '54%', y: '16%' },
        'building-approval-gate': { icon: '承', accent: 'approval', x: '72%', y: '54%' },
        'building-validation-lab': { icon: '検', accent: 'validation', x: '28%', y: '58%' }
    };

    return map[buildingId] || { icon: '棟', accent: 'neutral', x: '0%', y: '0%' };
}

function severityLabel(severity) {
    return severity === 'high' ? '高' : severity === 'medium' ? '中' : '低';
}

export class LeadConsoleView {
    constructor({ root, onBuildingSelect, onAnomalySelect, onActorSelect, onOptionSelect, onAction, onToggleActors, onFocusActorInitiative }) {
        this.root = root;
        this.onBuildingSelect = onBuildingSelect;
        this.onAnomalySelect = onAnomalySelect;
        this.onActorSelect = onActorSelect;
        this.onOptionSelect = onOptionSelect;
        this.onAction = onAction;
        this.onToggleActors = onToggleActors;
        this.onFocusActorInitiative = onFocusActorInitiative;
        this._handleClick = this._handleClick.bind(this);
    }

    mount() {
        this.root.addEventListener('click', this._handleClick);
    }

    unmount() {
        this.root.removeEventListener('click', this._handleClick);
    }

    render(leadState) {
        const { projections, selection } = leadState;
        const decisionItem = projections.opsPanel?.selectedDecisionItem || null;
        const selectedOption = projections.opsPanel?.selectedOption || null;
        const actorStrip = projections.actorStrip || { featuredActors: [], allActors: [], selectedActor: null };
        const visibleActors = selection.showAllActors ? actorStrip.allActors : actorStrip.featuredActors;
        const buttons = actionButtonsForStatus(decisionItem);
        const highlightedBuilding = selection.buildingId
            || projections.map?.anomalies?.find((anomaly) => anomaly.id === selection.anomalyId)?.buildingId
            || decisionItem?.buildingId
            || null;
        const highlightedBuildingName = (projections.map?.buildings || []).find((building) => building.id === highlightedBuilding)?.name
            || '区画全体';
        const selectedActorName = actorStrip.selectedActor?.name || '';

        this.root.innerHTML = `
            <div class="lead-console-root" data-component="lead-console">
                <header class="lead-console-header">
                    <div>
                        <p class="lead-console-kicker">現場責任者 | 区画巡回面 v0</p>
                        <h1>${escapeHtml(projections.map?.districtName || '継続率改善区画')}</h1>
                    </div>
                    <div class="lead-console-summary">
                        ${(projections.map?.summaryPills || []).map((pill) => `
                            <span class="lead-summary-pill ${escapeHtml(pill.tone || 'neutral')}">${escapeHtml(pill.label)}</span>
                        `).join('')}
                    </div>
                </header>
                <div class="lead-console-grid">
                    <section class="lead-console-map" data-lead-layer="map">
                        <div class="lead-panel-header">
                            <div>
                                <h2>区画巡回マップ</h2>
                                <p>左で現場が生きてる感じを掴む面</p>
                            </div>
                            <div class="lead-panel-meta">
                                <span class="lead-panel-note">10〜15秒ごとに巡回報告が切替</span>
                                <span class="lead-panel-badge">選択中: ${escapeHtml(highlightedBuildingName)}</span>
                            </div>
                        </div>
                        <div class="lead-map-chip-row lead-building-list">
                            ${(projections.map?.buildings || []).map((building) => `
                                <button
                                    type="button"
                                    class="lead-building-button ${selection.buildingId === building.id ? 'selected' : ''}"
                                    data-action="select-building"
                                    data-building-id="${escapeHtml(building.id)}"
                                >
                                    ${escapeHtml(building.name)}
                                </button>
                            `).join('')}
                        </div>
                        <div class="lead-map-scene">
                            <div class="lead-map-ground"></div>
                            <div class="lead-map-path lead-map-path-main"></div>
                            <div class="lead-map-path lead-map-path-cross"></div>
                            ${(projections.map?.buildings || []).map((building) => {
                                const visual = buildingVisual(building.id);
                                const initiative = projections.map?.buildingInitiatives?.[building.id];
                                return `
                                    <button
                                        type="button"
                                        class="lead-map-building ${visual.accent} ${highlightedBuilding === building.id ? 'active' : ''}"
                                        data-action="select-building"
                                        data-building-id="${escapeHtml(building.id)}"
                                        style="left:${visual.x}; top:${visual.y};"
                                    >
                                        <span class="lead-map-building-tag">${escapeHtml(building.name)}</span>
                                        <span class="lead-map-building-roof"></span>
                                        <span class="lead-map-building-body">
                                            <span class="lead-map-building-icon">${escapeHtml(visual.icon)}</span>
                                        </span>
                                        ${initiative ? `<span class="lead-map-building-caption">${escapeHtml(initiative.title)}</span>` : ''}
                                    </button>
                                `;
                            }).join('')}
                            ${(projections.map?.actorScene || []).map((actor) => `
                                <button
                                    type="button"
                                    class="lead-map-actor ${escapeHtml(actor.tone)} ${selection.actorId === actor.id ? 'selected' : ''}"
                                    data-action="select-actor"
                                    data-actor-id="${escapeHtml(actor.id)}"
                                    style="left:${actor.x}; top:${actor.y};"
                                >
                                    <span class="lead-map-actor-sprite" aria-hidden="true">
                                        <span class="lead-map-actor-head"></span>
                                        <span class="lead-map-actor-body"></span>
                                        <span class="lead-map-actor-legs"></span>
                                    </span>
                                    <span class="lead-map-actor-avatar">${escapeHtml(actor.name)}</span>
                                    <span class="lead-map-actor-bubble">${escapeHtml(actor.shortThought)}</span>
                                </button>
                            `).join('')}
                            ${(projections.map?.anomalies || []).map((anomaly) => `
                                <button
                                    type="button"
                                    class="lead-map-anomaly ${escapeHtml(anomaly.severity)} ${selection.anomalyId === anomaly.id ? 'selected' : ''}"
                                    data-action="select-anomaly"
                                    data-anomaly-id="${escapeHtml(anomaly.id)}"
                                    data-decision-item-id="${escapeHtml(anomaly.decisionItemId)}"
                                    style="left:${anomaly.x}; top:${anomaly.y};"
                                >
                                    <span class="lead-map-anomaly-ring"></span>
                                    <span class="lead-map-anomaly-dot"></span>
                                    <span class="lead-map-anomaly-label">${escapeHtml(anomaly.name)}</span>
                                </button>
                            `).join('')}
                        </div>
                        <div class="lead-anomaly-list">
                            ${(projections.map?.anomalies || []).map((anomaly) => `
                                <button
                                    type="button"
                                    class="lead-anomaly-button ${selection.anomalyId === anomaly.id ? 'selected' : ''}"
                                    data-action="select-anomaly"
                                    data-anomaly-id="${escapeHtml(anomaly.id)}"
                                    data-decision-item-id="${escapeHtml(anomaly.decisionItemId)}"
                                >
                                    ${escapeHtml(anomaly.name)}<small>優先 ${escapeHtml(severityLabel(anomaly.severity))}</small>
                                </button>
                            `).join('')}
                        </div>
                        <section class="lead-console-actors" data-lead-layer="actors">
                            <div class="lead-actor-strip-header">
                                <div>
                                    <h2>関係AI帯</h2>
                                    <p>今この場面に出てくる役付きAIだけを前に出す</p>
                                </div>
                                <button type="button" data-action="toggle-actors">${selection.showAllActors ? '折りたたむ' : 'もっと見る'}</button>
                            </div>
                            <div class="lead-actor-strip-list">
                                ${visibleActors.map((actor) => `
                                    <button type="button" class="lead-actor-chip ${selection.actorId === actor.id ? 'selected' : ''}" data-action="select-actor" data-actor-id="${escapeHtml(actor.id)}">
                                        <strong>${escapeHtml(actor.name)}</strong>
                                        <em>${escapeHtml(actor.role)}</em>
                                        <span>${escapeHtml(actor.shortThought)}</span>
                                    </button>
                                `).join('')}
                            </div>
                            ${actorStrip.selectedActor ? this._renderActorCard(actorStrip.selectedActor) : ''}
                        </section>
                    </section>

                    <section class="lead-console-flow" data-lead-layer="flow">
                        <div class="lead-panel-header">
                            <div>
                                <h2>進行レーン</h2>
                                <p>中央で選んだ対象の進み方を読む</p>
                            </div>
                            <div class="lead-panel-meta">
                                <span class="lead-panel-badge">${escapeHtml(highlightedBuildingName)}</span>
                            </div>
                        </div>
                        <div class="lead-flow-list">
                            ${(projections.flowLane?.items || []).map((item) => `
                                <article class="lead-flow-item ${escapeHtml(item.tone || 'normal')}" data-initiative-id="${escapeHtml(item.initiativeId)}">
                                    <div class="lead-flow-item-top">
                                        <h3>${escapeHtml(item.title)}</h3>
                                        <span class="lead-flow-badge">${escapeHtml(item.stage)}</span>
                                    </div>
                                    <p>${escapeHtml(item.stage)} / ${escapeHtml(item.status)}</p>
                                    <p>${escapeHtml(item.subtitle)}</p>
                                </article>
                            `).join('')}
                        </div>
                    </section>

                    <section class="lead-console-queue" data-lead-layer="queue">
                        <div class="lead-panel-header">
                            <div>
                                <h2>判断待ち一覧</h2>
                                <p>いま裁くべき項目だけを前に出す</p>
                            </div>
                            <div class="lead-panel-meta">
                                <span class="lead-panel-badge">${escapeHtml(projections.decisionQueue?.items?.length || 0)}件</span>
                            </div>
                        </div>
                        <div class="lead-queue-list">
                            ${(projections.decisionQueue?.items || []).map((item) => `
                                <article class="lead-queue-item ${escapeHtml(item.tone || 'normal')}">
                                    <strong>${escapeHtml(item.title)}</strong>
                                    <span>${escapeHtml(item.statusLabel)}</span>
                                    ${item.escalated ? '<em>上申中</em>' : ''}
                                </article>
                            `).join('')}
                        </div>
                    </section>

                    <section class="lead-console-side" data-lead-layer="ops">
                        <div class="lead-panel-header">
                            <div>
                                <h2>${projections.opsPanel?.mode === 'briefing' ? '論点整理室' : '即応パネル'}</h2>
                                <p>${projections.opsPanel?.mode === 'briefing' ? '深掘りして上申材料に変える' : '右で人間が裁く面'}</p>
                            </div>
                            <div class="lead-panel-meta">
                                ${selectedActorName ? `<span class="lead-panel-badge">関係AI: ${escapeHtml(selectedActorName)}</span>` : ''}
                            </div>
                        </div>
                        ${projections.opsPanel?.mode === 'briefing'
                            ? this._renderBriefingRoom(decisionItem)
                            : this._renderOpsPanel(decisionItem, selectedOption, projections.opsPanel?.relatedActors || [], buttons, projections.opsPanel?.activeTab)}
                    </section>
                </div>

            </div>
        `;
    }

    _renderOpsPanel(decisionItem, selectedOption, relatedActors, buttons, activeTab) {
        if (!decisionItem) {
            return '<p>対象を選ぶと即応パネルが開く</p>';
        }

        return `
            <div class="lead-ops-panel" data-mode="ops">
                <p class="lead-ops-tab">初期タブ: ${escapeHtml(activeTab || '状況要約')}</p>
                <section class="lead-ops-section">
                    <h3>状況</h3>
                    <div class="lead-ops-row"><dt>今の状態</dt><dd>${escapeHtml(decisionItem.statusLabel)}</dd></div>
                    <div class="lead-ops-row"><dt>主因</dt><dd>${escapeHtml(decisionItem.primaryCause)}</dd></div>
                    <div class="lead-ops-row"><dt>副因</dt><dd>${escapeHtml(decisionItem.secondaryCause || '-')}</dd></div>
                    <div class="lead-ops-row"><dt>全体リスク</dt><dd>${escapeHtml(decisionItem.overallRisk)}</dd></div>
                    <div class="lead-ops-row"><dt>関係AI</dt><dd>${escapeHtml(relatedActors.map((actor) => actor.name).join(' / '))}</dd></div>
                    ${statusSpecificFields(decisionItem)}
                </section>
                <section class="lead-ops-section">
                    <h3>推奨アクション</h3>
                    <div class="lead-option-list">
                        ${(decisionItem.options || []).map((option, index) => `
                            <button type="button" class="lead-option-card ${selectedOption?.id === option.id ? 'selected' : ''}" data-action="select-option" data-option-id="${escapeHtml(option.id)}">
                                <strong>${escapeHtml(index === 0 ? '推奨アクション 1' : `代替案 ${index + 1}`)}</strong>
                                <span>${escapeHtml(option.label)}</span>
                                <small>想定リスク: ${escapeHtml(option.risk)} / 必要証跡: ${escapeHtml(option.evidenceNeed)} / 承認要否: ${escapeHtml(option.approvalNeed)}</small>
                            </button>
                        `).join('')}
                    </div>
                </section>
                <section class="lead-ops-section">
                    <h3>即断ボタン</h3>
                    <div class="lead-action-list">
                        ${buttons.map((button) => `
                            <button type="button" data-action="run-command" data-command="${escapeHtml(button.command)}">
                                ${escapeHtml(button.label)}
                            </button>
                        `).join('')}
                    </div>
                </section>
            </div>
        `;
    }

    _renderBriefingRoom(decisionItem) {
        return `
            <div class="lead-briefing-room" data-mode="briefing">
                <section class="lead-ops-section">
                    <h3>論点整理</h3>
                    <p>対象: ${escapeHtml(decisionItem?.title || '未選択')}</p>
                    <ul>
                        <li>進める案</li>
                        <li>縮小案</li>
                        <li>停止案</li>
                        <li>反対意見</li>
                    </ul>
                </section>
                <section class="lead-ops-section">
                    <h3>操作</h3>
                    <div class="lead-action-list">
                        <button type="button" data-action="run-command" data-command="createEscalationPacket">上申資料を作成</button>
                        <button type="button" data-action="run-command" data-command="recordDecision">判断メモを作成</button>
                        <button type="button" data-action="run-command" data-command="holdDecisionItem">保留</button>
                    </div>
                </section>
            </div>
        `;
    }

    _renderActorCard(actor) {
        return `
            <article class="lead-actor-card" data-component="lead-actor-card">
                <h3>${escapeHtml(actor.card.name)}</h3>
                <p class="lead-actor-card-role">${escapeHtml(actor.card.role)}</p>
                <p>担当建物: ${escapeHtml(actor.card.buildingName)}</p>
                <p>施策: ${escapeHtml(actor.card.initiativeTitle)}</p>
                <p>裁量範囲: ${escapeHtml(actor.card.discretionScope)}</p>
                <p>巡回報告: ${escapeHtml(actor.card.shortThought)}</p>
                <div class="lead-action-list">
                    <button type="button" data-action="focus-actor-initiative" data-initiative-id="${escapeHtml(actor.currentInitiativeId)}">担当案件で絞る</button>
                </div>
            </article>
        `;
    }

    _handleClick(event) {
        const target = event.target.closest('[data-action]');
        if (!target) return;

        switch (target.dataset.action) {
            case 'select-building':
                this.onBuildingSelect?.(target.dataset.buildingId);
                break;
            case 'select-anomaly':
                this.onAnomalySelect?.(target.dataset.anomalyId, target.dataset.decisionItemId);
                break;
            case 'select-actor':
                this.onActorSelect?.(target.dataset.actorId);
                break;
            case 'select-option':
                this.onOptionSelect?.(target.dataset.optionId);
                break;
            case 'run-command':
                this.onAction?.(target.dataset.command);
                break;
            case 'toggle-actors':
                this.onToggleActors?.();
                break;
            case 'focus-actor-initiative':
                this.onFocusActorInitiative?.(target.dataset.initiativeId);
                break;
        }
    }
}
