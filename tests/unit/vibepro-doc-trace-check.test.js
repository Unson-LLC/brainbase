import { describe, expect, it } from 'vitest';

import {
  collectChangedFilesForDocTrace,
  validateVibeProDocTrace,
} from '../../scripts/vibepro-doc-trace-check.mjs';

describe('vibepro-doc-trace-check', () => {
  it('run証跡だけが更新された場合はStory_Architecture_Spec未更新として失敗する', () => {
    const result = validateVibeProDocTrace([
      'docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260427-112222-runtime-harness/development-run.json',
      'docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260427-112222-runtime-harness/score.json',
    ]);

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      failures: ['vibepro_run_without_story_architecture_spec_trace_update'],
    }));
  });

  it('run証跡とStory_Architecture_Specのいずれかが同じ差分にあれば通す', () => {
    const result = validateVibeProDocTrace([
      'docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260427-112222-runtime-harness/development-run.json',
      'docs/specs/vibepro-brainbase-self-evaluation-spec.md',
    ]);

    expect(result.status).toBe('passed');
    expect(result.trace_docs).toEqual(['docs/specs/vibepro-brainbase-self-evaluation-spec.md']);
  });

  it('run証跡がない通常変更は対象外として通す', () => {
    const result = validateVibeProDocTrace([
      'public/modules/session-indicators.js',
    ]);

    expect(result.status).toBe('passed');
    expect(result.run_evidence_files).toEqual([]);
  });

  it('環境変数の改行区切りchanged filesを正規化して使える', () => {
    const files = collectChangedFilesForDocTrace({
      env: {
        VIBEPRO_TRACE_CHANGED_FILES: [
          'docs/internal/vibepro-dogfood/runs/run-1/score.json',
          '',
          'docs/stories/vibepro-brainbase-dogfood-story.md',
        ].join('\n'),
      },
    });

    expect(files).toEqual([
      'docs/internal/vibepro-dogfood/runs/run-1/score.json',
      'docs/stories/vibepro-brainbase-dogfood-story.md',
    ]);
  });
});
