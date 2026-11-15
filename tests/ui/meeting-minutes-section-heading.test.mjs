import { expect, it } from 'vitest';
import { renderMeetingMinutesLineage } from '../../ui/meeting-minutes-lineage.js';
import { FakeDocument, findAll } from './world-canvas-harness.mjs';

it('keeps lineage as an embedded section rather than a page title', () => {
  const doc = new FakeDocument();
  const root = doc.createElement('section');
  const evidence = {
    meetingId: 'meeting-1', minutesId: 'minutes-1', versionId: 'v1',
    contentDigest: 'sha256:minutes-v1', locator: { section: 'decisions', item: 2 },
    provenance: { providerKind: 'google_drive', providerId: 'doc-1', revision: 'v1' },
  };
  renderMeetingMinutesLineage(root, { status: 'available', evidence, candidates: [], corrections: [] }, { documentRef: doc });
  expect(findAll(root, node => node.tagName === 'H1')).toHaveLength(0);
  expect(findAll(root, node => node.tagName === 'H2')[0]?.textContent).toBe('議事録からの判断・Task');
  expect(findAll(root, node => /bb-ws-page-(head|copy)/.test(node.className))).toHaveLength(0);
});
