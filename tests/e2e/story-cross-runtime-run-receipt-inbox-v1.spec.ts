import { createHash } from 'node:crypto';

import { expect, test } from '@playwright/test';

const AUTH_HEADERS = {
  'x-brainbase-role': 'member',
  'x-brainbase-projects': 'brainbase'
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
  summary
}: {
  suffix: string;
  workflowId: string;
  name: string;
  externalRunId: string;
  status: 'success' | 'failed' | 'blocked';
  evidenceState: 'confirmed' | 'unconfirmed' | 'no_data';
  finishedAt: string;
  summary: string;
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
      ...(status === 'blocked' ? {
        blocker_reason: 'tracked approval required',
        action_required: 'resolve_blocker'
      } : {}),
      ...(status === 'failed' ? { blocker_reason: 'tracked failure reported' } : {}),
      evidence_refs: evidenceState === 'no_data'
        ? []
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

test('common receipt path uses real ingest and inbox APIs before preserving the snapshot on 503', async ({ page, request }) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const workflowA = `Tracked common E2E A ${suffix}`;
  const workflowB = `Tracked common E2E B ${suffix}`;
  const operationalWorkflowName = `Operational fixture ${suffix}`;
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
  expect(trackedItems.map((item: { source_status: string }) => item.source_status)).toEqual(['blocked', 'failed']);
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
  await expect(page.getByRole('heading', { name: 'Operational Inbox' })).toBeVisible();
  const operationalItem = page.getByRole('button', {
    name: new RegExp(`${operationalWorkflowName} Project: brainbase`)
  });
  await expect(operationalItem).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agent Run Inbox' })).toBeVisible();
  await expect(page.getByText(`latest blocked remains ${suffix}`)).toBeVisible();
  await expect(page.getByText(`failed without evidence ${suffix}`)).toBeVisible();
  const connectorObservationCard = page.locator('[data-observation-kind="connector_observation"]')
    .filter({ hasText: `connector identity unavailable ${suffix}` });
  await expect(connectorObservationCard).toContainText('Connector observation');
  await expect(page.getByText(`old success must collapse ${suffix}`)).toHaveCount(0);

  const trackedCards = page.locator('.run-receipt-card[data-observation-kind="source_run"]')
    .filter({ hasText: suffix });
  await expect(trackedCards).toHaveCount(2);
  await expect(trackedCards.nth(0)).toContainText('status: blocked');
  await expect(trackedCards.nth(1)).toContainText('status: failed');

  await page.locator('#run-receipt-evidence').selectOption('unconfirmed');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText(`latest blocked remains ${suffix}`)).toBeVisible();
  await expect(connectorObservationCard).toBeVisible();
  await expect(page.getByText(`failed without evidence ${suffix}`)).toHaveCount(0);

  await page.route('**/api/run-receipts/inbox**', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'tracked source unavailable' })
    });
  });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('#agent-run-inbox-status')).toContainText('取得不能');
  await expect(page.locator('#agent-run-inbox-status')).toContainText('前回確認済み');
  await expect(page.getByText(`latest blocked remains ${suffix}`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operational Inbox' })).toBeVisible();
  await expect(operationalItem).toBeVisible();
});
