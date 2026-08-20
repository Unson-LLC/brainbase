import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import {
  assertSerializedPublicationContext,
  classifyOidcEndpoint
} from '../../scripts/npm-release.mjs';

describe('OSS npm release OIDC endpoint correction acceptance', () => {
  function oidcToken(overrides = {}) {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://token.actions.githubusercontent.com',
      aud: 'brainbase-npm-publish',
      repository: 'Unson-LLC/brainbase',
      run_id: '123',
      workflow_ref: 'Unson-LLC/brainbase/.github/workflows/npm-publish.yml@refs/heads/develop',
      ref: 'refs/heads/develop',
      ...overrides
    })).toString('base64url');
    return `${header}.${payload}.test-signature`;
  }

  const publicationContext = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'Unson-LLC/brainbase',
    GITHUB_RUN_ID: '123',
    BRAINBASE_NPM_PUBLISH_SERIALIZED: 'true',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/token',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-issued-request-token'
  };

  // story-brainbase-oss-npm-release-oidc-endpoint ac:1 ac:2 ac:3 executable diagnostic boundary coverage
  it('AC-1 AC-2 AC-3 S-003 replays the evidence-bound diagnostic through the runtime stop boundary', async () => {
    const endpoint = 'https://user-sentinel:password-sentinel@pipelinesghubeus4.actions.githubusercontent.com:8443/private-path?secret=query-sentinel';
    const request = vi.fn();
    const expected = {
      url_present: true,
      parse_ok: true,
      protocol_https: true,
      hostname_trusted: true,
      raw_authority_colon: true,
      userinfo_present: true,
      normalized_nondefault_port: true
    };

    expect(classifyOidcEndpoint(endpoint), 'ac-1 emits the fixed boolean classification').toEqual(expected);

    let message = '';
    try {
      await assertSerializedPublicationContext({
        BRAINBASE_NPM_OIDC_DIAGNOSTIC: 'true',
        ACTIONS_ID_TOKEN_REQUEST_URL: endpoint,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'token-sentinel'
      }, request);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message, 'ac-1 keeps the release diagnostic deterministic').toBe(`GitHub Actions OIDC diagnostic ${JSON.stringify(expected)}`);
    expect(request, 'ac-3 stops before the OIDC token request').not.toHaveBeenCalled();
    for (const sentinel of [
      'private-path',
      'query-sentinel',
      'user-sentinel',
      'password-sentinel',
      'token-sentinel'
    ]) {
      expect(message, 'ac-2 excludes endpoint and credential values').not.toContain(sentinel);
    }
  });

  // story-brainbase-oss-npm-release-oidc-endpoint ac:4 executable authorization boundary coverage
  it('AC-4 preserves the normal authorization and exact workflow claims', async () => {
    const acceptedRequest = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: oidcToken() })
    });
    await expect(assertSerializedPublicationContext(
      publicationContext,
      acceptedRequest
    ), 'ac-4 preserves accepted publication context').resolves.toBeUndefined();
    expect(acceptedRequest).toHaveBeenCalledOnce();

    const wrongClaimsRequest = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: oidcToken({ ref: 'refs/heads/unreviewed' }) })
    });
    await expect(assertSerializedPublicationContext(
      publicationContext,
      wrongClaimsRequest
    ), 'ac-4 preserves rejected claim mismatches').rejects.toThrow(/OIDC claims do not match/u);
  });

  // story-brainbase-oss-npm-release-oidc-endpoint ac:5 executable issuer coverage
  it('AC-5 rejects a token whose issuer is not the official GitHub Actions issuer', async () => {
    const wrongIssuerRequest = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: oidcToken({ iss: 'https://issuer.attacker.example' }) })
    });
    await expect(assertSerializedPublicationContext(
      publicationContext,
      wrongIssuerRequest
    ), 'ac-5 binds the token issuer to GitHub Actions').rejects.toThrow(/OIDC claims do not match/u);
  });

  // story-brainbase-oss-npm-release-oidc-endpoint ac:6 executable workflow activation coverage
  it('AC-6 removes the diagnostic stop and pins a trusted-publishing capable npm CLI', async () => {
    const acceptanceCriterion = 'workflowはnpm 11.5.1を使用し診断固定フラグを除去する';
    const workflow = await readFile(
      new URL('../../.github/workflows/npm-publish.yml', import.meta.url),
      'utf8'
    );
    const publishJob = workflow.slice(workflow.indexOf('  publish:'));
    expect(acceptanceCriterion, 'ac-6 binds the executable assertions to the Story criterion').toContain('npm 11.5.1');
    expect(publishJob, 'ac-6 removes the temporary diagnostic stop from the publish job').not.toMatch(/BRAINBASE_NPM_OIDC_DIAGNOSTIC/u);
    expect(publishJob, 'ac-6 installs a trusted-publishing capable npm CLI').toMatch(/npm install --global npm@11\.5\.1/u);
  });

  // story-brainbase-oss-npm-release-oidc-endpoint ac:4 executable endpoint allow-and-deny coverage
  it('AC-4 accepts the observed GitHub-hosted endpoint class and rejects suffix lookalikes', async () => {
    const acceptedRequest = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: oidcToken() })
    });
    await expect(assertSerializedPublicationContext({
      ...publicationContext,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://acghubeus2.actions.githubusercontent.com/token'
    }, acceptedRequest), 'ac-4 accepts a single GitHub-controlled hostname label').resolves.toBeUndefined();

    const rejectedRequest = vi.fn();
    await expect(assertSerializedPublicationContext({
      ...publicationContext,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://acghubeus2.actions.githubusercontent.com.attacker.example/token'
    }, rejectedRequest), 'ac-4 rejects a suffix-lookalike hostname').rejects.toThrow(/OIDC endpoint is not trusted/u);
    expect(rejectedRequest).not.toHaveBeenCalled();

    const userinfoRequest = vi.fn();
    await expect(assertSerializedPublicationContext({
      ...publicationContext,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://runner:secret@acghubeus2.actions.githubusercontent.com/token'
    }, userinfoRequest), 'ac-4 rejects endpoint userinfo').rejects.toThrow(/OIDC endpoint is not trusted/u);
    expect(userinfoRequest).not.toHaveBeenCalled();

    const explicitPortRequest = vi.fn();
    await expect(assertSerializedPublicationContext({
      ...publicationContext,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://acghubeus2.actions.githubusercontent.com:8443/token'
    }, explicitPortRequest), 'ac-4 rejects an explicit port').rejects.toThrow(/OIDC endpoint is not trusted/u);
    expect(explicitPortRequest).not.toHaveBeenCalled();
  });

  it('S-003 rejects a malformed endpoint before any token request', async () => {
    const request = vi.fn();
    const classification = classifyOidcEndpoint('malformed-path-sentinel?secret=query-sentinel');
    expect(classification).toMatchObject({
      url_present: true,
      parse_ok: false,
      protocol_https: false,
      hostname_trusted: false
    });
    await expect(assertSerializedPublicationContext({
      BRAINBASE_NPM_OIDC_DIAGNOSTIC: 'true',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'malformed-path-sentinel?secret=query-sentinel',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'token-sentinel'
    }, request)).rejects.toThrow(/"parse_ok":false/u);
    expect(request).not.toHaveBeenCalled();
  });

  // story-brainbase-oss-npm-release-oidc-endpoint ac:7 executable validation-lane coverage
  it('AC-7 keeps every focused release validation command executable', async () => {
    const packageJson = JSON.parse(await readFile(
      new URL('../../package.json', import.meta.url),
      'utf8'
    ));
    expect(packageJson.scripts.test, 'ac-7 keeps the unit and workflow suite outside release-only evidence').toBe(
      'vitest run --exclude tests/npm-prepublication-evidence.integration.test.ts'
    );
    expect(packageJson.scripts['test:integration'], 'ac-7 keeps release integration validation').toContain('tests/npm-release-validation.integration.test.ts');
    expect(packageJson.scripts['test:integration:release-evidence'], 'ac-7 keeps prepublication evidence explicit').toContain(
      'tests/npm-prepublication-evidence.integration.test.ts'
    );
    expect(packageJson.scripts['test:e2e'], 'ac-7 keeps the E2E runner available for the focused Story file').toMatch(/^vitest run /u);
    expect(packageJson.scripts.build, 'ac-7 keeps the TypeScript build validation').toBe('tsc -p tsconfig.json');
  });

  // story-brainbase-oss-npm-release-oidc-endpoint ac:8 executable phase-aware registry contract coverage
  it('AC-8 S-004 requires absence before initial publication and immutable evidence after it', async () => {
    const contract = JSON.parse(await readFile(
      new URL('../../docs/responsibility-authority/npm-publication.json', import.meta.url),
      'utf8'
    ));
    const publication = contract.responsibilities.find(
      (responsibility) => responsibility.id === 'brainbase_oss_npm_publication'
    );
    expect(publication.required_evidence, 'ac-8 requires phase-aware registry evidence').toContain('registry_state_verified_for_release_phase');
    expect(publication.unknown_policy, 'ac-8 requires target-version absence before initial publication').toMatch(/Before an initial publication, registry evidence must prove the target version is absent/u);
    expect(publication.unknown_policy, 'ac-8 requires dist integrity and immutable gitHead after publication').toMatch(/after publication, it must prove dist integrity and immutable gitHead/u);
  });

  it('AC-8 keeps the maintainer runbook aligned with the enabled publication path', async () => {
    const readme = await readFile(
      new URL('../../README.md', import.meta.url),
      'utf8'
    );
    const releaseOperation = readme.slice(readme.indexOf('### Maintainer release operation'));
    expect(releaseOperation, 'ac-8 removes the retired diagnostic-only operation').not.toMatch(/BRAINBASE_NPM_OIDC_DIAGNOSTIC/u);
    expect(releaseOperation, 'ac-8 requires one evidence-bound dispatch').toMatch(/Dispatch the reviewed ref once/u);
    expect(releaseOperation, 'ac-8 requires registry verification').toMatch(/`gitHead`, `dist\.integrity`, and dist-tag/u);
    expect(releaseOperation, 'ac-8 requires GitHub Release target verification').toMatch(/GitHub Release targets the reviewed release commit/u);
    expect(releaseOperation, 'ac-8 preserves immutable-version recovery').toMatch(/treat that version as immutable/u);
  });
});
