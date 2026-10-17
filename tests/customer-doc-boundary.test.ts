import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const execFileAsync = promisify(execFile);
const ledgerPath = 'docs/management/customer-doc-ledger.json';
const documentRoots = ['docs/stories', 'docs/specs', 'docs/architecture'] as const;
const customerDocumentId = 'otawara-gws-local-onboarding';
const customerHeadings = [
  '# Otawara Google Workspace Local Onboarding Plan',
  '# Otawara Google Workspace Local Onboarding Spec',
  '# Otawara Google Workspace Local Onboarding Architecture'
];
const canonicalRepository = 'cursorvers/brainbase-instance-cursorvers';

type CustomerDocLedger = {
  documents: Array<{
    id?: string;
    removed_paths?: string[];
    relocated_to_generic_paths?: string[];
    canonical_repository?: string;
    canonical_home?: string;
    content_verified?: boolean;
  }>;
  forbidden_terms?: string[];
  forbidden_terms_case_insensitive?: boolean;
  body_scan?: {
    include_path_globs?: string[];
    exclude_paths?: string[];
    exclude_path_prefixes?: Array<{ prefix: string; reason?: string }>;
    allowed_substrings?: Array<{ term: string; paths: string[]; reason?: string }>;
  };
};

async function loadLedger(): Promise<CustomerDocLedger> {
  return JSON.parse(await readFile(join(repoRoot, ledgerPath), 'utf8')) as CustomerDocLedger;
}

function ledgerEntry(ledger: CustomerDocLedger) {
  const entry = ledger.documents.find((document) => document.id === customerDocumentId);
  if (!entry) {
    throw new Error(`missing ledger entry ${customerDocumentId}`);
  }
  return entry;
}

export function returnedCustomerDocuments(paths: string[], removedDocuments: string[]): string[] {
  return paths.filter((file) => (
    removedDocuments.includes(file)
    || (
      documentRoots.some((root) => file.startsWith(`${root}/`))
      && file.includes(customerDocumentId)
    )
  ));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(join(repoRoot, path), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(join(repoRoot, root), { recursive: true });
  return entries
    .map((entry) => relative(repoRoot, join(repoRoot, root, entry.toString())).split('\\').join('/'))
    .filter((file) => file.endsWith('.md'));
}

async function gitTrackedFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024 });
  return stdout.split('\0').filter(Boolean);
}

function pathExcludedFromBodyScan(
  file: string,
  bodyScan: NonNullable<CustomerDocLedger['body_scan']>
): boolean {
  if (bodyScan.exclude_paths?.includes(file)) {
    return true;
  }
  for (const entry of bodyScan.exclude_path_prefixes ?? []) {
    if (file.startsWith(entry.prefix)) {
      return true;
    }
  }
  return false;
}

export function globPatternToRegExp(pattern: string): RegExp {
  if (!pattern || pattern.includes('{') || pattern.includes('[')) {
    throw new Error(`Unsupported include_path_glob pattern: ${pattern}`);
  }
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    if ('\\.+^${}()|[]'.includes(char)) {
      source += `\\${char}`;
      continue;
    }
    source += char;
  }
  source += '$';
  return new RegExp(source);
}

export function matchesIncludeGlob(file: string, pattern: string): boolean {
  return globPatternToRegExp(pattern).test(file);
}

function pathIncludedInBodyScan(
  file: string,
  includeGlobs: string[]
): boolean {
  return includeGlobs.some((pattern) => matchesIncludeGlob(file, pattern));
}

function termAllowedInFile(
  file: string,
  term: string,
  allowed: NonNullable<CustomerDocLedger['body_scan']>['allowed_substrings']
): boolean {
  const normalizedTerm = term.toLowerCase();
  for (const entry of allowed ?? []) {
    if (entry.term.toLowerCase() !== normalizedTerm) {
      continue;
    }
    if (entry.paths.includes(file)) {
      return true;
    }
  }
  return false;
}

export function findForbiddenTermViolations(
  files: Array<{ path: string; text: string }>,
  ledger: CustomerDocLedger
): string[] {
  const terms = ledger.forbidden_terms ?? [];
  const caseInsensitive = ledger.forbidden_terms_case_insensitive ?? true;
  const violations: string[] = [];

  for (const { path, text } of files) {
    const haystack = caseInsensitive ? text.toLowerCase() : text;
    for (const term of terms) {
      const needle = caseInsensitive ? term.toLowerCase() : term;
      if (!haystack.includes(needle)) {
        continue;
      }
      if (termAllowedInFile(path, term, ledger.body_scan?.allowed_substrings)) {
        continue;
      }
      violations.push(`${path}: contains forbidden term "${term}"`);
    }
  }

  return violations.sort();
}

async function bodyScanTargets(ledger: CustomerDocLedger): Promise<Array<{ path: string; text: string }>> {
  const bodyScan = ledger.body_scan;
  if (!bodyScan?.include_path_globs?.length) {
    return [];
  }

  const tracked = await gitTrackedFiles();
  const targets = tracked.filter((file) => (
    pathIncludedInBodyScan(file, bodyScan.include_path_globs!)
    && !pathExcludedFromBodyScan(file, bodyScan)
  ));

  return Promise.all(targets.map(async (path) => ({
    path,
    text: await readFile(join(repoRoot, path), 'utf8')
  })));
}

function markdownLinkTargets(text: string): string[] {
  return [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => match[1]);
}

function linkPointsAtCanonicalReference(href: string): boolean {
  const target = href.split('#')[0];
  return target.endsWith(ledgerPath)
    || target.includes(canonicalRepository)
    || target.includes('customer-doc-ledger.json');
}

describe('otawara customer document boundary', () => {
  it('fails when the customer-specific onboarding document returns to the shared docs', async () => {
    const ledger = await loadLedger();
    const removedDocuments = ledgerEntry(ledger).removed_paths ?? [];
    expect(returnedCustomerDocuments([
      'docs/stories/otawara-gws-local-onboarding.md',
      'docs/specs/otawara-gws-local-onboarding-spec.md',
      'docs/architecture/otawara-gws-local-onboarding.md',
      'docs/stories/notes/otawara-gws-local-onboarding.md'
    ], removedDocuments)).toEqual([
      'docs/stories/otawara-gws-local-onboarding.md',
      'docs/specs/otawara-gws-local-onboarding-spec.md',
      'docs/architecture/otawara-gws-local-onboarding.md',
      'docs/stories/notes/otawara-gws-local-onboarding.md'
    ]);
    expect(returnedCustomerDocuments([
      'docs/stories/google-workspace-local-onboarding.md',
      'docs/stories/onboarding-source-import-extract.md'
    ], removedDocuments)).toEqual([]);
  });

  it('keeps the otawara-gws-local-onboarding story, spec, and architecture out of the shared repo', async () => {
    const ledger = await loadLedger();
    const removedDocuments = ledgerEntry(ledger).removed_paths ?? [];

    for (const path of removedDocuments) {
      expect(await exists(path), `${path} should stay out of the shared repo`).toBe(false);
    }

    const present: string[] = [];
    for (const root of documentRoots) {
      present.push(...await filesUnder(root));
    }
    expect(returnedCustomerDocuments(present, removedDocuments)).toEqual([]);

    for (const file of present) {
      const text = await readFile(join(repoRoot, file), 'utf8');
      for (const heading of customerHeadings) {
        expect(text, `${file} should not restore ${heading}`).not.toContain(heading);
      }
    }
  });

  it('keeps shared generic google-workspace-local-onboarding docs in place', async () => {
    const ledger = await loadLedger();
    const genericPaths = ledgerEntry(ledger).relocated_to_generic_paths ?? [];
    expect(genericPaths.length).toBeGreaterThan(0);
    for (const path of genericPaths) {
      expect(await exists(path), `${path} should remain as the shared generic design doc`).toBe(true);
    }
  });

  it('matches ledger include_path_glob patterns with a general glob matcher', async () => {
    const ledger = await loadLedger();
    for (const pattern of ledger.body_scan?.include_path_globs ?? []) {
      expect(() => globPatternToRegExp(pattern)).not.toThrow();
    }
    expect(matchesIncludeGlob('README.md', 'README.md')).toBe(true);
    expect(matchesIncludeGlob('docs/stories/foo.md', 'docs/**/*.md')).toBe(true);
    expect(matchesIncludeGlob('tests/import-extract.test.ts', 'tests/**')).toBe(true);
    expect(() => globPatternToRegExp('docs/{bad}.md')).toThrow(/Unsupported include_path_glob/);
  });

  it('detects forbidden terms in a sample body', async () => {
    const ledger = await loadLedger();
    const violations = findForbiddenTermViolations([
      { path: 'docs/stories/example.md', text: 'Contact Masayuki Otawara for access.' }
    ], ledger);
    expect(violations.some((line) => line.includes('Masayuki Otawara'))).toBe(true);
    expect(findForbiddenTermViolations([
      { path: 'docs/stories/example.md', text: 'Generic adopter onboarding only.' }
    ], ledger)).toEqual([]);
  });

  it('scans tracked bodies from the ledger for forbidden customer identifiers', async () => {
    const ledger = await loadLedger();
    expect(ledger.forbidden_terms?.length).toBeGreaterThan(0);

    const files = await bodyScanTargets(ledger);
    expect(files.length).toBeGreaterThan(0);

    const violations = findForbiddenTermViolations(files, ledger);
    expect(violations).toEqual([]);
  });

  it('records cursorvers/brainbase-instance-cursorvers as the canonical home', async () => {
    const ledger = await loadLedger();
    const entry = ledgerEntry(ledger);
    expect(entry.canonical_repository).toBe(canonicalRepository);
    expect(entry.canonical_home).toBe(canonicalRepository);
    expect(entry.removed_paths).toEqual([
      'docs/stories/otawara-gws-local-onboarding.md',
      'docs/specs/otawara-gws-local-onboarding-spec.md',
      'docs/architecture/otawara-gws-local-onboarding.md'
    ]);
    expect(entry.relocated_to_generic_paths).toEqual([
      'docs/stories/google-workspace-local-onboarding.md',
      'docs/specs/google-workspace-local-onboarding-spec.md',
      'docs/architecture/google-workspace-local-onboarding.md'
    ]);
    expect(entry.content_verified).toBe(false);
  });

  it('points markdown links for the removed documents at the ledger or canonical repository', async () => {
    const files = (await gitTrackedFiles())
      .filter((file) => file.endsWith('.md'))
      .filter((file) => !file.startsWith('docs/management/audit-artifacts/'));
    const stale: string[] = [];
    for (const file of files) {
      const text = await readFile(join(repoRoot, file), 'utf8');
      for (const href of markdownLinkTargets(text)) {
        if (href.includes(customerDocumentId) && !linkPointsAtCanonicalReference(href)) {
          stale.push(`${file} -> ${href}`);
        }
      }
    }
    expect(stale).toEqual([]);
  });
});
