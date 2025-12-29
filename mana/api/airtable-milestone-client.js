/**
 * airtable-milestone-client.js
 * HybridClient (NocoDB + Airtable) マイルストーン・スプリント管理クライアント
 *
 * Phase 4-B: HybridClient統合版
 *
 * 正本: Airtable（各プロジェクトBase） → NocoDBに移行中
 * - マイルストーン: 90日単位の目標
 * - スプリント: 週単位の計画・振り返り
 * - タスク: 具体的なやること
 */

const HybridClient = require('./hybrid-client');

// プロジェクト別Base ID マッピング（変更なし）
const PROJECT_BASE_MAPPING = {
  'salestailor': 'app8uhkD8PcnxPvVx',
  'zeims': 'appg1DeWomuFuYnri',
  'dialogai': 'appLXuHKJGitc6CGd',
  'eve-topi': 'appsticSxr1PQsZam',
  'hp-sales': 'appXvthGPhEO1ZEOv',
  'smartfront': 'appXLSkrAKrykJJQm',
  'aitle': 'appvZv4ybVDsBXtvC',
  'mywa': 'appJeMbMQcz507E9g',
  'senrigan': 'appDd7TdJf1t23PCm',
  'baao': 'appCysQGZowfOd58i',
  'ncom': 'appQwscGj355IMsfS',
  'back-office': 'appxybW7Hn5qjaIwP',
};

// テーブル名（各Baseで共通）
const TABLE_NAMES = {
  milestones: 'マイルストーン',
  sprints: 'スプリント',
  tasks: 'タスク',
};

/**
 * AirtableレコードURLを生成（後方互換性のため維持）
 */
function buildAirtableUrl(baseId, tableId, recordId = null) {
  if (recordId) {
    return `https://airtable.com/${baseId}/${tableId}/${recordId}`;
  }
  return `https://airtable.com/${baseId}/${tableId}`;
}

class AirtableMilestoneClient {
  constructor(projectId) {
    if (!projectId) {
      throw new Error('projectId is required');
    }

    this.projectId = projectId.toLowerCase();
    this.baseId = PROJECT_BASE_MAPPING[this.projectId];

    if (!this.baseId) {
      throw new Error(`Unknown project: ${projectId}. Available: ${Object.keys(PROJECT_BASE_MAPPING).join(', ')}`);
    }

    // HybridClientインスタンス化
    this.client = new HybridClient();
  }

  // ========================================
  // マイルストーン操作
  // ========================================

  /**
   * 全マイルストーンを取得
   * @param {Object} options - フィルタオプション
   * @returns {Promise<Array>} マイルストーン一覧
   */
  async getMilestones(options = {}) {
    try {
      // HybridClient.list() 呼び出し（eachPageパターンから変換）
      const records = await this.client.list(this.baseId, TABLE_NAMES.milestones, {
        limit: options.maxRecords || 100,
        where: options.status ? `{ステータス} = "${options.status}"` : undefined,
        sort: options.sort || [{ field: '期限', direction: 'asc' }]
      });

      // レスポンス形式を既存APIに合わせる
      return records.map(r => ({
        id: r.id,
        name: r.fields['名前'],
        description: r.fields['説明'],
        deadline: r.fields['期限'],
        status: r.fields['ステータス'],
        progress: r.fields['進捗率'],
        blocker: r.fields['ブロッカー'],
        assignee: r.fields['担当者'],
        url: buildAirtableUrl(this.baseId, 'milestones', r.id),
        _raw: r.fields,
      }));
    } catch (err) {
      console.error(`[MilestoneClient] getMilestones error: ${err.message}`);
      throw err;
    }
  }

  /**
   * 進行中のマイルストーンを取得
   */
  async getActiveMilestones() {
    return this.getMilestones({ status: '進行中' });
  }

  /**
   * マイルストーンを作成
   */
  async createMilestone(data) {
    const fields = {
      '名前': data.name,
      '説明': data.description,
      '期限': data.deadline,
      'ステータス': data.status || '未着手',
      '進捗率': data.progress || 0,
      '担当者': data.assignee,
    };

    if (data.blocker) {
      fields['ブロッカー'] = data.blocker;
    }

    try {
      const record = await this.client.create(this.baseId, TABLE_NAMES.milestones, fields);

      return {
        id: record.id,
        ...record.fields,
        url: buildAirtableUrl(this.baseId, 'milestones', record.id),
      };
    } catch (err) {
      console.error(`[MilestoneClient] createMilestone error: ${err.message}`);
      throw err;
    }
  }

  /**
   * マイルストーンを更新
   */
  async updateMilestone(recordId, data) {
    const fields = {};

    if (data.name) fields['名前'] = data.name;
    if (data.description) fields['説明'] = data.description;
    if (data.deadline) fields['期限'] = data.deadline;
    if (data.status) fields['ステータス'] = data.status;
    if (data.progress !== undefined) fields['進捗率'] = data.progress;
    if (data.blocker !== undefined) fields['ブロッカー'] = data.blocker;
    if (data.assignee) fields['担当者'] = data.assignee;

    try {
      const record = await this.client.update(this.baseId, TABLE_NAMES.milestones, recordId, fields);
      return { id: record.id, ...record.fields };
    } catch (err) {
      console.error(`[MilestoneClient] updateMilestone error: ${err.message}`);
      throw err;
    }
  }

  // ========================================
  // スプリント操作
  // ========================================

  /**
   * 全スプリントを取得
   */
  async getSprints(options = {}) {
    try {
      // HybridClient.list() 呼び出し（eachPageパターンから変換）
      const records = await this.client.list(this.baseId, TABLE_NAMES.sprints, {
        limit: options.maxRecords || 100,
        sort: options.sort || [{ field: '開始日', direction: 'desc' }]
      });

      return records.map(r => ({
        id: r.id,
        period: r.fields['期間'],
        startDate: r.fields['開始日'],
        endDate: r.fields['終了日'],
        goal: r.fields['目標'],
        milestone: r.fields['マイルストーン'],
        dailyLog: r.fields['日次ログ'],
        completedItems: r.fields['完了事項'],
        blocker: r.fields['ブロッカー'],
        learnings: r.fields['学び'],
        nextWeek: r.fields['来週の予定'],
        url: buildAirtableUrl(this.baseId, 'sprints', r.id),
        _raw: r.fields,
      }));
    } catch (err) {
      console.error(`[MilestoneClient] getSprints error: ${err.message}`);
      throw err;
    }
  }

  /**
   * 現在のスプリントを取得（今日の日付を含むスプリント）
   */
  async getCurrentSprint() {
    const today = new Date().toISOString().split('T')[0];

    try {
      // firstPageパターンをlist(limit: 1)に変換
      const records = await this.client.list(this.baseId, TABLE_NAMES.sprints, {
        where: `AND({開始日} <= "${today}", {終了日} >= "${today}")`,
        limit: 1
      });

      if (records.length === 0) {
        return null;
      }

      const r = records[0];
      return {
        id: r.id,
        period: r.fields['期間'],
        startDate: r.fields['開始日'],
        endDate: r.fields['終了日'],
        goal: r.fields['目標'],
        milestone: r.fields['マイルストーン'],
        dailyLog: r.fields['日次ログ'],
        completedItems: r.fields['完了事項'],
        blocker: r.fields['ブロッカー'],
        learnings: r.fields['学び'],
        url: buildAirtableUrl(this.baseId, 'sprints', r.id),
        _raw: r.fields,
      };
    } catch (err) {
      console.error(`[MilestoneClient] getCurrentSprint error: ${err.message}`);
      throw err;
    }
  }

  /**
   * スプリントを作成
   */
  async createSprint(data) {
    const fields = {
      '期間': data.period,
      '開始日': data.startDate,
      '終了日': data.endDate,
      '目標': data.goal,
    };

    if (data.milestoneIds) {
      fields['マイルストーン'] = data.milestoneIds;
    }

    try {
      const record = await this.client.create(this.baseId, TABLE_NAMES.sprints, fields);

      return {
        id: record.id,
        ...record.fields,
        url: buildAirtableUrl(this.baseId, 'sprints', record.id),
      };
    } catch (err) {
      console.error(`[MilestoneClient] createSprint error: ${err.message}`);
      throw err;
    }
  }

  /**
   * スプリントの日次ログを追記
   * @param {string} sprintId - スプリントレコードID
   * @param {string} logEntry - 追記するログ（マークダウン形式）
   */
  async appendDailyLog(sprintId, logEntry) {
    try {
      // findパターンをlist(where: Id = sprintId)に変換
      const records = await this.client.list(this.baseId, TABLE_NAMES.sprints, {
        where: `{Id} = "${sprintId}"`,
        limit: 1
      });

      if (records.length === 0) {
        throw new Error(`Sprint not found: ${sprintId}`);
      }

      const record = records[0];
      const currentLog = record.fields['日次ログ'] || '';

      // 日付ヘッダーを抽出（例: "## 📅 2025-12-25（水）"）
      const dateHeaderMatch = logEntry.match(/## 📅 (\d{4}-\d{2}-\d{2})/);
      if (dateHeaderMatch) {
        const targetDate = dateHeaderMatch[1];
        // 既に同じ日付のログが存在するかチェック
        const datePattern = new RegExp(`## 📅 ${targetDate.replace(/-/g, '\\-')}`);
        if (datePattern.test(currentLog)) {
          console.log(`Skip: Daily log for ${targetDate} already exists in sprint ${sprintId}`);
          return { id: sprintId, dailyLog: currentLog, skipped: true };
        }
      }

      const newLog = currentLog ? `${currentLog}\n\n${logEntry}` : logEntry;

      const updated = await this.client.update(
        this.baseId,
        TABLE_NAMES.sprints,
        sprintId,
        { '日次ログ': newLog }
      );

      return { id: updated.id, dailyLog: updated.fields['日次ログ'] };
    } catch (err) {
      console.error(`[MilestoneClient] appendDailyLog error: ${err.message}`);
      throw err;
    }
  }

  /**
   * スプリントを更新（振り返り用）
   */
  async updateSprintRetrospective(sprintId, data) {
    const fields = {};

    if (data.completedItems) fields['完了事項'] = data.completedItems;
    if (data.blocker) fields['ブロッカー'] = data.blocker;
    if (data.learnings) fields['学び'] = data.learnings;
    if (data.nextWeek) fields['来週の予定'] = data.nextWeek;

    try {
      const record = await this.client.update(this.baseId, TABLE_NAMES.sprints, sprintId, fields);
      return { id: record.id, ...record.fields };
    } catch (err) {
      console.error(`[MilestoneClient] updateSprintRetrospective error: ${err.message}`);
      throw err;
    }
  }

  // ========================================
  // 複合操作
  // ========================================

  /**
   * プロジェクト進捗サマリーを取得
   * @returns {Promise<Object>} サマリー情報
   */
  async getProjectSummary() {
    const [milestones, currentSprint] = await Promise.all([
      this.getMilestones(),
      this.getCurrentSprint(),
    ]);

    const activeMilestones = milestones.filter(m => m.status === '進行中');
    const completedMilestones = milestones.filter(m => m.status === '完了');
    const blockedMilestones = milestones.filter(m => m.blocker);

    return {
      projectId: this.projectId,
      baseId: this.baseId,
      milestones: {
        total: milestones.length,
        active: activeMilestones.length,
        completed: completedMilestones.length,
        blocked: blockedMilestones.length,
        list: activeMilestones,
      },
      currentSprint,
      blockers: blockedMilestones.map(m => ({
        milestone: m.name,
        blocker: m.blocker,
      })),
    };
  }

  /**
   * 次週のスプリントを自動生成
   * @param {Object} options - オプション
   * @returns {Promise<Object>} 作成されたスプリント
   */
  async createNextWeekSprint(options = {}) {
    const today = new Date();
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + (8 - today.getDay()) % 7);

    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);

    const weekNumber = getWeekNumber(nextMonday);
    const period = `W${weekNumber} (${formatDate(nextMonday)}-${formatDate(nextSunday)})`;

    return this.createSprint({
      period,
      startDate: nextMonday.toISOString().split('T')[0],
      endDate: nextSunday.toISOString().split('T')[0],
      goal: options.goal || '',
      milestoneIds: options.milestoneIds,
    });
  }

  /**
   * メトリクス取得（HybridClientから）
   * @returns {Object} - 使用状況メトリクス
   */
  getMetrics() {
    return this.client.getMetrics();
  }
}

// ========================================
// ユーティリティ
// ========================================

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function formatDate(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}/${day}`;
}

module.exports = {
  AirtableMilestoneClient,
  PROJECT_BASE_MAPPING,
  TABLE_NAMES,
  buildAirtableUrl,
};
