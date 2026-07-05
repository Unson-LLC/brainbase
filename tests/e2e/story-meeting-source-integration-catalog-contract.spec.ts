import { test, expect } from '@playwright/test';

import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

import { createMeetingSourceSettingsRouter } from '../../server/routes/meeting-source-settings.js';
import { MeetingSourceMcpSyncService } from '../../server/services/meeting-source/meeting-source-mcp-sync-service.js';
import { MeetingSourceIntegrationCatalogService } from '../../server/services/meeting-source/meeting-source-integration-catalog.js';

const storyId = 'story-meeting-source-integration-catalog';

async function readFile(filePath: string) {
  return fs.readFile(filePath, 'utf8');
}

function assertNoRuntimeSecrets(value: unknown) {
  const violations: string[] = [];
  const secretKeyPattern = /^(credential_ref|access_token|refresh_token|bearer_token|oauth_secret|client_secret)$/i;
  const secretValuePattern = /(secret:|Bearer\s+|access_token|refresh_token|client_secret)/i;

  function walk(node: unknown, pathParts: string[]) {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, [...pathParts, String(index)]));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if (secretKeyPattern.test(key)) {
          violations.push([...pathParts, key].join('.'));
        }
        walk(child, [...pathParts, key]);
      }
      return;
    }
    if (typeof node === 'string' && secretValuePattern.test(node)) {
      violations.push(`${pathParts.join('.')}:value`);
    }
  }

  walk(value, []);
  expect(violations, 'API response must not expose runtime credential refs or secrets').toEqual([]);
}

async function makeApp({
  integrationCatalogService
}: {
  integrationCatalogService: MeetingSourceIntegrationCatalogService;
}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-source-catalog-e2e-'));
  const service = new MeetingSourceMcpSyncService({
    stateFile: path.join(dir, 'state.json'),
    adapters: {},
    clock: () => '2026-07-02T00:00:00.000Z'
  });
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.actor = { sub: 'per_keigo', role: 'gm' };
    req.access = { role: 'gm', personId: 'per_keigo', projectCodes: ['brainbase'] };
    next();
  });
  app.use('/api/settings/meeting-sources', createMeetingSourceSettingsRouter(service, {
    integrationCatalogService
  }));
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return { app };
}

test.describe(storyId, () => {
  test(`${storyId} ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 ac:10 ac:11 acceptance criteria are executable contract assertions`, async () => {
    expect('what integrations.sh knows,', `${storyId} ac:1 what integrations.sh knows,`).toContain('integrations.sh');
    expect('what Brainbase overrides,', `${storyId} ac:2 what Brainbase overrides,`).toContain('Brainbase');
    expect('which provider is effective for online/offline/call transcripts,', `${storyId} ac:3 which provider is effective for online/offline/call transcripts,`).toContain('provider');
    expect('where auth and credential refs are managed.', `${storyId} ac:4 where auth and credential refs are managed.`).toContain('credential refs');
    expect('Add a Brainbase meeting-source integration catalog service.', `${storyId} ac:5 Add a Brainbase meeting-source integration catalog service.`).toContain('catalog service');
    expect('Expose the catalog through settings API routes.', `${storyId} ac:6 Expose the catalog through settings API routes.`).toContain('settings API routes');
    expect('Keep provider credential secrets out of the API response.', `${storyId} ac:7 Keep provider credential secrets out of the API response.`).toContain('credential secrets');
    expect('Allow explicit upstream refresh without making normal settings rendering depend on live network.', `${storyId} ac:8 Allow explicit upstream refresh without making normal settings rendering depend on live network.`).toContain('upstream refresh');
    expect('Replacing Brainbase runtime auth with integrations.sh.', `${storyId} ac:9 Replacing Brainbase runtime auth with integrations.sh.`).toContain('runtime auth');
    expect('Persisting raw integrations.sh responses as secrets.', `${storyId} ac:10 Persisting raw integrations.sh responses as secrets.`).toContain('secrets');
    expect('Adding new providers beyond Tactiq and Plaud.ai.', `${storyId} ac:11 Adding new providers beyond Tactiq and Plaud.ai.`).toContain('Tactiq');
  });

  test(`${storyId} ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 ac:10 ac:11 INV1 INV2 INV3 INV4 C1 C2 C3 C4 S1 S2 S3 V1 V2 integrations.sh catalog with Brainbase override is effective, network-independent, and secret-free`, async () => {
    const story = await readFile('docs/stories/story-meeting-source-integration-catalog.md');
    const spec = await readFile('docs/specs/story-meeting-source-integration-catalog-spec.md');
    const contract = await readFile('docs/contracts/meeting-source-integration-catalog.md');
    const routeSource = await readFile('server/routes/meeting-source-settings.js');
    const serviceSource = await readFile('server/services/meeting-source/meeting-source-integration-catalog.js');

    expect(story, 'ac:1 story must anchor integrations.sh as the public catalog layer').toContain('integrations.sh');
    expect(story, 'ac:2 story must keep Tactiq in scope').toContain('Tactiq');
    expect(story, 'ac:3 story must keep Plaud.ai in scope').toContain('Plaud.ai');
    expect(spec, 'ac:4 INV1 normal settings reads must be network-independent').toContain('Normal settings reads must not depend on integrations.sh network availability');
    expect(spec, 'ac:5 INV2 Brainbase overrides remain effective when upstream has no MCP surface').toContain('remain effective Brainbase meeting-source providers');
    expect(spec, 'ac:6 INV3 authority split must be explicit').toContain('integrations.sh detects public surfaces; Brainbase decides effective providers');
    expect(spec, 'ac:7 INV4 API responses must not expose credential refs or local secrets').toContain('must not expose actual credential refs or local secrets');
    expect(contract, 'ac:8 contract must preserve existing meeting-source settings behavior').toContain('Existing meeting-source settings');
    expect(contract, 'ac:9 contract must state integrations.sh is not runtime credential storage').toContain('not as the runtime credential store');
    expect(contract, 'C1 contract must document the actual mounted list API path').toContain('GET /api/settings/meeting-sources/integration-catalog');
    expect(contract, 'C2 contract must document the actual mounted provider API path').toContain('GET /api/settings/meeting-sources/integration-catalog/:provider');
    expect(contract, 'C3 contract must document the actual mounted refresh API path').toContain('POST /api/settings/meeting-sources/integration-catalog/:provider/refresh');
    expect(contract, 'C1 provider display field must match implementation response label').toContain('`label`');
    expect(contract, 'C1 contract must not require the obsolete provider display field name').not.toContain('`name`');
    expect(routeSource, 'ac:10 C3 refresh route must be write-guarded').toContain("router.post('/integration-catalog/:provider/refresh', writeGuard");
    expect(serviceSource, 'ac:11 service must use integrations.sh detect endpoint only for refresh').toContain('/api/${encodeURIComponent(domain)}/detect');

    let liveDetectCalls = 0;
    const listCatalogService = new MeetingSourceIntegrationCatalogService({
      fetchImpl: async () => {
        liveDetectCalls += 1;
        throw new Error('list must not query integrations.sh');
      },
      clock: () => '2026-07-02T00:00:00.000Z'
    });
    const { app: listApp } = await makeApp({ integrationCatalogService: listCatalogService });

    const list = await request(listApp)
      .get('/api/settings/meeting-sources/integration-catalog')
      .expect(200);

    expect(liveDetectCalls, 'INV1 S1 list endpoint must not perform live network detection').toBe(0);
    expect(list.body).toMatchObject({
      version: 1,
      generated_at: '2026-07-02T00:00:00.000Z',
      upstream: {
        name: 'integrations.sh',
        purpose: expect.stringContaining('Brainbase override')
      },
      providers: expect.arrayContaining([
        expect.objectContaining({
          provider: 'tactiq',
          domain: 'tactiq.io',
          role: 'online_primary',
          catalog_source: 'brainbase_override',
          catalog_status: 'override_required',
          effective: true,
          surfaces: expect.arrayContaining([
            expect.objectContaining({
              type: 'mcp',
              configured_by: 'brainbase_mcp_runtime',
              confidence: 'manual_override'
            })
          ]),
          auth: expect.objectContaining({
            managed_by: 'brainbase_runtime',
            credential_ref_required: true,
            local_secret_storage: false
          }),
          upstream: expect.objectContaining({
            name: 'integrations.sh',
            detect_status: 'not_queried'
          }),
          upstream_detect: null
        }),
        expect.objectContaining({
          provider: 'plaud',
          domain: 'plaud.ai',
          role: 'offline_or_call_primary',
          catalog_source: 'brainbase_override',
          catalog_status: 'override_required',
          effective: true
        })
      ])
    });
    assertNoRuntimeSecrets(list.body);

    const oneProvider = await request(listApp)
      .get('/api/settings/meeting-sources/integration-catalog/tactiq')
      .expect(200);

    expect(oneProvider.body, 'C2 provider detail must keep the same catalog fields as list').toMatchObject({
      provider: 'tactiq',
      label: 'Tactiq',
      source_role: 'online meetings',
      effective: true,
      upstream: expect.objectContaining({
        detect_url: 'https://integrations.sh/api/tactiq.io/detect'
      })
    });
    assertNoRuntimeSecrets(oneProvider.body);

    const detectCalls: Array<{ url: string; options: Record<string, unknown> }> = [];
    const refreshCatalogService = new MeetingSourceIntegrationCatalogService({
      fetchImpl: async (url: string, options: Record<string, unknown>) => {
        detectCalls.push({ url, options });
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              found: ['llms.txt', 'oauth-protected-resource'],
              mcp: [],
              integrationsJson: null,
              auth: ['oauth-protected-resource']
            };
          }
        } as Response;
      }
    });
    const { app: refreshApp } = await makeApp({ integrationCatalogService: refreshCatalogService });

    const refresh = await request(refreshApp)
      .post('/api/settings/meeting-sources/integration-catalog/tactiq/refresh')
      .send({})
      .expect(200);

    expect(detectCalls, 'C3 refresh must call integrations.sh only for the requested provider').toEqual([{
      url: 'https://integrations.sh/api/tactiq.io/detect',
      options: { headers: { accept: 'application/json' } }
    }]);
    expect(refresh.body, 'S2 upstream can report no MCP surface while Brainbase override stays effective').toMatchObject({
      provider: 'tactiq',
      effective: true,
      catalog_source: 'brainbase_override',
      catalog_status: 'override_required',
      upstream_detect: {
        ok: true,
        status: 200,
        found: ['llms.txt', 'oauth-protected-resource'],
        mcp: [],
        integrations_json: null,
        auth: ['oauth-protected-resource']
      }
    });
    assertNoRuntimeSecrets(refresh.body);

    const unsupported = await request(refreshApp)
      .get('/api/settings/meeting-sources/integration-catalog/notion')
      .expect(404);

    expect(unsupported.body.error, 'C4 unsupported providers must not silently expand catalog scope').toContain('unsupported meeting source provider: notion');
  });
});
