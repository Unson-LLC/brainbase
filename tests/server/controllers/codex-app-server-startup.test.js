import { describe, expect, it } from 'vitest';
import {
  shouldStartCodexAppServerSession,
  waitForCodexAppServerSessionMetadata
} from '../../../server/controllers/session/codex-app-server-startup.js';

describe('Codex App Server startup guard', () => {
  it('Codexの明示要求だけをApp Server起動対象にする', () => {
    expect(shouldStartCodexAppServerSession('codex', true)).toBe(true);
    expect(shouldStartCodexAppServerSession('codex', false)).toBe(false);
    expect(shouldStartCodexAppServerSession('claude', true)).toBe(false);
  });

  it('metadataが永続化されない場合は成功扱いにしない', async () => {
    const controller = {
      _getSessionById: () => ({
        id: 'session-codex-missing-metadata',
        engine: 'codex'
      })
    };

    await expect(waitForCodexAppServerSessionMetadata(controller, 'session-codex-missing-metadata', {
      timeoutMs: 5,
      intervalMs: 1
    })).rejects.toThrow('Codex App Server metadata was not persisted');
  });
});
