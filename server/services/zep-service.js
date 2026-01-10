/**
 * ZepService
 * ZEPセッション管理のビジネスロジック
 * ZepMCPClientをラップし、brainbase-ui固有の処理を実装
 */
import { ZepMCPClient } from './zep-mcp-client.js';

export class ZepService {
  constructor() {
    this.client = new ZepMCPClient();
  }

  /**
   * セッション開始時: 仮セッションID作成
   * Claude CodeのUUIDが取得できるまで、brainbase session IDで仮セッションを作成
   *
   * @param {string} brainbaseSessionId - brainbase-uiのセッションID (session-{timestamp})
   * @param {string} userId - ユーザーID
   * @param {Object} metadata - セッションメタデータ (engine, cwd, git_branch等)
   * @returns {Promise<Object>}
   */
  async initializeSession(brainbaseSessionId, userId, metadata = {}) {
    const tempSessionId = `brainbase:${brainbaseSessionId}`;

    const sessionMetadata = {
      brainbase_session_id: brainbaseSessionId,
      project_id: 'brainbase',
      user_id: userId,
      created_at: new Date().toISOString(),
      ...metadata
    };

    console.log(`[ZepService] Initializing session: ${tempSessionId}`);

    try {
      const result = await this.client.createSession(
        tempSessionId,
        userId,
        sessionMetadata
      );

      console.log(`[ZepService] Session initialized: ${tempSessionId}`);
      return result;
    } catch (error) {
      console.error(`[ZepService] Failed to initialize session:`, error);
      throw error;
    }
  }

  /**
   * セッション終了時: Claude UUIDでセッションID更新
   * jsonlファイルからClaude CodeのUUIDを取得し、最終的なセッションIDを確定
   * 仮セッション(brainbase:session-{timestamp})から最終セッション(brainbase:{CLAUDE_UUID})に移行
   *
   * @param {string} brainbaseSessionId - brainbase-uiのセッションID
   * @param {string} claudeUuid - Claude CodeのセッションUUID
   * @param {Array<Object>} messages - 会話履歴メッセージ配列 [{role, content, timestamp}]
   * @returns {Promise<string>} 最終的なZEPセッションID
   */
  async finalizeSession(brainbaseSessionId, claudeUuid, messages) {
    const finalSessionId = `brainbase:${claudeUuid}`;
    const tempSessionId = `brainbase:${brainbaseSessionId}`;

    console.log(`[ZepService] Finalizing session: ${tempSessionId} -> ${finalSessionId}`);
    console.log(`[ZepService] Message count: ${messages.length}`);

    try {
      // 1. 新しいセッションIDで作成
      await this.client.createSession(finalSessionId, 'ksato', {
        claude_session_uuid: claudeUuid,
        brainbase_session_id: brainbaseSessionId,
        project_id: 'brainbase',
        migrated_from: tempSessionId,
        finalized_at: new Date().toISOString()
      });

      // 2. メッセージ追加
      await this.client.addMessages(finalSessionId, messages);

      console.log(`[ZepService] Session finalized: ${finalSessionId}`);
      return finalSessionId;
    } catch (error) {
      console.error(`[ZepService] Failed to finalize session:`, error);
      throw error;
    }
  }

  /**
   * ZEPセッションのメモリを取得
   * @param {string} sessionId - ZEPセッションID
   * @returns {Promise<Object>}
   */
  async getMemory(sessionId) {
    console.log(`[ZepService] Getting memory for session: ${sessionId}`);

    try {
      const memory = await this.client.getMemory(sessionId);
      console.log(`[ZepService] Memory retrieved for session: ${sessionId}`);
      return memory;
    } catch (error) {
      console.error(`[ZepService] Failed to get memory:`, error);
      throw error;
    }
  }

  /**
   * ZEPセッション一覧を取得
   * @param {string} userId - ユーザーID
   * @returns {Promise<Object>}
   */
  async listSessions(userId = 'ksato') {
    console.log(`[ZepService] Listing sessions for user: ${userId}`);

    try {
      const sessions = await this.client.listSessions(userId);
      console.log(`[ZepService] Sessions retrieved: ${sessions.length || 0} sessions`);
      return sessions;
    } catch (error) {
      console.error(`[ZepService] Failed to list sessions:`, error);
      throw error;
    }
  }

  /**
   * 接続を切断
   */
  async disconnect() {
    await this.client.disconnect();
  }
}
