const RETRO_METRICS = Object.freeze([
    'misregistration_rate',
    'correction_rate',
    'open_contradictions',
    'processing_time_ms',
    'stoppage_count'
]);
const OYASUMI_METRICS = Object.freeze([
    'unprocessed_count',
    'contradiction_count',
    'expired_count',
    'outbox_count'
]);

function unavailable(name) {
    const error = new Error(`routine dependency unavailable: ${name}`);
    error.code = 'routine_dependency_unavailable';
    error.dependency = name;
    return error;
}

function requireMethod(service, method, name) {
    if (typeof service?.[method] !== 'function') throw unavailable(name);
    return service[method].bind(service);
}

function normalizeKnowledgeIds(items) {
    const isFormalKnowledgeEventId = (id) => typeof id === 'string' && /^kev(?:_|$)/u.test(id);
    return new Set((Array.isArray(items) ? items : []).flatMap((item) => [
        item?.payload?.derived_from_event_id,
        item?.source_knowledge_event_id,
        item?.source_event_id,
        ...(Array.isArray(item?.source_event_ids) ? item.source_event_ids : []),
        ...(!item?.payload?.derived_from_event_id
            && !item?.source_knowledge_event_id
            && !item?.source_event_id
            && !Array.isArray(item?.source_event_ids)
            && /^event-/u.test(item?.id || '') ? [item.id] : [])
    ]).filter((id) => isFormalKnowledgeEventId(id) || /^event-/u.test(id)));
}

function safeMorningOutput(output) {
    return {
        exceptions: (Array.isArray(output?.exceptions) ? output.exceptions : []).slice(0, 3).map((item) => ({
            ...(typeof item?.code === 'string' ? { code: item.code } : {}),
            ...(typeof item?.summary === 'string' ? { summary: item.summary.slice(0, 2000) } : {})
        })),
        memories: (Array.isArray(output?.memories) ? output.memories : []).slice(0, 3).map((item) => ({
            summary: String(item?.summary || '').slice(0, 2000)
        })).filter((item) => item.summary),
        ...(output?.routine_output ? { routine_output: safeRoutineOutput('ohayo', output.routine_output) } : {})
    };
}

function safeText(value) {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 2000) : null;
}

function safeOutputItems(items, { review = false, reference = false } = {}) {
    return (Array.isArray(items) ? items : []).slice(0, 10).map((item) => {
        const summary = safeText(typeof item === 'string' ? item : item?.summary);
        if (!summary) return null;
        return {
            ...(review && typeof item?.id === 'string' ? { id: item.id.slice(0, 200) } : {}),
            ...(review && typeof item?.status === 'string' ? { status: item.status.slice(0, 100) } : {}),
            ...(reference && typeof item?.source === 'string' ? { source: item.source.slice(0, 100) } : {}),
            summary,
            ...(item?.applies_changes === false ? { applies_changes: false } : {})
        };
    }).filter(Boolean);
}

function safeRoutineOutput(routine, output = {}) {
    output = output || {};
    const headline = safeText(output?.headline) || ({
        ohayo: '今日進めることは未確定です',
        oyasumi: '今日を閉じてよいか確認できていません',
        retro: '来週から変える仕組みは未確定です'
    }[routine] || 'ルーティン結果を確認できていません');
    if (routine === 'ohayo') {
        return {
            headline,
            today_focus: safeOutputItems(output.today_focus),
            immediate_decisions: safeOutputItems(output.immediate_decisions),
            warnings: safeOutputItems(output.warnings),
            carryovers: safeOutputItems(output.carryovers),
            references: safeOutputItems(output.references, { reference: true })
        };
    }
    if (routine === 'oyasumi') {
        return {
            headline,
            tomorrow_focus: safeOutputItems(output.tomorrow_focus),
            closed: safeOutputItems(output.closed),
            carryovers: safeOutputItems(output.carryovers),
            personal_kg_registration_candidates: safeOutputItems(output.personal_kg_registration_candidates, { review: true }),
            graph_promotion_reviews: safeOutputItems(output.graph_promotion_reviews, { review: true })
        };
    }
    return {
        headline,
        system_changes: safeOutputItems(output.system_changes),
        repeated_patterns: safeOutputItems(output.repeated_patterns),
        personal_kg_registration_reviews: safeOutputItems(output.personal_kg_registration_reviews, { review: true }),
        graph_promotion_reviews: safeOutputItems(output.graph_promotion_reviews, { review: true })
    };
}

export class RoutineCycleExecutor {
    constructor({
        oyasumiReconciler,
        episodeCompressor,
        retrievabilityVerifier,
        livenessService,
        recallService,
        feedbackService,
        ohayoGenerator,
        retroService,
        judgmentOutboxDeliveryService
    } = {}) {
        this.oyasumiReconciler = oyasumiReconciler;
        this.episodeCompressor = episodeCompressor;
        this.retrievabilityVerifier = retrievabilityVerifier;
        this.livenessService = livenessService;
        this.recallService = recallService;
        this.feedbackService = feedbackService;
        this.ohayoGenerator = ohayoGenerator;
        this.retroService = retroService;
        this.judgmentOutboxDeliveryService = judgmentOutboxDeliveryService;
    }

    async execute(input = {}, context) {
        try {
            let result;
            if (input.routine === 'oyasumi') result = await this.executeOyasumi(input, context);
            else if (input.routine === 'ohayo') result = await this.executeOhayo(input, context);
            else if (input.routine === 'retro') result = await this.executeRetro(input, context);
            else throw new Error(`unsupported routine: ${input.routine}`);
            return this.withSummary(input.routine, result);
        } catch (error) {
            return this.withSummary(input.routine, {
                status: 'failed',
                anomalies: [{
                    code: error?.code || 'routine_execution_failed',
                    ...(error?.dependency ? { dependency: error.dependency } : {})
                }]
            });
        }
    }

    withSummary(routine, result) {
        const status = result?.status || 'failed';
        const anomalies = Array.isArray(result?.anomalies) ? result.anomalies : [];
        const coverage = result?.coverage || (status === 'failed'
            ? 'unavailable'
            : anomalies.length > 0 || status === 'partial' ? 'partial' : 'confirmed');
        const routineOutput = safeRoutineOutput(routine, result?.routine_output);
        const summary = {
            routine,
            status,
            coverage,
            anomaly_count: anomalies.length,
            headline: routineOutput.headline,
            routine_output: routineOutput
        };
        return {
            ...result,
            summary,
            routine_summary: summary,
            routine_output: routineOutput,
            coverage,
            artifacts: {
                routine_summary: summary,
                anomalies
            },
            evidence_refs: [{ kind: 'artifact_ref', ref: `routine_summary:${routine}`, label: 'routine_summary' }]
        };
    }

    async executeOyasumi(input, context) {
        const reconcile = requireMethod(this.oyasumiReconciler, 'reconcile', 'oyasumiReconciler.reconcile');
        const compress = requireMethod(this.episodeCompressor, 'compress', 'episodeCompressor.compress');
        const verify = requireMethod(this.retrievabilityVerifier, 'verify', 'retrievabilityVerifier.verify');

        const reconciliation = context === undefined
            ? await reconcile({ input: input.input || {} })
            : await reconcile({ input: input.input || {} }, context);
        const reconciliationKeys = Object.keys(reconciliation || {});
        const hasMetricContract = OYASUMI_METRICS.some((field) => Object.hasOwn(reconciliation || {}, field));
        const unconfirmed = OYASUMI_METRICS.filter((field) => reconciliation?.[field] == null);
        if (unconfirmed.length > 0 && (hasMetricContract || reconciliationKeys.length === 0)) {
            return {
                status: 'partial',
                reconciliation,
                anomalies: unconfirmed.map((field) => ({ code: 'routine_metric_unconfirmed', field }))
            };
        }
        const compression = context === undefined
            ? await compress({ reconciliation })
            : await compress({ reconciliation }, context);
        if (compression?.confirmed === false) {
            return {
                status: 'partial',
                reconciliation,
                compression,
                anomalies: [{ code: 'episode_compression_unconfirmed' }]
            };
        }
        const verification = context === undefined
            ? await verify({ reconciliation, compression })
            : await verify({ reconciliation, compression }, context);
        if (verification?.retrievable === false) {
            return {
                status: 'partial',
                reconciliation,
                compression,
                verification,
                anomalies: [{
                    code: 'knowledge_not_retrievable',
                    knowledge_ids: Array.isArray(verification.missing_ids) ? verification.missing_ids : []
                }]
            };
        }
        if (verification?.retrievable !== true) {
            return {
                status: 'partial',
                reconciliation,
                compression,
                verification,
                anomalies: [{ code: 'knowledge_retrievability_unconfirmed' }]
            };
        }
        const buildNightOutput = typeof this.oyasumiReconciler?.buildNightOutput === 'function'
            ? this.oyasumiReconciler.buildNightOutput.bind(this.oyasumiReconciler)
            : null;
        const routineOutput = buildNightOutput
            ? context === undefined
                ? await buildNightOutput({ input: input.input || {}, reconciliation, compression, verification })
                : await buildNightOutput({ input: input.input || {}, reconciliation, compression, verification }, context)
            : null;
        const outboxCarryoverCount = Number(reconciliation?.outbox_count) || 0;
        const anomalies = outboxCarryoverCount > 0
            ? [{ code: 'routine_outbox_carryover', count: outboxCarryoverCount }]
            : [];
        return {
            status: anomalies.length > 0 ? 'partial' : 'completed',
            coverage: buildNightOutput && anomalies.length === 0 ? 'confirmed' : 'partial',
            reconciliation,
            compression,
            verification,
            routine_output: routineOutput,
            anomalies
        };
    }

    async executeOhayo(input, context) {
        const listExceptions = requireMethod(this.livenessService, 'listExceptions', 'livenessService.listExceptions');
        const recallGraph = requireMethod(this.recallService, 'recallGraph', 'recallService.recallGraph');
        const recallPersonalKg = requireMethod(this.recallService, 'recallPersonalKg', 'recallService.recallPersonalKg');
        const recordUsage = requireMethod(this.feedbackService, 'recordUsage', 'feedbackService.recordUsage');
        const generate = requireMethod(this.ohayoGenerator, 'generate', 'ohayoGenerator.generate');

        const deliverPending = this.judgmentOutboxDeliveryService
            ? requireMethod(
                this.judgmentOutboxDeliveryService,
                'deliverPending',
                'judgmentOutboxDeliveryService.deliverPending'
            )
            : null;
        const judgmentOutboxDelivery = deliverPending
            ? await deliverPending(context)
            : null;
        const [exceptions, graphKnowledge, personalKnowledge] = await Promise.all([
            context === undefined ? listExceptions({ limit: 3 }) : listExceptions({ limit: 3 }, context),
            context === undefined
                ? recallGraph({ input: input.input || {} })
                : recallGraph({ input: input.input || {} }, context),
            context === undefined
                ? recallPersonalKg({ input: input.input || {} })
                : recallPersonalKg({ input: input.input || {} }, context)
        ]);
        const generateInput = {
            exceptions,
            graph_memories: graphKnowledge,
            personal_memories: personalKnowledge
        };
        const generated = context === undefined
            ? await generate(generateInput)
            : await generate(generateInput, context);
        const recalledIds = normalizeKnowledgeIds([...graphKnowledge, ...personalKnowledge]);
        const usedKnowledgeIds = [...new Set(Array.isArray(generated?.used_knowledge_ids)
            ? generated.used_knowledge_ids
            : [])]
            .filter((id) => recalledIds.has(id));
        const anomalies = [];
        if (judgmentOutboxDelivery) {
            const deliveryCode = judgmentOutboxDelivery.dead_lettered > 0
                ? 'judgment_outbox_dead_lettered'
                : judgmentOutboxDelivery.status === 'unavailable'
                    ? 'judgment_outbox_delivery_unavailable'
                    : judgmentOutboxDelivery.failed > 0
                        ? 'judgment_outbox_delivery_failed'
                        : judgmentOutboxDelivery.retryable > 0
                            ? 'judgment_outbox_delivery_retryable'
                            : judgmentOutboxDelivery.pending > 0
                                ? 'judgment_outbox_delivery_pending'
                                : null;
            if (deliveryCode) {
                const count = Number(
                    judgmentOutboxDelivery.dead_lettered
                    || judgmentOutboxDelivery.failed
                    || judgmentOutboxDelivery.retryable
                    || judgmentOutboxDelivery.pending
                ) || 0;
                const summary = ({
                    judgment_outbox_dead_lettered: `判断の知識化に失敗し、${count}件を隔離しています`,
                    judgment_outbox_delivery_unavailable: '判断の知識化サービスへ接続できません',
                    judgment_outbox_delivery_failed: `判断の知識化に${count}件失敗しています`,
                    judgment_outbox_delivery_retryable: `判断の知識化を${count}件再試行します`,
                    judgment_outbox_delivery_pending: `判断の知識化が${count}件未配信です`
                })[deliveryCode];
                anomalies.push({ code: deliveryCode, summary });
            }
        }
        for (const knowledgeId of usedKnowledgeIds) {
            try {
                const usage = { knowledge_id: knowledgeId, outcome: 'used', routine: 'ohayo' };
                if (context === undefined) await recordUsage(usage);
                else await recordUsage(usage, context);
            } catch {
                anomalies.push({ code: 'knowledge_feedback_failed', knowledge_id: knowledgeId });
            }
        }
        const morningOutput = safeMorningOutput(generated?.morning_output);
        const routineOutput = morningOutput.routine_output || {
            headline: morningOutput.memories[0]?.summary
                ? `今日は「${morningOutput.memories[0].summary}」を判断軸に進める`
                : '今日進めることは未確定です',
            today_focus: morningOutput.memories.slice(0, 1),
            immediate_decisions: morningOutput.memories.slice(1),
            warnings: morningOutput.exceptions,
            carryovers: [],
            references: []
        };
        const deliveryWarnings = anomalies
            .filter((anomaly) => anomaly.code.startsWith('judgment_outbox_') && anomaly.summary)
            .map((anomaly) => ({ summary: anomaly.summary }));
        if (deliveryWarnings.length > 0) {
            routineOutput.warnings = [
                ...(Array.isArray(routineOutput.warnings) ? routineOutput.warnings : []),
                ...deliveryWarnings
            ];
        }
        return {
            status: anomalies.length > 0 ? 'partial' : 'completed',
            exceptions: morningOutput.exceptions,
            used_knowledge_ids: usedKnowledgeIds,
            ...(generated?.morning_output ? { morning_output: morningOutput } : {}),
            routine_output: routineOutput,
            ...(judgmentOutboxDelivery ? { judgment_outbox_delivery: judgmentOutboxDelivery } : {}),
            anomalies
        };
    }

    async executeRetro(input, context) {
        const evaluateMetrics = requireMethod(this.retroService, 'evaluateMetrics', 'retroService.evaluateMetrics');
        const createCandidates = requireMethod(
            this.retroService,
            'createImprovementCandidates',
            'retroService.createImprovementCandidates'
        );
        const evaluation = {
            metrics: [...RETRO_METRICS],
            ...(input?.input ? { input: input.input } : {})
        };
        const metrics = context === undefined
            ? await evaluateMetrics(evaluation)
            : await evaluateMetrics(evaluation, context);
        const unconfirmed = RETRO_METRICS.filter((field) => metrics?.[field] == null);
        if (unconfirmed.length > 0) {
            return {
                status: 'partial',
                metrics,
                improvement_candidates: [],
                anomalies: unconfirmed.map((field) => ({ code: 'routine_metric_unconfirmed', field }))
            };
        }
        const candidateInput = { metrics, limit: 3, output: 'story_pr' };
        const candidates = context === undefined
            ? await createCandidates(candidateInput)
            : await createCandidates(candidateInput, context);
        let reviews = null;
        const listKnowledgeReviews = typeof this.retroService?.listKnowledgeReviews === 'function'
            ? this.retroService.listKnowledgeReviews.bind(this.retroService)
            : null;
        if (listKnowledgeReviews) {
            reviews = context === undefined
                ? await listKnowledgeReviews({ input: input.input || {}, limit: 10 })
                : await listKnowledgeReviews({ input: input.input || {}, limit: 10 }, context);
        }
        const improvementCandidates = (Array.isArray(candidates) ? candidates : []).slice(0, 3);
        return {
            status: 'completed',
            coverage: listKnowledgeReviews ? 'confirmed' : 'partial',
            metrics,
            improvement_candidates: improvementCandidates,
            routine_output: {
                headline: improvementCandidates.length > 0
                    ? '来週から、繰り返し起きた詰まりを仕組みで減らす'
                    : '来週から変える仕組みはありません',
                system_changes: improvementCandidates.map((candidate) => ({
                    summary: typeof candidate === 'string' ? candidate : candidate?.summary || candidate?.metric,
                    applies_changes: false
                })),
                repeated_patterns: [],
                personal_kg_registration_reviews: reviews?.personal_kg_registration_reviews || [],
                graph_promotion_reviews: reviews?.graph_promotion_reviews || []
            },
            anomalies: []
        };
    }
}

export function createUnavailableRoutineCycleExecutor() {
    return new RoutineCycleExecutor();
}
