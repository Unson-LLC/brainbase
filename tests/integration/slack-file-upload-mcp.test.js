import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

describe('slack file upload MCP', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.SLACK_MCP_XOXP_TOKEN = 'xoxp-test';
    process.env.SLACK_MCP_UPLOAD_ROOTS = tmpdir();
    process.env.SLACK_MCP_UPLOAD_CHANNELS = 'C0BKTFQ9V38';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the external upload flow without exposing the token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slack-upload-'));
    const file = join(dir, 'minutes.txt');
    await writeFile(file, 'meeting minutes');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, upload_url: 'https://upload.example', file_id: 'F123' }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, files: [{ id: 'F123', name: 'minutes.txt', permalink: 'https://slack.example/F123' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const { uploadFile } = await import('../../scripts/slack-file-upload-mcp.mjs');

    const result = await uploadFile({ channel_id: 'C0BKTFQ9V38', file_path: file });

    expect(result.id).toBe('F123');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.flat().join(' ')).not.toContain('xoxp-test');
    expect(fetchMock.mock.calls[2][1].body.toString()).toContain('channel_id=C0BKTFQ9V38');
  });

  it('rejects channels outside the allowlist before calling Slack', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { uploadFile } = await import('../../scripts/slack-file-upload-mcp.mjs');

    await expect(uploadFile({ channel_id: 'C_OTHER', file_path: '/tmp/minutes.txt' })).rejects.toThrow('channel_id is not allowed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports Slack missing scopes without including credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slack-upload-'));
    const file = join(dir, 'minutes.txt');
    await writeFile(file, 'meeting minutes');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'missing_scope', needed: 'files:write:user', provided: 'files:read' }),
    }));
    const { uploadFile } = await import('../../scripts/slack-file-upload-mcp.mjs');

    await expect(uploadFile({ channel_id: 'C0BKTFQ9V38', file_path: file })).rejects.toThrow('needed: files:write:user');
  });
});
