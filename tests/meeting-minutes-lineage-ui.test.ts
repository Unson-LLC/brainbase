import { describe, expect, it, vi } from 'vitest';
import {
  createMeetingMinutesLineageView,
  normalizeMeetingMinutesLineageView,
  renderMeetingMinutesLineage,
} from '../ui/meeting-minutes-lineage.js';
import { createMeetingMinutesLineageHttpActions } from '../ui/meeting-minutes-lineage-http.js';

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes: Record<string, string> = {};
  readonly listeners: Record<string, () => void> = {};
  parentNode: FakeNode | null = null;
  className = '';
  textContent = '';
  type = '';
  value = '';
  hidden = false;
  disabled = false;

  constructor(readonly tagName: string) {}

  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }

  appendChild(child: FakeNode): FakeNode {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeNode): FakeNode {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(name: string, listener: () => void): void {
    this.listeners[name] = listener;
  }

  click(): void {
    this.listeners.click?.();
  }
}

const documentRef = { createElement: (tag: string) => new FakeNode(tag) };

function descendants(node: FakeNode): FakeNode[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function inputForLabel(root: FakeNode, label: string): FakeNode | undefined {
  const labelNode = descendants(root).find((node) => node.tagName === 'span' && node.textContent === label);
  return labelNode?.parentNode?.children.find((node) => ['input', 'textarea', 'select'].includes(node.tagName));
}

const evidence = {
  meetingId: 'meeting-1',
  minutesId: 'minutes-1',
  versionId: 'v1',
  contentDigest: 'sha256:minutes-v1',
  locator: { section: 'decisions', item: 2 },
  provenance: { providerKind: 'google_drive', providerId: 'doc-1', revision: 'v1' },
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    status: 'available',
    evidence,
    candidates: [{
      candidate: { id: 'candidate-1', kind: 'judgment', proposal: { judgment: 'Prioritize onboarding' }, evidence },
      confirmationStatus: 'unconfirmed',
      adoptionStatus: 'not_adopted',
      executionStatus: 'unrecorded',
      resultStatus: 'unrecorded',
      reviewStatus: 'clear',
    }],
    corrections: [],
    ...overrides,
  };
}

describe('meeting minutes lineage UI', () => {
  it('preserves unavailable and invalid states instead of showing an empty success state', () => {
    expect(normalizeMeetingMinutesLineageView(undefined)).toEqual({ status: 'invalid', reason: 'response_not_object' });
    expect(normalizeMeetingMinutesLineageView({ status: 'unavailable', reason: 'permission_denied' })).toEqual({
      status: 'unavailable',
      reason: 'permission_denied',
    });
    expect(normalizeMeetingMinutesLineageView({ status: 'available', evidence, candidates: [], corrections: [] })).toMatchObject({
      status: 'available',
      candidates: [],
    });
  });

  it('exposes confirmation and adoption actions through the host action slot', () => {
    const root = new FakeNode('main');
    const confirm = vi.fn();
    renderMeetingMinutesLineage(root, payload(), { documentRef, actions: { confirmCandidate: confirm } });
    const confirmButton = descendants(root).find((node) => node.tagName === 'button' && node.textContent === '確認する');
    expect(confirmButton).toBeDefined();
    confirmButton?.click();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'candidate-1' }));

    const adopt = vi.fn();
    renderMeetingMinutesLineage(root, payload({
      candidates: [{
        ...payload().candidates[0],
        confirmationStatus: 'confirmed',
      }],
    }), { documentRef, actions: { adoptJudgment: adopt } });
    const adoptButton = descendants(root).find((node) => node.tagName === 'button' && node.textContent === '判断として採用');
    adoptButton?.click();
    expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ id: 'candidate-1' }));
  });

  it('shows task and judgment proposal details needed before confirmation', () => {
    const root = new FakeNode('main');
    renderMeetingMinutesLineage(root, payload({
      candidates: [{
        ...payload().candidates[0],
        candidate: {
          ...payload().candidates[0].candidate,
          kind: 'task',
          proposal: { task: { title: '候補タスク', description: '期限までに資料を確認する' } },
        },
      }],
    }), { documentRef });
    expect(descendants(root).find((node) => node.tagName === 'h3' && node.textContent === 'Task: 候補タスク — 期限までに資料を確認する')).toBeDefined();

    renderMeetingMinutesLineage(root, payload({
      candidates: [{
        ...payload().candidates[0],
        candidate: {
          ...payload().candidates[0].candidate,
          proposal: { learningCandidate: { proposedChange: { label: '判断基準を更新する' }, grounds: ['議事録の根拠A', '議事録の根拠B'] } },
        },
      }],
    }), { documentRef });
    expect(descendants(root).find((node) => node.tagName === 'h3' && node.textContent === '判断: 判断基準を更新する / 根拠: 議事録の根拠A / 議事録の根拠B')).toBeDefined();
  });

  it('offers a Japanese Task and judgment candidate form in the selected version slot', () => {
    const root = new FakeNode('main');
    renderMeetingMinutesLineage(root, payload(), {
      documentRef,
      actions: { createCandidate: vi.fn(async () => ({ id: 'candidate-created' })) },
      candidateDefaults: { kind: 'task', task: { title: '次回会議の準備' } },
    });
    const labels = descendants(root).filter((node) => node.tagName === 'span').map((node) => node.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Task名', '判断の提案', '候補の種類']));
    expect(descendants(root).some((node) => node.tagName === 'form')).toBe(true);
    expect(descendants(root).some((node) => node.tagName === 'h3' && node.textContent === 'この版から候補を作る')).toBe(true);
  });

  it('disables inactive candidate fields and restores them when the kind changes', () => {
    const root = new FakeNode('main');
    renderMeetingMinutesLineage(root, payload(), {
      documentRef,
      actions: { createCandidate: vi.fn(async () => ({ id: 'candidate-created' })) },
      candidateDefaults: { kind: 'task', task: { title: '次回会議の準備' } },
    });

    const kind = inputForLabel(root, '候補の種類');
    const taskTitle = inputForLabel(root, 'Task名');
    const grounds = inputForLabel(root, '根拠（1行1件）');
    expect(kind?.tagName).toBe('select');
    expect(taskTitle?.disabled).toBe(false);
    expect(grounds?.disabled).toBe(true);
    expect(grounds?.attributes.required).toBe('');

    kind!.value = 'judgment';
    kind!.listeners.change?.();
    expect(taskTitle?.disabled).toBe(true);
    expect(grounds?.disabled).toBe(false);

    kind!.value = 'task';
    kind!.listeners.change?.();
    expect(taskTitle?.disabled).toBe(false);
    expect(grounds?.disabled).toBe(true);
  });

  it('renders array defaults as separate lines in judgment fields', () => {
    const root = new FakeNode('main');
    renderMeetingMinutesLineage(root, payload(), {
      documentRef,
      actions: { createCandidate: vi.fn(async () => ({ id: 'candidate-created' })) },
      candidateDefaults: {
        kind: 'judgment',
        judgment: {
          grounds: ['議事録の根拠A', '議事録の根拠B'],
          counterexamples: ['留保A'],
          uncertainty: ['条件A', '条件B'],
        },
        applicability: { subjectIds: ['project-a', 'project-b'] },
      },
    });

    expect(inputForLabel(root, '根拠（1行1件）')?.value).toBe('議事録の根拠A\n議事録の根拠B');
    expect(inputForLabel(root, '反例・留保（1行1件）')?.value).toBe('留保A');
    expect(inputForLabel(root, '不確実性（1行1件）')?.value).toBe('条件A\n条件B');
    expect(inputForLabel(root, '対象範囲（1行1件）')?.value).toBe('project-a\nproject-b');
  });

  it('lets the core host load a projection without taking ownership of records', async () => {
    const root = new FakeNode('main');
    const load = vi.fn(async () => payload());
    const controller = createMeetingMinutesLineageView({ root, load, documentRef });
    expect(controller.state.status).toBe('unavailable');
    await controller.refresh();
    expect(load).toHaveBeenCalledTimes(1);
    expect(controller.state.status).toBe('available');
    expect(descendants(root).some((node) => node.tagName === 'article')).toBe(true);
  });

  it('keeps provider failures visible instead of leaving a stale projection on screen', async () => {
    const root = new FakeNode('main');
    const controller = createMeetingMinutesLineageView({
      root,
      load: vi.fn(async () => { throw Object.assign(new Error('permission denied'), { code: 'authorization_denied' }); }),
      documentRef,
    });
    const state = await controller.refresh();
    expect(state).toEqual({ status: 'unavailable', reason: 'authorization_denied' });
    expect(controller.state).toEqual(state);
    expect(descendants(root).some((node) => node.attributes['data-lineage-status'] === 'unavailable')).toBe(true);
  });

  it('refreshes after an HTTP confirmation and keeps a failed action retryable', async () => {
    const root = new FakeNode('main');
    const requests: Array<{ path: string; init: { body?: string } }> = [];
    let confirmationAttempts = 0;
    let confirmed = false;
    const transport = createMeetingMinutesLineageHttpActions({
      reference: evidence,
      idFor: ({ action }: { action: string }) => `operation-${action}`,
      idempotencyKeyFor: ({ action }: { action: string }) => `key-${action}`,
      fetcher: async (path: string, init: { body?: string }) => {
        requests.push({ path, init });
        if (path.endsWith('/by-version')) {
          return { ok: true, status: 200, json: async () => payload({
            candidates: [{
              ...payload().candidates[0],
              confirmationStatus: confirmed ? 'confirmed' : 'unconfirmed',
            }],
          }) };
        }
        if (path.endsWith('/confirm')) {
          confirmationAttempts += 1;
          if (confirmationAttempts === 1) {
            return { ok: false, status: 503, json: async () => ({ error: { code: 'provider_unavailable', message: '保存先が一時的に利用できません。' } }) };
          }
          confirmed = true;
          return { ok: true, status: 200, json: async () => ({ id: 'candidate-1' }) };
        }
        throw new Error(`unexpected request: ${path}`);
      },
    });
    const controller = createMeetingMinutesLineageView({
      root,
      load: transport.load,
      actions: transport.actions,
      documentRef,
    });

    await controller.refresh();
    const firstConfirm = descendants(root).find((node) => node.tagName === 'button' && node.textContent === '確認する');
    expect(firstConfirm).toBeDefined();
    firstConfirm?.click();
    await vi.waitFor(() => expect(descendants(root).find((node) => node.attributes['data-lineage-action-status'] === 'error')?.textContent)
      .toContain('保存先が一時的に利用できません。'));
    expect(confirmationAttempts).toBe(1);
    expect(descendants(root).some((node) => node.tagName === 'button' && node.textContent === '確認する')).toBe(true);

    descendants(root).find((node) => node.tagName === 'button' && node.textContent === '確認する')?.click();
    await vi.waitFor(() => expect(confirmationAttempts).toBe(2));
    await vi.waitFor(() => expect(requests.filter(({ path }) => path.endsWith('/by-version')).length).toBe(2));
    expect(descendants(root).some((node) => node.attributes['data-lineage-action-status'] === 'error')).toBe(false);
    expect(descendants(root).some((node) => node.attributes['data-status'] === 'confirmed')).toBe(true);
    expect(descendants(root).some((node) => node.tagName === 'button' && node.textContent === '確認する')).toBe(false);
  });
});
