import { logger } from '../utils/logger.js';

export class LearningController {
    constructor(learningService) {
        this.learningService = learningService;
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
}
