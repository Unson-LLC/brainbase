import { eventBus, EVENTS } from './core/event-bus.js';
import { appStore } from './core/store.js';
import { LEAD_BUILDING_TAB_MAP } from './domain/lead/lead-fixtures.js';
import { LeadProjectionService } from './domain/lead/lead-projection-service.js';
import { LeadRepository } from './domain/lead/lead-repository.js';
import { LeadService } from './domain/lead/lead-service.js';
import { LeadConsoleView } from './ui/views/lead-console-view.js';

export class DashboardController {
    constructor({
        store = appStore,
        bus = eventBus,
        repository = new LeadRepository(),
        projectionService = new LeadProjectionService(),
        leadService = null
    } = {}) {
        this.store = store;
        this.eventBus = bus;
        this.repository = repository;
        this.projectionService = projectionService;
        this.leadService = leadService || new LeadService({ store: this.store, eventBus: this.eventBus });
        this.panel = null;
        this.view = null;
    }

    async init() {
        this.panel = document.getElementById('dashboard-panel');
        if (!this.panel) return;

        this._initializeLeadState();
        this._ensureView();
        this._render();
    }

    destroy() {
        this.view?.unmount?.();
        this.view = null;
        this.panel = null;
    }

    _initializeLeadState() {
        const snapshot = this.repository.createSnapshot();
        this.store.setState({
            lead: {
                repository: snapshot,
                selection: {
                    buildingId: null,
                    anomalyId: null,
                    actorId: null,
                    decisionItemId: 'decision-setup-simplification',
                    optionId: 'option-request-artifact',
                    activeRightPanelMode: 'ops',
                    showAllActors: false
                },
                projections: {},
                records: snapshot.records
            }
        });
    }

    _ensureView() {
        if (this.view) return;

        this.view = new LeadConsoleView({
            root: this.panel,
            onBuildingSelect: (buildingId) => this._selectBuilding(buildingId),
            onAnomalySelect: (anomalyId, decisionItemId) => this._selectAnomaly(anomalyId, decisionItemId),
            onActorSelect: (actorId) => this._selectActor(actorId),
            onOptionSelect: (optionId) => this._selectOption(optionId),
            onAction: (command) => this._runCommand(command),
            onToggleActors: () => this._toggleActors(),
            onFocusActorInitiative: (initiativeId) => this._focusActorInitiative(initiativeId)
        });
        this.view.mount();
    }

    _render() {
        const leadState = this.store.getState().lead;
        const projections = this.projectionService.build(this.store.getState());
        this.store.setState({
            lead: {
                ...leadState,
                projections
            }
        });
        this.view.render(this.store.getState().lead);
    }

    async _selectBuilding(buildingId) {
        const leadState = this.store.getState().lead;
        const firstDecisionItem = leadState.repository.decisionItems.find((item) => {
            const initiative = leadState.repository.initiatives.find((entry) => entry.id === item.initiativeId);
            return initiative?.buildingId === buildingId;
        });

        this.store.setState({
            lead: {
                ...leadState,
                selection: {
                    ...leadState.selection,
                    buildingId,
                    anomalyId: null,
                    decisionItemId: firstDecisionItem?.id || leadState.selection.decisionItemId,
                    optionId: firstDecisionItem?.options?.[0]?.id || leadState.selection.optionId,
                    activeRightPanelMode: 'ops'
                }
            }
        });

        this._render();
        await this.eventBus.emit(EVENTS.LEAD_BUILDING_SELECTED, {
            buildingId,
            initialTab: LEAD_BUILDING_TAB_MAP[buildingId] || '状況要約'
        });
    }

    async _selectAnomaly(anomalyId, decisionItemId) {
        const leadState = this.store.getState().lead;
        const decisionItem = leadState.repository.decisionItems.find((item) => item.id === decisionItemId);

        this.store.setState({
            lead: {
                ...leadState,
                selection: {
                    ...leadState.selection,
                    anomalyId,
                    decisionItemId,
                    optionId: decisionItem?.options?.[0]?.id || leadState.selection.optionId,
                    activeRightPanelMode: 'ops'
                }
            }
        });
        this._render();
        await this.eventBus.emit(EVENTS.LEAD_ANOMALY_SELECTED, { anomalyId, decisionItemId });
    }

    async _selectActor(actorId) {
        const leadState = this.store.getState().lead;
        this.store.setState({
            lead: {
                ...leadState,
                selection: {
                    ...leadState.selection,
                    actorId
                }
            }
        });
        this._render();
        await this.eventBus.emit(EVENTS.LEAD_ACTOR_SELECTED, { actorId });
    }

    async _selectOption(optionId) {
        const leadState = this.store.getState().lead;
        this.store.setState({
            lead: {
                ...leadState,
                selection: {
                    ...leadState.selection,
                    optionId
                }
            }
        });
        this._render();
        await this.eventBus.emit(EVENTS.LEAD_OPTION_SELECTED, { optionId });
    }

    _toggleActors() {
        const leadState = this.store.getState().lead;
        this.store.setState({
            lead: {
                ...leadState,
                selection: {
                    ...leadState.selection,
                    showAllActors: !leadState.selection.showAllActors
                }
            }
        });
        this._render();
    }

    async _focusActorInitiative(initiativeId) {
        const initiative = this.store.getState().lead.repository.initiatives.find((item) => item.id === initiativeId);
        if (!initiative) return;
        await this._selectBuilding(initiative.buildingId);
    }

    async _runCommand(command) {
        const leadState = this.store.getState().lead;
        const decisionItemId = leadState.selection.decisionItemId;
        const selectedDecisionItem = leadState.repository.decisionItems.find((item) => item.id === decisionItemId);
        const selectedInitiative = leadState.repository.initiatives.find((item) => item.id === selectedDecisionItem?.initiativeId);

        const commandHandlers = {
            requestArtifact: () => this.leadService.requestArtifact({
                decisionItemId,
                evidenceKey: selectedDecisionItem?.requiredEvidence?.[0] || 'evidence-gap',
                dueAt: '2026-03-15T14:00:00+09:00'
            }),
            setArtifactDueDate: () => this.leadService.setArtifactDueDate({
                decisionItemId,
                dueAt: '2026-03-15T18:00:00+09:00'
            }),
            proceedWithAlternativeEvidence: () => this.leadService.proceedWithAlternativeEvidence({ decisionItemId }),
            rerouteExecution: () => this.leadService.rerouteExecution({
                decisionItemId,
                optionId: leadState.selection.optionId
            }),
            shrinkScopeAndContinue: () => this.leadService.shrinkScopeAndContinue({
                decisionItemId,
                initiativeId: selectedInitiative?.id,
                scope: '限定顧客のみ'
            }),
            approveDecisionItem: () => this.leadService.approveDecisionItem({ decisionItemId }),
            approveDecisionItemWithConstraint: () => this.leadService.approveDecisionItemWithConstraint({
                decisionItemId,
                constraint: '対象顧客を限定して48時間のみ'
            }),
            returnDecisionItem: () => this.leadService.returnDecisionItem({ decisionItemId }),
            retryExecutionPlan: () => this.leadService.retryExecutionPlan({ decisionItemId }),
            executeViaAlternateRoute: () => this.leadService.executeViaAlternateRoute({ decisionItemId }),
            handoffToRecoveryOwner: () => this.leadService.handoffToRecoveryOwner({ decisionItemId }),
            pauseAndStabilize: () => this.leadService.pauseAndStabilize({
                decisionItemId,
                openBriefingRoom: true
            }),
            sendToBriefingRoom: () => this.leadService.sendToBriefingRoom({ decisionItemId }),
            createEscalationPacket: () => this.leadService.createEscalationPacket({ decisionItemId }),
            recordDecision: () => this.leadService.recordDecision({
                decisionItemId,
                decision: '判断メモを作成',
                rationale: '現場責任者の裁定を記録'
            }),
            holdDecisionItem: () => this.leadService.holdDecisionItem({ decisionItemId })
        };

        const handler = commandHandlers[command];
        if (!handler) return;
        const pending = handler();
        this._render();
        await pending;
        this._render();
    }
}
