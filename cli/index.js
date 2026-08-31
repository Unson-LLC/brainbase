#!/usr/bin/env node

import { login, status, logout } from './auth.js';
import {
    addExplicitLearn,
    applyPromotion,
    dedupeExistingLearningPromotions,
    ingestReviewArtifacts,
    rejectLearningPromotion,
    runDailyLearning,
    showLearningInbox,
    showPromotion
} from './learning.js';
import { sync, pull, push, wikiStatus } from './sync.js';
import { runProjectProvisioning } from './project-provisioning.js';

const [,, command, subcommand, ...restArgs] = process.argv;

const HELP = `
brainbase CLI

Usage:
  brainbase auth login     Login to brainbase server
  brainbase auth status    Show authentication status
  brainbase auth logout    Clear saved credentials
  brainbase wiki sync      Read-only export (legacy alias)
  brainbase wiki pull      Export wiki from server
  brainbase wiki push      Refused: Wiki writes are retired
  brainbase wiki status    Show retirement/export diff
  brainbase learn add      明示した学びを記録し、知識候補を作成する
  brainbase learn ingest-reviews  検証レビューから知識候補を作成する
  brainbase learn daily    日次の候補収集と確認待ち一覧を更新する
  brainbase learn inbox    確認待ちの知識候補を表示する
  brainbase learn dedupe-existing  重複する確認待ち候補を統合する
  brainbase learn show ID  候補を1件表示する
  brainbase learn apply ID 候補を保存先に応じて正式登録・手順化する
  brainbase learn reject ID [--reason TEXT] 候補を今回は見送る
  brainbase project provision check --manifest FILE
  brainbase project provision plan --manifest FILE --idempotency-key KEY
  brainbase project provision approve RUN_ID --gates GATE,... --review-ref RECEIPT
  brainbase project provision apply|resume RUN_ID
  brainbase project provision status|verify RUN_ID
  brainbase help           このヘルプを表示する
`;

async function main() {
    try {
        switch (command) {
            case 'auth':
                switch (subcommand) {
                    case 'login': await login(); break;
                    case 'status': status(); break;
                    case 'logout': logout(); break;
                    default:
                        console.log('Usage: brainbase auth [login|status|logout]');
                }
                break;

            case 'wiki':
                switch (subcommand) {
                    case 'sync': await sync(); break;
                    case 'pull': await pull(); break;
                    case 'push': await push(); break;
                    case 'status': await wikiStatus(); break;
                    default:
                        console.log('Usage: brainbase wiki [sync|pull|push|status]');
                }
                break;

            case 'learn':
                switch (subcommand) {
                    case 'add': await addExplicitLearn(restArgs); break;
                    case 'ingest-reviews': await ingestReviewArtifacts(restArgs); break;
                    case 'daily': await runDailyLearning(restArgs); break;
                    case 'inbox': await showLearningInbox(); break;
                    case 'dedupe-existing': await dedupeExistingLearningPromotions(); break;
                    case 'show':
                        if (!restArgs[0]) {
                            throw new Error('Usage: brainbase learn show <candidate-id>');
                        }
                        await showPromotion(restArgs[0]);
                        break;
                    case 'apply':
                        if (!restArgs[0]) {
                            throw new Error('Usage: brainbase learn apply <candidate-id>');
                        }
                        await applyPromotion(restArgs[0]);
                        break;
                    case 'reject': {
                        const candidateId = restArgs[0];
                        if (!candidateId) {
                            throw new Error('Usage: brainbase learn reject <candidate-id> [--reason text]');
                        }
                        const reasonIndex = restArgs.indexOf('--reason');
                        const reason = reasonIndex >= 0 ? restArgs[reasonIndex + 1] || '' : '';
                        await rejectLearningPromotion(candidateId, reason);
                        break;
                    }
                    default:
                        console.log('Usage: brainbase learn [add|ingest-reviews|daily|inbox|dedupe-existing|show|apply|reject]');
                }
                break;

            case 'project':
                if (subcommand !== 'provision') {
                    throw new Error('Usage: brainbase project provision [check|plan|approve|apply|status|verify|resume]');
                }
                await runProjectProvisioning(restArgs[0], restArgs.slice(1));
                break;

            case 'help':
            case '--help':
            case '-h':
            case undefined:
                console.log(HELP);
                break;

            default:
                console.log(`Unknown command: ${command}`);
                console.log(HELP);
                process.exit(1);
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

main();
