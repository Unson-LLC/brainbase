import { describe, expect, it } from 'vitest';
import { buildAutonomousHookConfig } from '../src/autonomy-cli.js';

describe('autonomous CLI hook installation', () => {
  it('binds all three Codex hooks to the autonomy wrapper', () => {
    const config = buildAutonomousHookConfig('/tmp/autonomy-cli.js') as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string; statusMessage: string }> }>>
    };

    expect(Object.keys(config.hooks)).toEqual(['UserPromptSubmit', 'PostToolUse', 'Stop']);
    for (const registrations of Object.values(config.hooks)) {
      expect(registrations[0]?.hooks[0]?.command).toContain('/tmp/autonomy-cli.js judgment:hook');
      expect(registrations[0]?.hooks[0]?.statusMessage).toContain('autonomous');
    }
  });
});
