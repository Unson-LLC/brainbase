/**
 * ClaudeLogParser
 * Claude Codeのjsonlログファイルからセッション情報・会話履歴を抽出するユーティリティ
 */
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';

export class ClaudeLogParser {
  /**
   * 最新のClaude CodeセッションUUIDを取得
   * ~/.claude/projects/-Users-ksato-workspace/ 配下の最新jsonlファイルからUUIDを抽出
   * ファイル名自体がセッションUUID（例: 9469d353-0d3a-47fa-9a0e-d3a0fa80050b.jsonl）
   *
   * @returns {Promise<string|null>} セッションUUID or null
   */
  static async getLatestSessionUuid() {
    const projectsDir = path.join(
      process.env.HOME,
      '.claude/projects/-Users-ksato-workspace'
    );

    try {
      const files = await fs.readdir(projectsDir);
      const jsonlFiles = files
        .filter(f => f.endsWith('.jsonl'))
        .map(f => path.join(projectsDir, f));

      if (jsonlFiles.length === 0) {
        console.warn('[ClaudeLogParser] No jsonl files found');
        return null;
      }

      // 最新のファイルを取得（mtime降順）
      const stats = await Promise.all(
        jsonlFiles.map(async f => ({
          path: f,
          mtime: (await fs.stat(f)).mtime
        }))
      );

      const latest = stats.sort((a, b) => b.mtime - a.mtime)[0];
      console.log(`[ClaudeLogParser] Latest jsonl file: ${latest.path}`);

      // ファイル名からUUIDを抽出（拡張子を除く）
      const uuid = path.basename(latest.path, '.jsonl');

      console.log(`[ClaudeLogParser] Session UUID: ${uuid}`);
      return uuid;
    } catch (error) {
      console.error('[ClaudeLogParser] Error getting session UUID:', error);
      throw error;
    }
  }

  /**
   * jsonlファイルから会話履歴を抽出
   * user/assistantメッセージのみを抽出し、ZEP形式に変換
   *
   * @param {string} jsonlPath - jsonlファイルパス
   * @returns {Promise<Array<Object>>} メッセージ配列 [{role, content, timestamp, uuid}]
   */
  static async extractMessages(jsonlPath) {
    const messages = [];

    try {
      const fileStream = await fs.open(jsonlPath, 'r');
      const rl = readline.createInterface({
        input: fileStream.createReadStream(),
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        try {
          const data = JSON.parse(line);

          // user or assistant メッセージのみ抽出
          if (data.type === 'user' || data.type === 'assistant') {
            messages.push({
              role: data.message.role,
              content: this.extractContent(data.message.content),
              timestamp: data.timestamp,
              uuid: data.uuid
            });
          }
        } catch (err) {
          console.error('[ClaudeLogParser] Failed to parse line:', err);
          // 個別行のパースエラーは無視して続行
        }
      }

      console.log(`[ClaudeLogParser] Extracted ${messages.length} messages from ${jsonlPath}`);
      return messages;
    } catch (error) {
      console.error('[ClaudeLogParser] Error extracting messages:', error);
      throw error;
    }
  }

  /**
   * メッセージコンテンツを文字列に変換
   * Claude Codeのログ形式（string, array, object）をZEP形式（string）に変換
   *
   * @param {string|Array|Object} content - メッセージコンテンツ
   * @returns {string} 文字列化されたコンテンツ
   */
  static extractContent(content) {
    // 文字列の場合はそのまま返す
    if (typeof content === 'string') {
      return content;
    }

    // 配列の場合は各要素のtextを結合
    if (Array.isArray(content)) {
      return content
        .map(item => {
          if (typeof item === 'string') {
            return item;
          }
          if (item.text) {
            return item.text;
          }
          // tool_useやtool_resultの場合はJSONとして保持
          return JSON.stringify(item);
        })
        .join('\n');
    }

    // オブジェクトの場合はJSONとして文字列化
    return JSON.stringify(content);
  }

  /**
   * ファイルの最初の行を読み込む
   * @param {string} filePath - ファイルパス
   * @returns {Promise<string>} 最初の行
   */
  static async readFirstLine(filePath) {
    const fileStream = await fs.open(filePath, 'r');
    const rl = readline.createInterface({
      input: fileStream.createReadStream(),
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      rl.close();
      return line;
    }

    return null;
  }
}
