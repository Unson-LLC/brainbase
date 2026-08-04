import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import {
  assertSerializedPublicationContext,
  classifyOidcEndpoint
} from '../../scripts/npm-release.mjs';

describe('OSS npm release OIDC diagnostic acceptance', () => {
  function oidcToken(overrides = {}) {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
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

  it('AC-1 AC-2 AC-3 AC-5 AC-6 S-003 replays the activation contract through the runtime stop boundary', async () => {
    const workflow = await readFile(
      new URL('../../.github/workflows/npm-publish.yml', import.meta.url),
      'utf8'
    );
    const publishJob = workflow.slice(workflow.indexOf('  publish:'));
    expect(publishJob, 'ac-5 keeps activation out of the diagnostic implementation PR').not.toMatch(/BRAINBASE_NPM_OIDC_DIAGNOSTIC/u);
    expect(workflow, 'ac-5 never exposes diagnostic activation as a dispatch input').not.toMatch(/BRAINBASE_NPM_OIDC_DIAGNOSTIC:[\s\S]*github\.event\.inputs/u);

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

    expect(message, 'ac-6 keeps the release diagnostic deterministic').toBe(`GitHub Actions OIDC diagnostic ${JSON.stringify(expected)}`);
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

  it('AC-7 S-004 requires absence before initial publication and immutable evidence after it', async () => {
    const contract = JSON.parse(await readFile(
      new URL('../../docs/responsibility-authority/npm-publication.json', import.meta.url),
      'utf8'
    ));
    const publication = contract.responsibilities.find(
      (responsibility) => responsibility.id === 'brainbase_oss_npm_publication'
    );
    expect(publication.required_evidence, 'ac-7 requires phase-aware registry evidence').toContain('registry_state_verified_for_release_phase');
    expect(publication.unknown_policy).toMatch(/Before an initial publication, registry evidence must prove the target version is absent/u);
    expect(publication.unknown_policy).toMatch(/after publication, it must prove dist integrity and immutable gitHead/u);
  });
});
