import { describe, expect, it, vi } from 'vitest';
import {
  createMeetingMinutesLineageView,
  normalizeMeetingMinutesLineageView,
  renderMeetingMinutesLineage,
} from '../ui/meeting-minutes-lineage.js';

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes: Record<string, string> = {};
  readonly listeners: Record<string, () => void> = {};
  parentNode: FakeNode | null = null;
  className = '';
  textContent = '';
  type = '';

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
});
