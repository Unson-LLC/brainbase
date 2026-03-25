/**
 * BrainbaseActionController
 * ダッシュボードのアクション管理（Story 3: 介入判断を実行に移す）
 */
import { asyncHandler } from '../lib/async-handler.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { logger } from '../utils/logger.js';

/**
 * アクション型定義
 */
export const ACTION_TYPES = {
    MTG_INVITE: { id: 'mtg_invite', label: 'MTG招集', icon: '📅' },
    REASSIGN: { id: 'reassign', label: '担当変更', icon: '👤' },
    DEADLINE_CHANGE: { id: 'deadline_change', label: '期限変更', icon: '📆' },
    UNBLOCK: { id: 'unblock', label: 'ブロック解除', icon: '🔓' },
    ESCALATE: { id: 'escalate', label: 'エスカレーション', icon: '⚡' }
};

/**
 * アクションステータス定義
 */
export const ACTION_STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    EXECUTED: 'executed',
    FAILED: 'failed'
};

const VALID_ACTION_TYPES = Object.values(ACTION_TYPES).map(t => t.id);
const VALID_STATUSES = Object.values(ACTION_STATUS);

export class BrainbaseActionController {
    constructor(nocodbService) {
        this.nocodbService = nocodbService;
    }

    /** POST /api/brainbase/actions */
    create = asyncHandler(async (req, res) => {
        const { project, taskId, tableId, actionType, details } = req.body;

        if (!project || !taskId || !tableId || !actionType) {
            throw AppError.validation('project, taskId, tableId, actionType are required');
        }

        if (!VALID_ACTION_TYPES.includes(actionType)) {
            throw AppError.validation(`Valid types: ${VALID_ACTION_TYPES.join(', ')}`);
        }

        const action = await this.nocodbService.createAction({
            project,
            taskId: parseInt(taskId, 10),
            tableId,
            actionType,
            details: details || {},
            status: ACTION_STATUS.PENDING,
            createdAt: new Date().toISOString()
        });

        logger.info('Action created', { project, taskId, actionType });
        res.json({ success: true, action });
    });

    /** GET /api/brainbase/actions */
    list = asyncHandler(async (req, res) => {
        const { project } = req.query;
        const limit = parseInt(req.query.limit) || 50;
        const result = await this.nocodbService.getActions(project, limit);
        res.json(result);
    });

    /** PATCH /api/brainbase/actions/:actionId/status */
    updateStatus = asyncHandler(async (req, res) => {
        const { actionId } = req.params;
        const { status } = req.body;

        if (!VALID_STATUSES.includes(status)) {
            throw AppError.validation(`Valid statuses: ${VALID_STATUSES.join(', ')}`);
        }

        await this.nocodbService.updateActionStatus(parseInt(actionId, 10), status);
        logger.info('Action status updated', { actionId, status });
        res.json({ success: true });
    });

    /** GET /api/brainbase/action-types */
    getTypes = (req, res) => {
        res.json(ACTION_TYPES);
    };
}
