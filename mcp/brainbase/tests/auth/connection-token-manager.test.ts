import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectionTokenManager } from '../../src/auth/token-manager.js';
import { authenticateProject } from '../../src/tools/authenticated-api-tool.js';

const jwt = (projectCodes: string[]) => `header.${Buffer.from(JSON.stringify({ projectCodes })).toString('base64url')}.signature`;
describe('connection authentication', () => {
  let directory: string;
  let tokenFile: string;
  let originalMode: string | undefined;
  let originalToken: string | undefined;
  const userToken = jwt(['brainbase', 'aitle']);
  const serviceToken = jwt(['brainbase']);
  beforeEach(async () => {
    originalMode = process.env.BRAINBASE_AUTH_MODE;
    originalToken = process.env.BRAINBASE_GRAPH_API_TOKEN;
    delete process.env.BRAINBASE_AUTH_MODE;
    process.env.BRAINBASE_GRAPH_API_TOKEN = serviceToken;
    directory = await mkdtemp(join(tmpdir(), 'brainbase-auth-'));
    tokenFile = join(directory, 'tokens.json');
    await writeFile(tokenFile, JSON.stringify({ access_token: userToken }));
  });
  afterEach(async () => {
    for (const [key, value] of [['BRAINBASE_AUTH_MODE', originalMode], ['BRAINBASE_GRAPH_API_TOKEN', originalToken]]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });
  it('interactive uses the saved user despite a coexisting service token', async () => {
    process.env.BRAINBASE_AUTH_MODE = 'interactive';
    const { tokenManager } = createConnectionTokenManager(undefined, tokenFile);
    assert.equal(await tokenManager.getToken(), userToken);
    const result = await authenticateProject({ project_code: 'aitle' }, { apiUrl: '', tokenManager });
    assert.deepEqual('scope' in result ? result.scope : undefined, ['brainbase', 'aitle']);
  });
  it('service remains restricted even when a broader user token is saved', async () => {
    process.env.BRAINBASE_AUTH_MODE = 'service';
    const { tokenManager } = createConnectionTokenManager(undefined, tokenFile);
    assert.equal(await tokenManager.getToken(), serviceToken);
    const result = await authenticateProject({ project_code: 'aitle' }, { apiUrl: '', tokenManager });
    assert.equal('error' in result && result.error?.code, 'brainbase_project_not_accessible');
  });
  it('service never falls back after its environment token disappears', async () => {
    const { mode, tokenManager } = createConnectionTokenManager(undefined, tokenFile);
    assert.equal(mode, 'service');
    delete process.env.BRAINBASE_GRAPH_API_TOKEN;
    await assert.rejects(tokenManager.getToken(), /requires BRAINBASE_GRAPH_API_TOKEN/);
  });
  it('explicit service without a token fails despite saved user credentials', async () => {
    process.env.BRAINBASE_AUTH_MODE = 'service';
    delete process.env.BRAINBASE_GRAPH_API_TOKEN;
    await assert.rejects(createConnectionTokenManager(undefined, tokenFile).tokenManager.getToken(), /requires BRAINBASE_GRAPH_API_TOKEN/);
  });
  it('implicit interactive stays interactive when an environment token appears', async () => {
    delete process.env.BRAINBASE_GRAPH_API_TOKEN;
    const { mode, tokenManager } = createConnectionTokenManager(undefined, tokenFile);
    assert.equal(mode, 'interactive');
    process.env.BRAINBASE_GRAPH_API_TOKEN = serviceToken;
    assert.equal(await tokenManager.getToken(), userToken);
  });
  it('configured scope still restricts interactive access', async () => {
    process.env.BRAINBASE_AUTH_MODE = 'interactive';
    const { tokenManager } = createConnectionTokenManager(undefined, tokenFile);
    const result = await authenticateProject({ project_code: 'aitle' }, { apiUrl: '', tokenManager, configuredProjectCodes: ['brainbase'] });
    assert.equal('error' in result && result.error?.code, 'brainbase_project_not_accessible');
  });
  it('rejects an invalid mode', () => {
    process.env.BRAINBASE_AUTH_MODE = 'invalid';
    assert.throws(() => createConnectionTokenManager(undefined, tokenFile), /must be interactive or service/);
  });
});
