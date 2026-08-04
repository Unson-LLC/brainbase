import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('npm publish workflow', () => {
  it('binds validation and publish to the merged commit', async () => {
    const workflow = await readFile(new URL('../.github/workflows/npm-publish.yml', import.meta.url), 'utf8');
    const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(workflow).toMatch(/pull_request_target:/u);
    expect(workflow).toMatch(/github\.event\.pull_request\.merge_commit_sha/u);
    expect(workflow).toMatch(/git checkout --detach/u);
    expect(workflow).toMatch(/--trusted-ref origin\/develop/u);
    expect(workflow).toMatch(/NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/u);
    expect(workflow).toMatch(/--provenance/u);
    expect(packageManifest.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/Unson-LLC/brainbase.git'
    });
    const validationJob = workflow.slice(workflow.indexOf('  validate:'), workflow.indexOf('  publish:'));
    const publishJob = workflow.slice(workflow.indexOf('  publish:'));
    expect(validationJob).toMatch(/contents: read/u);
    expect(validationJob).toMatch(/npm-release\.mjs validate/u);
    expect(validationJob).toMatch(/actions\/upload-artifact@v4/u);
    expect(validationJob).not.toMatch(/id-token: write/u);
    expect(validationJob).not.toMatch(/NODE_AUTH_TOKEN/u);
    expect(publishJob).toMatch(/needs: validate/u);
    expect(publishJob).toMatch(/id-token: write/u);
    expect(publishJob).toMatch(/actions\/download-artifact@v4/u);
    expect(publishJob).toMatch(/--tarball-file/u);
    expect(publishJob).toMatch(/node scripts\/npm-release\.mjs publish/u);
    expect(publishJob).toMatch(/BRAINBASE_NPM_PUBLISH_SERIALIZED: 'true'/u);
    expect(publishJob).toMatch(/id-token: write/u);
    expect(publishJob).not.toMatch(/npm run release:publish/u);
  });

  it('supports manual recovery and creates a release only after npm publish', async () => {
    const workflow = await readFile(new URL('../.github/workflows/npm-publish.yml', import.meta.url), 'utf8');
    expect(workflow).toMatch(/workflow_dispatch:/u);
    expect(workflow).toMatch(/release_ref:/u);
    expect(workflow).toMatch(/git merge-base --is-ancestor "\$RELEASE_SHA" origin\/develop/u);
    expect(workflow).toMatch(/test "\$PACKAGE_NAME" = "@unson\/brainbase-mcp"/u);
    expect(workflow.indexOf('npm-release.mjs publish')).toBeLessThan(workflow.indexOf('gh release'));
    expect(workflow).toMatch(/git rev-parse -q --verify "refs\/tags\/v\$\{VERSION\}\^\{commit\}"/u);
    expect(workflow).toMatch(/test "\$TAG_SHA" = "\$RELEASE_SHA"/u);
  });

  it('keeps OIDC unavailable until validation has produced the immutable artifact', async () => {
    const workflow = await readFile(new URL('../.github/workflows/npm-publish.yml', import.meta.url), 'utf8');
    expect(workflow).toMatch(/permissions: \{\}/u);
    expect(workflow).toMatch(/publish:\n    needs: validate/u);
    expect(workflow).toMatch(/if: \$\{\{ needs\.validate\.outputs\.release_required == 'true' \}\}/u);
    expect(workflow).toMatch(/npm-release-\$\{\{ steps\.target\.outputs\.sha \}\}/u);
    expect(workflow).toMatch(/npm-release-\$\{\{ needs\.validate\.outputs\.sha \}\}/u);
  });

  it('serializes every publication attempt for the package', async () => {
    const workflow = await readFile(new URL('../.github/workflows/npm-publish.yml', import.meta.url), 'utf8');
    expect(workflow).toMatch(/concurrency:\n  group: npm-publish-unson-brainbase-mcp\n  cancel-in-progress: false/u);
    const concurrency = workflow.slice(workflow.indexOf('concurrency:'), workflow.indexOf('permissions: {}'));
    expect(concurrency).not.toMatch(/pull_request|release_ref|github\.event/u);
  });

  it('documents CLI recovery through the serialized workflow', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    const operation = readme.slice(readme.indexOf('### Maintainer release operation'));
    expect(operation).toMatch(/gh workflow run npm-publish\.yml/u);
    expect(operation).toMatch(/--ref develop/u);
    expect(operation).toMatch(/-f release_ref="\$RELEASE_REF"/u);
    expect(operation).not.toMatch(/NODE_AUTH_TOKEN="\$NPM_TOKEN" node scripts\/npm-release\.mjs publish/u);
    expect(operation).toMatch(/Direct local `release:publish` is rejected/u);
  });
});
