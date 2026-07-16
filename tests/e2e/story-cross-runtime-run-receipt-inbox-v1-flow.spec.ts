import { createHash } from 'node:crypto';

import { expect, test } from '@playwright/test';

const AUTH_HEADERS = {
  'x-internal-api-key': process.env.BRAINBASE_E2E_INTERNAL_API_SECRET
    || 'brainbase-e2e-internal-api-secret'
};

function idempotencyKey(projectId: string, sourceType: string, externalRunId: string) {
  return `rr1_${createHash('sha256')
    .update(JSON.stringify([projectId, sourceType, externalRunId]))
    .digest('hex')}`;
}

function makeReceipt({
  suffix,
  workflowId,
  name,
  externalRunId,
  status,
  evidenceState,
  finishedAt,
  summary,
  evidenceUrl
}: {
  suffix: string;
  workflowId: string;
  name: string;
  externalRunId: string;
  status: 'success' | 'failed' | 'blocked' | 'waiting_human' | 'cancelled';
  evidenceState: 'confirmed' | 'unconfirmed' | 'no_data';
  finishedAt: string;
  summary: string;
  evidenceUrl?: string;
}) {
  const sourceType = 'mana';
  const canonicalExternalRunId = `tracked-e2e:${suffix}:${externalRunId}`;
  return {
    contract_version: 'run_receipt.v1',
    source: {
      type: sourceType,
      workflow_id: `tracked-e2e:${suffix}:${workflowId}`,
      name,
      runtime_target: 'test-server'
    },
    run: {
      project_id: 'brainbase',
      external_run_id: canonicalExternalRunId,
      status,
      evidence_state: evidenceState,
      started_at: finishedAt,
      finished_at: finishedAt,
      summary,
      metrics: { attempts: 1, processed: 1 },
      ...(status === 'blocked' ? {
        blocker_reason: 'tracked approval required',
        action_required: 'resolve_blocker'
      } : {}),
      ...(status === 'failed' ? { blocker_reason: 'tracked failure reported' } : {}),
      evidence_refs: evidenceState === 'no_data'
        ? []
        : evidenceUrl
          ? [{ kind: 'url', ref: evidenceUrl }]
          : [{ kind: 'log_ref', ref: `tracked-e2e:run/${suffix}/${externalRunId}` }]
    },
    delivery: {
      idempotency_key: idempotencyKey('brainbase', sourceType, canonicalExternalRunId),
      attempt: 1
    }
  };
}

function makeConnectorObservation(suffix: string) {
  const sourceType = 'mana';
  const externalRunId = `tracked-e2e:${suffix}:connector-observation`;
  return {
    contract_version: 'run_receipt.v1',
    source: {
      type: sourceType,
      workflow_id: '__connector_observation__',
      runtime_target: 'test-server'
    },
    run: {
      project_id: 'brainbase',
      external_run_id: externalRunId,
      observation_kind: 'connector_observation',
      status: 'blocked',
      evidence_state: 'unconfirmed',
      finished_at: '2026-07-15T10:15:00Z',
      summary: `connector identity unavailable ${suffix}`,
      blocker_reason: 'tracked connector identity unavailable',
      action_required: 'check_error',
      evidence_refs: []
    },
    delivery: {
      idempotency_key: idempotencyKey('brainbase', sourceType, externalRunId),
      attempt: 1
    }
  };
}

test('story-cross-runtime-run-receipt-inbox-v1 flow_replay production_path_matrix scenario_clause_e2e S-001 S-002 S-003 S-005 S-009 S-010 S-013 S-014 S-015 S-016 S-017 SCN-001 SCN-002 SCN-003 SCN-005 SCN-009 SCN-010 SCN-013 SCN-014 SCN-015 SCN-016 SCN-017 common receipt production flow preserves the confirmed snapshot on 503', async ({ page, request }) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const workflowA = `Tracked common E2E A ${suffix}`;
  const workflowB = `Tracked common E2E B ${suffix}`;
  const operationalWorkflowName = `Operational fixture ${suffix}`;
  const evidenceUrl = `https://evidence.example.invalid/runs/${suffix}/success-confirmed`;
  const receipts = [
    makeReceipt({
      suffix,
      workflowId: 'same-workflow',
      name: workflowA,
      externalRunId: 'old-success',
      status: 'success',
      evidenceState: 'confirmed',
      finishedAt: '2026-07-15T08:00:00Z',
      summary: `old success must collapse ${suffix}`
    }),
    makeReceipt({
      suffix,
      workflowId: 'same-workflow',
      name: workflowA,
      externalRunId: 'latest-blocked',
      status: 'blocked',
      evidenceState: 'unconfirmed',
      finishedAt: '2026-07-15T09:00:00Z',
      summary: `latest blocked remains ${suffix}`
    }),
    makeReceipt({
      suffix,
      workflowId: 'failed-workflow',
      name: workflowB,
      externalRunId: 'failed-no-data',
      status: 'failed',
      evidenceState: 'no_data',
      finishedAt: '2026-07-15T10:00:00Z',
      summary: `failed without evidence ${suffix}`
    }),
    makeReceipt({
      suffix,
      workflowId: 'waiting-workflow',
      name: `Tracked waiting E2E ${suffix}`,
      externalRunId: 'waiting-human',
      status: 'waiting_human',
      evidenceState: 'confirmed',
      finishedAt: '2026-07-15T10:05:00Z',
      summary: `waiting for human ${suffix}`
    }),
    makeReceipt({
      suffix,
      workflowId: 'cancelled-workflow',
      name: `Tracked cancelled E2E ${suffix}`,
      externalRunId: 'cancelled-explicitly',
      status: 'cancelled',
      evidenceState: 'confirmed',
      finishedAt: '2026-07-15T10:10:00Z',
      summary: `cancelled explicitly ${suffix}`
    }),
    makeReceipt({
      suffix,
      workflowId: 'success-workflow',
      name: `Tracked success E2E ${suffix}`,
      externalRunId: 'success-confirmed',
      status: 'success',
      evidenceState: 'confirmed',
      finishedAt: '2026-07-15T10:12:00Z',
      summary: `success confirmed ${suffix}`,
      evidenceUrl
    }),
    makeConnectorObservation(suffix)
  ];

  for (const receipt of receipts) {
    const response = await request.post('/api/run-receipts/ingest', {
      headers: AUTH_HEADERS,
      data: receipt
    });
    expect(response.status()).toBe(201);
  }

  const apiResponse = await request.get('/api/run-receipts/inbox', {
    headers: AUTH_HEADERS,
    params: { project_id: 'brainbase', source_type: 'mana' }
  });
  expect(apiResponse.ok()).toBe(true);
  const apiInbox = await apiResponse.json();
  const trackedItems = apiInbox.items.filter((item: { source?: { workflow_id?: string } }) => (
    item.source?.workflow_id?.startsWith(`tracked-e2e:${suffix}:`)
  ));
  expect(trackedItems.map((item: { source_status: string }) => item.source_status)).toEqual([
    'blocked', 'failed', 'waiting_human', 'success', 'cancelled'
  ]);
  expect(trackedItems.map((item: {
    source_status: string;
    priority: number;
    source_action_required: boolean;
    source_action: string | null;
    action_required: string;
  }) => ({
    status: item.source_status,
    priority: item.priority,
    sourceActionRequired: item.source_action_required,
    sourceAction: item.source_action,
    actionRequired: item.action_required
  }))).toEqual([
    {
      status: 'blocked',
      priority: 1,
      sourceActionRequired: true,
      sourceAction: 'resolve_blocker',
      actionRequired: 'resolve_blocker'
    },
    {
      status: 'failed',
      priority: 2,
      sourceActionRequired: false,
      sourceAction: null,
      actionRequired: 'check_error'
    },
    {
      status: 'waiting_human',
      priority: 3,
      sourceActionRequired: false,
      sourceAction: null,
      actionRequired: 'review_run'
    },
    {
      status: 'success',
      priority: 6,
      sourceActionRequired: false,
      sourceAction: null,
      actionRequired: 'none'
    },
    {
      status: 'cancelled',
      priority: 6,
      sourceActionRequired: false,
      sourceAction: null,
      actionRequired: 'none'
    }
  ]);
  expect(trackedItems.map((item: { summary: string }) => item.summary)).not.toContain(`old success must collapse ${suffix}`);
  const observationItem = apiInbox.items.find((item: { summary?: string }) => (
    item.summary === `connector identity unavailable ${suffix}`
  ));
  expect(observationItem).toMatchObject({
    observation_kind: 'connector_observation',
    source_status: 'blocked',
    evidence_state: 'unconfirmed'
  });

  await page.setExtraHTTPHeaders(AUTH_HEADERS);
  await page.route('**/api/workflows', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || url.pathname !== '/api/workflows') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        workflows: [{
          id: `operational-${suffix}`,
          name: operationalWorkflowName,
          project_id: 'brainbase',
          owner_id: 'sato',
          context_sources: [],
          latest_run: {
            id: `operational-run-${suffix}`,
            status: 'waiting_human',
            action_required: 'approve',
            human_waiting: true,
            finished_at: '2026-07-15T10:30:00.000Z'
          },
          latest_context_snapshots: []
        }]
      })
    });
  });
  await page.goto('/workflows.html');
  const agentRunInboxHeading = page.getByRole('heading', { name: 'Agent Run Inbox' });
  await expect(agentRunInboxHeading).toBeVisible();
  const inboxHeadingBox = await agentRunInboxHeading.boundingBox();
  const viewport = page.viewportSize();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(inboxHeadingBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(inboxHeadingBox!.y).toBeGreaterThanOrEqual(0);
  expect(inboxHeadingBox!.y).toBeLessThan(viewport!.height);
  expect(await agentRunInboxHeading.evaluate((heading) => (
    heading.compareDocumentPosition(document.querySelector('.project-grid'))
      & Node.DOCUMENT_POSITION_FOLLOWING
  ))).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Operational Inbox' })).toBeVisible();
  const operationalItem = page.getByRole('button', {
    name: new RegExp(`${operationalWorkflowName} Project: brainbase`)
  });
  await expect(operationalItem).toBeVisible();
  await expect(page.getByText(`latest blocked remains ${suffix}`)).toBeVisible();
  await expect(page.getByText(`failed without evidence ${suffix}`)).toBeVisible();
  await expect(page.getByText(`waiting for human ${suffix}`)).toBeVisible();
  await expect(page.getByText(`success confirmed ${suffix}`)).toBeVisible();
  await expect(page.getByText(`cancelled explicitly ${suffix}`)).toBeVisible();
  const connectorObservationCard = page.locator('[data-observation-kind="connector_observation"]')
    .filter({ hasText: `connector identity unavailable ${suffix}` });
  await expect(connectorObservationCard).toContainText('Connector observation');
  await expect(page.getByText(`old success must collapse ${suffix}`)).toHaveCount(0);

  const trackedCards = page.locator('.run-receipt-card[data-observation-kind="source_run"]')
    .filter({ hasText: suffix });
  await expect(trackedCards).toHaveCount(5);
  await expect(trackedCards.nth(0)).toContainText('status: blocked');
  await expect(trackedCards.nth(1)).toContainText('status: failed');
  await expect(trackedCards.nth(2)).toContainText('status: waiting_human');
  await expect(trackedCards.nth(3)).toContainText('status: success');
  await expect(trackedCards.nth(4)).toContainText('status: cancelled');
  const blockedCard = trackedCards.nth(0);
  await expect(blockedCard.getByText('Action', { exact: true }).locator('..'))
    .toContainText('resolve_blocker');
  await expect(blockedCard.getByText('Blocker', { exact: true }).locator('..'))
    .toContainText('tracked approval required');
  await expect(blockedCard.getByText('Run ID', { exact: true }).locator('..'))
    .toContainText(trackedItems[0].id);
  await expect(blockedCard.getByText('Observed', { exact: true }).locator('..'))
    .toContainText(trackedItems[0].effective_at);
  await expect(blockedCard.locator('.run-receipt-detail').filter({ hasText: 'Evidence refs' }))
    .toContainText(`tracked-e2e:run/${suffix}/latest-blocked`);
  await expect(blockedCard.locator('.run-receipt-detail').filter({ hasText: 'Metrics' }))
    .toContainText('attempts: 1 · processed: 1');

  const evidenceLink = page.getByRole('link', { name: `Open evidence URL: ${evidenceUrl}` });
  await expect(evidenceLink).toHaveAttribute('href', evidenceUrl);
  await expect(evidenceLink).toHaveAttribute('target', '_blank');
  await expect(evidenceLink).toHaveAttribute('rel', 'noopener noreferrer');
  await page.context().route(evidenceUrl, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'tracked evidence target' });
  });
  await evidenceLink.focus();
  await expect(evidenceLink).toBeFocused();
  const popupPromise = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const evidencePopup = await popupPromise;
  await expect(evidencePopup).toHaveURL(evidenceUrl);
  await evidencePopup.close();

  await page.locator('#run-receipt-project').focus();
  await expect(page.locator('#run-receipt-project')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#run-receipt-source')).toBeFocused();
  const sourceFocusStyle = await page.locator('#run-receipt-source').evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(sourceFocusStyle.outlineStyle).not.toBe('none');
  expect(Number.parseFloat(sourceFocusStyle.outlineWidth)).toBeGreaterThanOrEqual(3);
  await page.keyboard.press('Tab');
  await expect(page.locator('#run-receipt-status')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#run-receipt-evidence')).toBeFocused();

  await page.locator('#run-receipt-project').selectOption('brainbase');
  const applyButton = page.getByRole('button', { name: 'Apply' });
  await applyButton.focus();
  await expect(applyButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#run-receipt-project')).toHaveValue('brainbase');
  await expect(page.getByText(`latest blocked remains ${suffix}`)).toBeVisible();

  const resetButton = page.getByRole('button', { name: 'Reset' });
  await resetButton.focus();
  await expect(resetButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#run-receipt-project')).toHaveValue('');
  await expect(page.getByText(`failed without evidence ${suffix}`)).toBeVisible();
  await page.locator('#run-receipt-status').selectOption('blocked');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('#run-receipt-status')).toHaveValue('blocked');
  await expect(page.getByText(`latest blocked remains ${suffix}`)).toBeVisible();
  await expect(page.getByText(`failed without evidence ${suffix}`)).toHaveCount(0);

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.locator('#run-receipt-status')).toHaveValue('');
  await expect(page.locator('#run-receipt-evidence')).toHaveValue('');
  await expect(page.getByText(`failed without evidence ${suffix}`)).toBeVisible();

  await page.locator('#run-receipt-evidence').selectOption('unconfirmed');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText(`latest blocked remains ${suffix}`)).toBeVisible();
  await expect(connectorObservationCard).toBeVisible();
  await expect(page.getByText(`failed without evidence ${suffix}`)).toHaveCount(0);

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.locator('#run-receipt-evidence')).toHaveValue('');
  await expect(page.getByText(`failed without evidence ${suffix}`)).toBeVisible();

  await page.locator('#run-receipt-source').selectOption('mana');
  await page.locator('#run-receipt-evidence').selectOption('unconfirmed');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('#run-receipt-source')).toHaveValue('mana');
  await expect(page.locator('#run-receipt-evidence')).toHaveValue('unconfirmed');
  await expect(page.getByText(`latest blocked remains ${suffix}`)).toBeVisible();

  await page.route('**/api/run-receipts/inbox**', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'tracked source unavailable' })
    });
  });
  await page.locator('#run-receipt-source').selectOption('github_actions');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('#agent-run-inbox-status')).toContainText('取得不能');
  await expect(page.locator('#agent-run-inbox-status')).toContainText('前回確認済み');
  await expect(page.locator('#run-receipt-source')).toHaveValue('mana');
  await expect(page.locator('#run-receipt-evidence')).toHaveValue('unconfirmed');
  await expect(page.getByText(`latest blocked remains ${suffix}`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operational Inbox' })).toBeVisible();
  await expect(operationalItem).toBeVisible();
});

test('story-cross-runtime-run-receipt-inbox-v1 visible loading settles to a confirmed ready-empty state', async ({ page }) => {
  let releaseInboxRequest = () => {};
  const holdInboxRequest = new Promise<void>((resolve) => {
    releaseInboxRequest = resolve;
  });

  await page.setExtraHTTPHeaders(AUTH_HEADERS);
  await page.route('**/api/workflows', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || url.pathname !== '/api/workflows') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ workflows: [] })
    });
  });
  await page.route('**/api/run-receipts/inbox**', async (route) => {
    await holdInboxRequest;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], count: 0, has_more: false, omitted_count: 0 })
    });
  });

  await page.goto('/workflows.html');
  await expect(page.getByRole('heading', { name: 'Agent Run Inbox' })).toBeVisible();
  await expect(page.locator('#agent-run-inbox-status')).toContainText('更新中');
  await expect(page.getByText('該当するRun Receiptはありません')).toHaveCount(0);

  releaseInboxRequest();
  await expect(page.locator('#agent-run-inbox-status')).toContainText('0件を確認済み');
  await expect(page.getByText('該当するRun Receiptはありません')).toBeVisible();
});
