import { logger } from '../utils/logger.js';
import { canonicalPersonalKgAccess } from '../services/personal-kg-owner.js';

function personalAccess(req, env) {
    const access = canonicalPersonalKgAccess(req.personalKnowledgeAccess || req.access, env);
    if (!access?.personId || !access?.organizationId) {
        const error = new Error('personal_knowledge_identity_required');
        error.status = 403;
        throw error;
    }
    return access;
}

function authenticatedActor(access) {
    return access.actorPersonId || access.personId;
}

function stripIdentityClaims(input = {}) {
    const {
        owner_person_id: _ownerSnake,
        ownerPersonId: _ownerCamel,
        organization_id: _organizationSnake,
        organizationId: _organizationCamel,
        actor_person_id: _actorSnake,
        actorPersonId: _actorCamel,
        decision_owner_person_id: _decisionOwnerSnake,
        decisionOwnerPersonId: _decisionOwnerCamel,
        recommended_owner_person_id: _recommendedOwnerSnake,
        recommendedOwnerPersonId: _recommendedOwnerCamel,
        ...safe
    } = input;
    return safe;
}

function assertProjectAccess(input, access) {
    const projectCode = input.project_code || input.projectCode || null;
    const allowed = Array.isArray(access.projectCodes) ? access.projectCodes : [];
    if (projectCode && allowed.length > 0 && !allowed.includes(projectCode)) {
        const error = new Error('personal_knowledge_project_access_denied');
        error.status = 403;
        throw error;
    }
}

function ownerDecisionOptions(req, env) {
    const access = personalAccess(req, env);
    const body = stripIdentityClaims(req.body || {});
    assertProjectAccess(body, access);
    return {
        access,
        options: {
            ...body,
            actor_person_id: authenticatedActor(access),
            decision_owner_person_id: access.personId,
            access
        }
    };
}

export class LearningController {
    constructor(learningService, learningHealthService = null, options = {}) {
        this.learningService = learningService;
        this.learningHealthService = learningHealthService;
        this.env = options.env || process.env;
    }

    recordEpisode = async (req, res) => {
        try {
            const result = await this.learningService.recordEpisode(req.body || {});
            res.status(201).json(result);
        } catch (error) {
            logger.error('Failed to record learning episode', { error });
            res.status(400).json({ error: error.message || 'Failed to record learning episode' });
        }
    };

    proposePromotions = async (req, res) => {
        try {
            const result = await this.learningService.proposePromotions({
                applyMode: req.body?.applyMode
            });
            res.json({ candidates: result });
        } catch (error) {
            logger.error('Failed to propose learning promotions', { error });
            res.status(500).json({ error: 'Failed to propose learning promotions' });
        }
    };

    listPromotions = async (req, res) => {
        try {
            const result = await this.learningService.listPromotions({
                status: req.query.status,
                pillar: req.query.pillar,
                apply_mode: req.query.apply_mode
            });
            res.json(result);
        } catch (error) {
            logger.error('Failed to list learning promotions', { error });
            res.status(500).json({ error: 'Failed to list learning promotions' });
        }
    };

    createMemoryCandidate = async (req, res) => {
        try {
            const access = personalAccess(req, this.env);
            const body = stripIdentityClaims(req.body || {});
            assertProjectAccess(body, access);
            const result = await this.learningService.createMemoryCandidate({
                ...body,
                owner_person_id: access.personId,
                organization_id: access.organizationId,
                actor_person_id: authenticatedActor(access),
                recommended_owner_person_id: access.personId,
                org_ids: [access.organizationId]
            }, { access });
            res.status(201).json(result);
        } catch (error) {
            logger.error('Failed to create memory candidate', { error });
            res.status(error.status || 400).json({ error: error.message || 'Failed to create memory candidate' });
        }
    };

    listMemoryCandidates = async (req, res) => {
        try {
            const access = personalAccess(req, this.env);
            const includePromoted = req.query.include_promoted === 'true' || req.query.includePromoted === 'true';
            const projectCode = req.query.project_code || req.query.projectCode;
            assertProjectAccess({ project_code: projectCode }, access);
            const result = await this.learningService.listMemoryCandidates({
                owner_person_id: access.personId,
                organization_id: access.organizationId,
                visibility: req.query.visibility,
                scope: req.query.scope,
                sensitivity: req.query.sensitivity,
                project_code: projectCode,
                promotion_status: req.query.promotion_status,
                status: req.query.status,
                subject_type: req.query.subject_type,
                subjectType: req.query.subjectType,
                include_promoted: includePromoted
            }, { access });
            res.json({ candidates: result });
        } catch (error) {
            logger.error('Failed to list memory candidates', { error });
            res.status(error.status || 400).json({ error: error.message || 'Failed to list memory candidates' });
        }
    };

    searchPersonalKg = async (req, res) => {
        try {
            const access = personalAccess(req, this.env);
            const cognitiveTypeParam = req.query.cognitive_type || req.query.cognitiveType;
            const result = await this.learningService.searchPersonalKgCandidates({
                query: req.query.q || req.query.query,
                ownerPersonId: access.personId,
                organizationId: access.organizationId,
                cognitiveTypes: cognitiveTypeParam ? String(cognitiveTypeParam).split(',') : null,
                limit: req.query.limit
            }, { access });
            res.json({ candidates: result });
        } catch (error) {
            logger.error('Failed to search personal KG candidates', { error });
            res.status(error.status || 400).json({ error: error.message || 'Failed to search personal KG candidates' });
        }
    };

    classifyMemoryCandidate = async (req, res) => {
        try {
            const { options } = ownerDecisionOptions(req, this.env);
            const result = await this.learningService.classifyMemoryCandidate(req.params.id, options);
            if (result.notFound || !result.success) {
                return res.status(404).json({ error: 'Memory candidate not found' });
            }
            res.json(result);
        } catch (error) {
            logger.error('Failed to classify memory candidate', { error });
            res.status(error.status || 400).json({ error: error.message || 'Failed to classify memory candidate' });
        }
    };

    approveMemoryCandidate = async (req, res) => {
        try {
            const { options } = ownerDecisionOptions(req, this.env);
            const result = await this.learningService.approveMemoryCandidate(req.params.id, options);
            if (result.notFound || !result.success) {
                return res.status(404).json({ error: 'Memory candidate not found' });
            }
            res.json(result);
        } catch (error) {
            logger.error('Failed to approve memory candidate', { error });
            res.status(error.status || 400).json({ error: error.message || 'Failed to approve memory candidate' });
        }
    };

    rejectMemoryCandidate = async (req, res) => {
        try {
            const { options } = ownerDecisionOptions(req, this.env);
            const result = await this.learningService.rejectMemoryCandidate(req.params.id, options);
            if (result.notFound || !result.success) {
                return res.status(404).json({ error: 'Memory candidate not found' });
            }
            res.json(result);
        } catch (error) {
            logger.error('Failed to reject memory candidate', { error });
            res.status(error.status || 400).json({ error: error.message || 'Failed to reject memory candidate' });
        }
    };

    expireMemoryCandidate = async (req, res) => {
        try {
            const { options } = ownerDecisionOptions(req, this.env);
            const result = await this.learningService.expireMemoryCandidate(req.params.id, options);
            if (result.notFound || !result.success) {
                return res.status(404).json({ error: 'Memory candidate not found' });
            }
            res.json(result);
        } catch (error) {
            logger.error('Failed to expire memory candidate', { error });
            res.status(error.status || 400).json({ error: error.message || 'Failed to expire memory candidate' });
        }
    };

    promoteMemoryCandidateToGraph = async (_req, res) => res.status(409).json({
        error: 'personal_knowledge_two_stage_promotion_required'
    });

    getPromotion = async (req, res) => {
        try {
            const result = await this.learningService.getPromotion(req.params.id);
            if (!result) {
                return res.status(404).json({ error: 'Promotion candidate not found' });
            }
            res.json(result);
        } catch (error) {
            logger.error('Failed to get learning promotion', { error });
            res.status(500).json({ error: 'Failed to get learning promotion' });
        }
    };

    dedupeExistingPromotions = async (_req, res) => {
        try {
            const result = await this.learningService.dedupeExistingPromotions();
            res.json(result);
        } catch (error) {
            logger.error('Failed to dedupe existing learning promotions', { error });
            res.status(500).json({ error: 'Failed to dedupe existing learning promotions' });
        }
    };

    markApplied = async (req, res) => {
        try {
            const result = await this.learningService.applyPromotion(req.params.id);
            if (result.notFound || !result.success) {
                return res.status(404).json({ error: 'Promotion candidate not found' });
            }
            res.json(result);
        } catch (error) {
            logger.error('Failed to apply learning promotion', { error });
            res.status(500).json({ error: 'Failed to apply learning promotion' });
        }
    };

    rejectPromotion = async (req, res) => {
        try {
            const result = await this.learningService.markPromotionRejected(req.params.id, req.body?.reason);
            if (!result.success) {
                return res.status(404).json({ error: 'Promotion candidate not found' });
            }
            res.json(result);
        } catch (error) {
            logger.error('Failed to reject learning promotion', { error });
            res.status(500).json({ error: 'Failed to reject learning promotion' });
        }
    };

    getHealth = async (req, res) => {
        try {
            if (!this.learningHealthService) {
                return res.status(503).json({ error: 'Learning health service not configured' });
            }
            const result = await this.learningHealthService.getHealth();
            res.json(result);
        } catch (error) {
            logger.error('Failed to get learning health', { error });
            res.status(500).json({ error: 'Failed to get learning health' });
        }
    };

    recordSkillUsage = async (req, res) => {
        try {
            const result = await this.learningService.recordSkillUsage(req.body || {});
            res.status(201).json(result);
        } catch (error) {
            logger.error('Failed to record skill usage', { error });
            res.status(400).json({ error: error.message || 'Failed to record skill usage' });
        }
    };

    listStaleSkills = async (req, res) => {
        try {
            const days = Number(req.query.days);
            const result = await this.learningService.listStaleSkills({
                days: Number.isFinite(days) ? days : undefined
            });
            res.json({ stale_skills: result });
        } catch (error) {
            logger.error('Failed to list stale skills', { error });
            res.status(500).json({ error: 'Failed to list stale skills' });
        }
    };
}