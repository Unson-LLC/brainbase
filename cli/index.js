#!/usr/bin/env node

import { login, status, logout } from './auth.js';
import { sync, pull, push } from './sync.js';

const [,, command, subcommand] = process.argv;

const HELP = `
brainbase CLI

Usage:
  brainbase auth login     Login to brainbase server
  brainbase auth status    Show authentication status
  brainbase auth logout    Clear saved credentials
  brainbase wiki sync      Bidirectional wiki sync
  brainbase wiki pull      Download wiki from server
  brainbase wiki push      Upload local wiki to server
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
                    default:
                        console.log('Usage: brainbase wiki [sync|pull|push]');
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
