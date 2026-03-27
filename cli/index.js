#!/usr/bin/env node

import { login, status, logout } from './auth.js';
import {
    addExplicitLearn,
    applyPromotion,
    ingestReviewArtifacts,
    rejectLearningPromotion,
    runDailyLearning,
    showLearningInbox,
    showPromotion
} from './learning.js';
import { sync, pull, push, wikiStatus } from './sync.js';

const [,, command, subcommand, ...restArgs] = process.argv;

const HELP = `
brainbase CLI

Usage:
  brainbase auth login     Login to brainbase server
  brainbase auth status    Show authentication status
  brainbase auth logout    Clear saved credentials
  brainbase wiki sync      Bidirectional wiki sync
  brainbase wiki pull      Download wiki from server
  brainbase wiki push      Upload local wiki to server
  brainbase wiki status    Show sync diff (no changes)
  brainbase learn add      Record explicit learn and propose candidates
  brainbase learn ingest-reviews  Import verify-first review artifacts
  brainbase learn daily    Run daily review backfill + inbox summary
  brainbase learn inbox    Show pending manual candidates
  brainbase learn show ID  Show one candidate
  brainbase learn apply ID Apply one candidate
  brainbase learn reject ID [--reason TEXT] Reject one candidate
  brainbase help           Show this help
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
                        console.log('Usage: brainbase learn [add|ingest-reviews|daily|inbox|show|apply|reject]');
                }
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
