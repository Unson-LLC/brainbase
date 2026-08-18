import { expect, test } from '@playwright/test';

import { reviewPackToLedgerPayload } from '../../scripts/import-sns-review-pack-to-ledger.js';
import { InMemorySnsPostingLedgerRepository } from '../../server/services/sns/posting-ledger-repository.js';
import { SnsScheduledPublisher } from '../../server/services/sns/sns-scheduled-publisher.js';

test('AC-005 str.brainbase.sns-scheduled-publisher ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 JST review-pack schedule and due runner contract', async () => {
  const tenantBoundary = {
    tenant_context: {
      tenant: {
        tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        tenant_revision: '7'
      }
    },
    resource_ref: {
      object_type: 'project',
      resource_id: 'project_sns'
    }
  };
  const payload = reviewPackToLedgerPayload({
    reviewPack: {
      date: '2026-05-24',
      posts: [
        { slot: 'baseline_1', lane: 'own_proof', topic: 'Own Proof', body: '09 JST post' },
        { slot: 'baseline_2', lane: 'trust_balance', topic: 'Trust', body: '12 JST post' },
        { slot: 'peer_quote_1', lane: 'peer_circle', topic: 'Peer', body: '15 JST post', source_url: 'https://x.com/a/status/1' },
        { slot: 'news_commentary_1', lane: 'trust_balance', topic: 'News', body: '18 JST post', source_url: 'https://x.com/b/status/2' }
      ]
    }
  }, { tenantBoundary, requireTenantBoundary: true });
  const repository = new InMemorySnsPostingLedgerRepository();

  repository.upsertReviewPack(payload);
  const posts = repository.listPosts({ startDate: '2026-05-24', endDate: '2026-05-24' });

  expect(posts.map((post) => [post.time, post.scheduled_at])).toEqual([
    ['09:00', '2026-05-24T00:00:00.000Z'],
    ['12:00', '2026-05-24T03:00:00.000Z'],
    ['15:00', '2026-05-24T06:00:00.000Z'],
    ['18:00', '2026-05-24T09:00:00.000Z']
  ]);

  const first = posts[0];
  repository.updatePost(first.id, { status: 'approved' }, { actor_person_id: 'sato_keigo' });
  repository.updatePost(first.id, { status: 'scheduled' }, { actor_person_id: 'sato_keigo' });

  const publishCalls: string[] = [];
  const publishService = {
    async publishPost(id: string) {
      publishCalls.push(id);
      const post = repository.updatePost(id, {
        status: 'posted',
        posted_url: `https://x.com/AIBizNavigator/status/${id}`,
        posted_at: '2026-05-24T00:01:00.000Z'
      }, { actor_person_id: 'sato_keigo' });
      return { post };
    }
  };

  const disabledRun = await new SnsScheduledPublisher({
    ledgerRepository: repository,
    publishService,
    now: () => new Date('2026-05-24T00:01:00.000Z')
  }).run({ auto_publish_enabled: false });
  expect(disabledRun).toMatchObject({ scanned: 1, due: 1, posted: 0, skipped: 1 });
  expect(repository.findById(first.id)?.status).toBe('scheduled');
  expect(publishCalls).toEqual([]);

  const enabledRun = await new SnsScheduledPublisher({
    ledgerRepository: repository,
    publishService,
    tenantBoundaryAuthorizer: async (boundary) => {
      expect(boundary).toEqual(tenantBoundary);
      return { authorized: true, entry_point: 'background_job' };
    },
    now: () => new Date('2026-05-24T00:01:00.000Z')
  }).run({ auto_publish_enabled: true });
  expect(enabledRun).toMatchObject({ scanned: 1, due: 1, posted: 1, failed: 0 });
  expect(publishCalls).toEqual([first.id]);
  expect(repository.findById(first.id)).toMatchObject({
    status: 'posted',
    posted_url: `https://x.com/AIBizNavigator/status/${first.id}`
  });

  const rerun = await new SnsScheduledPublisher({
    ledgerRepository: repository,
    publishService,
    now: () => new Date('2026-05-24T00:02:00.000Z')
  }).run({ auto_publish_enabled: true });
  expect(rerun).toMatchObject({ scanned: 0, due: 0, posted: 0, failed: 0 });
  expect(publishCalls).toEqual([first.id]);
});
