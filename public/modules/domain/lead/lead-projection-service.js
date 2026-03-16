import { LEAD_BUILDING_TAB_MAP } from './lead-fixtures.js';

function findDecisionItem(repository, selection) {
    if (selection.decisionItemId) {
        return repository.decisionItems.find(item => item.id === selection.decisionItemId) || null;
    }

    if (selection.anomalyId) {
        const anomaly = repository.anomalies.find(item => item.id === selection.anomalyId);
        if (anomaly) {
            return repository.decisionItems.find(item => item.id === anomaly.decisionItemId) || null;
        }
    }

    if (selection.buildingId) {
        const initiativeIds = repository.initiatives
            .filter(item => item.buildingId === selection.buildingId)
            .map(item => item.id);
        return repository.decisionItems.find(item => initiativeIds.includes(item.initiativeId)) || null;
    }

    return repository.decisionItems[0] || null;
}

function filterInitiativesByBuilding(repository, buildingId) {
    if (!buildingId) {
        return repository.initiatives;
    }

    return repository.initiatives.filter(item => item.buildingId === buildingId);
}

function buildStatus(decisionItem) {
    return {
        key: decisionItem?.status || 'normal',
        label: decisionItem?.statusLabel || '通常'
    };
}

function buildActorCard(repository, actor) {
    if (!actor) return null;

    const initiative = repository.initiatives.find(item => item.id === actor.currentInitiativeId);
    const building = repository.buildings.find(item => item.id === actor.buildingId);

    return {
        ...actor,
        card: {
            name: actor.name,
            role: actor.role,
            buildingName: building?.name || '',
            initiativeTitle: initiative?.title || '',
            discretionScope: actor.discretionScope,
            shortThought: actor.shortThought
        }
    };
}

function toneFromAttention(level) {
    if (level === '高') return 'alert';
    if (level === '中') return 'watch';
    return 'normal';
}

function buildingPosition(buildingId) {
    const map = {
        'building-execution-hall': { x: '10%', y: '16%' },
        'building-evidence-vault': { x: '54%', y: '14%' },
        'building-approval-gate': { x: '70%', y: '56%' },
        'building-validation-lab': { x: '26%', y: '58%' }
    };
    return map[buildingId] || { x: '0%', y: '0%' };
}

function actorPosition(actorId) {
    const map = {
        'actor-kai': { x: '24%', y: '52%', tone: 'watch' },
        'actor-ren': { x: '18%', y: '66%', tone: 'normal' },
        'actor-mina': { x: '48%', y: '72%', tone: 'active' },
        'actor-sui': { x: '67%', y: '48%', tone: 'watch' },
        'actor-haru': { x: '81%', y: '52%', tone: 'alert' },
        'actor-nagi': { x: '72%', y: '80%', tone: 'normal' }
    };
    return map[actorId] || { x: '0%', y: '0%', tone: 'normal' };
}

function anomalyPosition(anomalyId) {
    const map = {
        'anomaly-setup-evidence-gap': { x: '36%', y: '42%' },
        'anomaly-copy-approval-pending': { x: '72%', y: '40%' },
        'anomaly-mail-execution-failure': { x: '21%', y: '34%' },
        'anomaly-onboard-stalled': { x: '58%', y: '36%' }
    };
    return map[anomalyId] || { x: '0%', y: '0%' };
}

export class LeadProjectionService {
    build(state) {
        const leadState = state.lead;
        const repository = leadState.repository;
        const selection = leadState.selection;
        const selectedDecisionItem = findDecisionItem(repository, selection);
        const selectedActor = repository.actors.find(item => item.id === selection.actorId) || null;

        return {
            map: {
                districtName: repository.district?.name || '',
                summaryPills: [
                    { label: repository.district?.objective || '', tone: 'objective' },
                    { label: `停滞 ${repository.decisionItems.filter((item) => item.status === 'stalled').length}`, tone: 'watch' },
                    { label: `承認待ち ${repository.decisionItems.filter((item) => item.status === 'approval_pending').length}`, tone: 'approval' },
                    { label: `夜間稼働 ${repository.actors.length}`, tone: 'active' }
                ].filter((pill) => pill.label),
                buildings: repository.buildings,
                anomalies: repository.anomalies.map((anomaly) => ({
                    ...anomaly,
                    ...anomalyPosition(anomaly.id),
                    buildingId: repository.initiatives.find((item) => item.id === anomaly.initiativeId)?.buildingId || null
                })),
                actors: repository.actors,
                buildingInitiatives: Object.fromEntries(
                    repository.buildings.map((building) => [
                        building.id,
                        repository.initiatives.find((item) => item.buildingId === building.id) || null
                    ])
                ),
                actorScene: repository.actors.map((actor) => ({
                    ...actor,
                    ...actorPosition(actor.id)
                })).slice(0, 5)
            },
            flowLane: {
                items: filterInitiativesByBuilding(repository, selection.buildingId).map(item => ({
                    initiativeId: item.id,
                    title: item.title,
                    stage: item.stage,
                    status: item.executionHealth,
                    subtitle: item.subtitle,
                    tone: toneFromAttention(item.attentionLevel)
                }))
            },
            decisionQueue: {
                items: repository.decisionItems.map(item => ({
                    id: item.id,
                    title: item.title,
                    statusLabel: item.statusLabel,
                    initiativeId: item.initiativeId,
                    escalated: leadState.records.escalationPackets.some(packet => packet.decisionItemId === item.id),
                    tone: toneFromAttention(repository.initiatives.find((initiative) => initiative.id === item.initiativeId)?.attentionLevel)
                }))
            },
            opsPanel: {
                mode: selection.activeRightPanelMode || 'ops',
                activeTab: LEAD_BUILDING_TAB_MAP[selection.buildingId] || '状況要約',
                selectedDecisionItem,
                selectedOption: selectedDecisionItem?.options.find(option => option.id === selection.optionId) || selectedDecisionItem?.options?.[0] || null,
                status: buildStatus(selectedDecisionItem),
                relatedActors: (selectedDecisionItem?.relatedActorIds || [])
                    .map(actorId => repository.actors.find(actor => actor.id === actorId))
                    .filter(Boolean)
            },
            briefingRoom: {
                mode: selection.activeRightPanelMode === 'briefing' ? 'briefing' : 'hidden',
                selectedDecisionItem
            },
            actorStrip: {
                featuredActors: repository.actors.slice(0, 4).map(actor => buildActorCard(repository, actor)),
                selectedActor: buildActorCard(repository, selectedActor),
                allActors: repository.actors.map(actor => buildActorCard(repository, actor))
            }
        };
    }
}
