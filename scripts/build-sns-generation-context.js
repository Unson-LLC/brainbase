#!/usr/bin/env node
// @ts-check

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { throwRetiredSnsCli } from './lib/retired-sns-cli.js';

async function main() {
    throwRetiredSnsCli('build-sns-generation-context.js');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
