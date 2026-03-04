/**
 * Skills関連のAPIルーティング
 */
import { Router } from 'express';
import { skillsController } from '../controllers/skills-controller.js';

const router = Router();

// Skills使用履歴関連
router.post('/usage', (req, res) => skillsController.recordUsage(req, res));
router.get('/usage', (req, res) => skillsController.getAllUsageHistory(req, res));
router.get('/usage/:skillName', (req, res) => skillsController.getUsageHistory(req, res));

// 処理済みセッション管理
router.get('/processed-sessions', (req, res) => skillsController.getProcessedSessions(req, res));
router.post('/processed-sessions', (req, res) => skillsController.markProcessed(req, res));

// 学習候補取得
router.get('/learnings/:sessionId', (req, res) => skillsController.getLearnings(req, res));

// LLM呼び出し
router.post('/llm', (req, res) => skillsController.callLLM(req, res));

// 品質評価エンドポイント
router.post('/evaluate/completeness', (req, res) => skillsController.checkCompleteness(req, res));
router.post('/evaluate/correctness', (req, res) => skillsController.checkCorrectness(req, res));
router.post('/evaluate/conciseness', (req, res) => skillsController.checkConciseness(req, res));
router.post('/evaluate/kernel', (req, res) => skillsController.checkKERNEL(req, res));
router.post('/evaluate/consistency', (req, res) => skillsController.checkConsistency(req, res));

export default router;
