/**
 * Skills関連のAPIコントローラー
 */
import { skillsUsageService } from '../services/skills-usage-service.js';
import { skillsEvaluationService } from '../services/skills-evaluation-service.js';
import { skillsUpdateService } from '../services/skills-update-service.js';

export class SkillsController {
  /**
   * Skills使用履歴を記録
   * POST /api/skills/usage
   */
  async recordUsage(req, res) {
    try {
      const data = req.body;

      // バリデーション
      if (!data.sessionId || !data.skillName || !data.timestamp) {
        return res.status(400).json({
          error: 'Missing required fields: sessionId, skillName, timestamp'
        });
      }

      const result = await skillsUsageService.recordUsage(data);
      res.json(result);
    } catch (error) {
      console.error('[SkillsController] Failed to record usage:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * 特定Skillの使用履歴を取得
   * GET /api/skills/usage/:skillName
   */
  async getUsageHistory(req, res) {
    try {
      const { skillName } = req.params;
      const history = await skillsUsageService.getUsageHistory(skillName);
      res.json({ history });
    } catch (error) {
      console.error('[SkillsController] Failed to get usage history:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * 全Skillsの使用履歴を取得
   * GET /api/skills/usage
   */
  async getAllUsageHistory(req, res) {
    try {
      const history = await skillsUsageService.getAllUsageHistory();
      res.json({ history });
    } catch (error) {
      console.error('[SkillsController] Failed to get all usage history:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * 処理済みセッション一覧を取得
   * GET /api/skills/processed-sessions
   */
  async getProcessedSessions(req, res) {
    try {
      const processedSessions = await skillsUsageService.getProcessedSessions();
      res.json({ processedSessions });
    } catch (error) {
      console.error('[SkillsController] Failed to get processed sessions:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * 処理済みセッションをマーク
   * POST /api/skills/processed-sessions
   */
  async markProcessed(req, res) {
    try {
      const { sessionId } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'Missing required field: sessionId' });
      }

      await skillsUsageService.markProcessed(sessionId);
      res.json({ success: true });
    } catch (error) {
      console.error('[SkillsController] Failed to mark processed:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * 学習候補を取得
   * GET /api/skills/learnings/:sessionId
   */
  async getLearnings(req, res) {
    try {
      const { sessionId } = req.params;
      const learnings = await skillsUsageService.getLearnings(sessionId);
      res.json({ learnings });
    } catch (error) {
      console.error('[SkillsController] Failed to get learnings:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * LLMを呼び出し
   * POST /api/skills/llm
   */
  async callLLM(req, res) {
    try {
      const { prompt, options } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: 'Missing required field: prompt' });
      }

      const result = await skillsEvaluationService.callLLM(prompt, options);
      res.json({ result });
    } catch (error) {
      console.error('[SkillsController] LLM call failed:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * 完全性をチェック
   * POST /api/skills/evaluate/completeness
   */
  async checkCompleteness(req, res) {
    try {
      const { skillName } = req.body;

      if (!skillName) {
        return res.status(400).json({ error: 'Missing required field: skillName' });
      }

      const score = await skillsEvaluationService.checkCompleteness(skillName);
      res.json({ score });
    } catch (error) {
      console.error('[SkillsController] Completeness check failed:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * 正確性をチェック
   * POST /api/skills/evaluate/correctness
   */
  async checkCorrectness(req, res) {
    try {
      const { skillName, usageHistory } = req.body;

      if (!skillName) {
        return res.status(400).json({ error: 'Missing required field: skillName' });
      }

      const score = await skillsEvaluationService.checkCorrectness(skillName, usageHistory || []);
      res.json({ score });
    } catch (error) {
      console.error('[SkillsController] Correctness check failed:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * 簡潔性をチェック
   * POST /api/skills/evaluate/conciseness
   */
  async checkConciseness(req, res) {
    try {
      const { skillName } = req.body;

      if (!skillName) {
        return res.status(400).json({ error: 'Missing required field: skillName' });
      }

      const score = await skillsEvaluationService.checkConciseness(skillName);
      res.json({ score });
    } catch (error) {
      console.error('[SkillsController] Conciseness check failed:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * KERNEL準拠をチェック
   * POST /api/skills/evaluate/kernel
   */
  async checkKERNEL(req, res) {
    try {
      const { skillName } = req.body;

      if (!skillName) {
        return res.status(400).json({ error: 'Missing required field: skillName' });
      }

      const score = await skillsEvaluationService.checkKERNEL(skillName);
      res.json({ score });
    } catch (error) {
      console.error('[SkillsController] KERNEL check failed:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * 一貫性をチェック
   * POST /api/skills/evaluate/consistency
   */
  async checkConsistency(req, res) {
    try {
      const { skillName } = req.body;

      if (!skillName) {
        return res.status(400).json({ error: 'Missing required field: skillName' });
      }

      const score = await skillsEvaluationService.checkConsistency(skillName);
      res.json({ score });
    } catch (error) {
      console.error('[SkillsController] Consistency check failed:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Skillを更新
   * POST /api/skills/update
   */
  async updateSkill(req, res) {
    try {
      const { skillName, newContent, metadata } = req.body;

      if (!skillName || !newContent) {
        return res.status(400).json({ error: 'Missing required fields: skillName, newContent' });
      }

      const result = await skillsUpdateService.updateSkill(skillName, newContent, metadata);
      res.json(result);
    } catch (error) {
      console.error('[SkillsController] Update failed:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * バックアップ一覧を取得
   * GET /api/skills/backups/:skillName
   */
  async listBackups(req, res) {
    try {
      const { skillName } = req.params;
      const backups = await skillsUpdateService.listBackups(skillName);
      res.json({ backups });
    } catch (error) {
      console.error('[SkillsController] Failed to list backups:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * バックアップコンテンツを取得
   * GET /api/skills/backups/:skillName/:timestamp
   */
  async getBackup(req, res) {
    try {
      const { skillName, timestamp } = req.params;
      const content = await skillsUpdateService.getBackup(skillName, timestamp);
      res.json({ content });
    } catch (error) {
      console.error('[SkillsController] Failed to get backup:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * 現在のコンテンツを取得
   * GET /api/skills/content/:skillName
   */
  async getCurrentContent(req, res) {
    try {
      const { skillName } = req.params;
      const content = await skillsUpdateService.getCurrentContent(skillName);
      res.json({ content });
    } catch (error) {
      console.error('[SkillsController] Failed to get current content:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * 履歴を記録
   * POST /api/skills/history
   */
  async logHistory(req, res) {
    try {
      const entry = req.body;
      const result = await skillsUpdateService.logHistory(entry);
      res.json(result);
    } catch (error) {
      console.error('[SkillsController] Failed to log history:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * 履歴を取得
   * GET /api/skills/history/:skillName
   */
  async getHistory(req, res) {
    try {
      const { skillName } = req.params;
      const history = await skillsUpdateService.getHistory(skillName);
      res.json(history);
    } catch (error) {
      console.error('[SkillsController] Failed to get history:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Skill実行をシミュレーション
   * POST /api/skills/simulate
   */
  async simulate(req, res) {
    try {
      const { skill, testCase } = req.body;
      const result = await skillsUpdateService.simulateExecution(skill, testCase);
      res.json(result);
    } catch (error) {
      console.error('[SkillsController] Simulation failed:', error);
      res.status(500).json({ error: error.message });
    }
  }
}

export const skillsController = new SkillsController();
