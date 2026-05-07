import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const DEFAULT_BASE_REF = 'origin/develop';

export const GRAPHIFY_REQUIRED_PATTERNS = [
  /^server\/services\/session-core\//,
  /^server\/services\/session-activity-ws-service\.js$/,
  /^server\/controllers\/session\//,
  /^public\/modules\/session-indicators\.js$/,
  /^public\/modules\/session-ui-state\.js$/,
  /^public\/modules\/core\/session-activity-ws-client\.js$/,
  /^public\/modules\/ui\/views\/session-view\.js$/,
  /^public\/modules\/core\/store\.js$/,
  /^public\/modules\/core\/event-bus\.js$/,
  /^public\/modules\/terminal\//,
  /^server\/services\/terminal-/,
  /^scripts\/codex-pty-shim\.py$/,
  /^scripts\/codex-hooks-activity\.sh$/,
  /^\.claude\/scripts\/hooks\//,
];

const GRAPHIFY_EVIDENCE_HEADING = /(?:^|\n)#{0,6}\s*(?:VibePro\s+)?Graphify\s+Impact\s+Review\b/i;
const GRAPHIFY_COMMAND_EVIDENCE = /\b(?:vibepro\s+(?:graph|story\s+diagnose|story\s+derive)|graphify\s+(?:update|query|path|explain)|--run-graphify)\b/i;

export function normalizeChangedFiles(files = []) {
  return Array.from(new Set(
    files
      .map((file) => String(file || '').trim().replace(/^\.\//, ''))
      .filter(Boolean),
  )).sort();
}

export function requiresGraphifyImpactReview(filePath) {
  return GRAPHIFY_REQUIRED_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function getGraphifyRequiredFiles(files = []) {
  return normalizeChangedFiles(files).filter(requiresGraphifyImpactReview);
}

export function hasGraphifyImpactEvidence(body = '') {
  const text = String(body || '');
  return GRAPHIFY_EVIDENCE_HEADING.test(text) && GRAPHIFY_COMMAND_EVIDENCE.test(text);
}

export function checkGraphifyImpactGate({ changedFiles = [], prBody = '', bypass = false } = {}) {
  const requiredFiles = getGraphifyRequiredFiles(changedFiles);
  if (requiredFiles.length === 0) {
    return {
      status: 'passed',
      requiredFiles,
      reason: 'No graph-sensitive files changed.',
    };
  }

  if (bypass) {
    return {
      status: 'passed',
      requiredFiles,
      reason: 'Bypassed by VIBEPRO_GRAPHIFY_IMPACT_BYPASS=1.',
    };
  }

  if (hasGraphifyImpactEvidence(prBody)) {
    return {
      status: 'passed',
      requiredFiles,
      reason: 'PR body contains Graphify impact review evidence.',
    };
  }

  return {
    status: 'failed',
    requiredFiles,
    reason: [
      'Graph-sensitive files changed without a VibePro Graphify impact review.',
      'Add a PR body section titled "Graphify Impact Review" with the exact `vibepro graph --run-graphify` / `graphify query|path|explain` evidence used for the impact check.',
      'Runbook: docs/brainbase-capabilities/runbooks/vibepro-impact-review.md.',
      'Capability: docs/brainbase-capabilities/capabilities/vibepro.impact-review.yml.',
    ].join(' '),
  };
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function readChangedFilesFromGit(baseRef, headRef) {
  const range = headRef ? `${baseRef}...${headRef}` : baseRef;
  const output = runGit(['diff', '--name-only', range]);
  return output.split('\n').filter(Boolean);
}

function readPrBody() {
  if (process.env.PR_BODY) return process.env.PR_BODY;
  if (process.env.GITHUB_EVENT_PATH && fs.existsSync(process.env.GITHUB_EVENT_PATH)) {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    return event.pull_request?.body || '';
  }
  return '';
}

function parseArgs(argv) {
  const args = {
    base: process.env.BASE_REF || DEFAULT_BASE_REF,
    head: process.env.HEAD_REF || '',
    changedFiles: [],
    prBody: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base') args.base = argv[++index] || args.base;
    else if (arg === '--head') args.head = argv[++index] || args.head;
    else if (arg === '--changed-file') args.changedFiles.push(argv[++index] || '');
    else if (arg === '--pr-body') args.prBody = argv[++index] || '';
    else if (arg === '--json') args.json = true;
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const changedFiles = args.changedFiles.length > 0
    ? args.changedFiles
    : readChangedFilesFromGit(args.base, args.head);
  const result = checkGraphifyImpactGate({
    changedFiles,
    prBody: args.prBody ?? readPrBody(),
    bypass: process.env.VIBEPRO_GRAPHIFY_IMPACT_BYPASS === '1',
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.status === 'passed') {
    console.log(`VibePro Graphify impact gate passed: ${result.reason}`);
  } else {
    console.error(`VibePro Graphify impact gate failed: ${result.reason}`);
    console.error('Files requiring Graphify impact review:');
    for (const file of result.requiredFiles) console.error(`- ${file}`);
  }

  if (result.status !== 'passed') process.exitCode = 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
