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
const removedDocuments = [
  'docs/stories/otawara-gws-local-onboarding.md',
  'docs/specs/otawara-gws-local-onboarding-spec.md',
  'docs/architecture/otawara-gws-local-onboarding.md'
];
const customerDocumentId = 'otawara-gws-local-onboarding';
const customerHeadings = [
  '# Otawara Google Workspace Local Onboarding Plan',
  '# Otawara Google Workspace Local Onboarding Spec',
  '# Otawara Google Workspace Local Onboarding Architecture'
];
const canonicalRepository = 'cursorvers/brainbase-instance-cursorvers';

export function returnedCustomerDocuments(paths: string[]): string[] {
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

async function gitMarkdownFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files', '*.md'], { cwd: repoRoot });
  return stdout.split('\n').filter(Boolean);
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
  it('fails when the customer-specific onboarding document returns to the shared docs', () => {
    expect(returnedCustomerDocuments([
      'docs/stories/otawara-gws-local-onboarding.md',
      'docs/specs/otawara-gws-local-onboarding-spec.md',
      'docs/architecture/otawara-gws-local-onboarding.md',
      'docs/stories/notes/otawara-gws-local-onboarding.md'
    ])).toEqual([
      'docs/stories/otawara-gws-local-onboarding.md',
      'docs/specs/otawara-gws-local-onboarding-spec.md',
      'docs/architecture/otawara-gws-local-onboarding.md',
      'docs/stories/notes/otawara-gws-local-onboarding.md'
    ]);
    expect(returnedCustomerDocuments([
      'docs/stories/google-workspace-local-onboarding.md',
      'docs/stories/onboarding-source-import-extract.md'
    ])).toEqual([]);
  });

  it('keeps the otawara-gws-local-onboarding story, spec, and architecture out of the shared repo', async () => {
    for (const path of removedDocuments) {
      expect(await exists(path), `${path} should stay out of the shared repo`).toBe(false);
    }

    const present: string[] = [];
    for (const root of documentRoots) {
      present.push(...await filesUnder(root));
    }
    expect(returnedCustomerDocuments(present)).toEqual([]);

    for (const file of present) {
      const text = await readFile(join(repoRoot, file), 'utf8');
      for (const heading of customerHeadings) {
        expect(text, `${file} should not restore ${heading}`).not.toContain(heading);
      }
    }
  });

  it('records cursorvers/brainbase-instance-cursorvers as the canonical home', async () => {
    const ledger = JSON.parse(await readFile(join(repoRoot, ledgerPath), 'utf8'));
    const entry = ledger.documents.find((document: { id?: string }) => document.id === customerDocumentId);
    expect(entry?.canonical_repository).toBe(canonicalRepository);
    expect(entry?.canonical_home).toBe(canonicalRepository);
    expect(entry?.removed_paths).toEqual(removedDocuments);
    expect(entry?.content_verified).toBe(false);
  });

  it('points markdown links for the removed documents at the ledger or canonical repository', async () => {
    const files = (await gitMarkdownFiles())
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
