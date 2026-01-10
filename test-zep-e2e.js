/**
 * ZEP MCP統合 E2Eテスト
 * 実際のZEP APIへの接続とデータ保存をテスト
 */
import 'dotenv/config';
import { ZepService } from './server/services/zep-service.js';
import { ClaudeLogParser } from './server/utils/claude-log-parser.js';

async function runE2ETest() {
    console.log('=== ZEP MCP統合 E2Eテスト開始 ===\n');

    const zepService = new ZepService();

    try {
        // Test 1: ZEP接続確認
        console.log('Test 1: ZEP接続確認');
        const sessions = await zepService.listSessions('ksato');
        console.log(`✅ ZEP接続成功: ${sessions.content?.[0]?.text ? JSON.parse(sessions.content[0].text).length : 0}件のセッションを取得\n`);

        // Test 2: 仮セッション作成
        console.log('Test 2: 仮セッション作成');
        const testSessionId = `session-test-${Date.now()}`;
        await zepService.initializeSession(testSessionId, 'ksato', {
            engine: 'claude',
            cwd: process.cwd(),
            git_branch: 'main'
        });
        console.log(`✅ 仮セッション作成成功: brainbase:${testSessionId}\n`);

        // Test 3: Claude UUIDの取得
        console.log('Test 3: Claude UUID取得');
        const uuid = await ClaudeLogParser.getLatestSessionUuid();
        console.log(`✅ UUID取得成功: ${uuid}\n`);

        // Test 4: メッセージ抽出
        console.log('Test 4: メッセージ抽出');
        const projectsDir = process.env.HOME + '/.claude/projects/-Users-ksato-workspace';
        const fs = await import('fs/promises');
        const files = await fs.readdir(projectsDir);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
        const testFile = `${projectsDir}/${jsonlFiles[0]}`;

        const messages = await ClaudeLogParser.extractMessages(testFile);
        console.log(`✅ メッセージ抽出成功: ${messages.length}件\n`);

        // Test 5: ZEPセッション確定（実際のメッセージ保存）
        console.log('Test 5: ZEPセッション確定（メッセージ保存）');
        const finalSessionId = await zepService.finalizeSession(
            testSessionId,
            `test-${uuid}`,
            messages.slice(0, 5) // 最初の5件のみテスト
        );
        console.log(`✅ セッション確定成功: ${finalSessionId}\n`);

        // Test 6: メモリ取得
        console.log('Test 6: 保存されたメモリ取得');
        const memory = await zepService.getMemory(finalSessionId);
        console.log(`✅ メモリ取得成功`);
        console.log(`   - セッションID: ${finalSessionId}`);
        console.log(`   - メッセージ数: ${memory.content?.[0]?.text ? JSON.parse(memory.content[0].text).messages?.length || 0 : 0}\n`);

        console.log('=== 全テスト成功 ===');
        console.log('\n次のステップ:');
        console.log('1. brainbase-uiサーバーを起動: npm run dev');
        console.log('2. 実際のセッションを終了して、自動保存をテスト');
        console.log('3. /tmp/hook-debug.log でログを確認\n');

    } catch (error) {
        console.error('❌ テスト失敗:', error.message);
        console.error('\nスタックトレース:', error.stack);
        process.exit(1);
    } finally {
        await zepService.disconnect();
    }
}

runE2ETest();
