import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  MeetingSourceIntegrationCatalogService,
  createMeetingSourceIntegrationCatalogService,
} from '../src/meeting-source-integration-catalog.js';

// brainbase-unson server/services/meeting-source/meeting-source-integration-catalog.js を処理を変えずに移した。
// unsonでは経路のテスト（tests/server/routes/meeting-source-settings.test.js）が頼っている振る舞いを
// ここで固定する（story-document-and-meeting-source-exits-v1）。
const clock = () => '2026-10-10T00:00:00.000Z';

describe('MeetingSourceIntegrationCatalogService', () => {
  it('Tactiq と Plaud.ai を、問い合わせ前の状態で一覧にする', async () => {
    const fetchImpl = vi.fn();
    const catalog = await new MeetingSourceIntegrationCatalogService({ fetchImpl, clock }).listCatalog();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(catalog).toMatchObject({
      version: 1,
      generated_at: '2026-10-10T00:00:00.000Z',
      upstream: { name: 'integrations.sh', base_url: 'https://integrations.sh' },
    });
    expect(catalog.providers.map((entry) => [entry.provider, entry.role])).toEqual([
      ['tactiq', 'online_primary'],
      ['plaud', 'offline_or_call_primary'],
    ]);
    expect(catalog.providers[0]).toMatchObject({
      effective: true,
      auth: { managed_by: 'brainbase_runtime', credential_ref_required: true, local_secret_storage: false },
      upstream: { domain: 'tactiq.io', detect_url: 'https://integrations.sh/api/tactiq.io/detect', detect_status: 'not_queried' },
      upstream_detect: null,
    });
  });

  it('更新では integrations.sh に問い合わせ、結果を形を整えて返す', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ found: ['mcp'], mcp: [{ url: 'x' }], integrationsJson: { a: 1 }, auth: ['oauth'] }),
    }));
    const service = new MeetingSourceIntegrationCatalogService({ baseURL: 'https://catalog.test/', fetchImpl, clock });

    const entry = await service.refreshProvider(' Plaud ');

    expect(fetchImpl).toHaveBeenCalledWith('https://catalog.test/api/plaud.ai/detect', { headers: { accept: 'application/json' } });
    expect(entry.upstream).toMatchObject({ detect_status: 'pending', detect_url: 'https://catalog.test/api/plaud.ai/detect' });
    expect(entry.upstream_detect).toEqual({
      ok: true, status: 200, found: ['mcp'], mcp: [{ url: 'x' }], integrations_json: { a: 1 }, auth: ['oauth'],
    });
  });

  it('問い合わせに失敗しても、例外にせず結果として返す', async () => {
    const failing = new MeetingSourceIntegrationCatalogService({ fetchImpl: vi.fn(async () => { throw new Error('offline'); }), clock });
    expect((await failing.refreshProvider('tactiq')).upstream_detect).toEqual({ ok: false, error: 'offline' });

    const noFetch = new MeetingSourceIntegrationCatalogService({ fetchImpl: null as never, clock });
    expect((await noFetch.refreshProvider('tactiq')).upstream_detect).toEqual({ ok: false, error: 'fetch_not_available' });
  });

  it('未知のproviderは 404 のエラーにし、カタログを書き換えさせない', async () => {
    const service = createMeetingSourceIntegrationCatalogService({ clock });
    await expect(service.getCatalogEntry('zoom')).rejects.toMatchObject({
      message: 'unsupported meeting source provider: zoom',
      statusCode: 404,
    });

    const first = await service.getCatalogEntry('tactiq');
    (first.notes as string[]).push('changed');
    const second = await service.getCatalogEntry('tactiq');
    expect(second.notes).toHaveLength(2);
  });
});

describe('meeting-source-integration-catalog の公開の出口', () => {
  it('package.json の出口から、ビルド後の成果物として読み込める', async () => {
    const root = process.cwd();
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    expect(manifest.exports['./meeting-source-integration-catalog']).toEqual({
      types: './dist/meeting-source-integration-catalog.d.ts',
      import: './dist/meeting-source-integration-catalog.js',
    });
    const built = await import(pathToFileURL(path.join(root, manifest.exports['./meeting-source-integration-catalog'].import)).href);
    const catalog = await built.createMeetingSourceIntegrationCatalogService({ clock }).listCatalog();
    expect(catalog.providers.map((entry: { provider: string }) => entry.provider)).toEqual(['tactiq', 'plaud']);
  });
});
