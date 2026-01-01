#!/usr/bin/env node
/**
 * Phase 2 クリーンアップメソッド手動実行スクリプト
 * 24h TTL（paused）と 30d TTL（archived）のクリーンアップを実行
 */

import { promisify } from 'util';
import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// StateStore と SessionManager をインポート
import { StateStore } from '../lib/state-store.js';
import { SessionManager } from '../server/services/session-manager.js';
import { WorktreeService } from '../server/services/worktree-service.js';

const execPromise = promisify(exec);

async function main() {
    console.log('=== Phase 2 クリーンアップ実行 ===\n');

    // StateStore 初期化
    const stateStore = new StateStore(path.join(__dirname, '..', 'state.json'));
    await stateStore.init();

    console.log('✅ StateStore initialized');
    console.log(`   Schema version: ${stateStore.get().schemaVersion}`);
    console.log(`   Total sessions: ${stateStore.get().sessions.length}\n`);

    // WorktreeService 初期化
    const worktreeService = new WorktreeService({
        execPromise,
        rootPath: '/Users/ksato/workspace/.worktrees'
    });

    // SessionManager 初期化
    const sessionManager = new SessionManager({
        serverDir: path.join(__dirname, '..'),
        execPromise,
        stateStore,
        worktreeService
    });

    console.log('✅ SessionManager initialized\n');

    // クリーンアップ前の統計
    const stateBefore = stateStore.get();
    const pausedBefore = stateBefore.sessions.filter(s => s.intendedState === 'paused').length;
    const archivedBefore = stateBefore.sessions.filter(s => s.intendedState === 'archived').length;

    console.log('【クリーンアップ前】');
    console.log(`  Paused sessions: ${pausedBefore}`);
    console.log(`  Archived sessions: ${archivedBefore}\n`);

    // Phase 2: 24h TTL cleanup (paused sessions)
    console.log('▶ cleanupStalePausedSessions() 実行中...');
    await sessionManager.cleanupStalePausedSessions();

    // Phase 2: 30d TTL cleanup (archived sessions)
    console.log('▶ cleanupArchivedSessions() 実行中...');
    await sessionManager.cleanupArchivedSessions();

    // クリーンアップ後の統計
    const stateAfter = stateStore.get();
    const pausedAfter = stateAfter.sessions.filter(s => s.intendedState === 'paused').length;
    const archivedAfter = stateAfter.sessions.filter(s => s.intendedState === 'archived').length;

    console.log('\n【クリーンアップ後】');
    console.log(`  Paused sessions: ${pausedAfter} (${pausedBefore - pausedAfter} cleaned)`);
    console.log(`  Archived sessions: ${archivedAfter} (${archivedBefore - archivedAfter} deleted)\n`);

    console.log('✅ Phase 2 クリーンアップ完了');
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
