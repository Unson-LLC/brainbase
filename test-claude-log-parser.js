/**
 * ClaudeLogParser テスト
 * 実際のjsonlファイルからメッセージを抽出できるか確認
 */
import { ClaudeLogParser } from './server/utils/claude-log-parser.js';

async function testClaudeLogParser() {
    console.log('=== ClaudeLogParser テスト開始 ===\n');

    try {
        // Test 1: 最新セッションUUIDの取得
        console.log('Test 1: 最新セッションUUID取得');
        const uuid = await ClaudeLogParser.getLatestSessionUuid();
        console.log(`✅ UUID取得成功: ${uuid}\n`);

        // Test 2: jsonlファイルからメッセージ抽出
        console.log('Test 2: メッセージ抽出');
        const projectsDir = process.env.HOME + '/.claude/projects/-Users-ksato-workspace';
        const fs = await import('fs/promises');
        const files = await fs.readdir(projectsDir);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

        if (jsonlFiles.length === 0) {
            console.log('❌ jsonlファイルが見つかりません');
            return;
        }

        const testFile = `${projectsDir}/${jsonlFiles[0]}`;
        console.log(`テスト対象ファイル: ${testFile}`);

        const messages = await ClaudeLogParser.extractMessages(testFile);
        console.log(`✅ メッセージ抽出成功: ${messages.length}件\n`);

        // 最初の3件を表示
        console.log('抽出されたメッセージ (最初の3件):');
        messages.slice(0, 3).forEach((msg, idx) => {
            const preview = msg.content.substring(0, 100).replace(/\n/g, ' ');
            console.log(`${idx + 1}. [${msg.role}] ${preview}...`);
        });

        console.log('\n=== テスト完了 ===');
    } catch (error) {
        console.error('❌ テスト失敗:', error);
        throw error;
    }
}

testClaudeLogParser();
