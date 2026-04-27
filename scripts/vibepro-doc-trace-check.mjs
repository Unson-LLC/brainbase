import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const VIBEPRO_RUN_PREFIX = 'docs/internal/vibepro-dogfood/runs/';

export const VIBEPRO_TRACE_DOCS = new Set([
  'docs/stories/vibepro-brainbase-dogfood-story.md',
  'docs/architecture/vibepro-brainbase-dogfood-architecture.md',
  'docs/specs/vibepro-brainbase-self-evaluation-spec.md',
]);

function readGit(args, cwd = process.cwd()) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function normalizeChangedFiles(files) {
  return [...new Set((files ?? [])
    .map((file) => String(file || '').trim())
    .filter(Boolean)
    .map((file) => file.replace(/^"|"$/g, '')))];
}

function parsePorcelainPath(line) {
  if (!line) return '';
  const rawPath = line.slice(3).trim();
  const normalizedPath = rawPath.includes(' -> ')
    ? rawPath.split(' -> ').at(-1)
    : rawPath;
  return normalizedPath?.replace(/^"|"$/g, '') ?? '';
}

function readWorkingTreeChangedFiles(cwd) {
  return normalizeChangedFiles(
    readGit(['status', '--porcelain=v1'], cwd)
      .split('\n')
      .map(parsePorcelainPath),
  );
}

function isAllZeroSha(value) {
  return Boolean(value) && /^0+$/.test(value);
}

export function validateVibeProDocTrace(changedFiles) {
  const files = normalizeChangedFiles(changedFiles);
  const runEvidenceFiles = files.filter((file) => file.startsWith(VIBEPRO_RUN_PREFIX));
  const traceDocs = files.filter((file) => VIBEPRO_TRACE_DOCS.has(file));

  const result = {
    status: 'passed',
    checked_files: files,
    run_evidence_files: runEvidenceFiles,
    trace_docs: traceDocs,
    failures: [],
  };

  if (runEvidenceFiles.length === 0) {
    return result;
  }

  if (traceDocs.length === 0) {
    result.status = 'failed';
    result.failures.push('vibepro_run_without_story_architecture_spec_trace_update');
  }

  return result;
}

export function collectChangedFilesForDocTrace(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  if (options.changedFiles) {
    return normalizeChangedFiles(options.changedFiles);
  }

  const env = options.env ?? process.env;
  if (env.VIBEPRO_TRACE_CHANGED_FILES) {
    return normalizeChangedFiles(env.VIBEPRO_TRACE_CHANGED_FILES.split(/\r?\n/));
  }

  if (env.GITHUB_EVENT_NAME === 'schedule' || env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    return [];
  }

  const baseRef = options.baseRef ?? env.VIBEPRO_TRACE_BASE_REF
    ?? (env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : null);
  const beforeSha = options.beforeSha ?? env.GITHUB_EVENT_BEFORE ?? null;

  if (baseRef) {
    return normalizeChangedFiles([
      ...readGit(['diff', '--name-only', `${baseRef}...HEAD`], cwd).split('\n'),
      ...readWorkingTreeChangedFiles(cwd),
    ]);
  }

  if (beforeSha && !isAllZeroSha(beforeSha)) {
    return normalizeChangedFiles([
      ...readGit(['diff', '--name-only', `${beforeSha}...HEAD`], cwd).split('\n'),
      ...readWorkingTreeChangedFiles(cwd),
    ]);
  }

  return normalizeChangedFiles([
    ...readGit(['diff', '--name-only', 'HEAD~1...HEAD'], cwd).split('\n'),
    ...readWorkingTreeChangedFiles(cwd),
  ]);
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const changedFiles = collectChangedFilesForDocTrace();
  const result = validateVibeProDocTrace(changedFiles);
  printResult(result);
  if (result.status !== 'passed') {
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (entrypoint) {
  await main();
}
