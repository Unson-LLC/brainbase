/**
 * ZepMCPClient
 * ZEP MCP Server との通信を管理するクライアント
 * MCP Client SDK を使用して stdio transport で接続
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class ZepMCPClient {
  constructor() {
    this.client = null;
    this.connected = false;
  }

  /**
   * ZEP MCPサーバーに接続
   */
  async connect() {
    if (this.connected) {
      return;
    }

    const transport = new StdioClientTransport({
      command: "node",
      args: [process.env.ZEP_MCP_SERVER_PATH || "zep-mcp-server"],
      env: {
        ...process.env,
        ZEP_API_KEY: process.env.ZEP_API_KEY
      }
    });

    this.client = new Client(
      { name: "brainbase-zep-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await this.client.connect(transport);
    this.connected = true;
    console.log('[ZepMCPClient] Connected to ZEP MCP Server');
  }

  /**
   * MCPツールを呼び出す
   * @param {string} toolName - ツール名
   * @param {Object} args - ツール引数
   * @returns {Promise<Object>} ツールの実行結果
   */
  async callTool(toolName, args) {
    if (!this.connected) {
      await this.connect();
    }

    try {
      const result = await this.client.callTool({
        name: toolName,
        arguments: args
      });
      return result;
    } catch (error) {
      console.error(`[ZepMCPClient] Error calling tool ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * ZEPセッションを作成
   * @param {string} sessionId - セッションID
   * @param {string} userId - ユーザーID
   * @param {Object} metadata - セッションメタデータ
   * @returns {Promise<Object>}
   */
  async createSession(sessionId, userId, metadata = {}) {
    return await this.callTool('zep_create_session', {
      session_id: sessionId,
      user_id: userId,
      metadata
    });
  }

  /**
   * ZEPセッションのメタデータを更新
   * @param {string} sessionId - セッションID
   * @param {Object} metadata - 更新するメタデータ
   * @returns {Promise<Object>}
   */
  async updateSession(sessionId, metadata) {
    return await this.callTool('zep_update_session', {
      session_id: sessionId,
      metadata
    });
  }

  /**
   * ZEPセッションにメッセージを追加
   * @param {string} sessionId - セッションID
   * @param {Array<Object>} messages - メッセージ配列 [{role, content}]
   * @returns {Promise<Object>}
   */
  async addMessages(sessionId, messages) {
    return await this.callTool('zep_add_messages', {
      session_id: sessionId,
      messages
    });
  }

  /**
   * ZEPセッションのメモリを取得
   * @param {string} sessionId - セッションID
   * @param {number} limit - 取得するメッセージ数
   * @returns {Promise<Object>}
   */
  async getMemory(sessionId, limit = 50) {
    return await this.callTool('zep_get_memory', {
      session_id: sessionId,
      limit
    });
  }

  /**
   * ZEPセッション一覧を取得
   * @param {string} userId - ユーザーID
   * @param {number} limit - 取得するセッション数
   * @returns {Promise<Object>}
   */
  async listSessions(userId, limit = 100) {
    return await this.callTool('zep_list_sessions', {
      user_id: userId,
      limit
    });
  }

  /**
   * 接続を切断
   */
  async disconnect() {
    if (this.client && this.connected) {
      await this.client.close();
      this.connected = false;
      console.log('[ZepMCPClient] Disconnected from ZEP MCP Server');
    }
  }
}
