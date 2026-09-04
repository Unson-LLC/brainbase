const ROUTINE_PROJECT_ID = 'brainbase';
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

function reviewItem(item) {
    const summary = safeMemory(item)?.summary;
    if (!summary) return null;
    return {
        ...(typeof item?.id === 'string' ? { id: item.id } : {}),
        ...(typeof item?.promotion_status === 'string' ? { status: item.promotion_status } : {}),
        summary
    };
}

function uniqueReviews(items) {
    return [...new Map(items.filter(Boolean).map((item) => [item.id || item.summary, item])).values()];
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

    async buildNightOutput({ input = {}, reconciliation = {} } = {}, context) {
        const carryovers = [
            ['未処理', reconciliation.unprocessed_count],
            ['矛盾', reconciliation.contradiction_count],
            ['期限切れ', reconciliation.expired_count],
            ['未配信', reconciliation.outbox_count]
        ].filter(([, count]) => Number(count) > 0)
            .map(([label, count]) => ({ summary: `${label}が${count}件あります` }));
        const confirmedClosed = carryovers.length === 0;
        const candidateRepository = requireDependency(this.candidateRepository, 'candidateRepository', 'transaction');
        const projectCode = projectInput({ input }).project_id;
        const [personalCandidates, graphCandidates] = await candidateRepository.transaction(
            async (scopedRepository) => Promise.all([
                scopedRepository.list({
                    project_code: projectCode,
                    owner_person_id: context?.access?.personId,
                    promotion_status: 'candidate',
                    order_by: 'created_at',
                    order_direction: 'asc',
                    limit: 10
                }),
                scopedRepository.list({
                    project_code: projectCode,
                    promotion_status: 'pending_approval',
                    order_by: 'created_at',
                    order_direction: 'asc',
                    limit: 10
                })
            ]),
            { access: context?.access }
        );
        return {
            headline: confirmedClosed ? '今日は閉じてよい' : '残件を確認してから今日を閉じる',
            tomorrow_focus: Array.isArray(input.tomorrow_focus) ? input.tomorrow_focus : [],
            closed: Array.isArray(input.closed) ? input.closed : [],
            carryovers,
            personal_kg_registration_candidates: uniqueReviews([
                ...(Array.isArray(input.personal_kg_registration_candidates)
                    ? input.personal_kg_registration_candidates.map(reviewItem) : []),
                ...personalCandidates.map(reviewItem)
            ]),
            graph_promotion_reviews: uniqueReviews([
                ...(Array.isArray(input.graph_promotion_reviews)
                    ? input.graph_promotion_reviews.map(reviewItem) : []),
                ...graphCandidates.map(reviewItem)
            ])
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
        const references = displayedIds.map((id) => {
            const item = recalledById.get(id);
            const memory = safeMemory(item);
            return memory ? {
                source: graph.includes(item) ? 'graph_ssot' : 'personal_kg',
                summary: memory.summary
            } : null;
        }).filter(Boolean);
        const focus = displayedMemories.slice(0, 1);
        return {
            exceptions: visibleExceptions,
            graph_memories: graph,
            personal_memories: personal,
            recalled_memory_ids: recalledIds,
            displayed_memory_ids: displayedIds,
            used_knowledge_ids: [...new Set(displayedIds.map((id) => sourceEventId(recalledById.get(id))).filter(Boolean))],
            morning_output: {
                exceptions: visibleExceptions,
                memories: displayedMemories,
                routine_output: {
                    headline: focus[0]
                        ? `今日は「${focus[0].summary}」を判断軸に進める`
                        : '今日進めることは未確定です',
                    today_focus: focus,
                    immediate_decisions: displayedMemories.slice(1),
                    warnings: visibleExceptions,
                    carryovers: [],
                    references
                }
            }
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

    async listKnowledgeReviews({ input = {}, limit = 10 } = {}, context) {
        const candidateRepository = requireDependency(
            this.candidateRepository,
            'candidateRepository',
            'transaction'
        );
        const projectCode = projectInput({ input }).project_id;
        const [personalCandidates, graphCandidates] = await candidateRepository.transaction(
            async (scopedRepository) => Promise.all([
                scopedRepository.list({
                    project_code: projectCode,
                    owner_person_id: context?.access?.personId,
                    promotion_status: 'candidate',
                    order_by: 'created_at',
                    order_direction: 'asc',
                    limit
                }),
                scopedRepository.list({
                    project_code: projectCode,
                    promotion_status: 'pending_approval',
                    order_by: 'created_at',
                    order_direction: 'asc',
                    limit
                })
            ]),
            { access: context?.access }
        );
        return {
            personal_kg_registration_reviews: uniqueReviews([
                ...(Array.isArray(input.personal_kg_registration_reviews)
                    ? input.personal_kg_registration_reviews.map(reviewItem) : []),
                ...personalCandidates.map(reviewItem)
            ]),
            graph_promotion_reviews: uniqueReviews(graphCandidates.map(reviewItem))
        };
    }
}
