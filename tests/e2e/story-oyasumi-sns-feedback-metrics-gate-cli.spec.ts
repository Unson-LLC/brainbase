import { expect, test } from '@playwright/test';

import { InMemoryAccountRepository } from '../../server/services/account/account-repository.js';
import { InMemorySnsPostingLedgerRepository } from '../../server/services/sns/posting-ledger-repository.js';
import { SnsMetricsPoller } from '../../server/services/sns/sns-metrics-poller.js';
import { parseArgs, validateArgs } from '../../scripts/poll-sns-feedback-metrics.js';
import fs from 'node:fs/promises';

function createAccountRepository() {
  const accountRepository = new InMemoryAccountRepository();
  accountRepository.create({
    id: 'acc_x_sato',
    service: 'x',
    scope_type: 'personal',
    owner_person_id: 'sato_keigo',
    display_name: 'sato @X',
    credential_ref: { provider: 'env', path: 'SNS_X_ACCESS_TOKEN' },
    capabilities: ['post', 'read'],
    created_by_person_id: 'sato_keigo',
  });
  return accountRepository;
}

function addPostedPost(repository: InMemorySnsPostingLedgerRepository, date: string, slotIndex: number, tweetId: string) {
  repository.upsertReviewPack({
    account_id: 'acc_x_sato',
    account_handle: '@AIBizNavigator',
    drafts: [{
      date,
      slot_index: slotIndex,
      lane: 'learn_in_public',
      body: `feedback target ${slotIndex}`,
    }],
  });
  let post = repository.listPosts({ startDate: date, endDate: date })
    .find((candidate) => candidate.slot_index === slotIndex);
  if (!post) throw new Error(`post not created for ${date}#${slotIndex}`);
  post = repository.updatePost(post.id, { status: 'approved' }, { actor_person_id: 'sato_keigo' });
  post = repository.updatePost(post.id, { status: 'scheduled' }, { actor_person_id: 'sato_keigo' });
  return repository.updatePost(post.id, {
    status: 'posted',
    posted_url: `https://x.com/AIBizNavigator/status/${tweetId}`,
    posted_at: `${date}T03:00:00.000Z`,
  }, { actor_person_id: 'sato_keigo' });
}

test('story-oyasumi-sns-feedback-metrics-gate ac:1 ac:2 ac:3 ac:4 CLI and Ledger contract', async () => {
  const args = parseArgs([
    '--date',
    '2026-05-24',
    '--limit',
    '20',
    '--mark-learning-ready',
    '--json',
  ]);
  validateArgs(args);
  expect(args).toMatchObject({
    date: '2026-05-24',
    markLearningReady: true,
  });

  const ledgerRepository = new InMemorySnsPostingLedgerRepository();
  const target = addPostedPost(ledgerRepository, '2026-05-24', 1, '2058426862385397887');
  const otherDay = addPostedPost(ledgerRepository, '2026-05-23', 2, '2058000000000000001');
  const xClient = {
    async fetchTweetMetrics(_credentialRef: unknown, tweetId: string) {
      return {
        impressions: tweetId === '2058426862385397887' ? 432 : 999,
        likes: 12,
        reposts: 2,
        replies: 1,
        bookmarks: 4,
      };
    },
  };
  const poller = new SnsMetricsPoller({
    ledgerRepository,
    accountRepository: createAccountRepository(),
    xClient,
    now: () => new Date('2026-05-24T12:00:00.000Z'),
  });

  const result = await poller.run({
    limit: 20,
    date: '2026-05-24',
    mark_learning_ready: true,
  });

  expect(result).toMatchObject({
    date: '2026-05-24',
    scanned: 1,
    polled: 1,
    failed: 0,
    mark_learning_ready: true,
    learning_ready: {
      before: 0,
      promoted: 1,
      after: 1,
    },
  });
  expect(result.polled_posts[0]).toMatchObject({
    post_id: target.id,
    previous_status: 'posted',
    status: 'learning_ready',
  });
  expect(ledgerRepository.findById(target.id)?.status).toBe('learning_ready');
  expect(ledgerRepository.findById(target.id)?.metrics_snapshots).toHaveLength(1);
  expect(ledgerRepository.findById(otherDay.id)?.status).toBe('posted');
  expect(ledgerRepository.findById(otherDay.id)?.metrics_snapshots).toHaveLength(0);

  const dryRunTarget = addPostedPost(ledgerRepository, '2026-05-24', 3, '2058427977575387586');
  const dryRun = await poller.run({
    limit: 20,
    date: '2026-05-24',
    dry_run: true,
    mark_learning_ready: true,
  });
  expect(dryRun.dry_run).toBe(true);
  expect(dryRun.learning_ready).toMatchObject({
    before: 1,
    promoted: 0,
    after: 1,
  });
  expect(ledgerRepository.findById(dryRunTarget.id)?.status).toBe('posted');
  expect(ledgerRepository.findById(dryRunTarget.id)?.metrics_snapshots).toHaveLength(0);

  const oyasumi = await fs.readFile('.claude/commands/oyasumi.md', 'utf8');
  // The metrics capability remains independently testable, but the Brainbase
  // day-closing routine no longer owns SNS polling or feedback learning.
  expect(oyasumi).not.toContain('sns:poll-metrics');
  expect(oyasumi).not.toContain('sns:feedback-learning');
  expect(oyasumi).not.toContain('SNS_METRICS_POLLING_ENABLED');
  expect(oyasumi).toContain('外部サービスを直接巡回しない');

  await expect(fs.stat('config/com.brainbase.sns-feedback-metrics-poller.plist'))
    .rejects.toMatchObject({ code: 'ENOENT' });
});
