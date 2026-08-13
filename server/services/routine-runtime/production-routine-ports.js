const ROUTINE_PROJECT_ID = 'brainbase';
const DEFAULT_PERSONAL_KG_OWNER_PERSON_ID = 'sato_keigo';
const ROUTINE_AUTOMATION_IDS = Object.freeze([
    'brainbase-ohayo',
    'brainbase-oyasumi',
    'brainbase-retro'
]);

function projectInput(input = {}) {
    const projectId = input?.input?.project_id || input?.project_id || ROUTINE_PROJECT_ID;
    if (projectId !== ROUTINE_PROJECT_ID) {
        const error = new Error('routine project is not supported');
        error.code = 'routine_project_not_supported';
        throw error;
    }
    return { project_id: projectId };
}

function unavailable(source, error) {
    return {
        code: error?.code === 'routine_dependency_unavailable'
            ? 'routine_dependency_unavailable'
            : 'routine_source_unavailable',
        source,
        reason: error?.code || error?.name || 'unavailable'
    };
}

function requireDependency(value, name, method = null) {
    if (!value || (method && typeof value[method] !== 'function')) {
        const error = new Error(`routine dependency unavailable: ${name}`);
        error.code = 'routine_dependency_unavailable';
        error.dependency = name;
        throw error;
    }
    return value;
}

async function readSource(source, reader) {
    try {
        return { value: await reader(), anomaly: null };
    } catch (error) {
        return { value: null, anomaly: unavailable(source, error) };
    }
}

function sourceEventId(item) {
    const isFormalKnowledgeEventId = (id) => typeof id === 'string' && /^(?:kev|pke)(?:_|$)/u.test(id);
    if (isFormalKnowledgeEventId(item?.payload?.derived_from_event_id)) {
        return item.payload.derived_from_event_id;
    }
    if (isFormalKnowledgeEventId(item?.source_knowledge_event_id)) return item.source_knowledge_event_id;
    if (isFormalKnowledgeEventId(item?.source_event_id)) return item.source_event_id;
    if (Array.isArray(item?.source_event_ids)) {
        return item.source_event_ids.find(isFormalKnowledgeEventId) || null;
    }
    return null;
}

function safeException(item) {
    return {
        ...(typeof item?.code === 'string' ? { code: item.code } : {}),
        ...(typeof item?.summary === 'string' ? { summary: item.summary.slice(0, 2000) } : {})
    };
}

function safeMemory(item) {
    const summary = item?.summary || item?.name || item?.title || item?.body;
    return typeof summary === 'string' && summary.trim()
        ? { summary: summary.trim().slice(0, 2000) }
        : null;
}

export class ProductionRoutinePorts {
    constructor({
        knowledgeEventRepository,
        candidateRepository,
        personalKnowledgeService,
        infoSSOTService,
        runReceiptQueryService,
        listJudgmentOutboxExceptions,
        knowledgeFeedbackService,
        countRunReceiptOutbox = null,
        personalKgOwnerPersonId = process.env.BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID
            || DEFAULT_PERSONAL_KG_OWNER_PERSON_ID,
        personalVaultReadEnabled = process.env.BRAINBASE_PERSONAL_VAULT_READ_ENABLED !== '0',
        now = () => new Date()
    } = {}) {
        this.knowledgeEventRepository = knowledgeEventRepository;
        this.candidateRepository = candidateRepository;
        this.personalKnowledgeService = personalKnowledgeService;
        this.infoSSOTService = infoSSOTService;
        this.runReceiptQueryService = runReceiptQueryService;
        this.listJudgmentOutboxExceptions = listJudgmentOutboxExceptions;
        this.knowledgeFeedbackService = knowledgeFeedbackService;
        this.countRunReceiptOutbox = countRunReceiptOutbox;
        this.personalKgOwnerPersonId = personalKgOwnerPersonId;
        this.personalVaultReadEnabled = personalVaultReadEnabled;
        this.now = now;
    }

    async reconcile(input, context) {
        const project = projectInput(input);
        const [knowledge, personal, receipts, judgmentOutbox, receiptOutbox] = await Promise.all([
            readSource('knowledge_events', () => requireDependency(
                this.knowledgeEventRepository,
                'knowledgeEventRepository',
                'summarizeRoutineState'
            ).summarizeRoutineState(project, context)),
            this.personalVaultReadEnabled
                ? readSource('personal_knowledge_events', () => requireDependency(
                    this.personalKnowledgeService,
                    'personalKnowledgeService',
                    'summarizeRoutineState'
                ).summarizeRoutineState(project, { access: context?.access }))
                : Promise.resolve({
                    value: {
                        unprocessed_count: 0,
                        contradiction_count: 0,
                        expired_count: 0,
                        episode_ids: []
                    },
                    anomaly: null
                }),
            readSource('run_receipts', () => requireDependency(
                this.runReceiptQueryService,
                'runReceiptQueryService',
                'summarizeRoutineState'
            ).summarizeRoutineState(project, context)),
            readSource('judgment_knowledge_event_outbox', () => requireDependency(
                this.listJudgmentOutboxExceptions,
                'listJudgmentOutboxExceptions'
            )(context)),
            this.countRunReceiptOutbox
                ? readSource('run_receipt_outbox', () => this.countRunReceiptOutbox(context))
                : Promise.resolve({ value: null, anomaly: null })
        ]);
        const anomalies = [knowledge.anomaly, personal.anomaly, receipts.anomaly, judgmentOutbox.anomaly, receiptOutbox.anomaly]
            .filter(Boolean);
        const runReceiptOutboxCount = receiptOutbox.value ?? receipts.value?.outbox_count;
        const sum = (field) => knowledge.value?.[field] == null || personal.value?.[field] == null
            ? null
            : knowledge.value[field] + personal.value[field];
        return {
            unprocessed_count: sum('unprocessed_count'),
            contradiction_count: sum('contradiction_count'),
            expired_count: sum('expired_count'),
            outbox_count: runReceiptOutboxCount == null || !Array.isArray(judgmentOutbox.value)
                ? null
                : runReceiptOutboxCount + judgmentOutbox.value.length,
            organization_episode_ids: Array.isArray(knowledge.value?.episode_ids) ? knowledge.value.episode_ids : [],
            personal_episode_ids: Array.isArray(personal.value?.episode_ids) ? personal.value.episode_ids : [],
            ...(anomalies.length > 0 ? { anomalies } : {})
        };
    }

    async compress({ reconciliation } = {}, context) {
        const organization = typeof this.knowledgeEventRepository?.compressRoutineEpisodes === 'function'
            ? await this.knowledgeEventRepository.compressRoutineEpisodes({
                project_id: ROUTINE_PROJECT_ID,
                episode_ids: reconciliation?.organization_episode_ids || []
            }, context)
            : { confirmed: false, reason: 'organization_episode_compressor_unavailable' };
        const personal = !this.personalVaultReadEnabled
            ? { confirmed: true, episode_ids: [], mode: 'legacy_candidate_read' }
            : typeof this.personalKnowledgeService?.compressRoutineEpisodes === 'function'
            ? await this.personalKnowledgeService.compressRoutineEpisodes({
                project_id: ROUTINE_PROJECT_ID,
                episode_ids: reconciliation?.personal_episode_ids || []
            }, { access: context?.access })
            : { confirmed: false, reason: 'personal_episode_compressor_unavailable' };
        return {
            organization,
            personal,
            episode_ids: [
                ...(organization.episode_ids || []),
                ...(personal.episode_ids || [])
            ],
            confirmed: organization.confirmed === true && personal.confirmed === true
        };
    }

    async verify({ reconciliation, compression } = {}, context) {
        const organization = typeof this.knowledgeEventRepository?.verifyRoutineRetrievability === 'function'
            ? await this.knowledgeEventRepository.verifyRoutineRetrievability({
                project_id: ROUTINE_PROJECT_ID,
                episode_ids: reconciliation?.organization_episode_ids || []
            }, context)
            : { retrievable: undefined, reason: 'organization_retrievability_verifier_unavailable' };
        const personal = !this.personalVaultReadEnabled
            ? { retrievable: true, missing_ids: [], mode: 'legacy_candidate_read' }
            : typeof this.personalKnowledgeService?.verifyRoutineRetrievability === 'function'
            ? await this.personalKnowledgeService.verifyRoutineRetrievability({
                project_id: ROUTINE_PROJECT_ID,
                episode_ids: reconciliation?.personal_episode_ids || []
            }, { access: context?.access })
            : { retrievable: undefined, reason: 'personal_retrievability_verifier_unavailable' };
        return {
            organization,
            personal,
            retrievable: organization.retrievable === true && personal.retrievable === true,
            missing_ids: [...(organization.missing_ids || []), ...(personal.missing_ids || [])]
        };
    }

    async recallGraph(input, context) {
        const project = projectInput(input);
        return requireDependency(this.infoSSOTService, 'infoSSOTService', 'listGraphEntities').listGraphEntities(context?.access, {
            projectCode: project.project_id,
            query: input?.input?.query,
            limit: 50
        });
    }

    async recallPersonalKg(input, context) {
        const project = projectInput(input);
        if (!this.personalVaultReadEnabled) {
            return requireDependency(
                this.candidateRepository,
                'candidateRepository',
                'listPersonalKg'
            ).listPersonalKg({
                project_code: project.project_id,
                owner_person_id: context?.access?.personId,
                role: context?.access?.role,
                clearance: context?.access?.clearance,
                query: input?.input?.query,
                limit: 50
            }, context);
        }
        const events = await requireDependency(
            this.personalKnowledgeService,
            'personalKnowledgeService',
            'search'
        ).search({
            query: input?.input?.query,
            limit: 50
        }, { access: context?.access });
        return events.map((event) => ({
            ...event,
            id: event.event_id,
            source_knowledge_event_id: event.event_id
        }));
    }

    async generate({
        exceptions,
        graph_memories: graphMemories,
        personal_memories: personalMemories
    } = {}) {
        const graph = Array.isArray(graphMemories) ? graphMemories : [];
        const personal = Array.isArray(personalMemories) ? personalMemories : [];
        const recalled = [...graph, ...personal];
        const recalledIds = recalled.map((item) => item?.id).filter(Boolean);
        const recalledById = new Map(recalled.map((item) => [item?.id, item]));
        const displayedIds = [...new Set(recalled
            .filter((item) => sourceEventId(item))
            .slice(0, 3)
            .map((item) => item.id))];
        const displayedMemories = displayedIds.map((id) => safeMemory(recalledById.get(id))).filter(Boolean);
        const visibleExceptions = (Array.isArray(exceptions) ? exceptions : []).slice(0, 3).map(safeException);
        return {
            exceptions: visibleExceptions,
            graph_memories: graph,
            personal_memories: personal,
            recalled_memory_ids: recalledIds,
            displayed_memory_ids: displayedIds,
            used_knowledge_ids: [...new Set(displayedIds.map((id) => sourceEventId(recalledById.get(id))).filter(Boolean))],
            morning_output: { exceptions: visibleExceptions, memories: displayedMemories }
        };
    }

    async recordUsage({ knowledge_id: knowledgeId }, context) {
        if (/^pke(?:_|$)/u.test(knowledgeId)) {
            return requireDependency(
                this.personalKnowledgeService,
                'personalKnowledgeService',
                'recordUsage'
            ).recordUsage(knowledgeId, { access: context?.access });
        }
        return requireDependency(
            this.knowledgeFeedbackService,
            'knowledgeFeedbackService',
            'recordFeedback'
        ).recordFeedback({
            event_id: knowledgeId,
            action: 'adopt',
            reason: 'used_by_ohayo'
        }, { access: context?.access });
    }

    async evaluateMetrics({ input } = {}, context) {
        const project = projectInput({ input });
        const until = input?.until || this.now().toISOString();
        const since = input?.since || new Date(Date.parse(until) - 7 * 24 * 60 * 60 * 1000).toISOString();
        const scope = {
            ...(input || {}),
            ...project,
            since,
            until,
            routine_automation_ids: [...ROUTINE_AUTOMATION_IDS]
        };
        const [knowledge, receipts] = await Promise.all([
            readSource('knowledge_events', () => requireDependency(
                this.knowledgeEventRepository,
                'knowledgeEventRepository',
                'summarizeRoutineState'
            ).summarizeRoutineState(scope, context)),
            readSource('run_receipts', () => requireDependency(
                this.runReceiptQueryService,
                'runReceiptQueryService',
                'summarizeRoutineState'
            ).summarizeRoutineState(scope, context))
        ]);
        const anomalies = [knowledge.anomaly, receipts.anomaly].filter(Boolean);
        return {
            misregistration_rate: knowledge.value?.misregistration_rate ?? null,
            correction_rate: knowledge.value?.correction_rate ?? null,
            open_contradictions: knowledge.value?.open_contradictions ?? null,
            processing_time_ms: knowledge.value?.processing_time_ms ?? null,
            stoppage_count: receipts.value?.stoppage_count ?? null,
            ...(anomalies.length > 0 ? { anomalies } : {})
        };
    }

    async createImprovementCandidates({ metrics, limit = 3 } = {}) {
        const candidates = Object.entries(metrics || {})
            .filter(([, value]) => typeof value === 'number' && value > 0)
            .map(([metric, value]) => ({
                kind: 'story_pr_candidate',
                metric,
                observed_value: value,
                applies_changes: false
            }));
        return candidates.slice(0, limit);
    }
}
