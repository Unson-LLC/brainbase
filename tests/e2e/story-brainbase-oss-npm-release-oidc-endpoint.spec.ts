import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import {
  assertSerializedPublicationContext,
  classifyOidcEndpoint
} from '../../scripts/npm-release.mjs';

describe('OSS npm release OIDC diagnostic acceptance', () => {
  it('replays the fixed workflow diagnostic through the runtime stop boundary', async () => {
    const workflow = await readFile(
      new URL('../../.github/workflows/npm-publish.yml', import.meta.url),
      'utf8'
    );
    const publishJob = workflow.slice(workflow.indexOf('  publish:'));
    expect(publishJob).toMatch(/BRAINBASE_NPM_OIDC_DIAGNOSTIC: 'true'/u);
    expect(workflow).not.toMatch(/BRAINBASE_NPM_OIDC_DIAGNOSTIC:[\s\S]*github\.event\.inputs/u);

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

    expect(classifyOidcEndpoint(endpoint)).toEqual(expected);

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

    expect(message).toBe(`GitHub Actions OIDC diagnostic ${JSON.stringify(expected)}`);
    expect(request).not.toHaveBeenCalled();
    for (const sentinel of [
      'private-path',
      'query-sentinel',
      'user-sentinel',
      'password-sentinel',
      'token-sentinel'
    ]) {
      expect(message).not.toContain(sentinel);
    }
  });
});
