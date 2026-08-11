import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const freshHealthCheck = () => new Date().toISOString();

const source = (overrides: Record<string, unknown> = {}) => ({
  source_id: 'drive-primary',
  source_system: 'google_drive',
  connector_type: 'google_drive',
  readiness: 'ready',
  authorization_status: 'authorized',
  available_scopes: [{ account_id: 'account-1', folder_id: 'folder-1' }],
  health_checked_at: freshHealthCheck(),
  evidence_ref: 'connector://google_drive/health',
  ...overrides,
});

function runInventory(input: unknown, inputPath = '-') {
  return JSON.parse(execFileSync('node', [
    'scripts/normalize-onboarding-source-inventory.mjs',
    inputPath,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input: inputPath === '-' ? JSON.stringify(input) : undefined,
  }));
}

test('story-ten-minute-world-onboarding ac-1 and ac-6 bind the host connector and promotion handoff contract', () => {
  const skill = fs.readFileSync('.claude/skills/brainbase-onboarding/SKILL.md', 'utf8');

  expect(skill, 'ac-1 host-callable MCP Drive Gmail and explicit local folder only').toContain(
    '現在のagentで実際に呼べるMCP、Google Drive、Gmail connectorと、利用者が明示したlocal root',
  );
  expect(skill, 'ac-1 Brainbase server must not fabricate connector state').toContain(
    'hostに存在しないconnectorや接続状態をBrainbase server内に捏造する',
  );
  expect(skill, 'ac-6 metadata-first bounded retrieval').toContain('metadata-firstで列挙し');
  expect(skill, 'ac-6 human candidate review before Graph SSOT').toContain(
    '未承認候補とinferred edgeはGraph SSOTへ書かない',
  );
  expect(skill, 'ac-6 Promotion Gate and Graph SSOT re-fetch').toContain(
    '承認済み候補だけを既存のPromotion Gateへ渡す',
  );
  expect(skill, 'ac-6 production E2E remains unconfirmed').toContain(
    'production E2E未確認の状態を提供済みと報告する',
  );
});

test('story-ten-minute-world-onboarding ac-2 ac-3 ac-4 ac-5 replays the Slice 0a CLI handoff contract', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-onboarding-e2e-'));
  const inputPath = path.join(temporaryDirectory, 'sources.json');
  const payload = {
    sources: [
      source(),
      source({
        source_id: 'single-document',
        source_system: 'single_document',
        connector_type: 'single_document',
        authorization_status: 'not_required',
        available_scopes: [{ resource_id: 'document-1' }],
        evidence_ref: 'file://single-document',
      }),
      source({
        source_id: 'gmail-waiting',
        source_system: 'gmail',
        connector_type: 'gmail',
        readiness: 'waiting_for_authorization',
        authorization_status: 'pending',
        available_scopes: [{ account_id: 'account-1', query: 'newer_than:30d' }],
        evidence_ref: 'connector://gmail/authorization',
      }),
    ],
  };

  fs.writeFileSync(inputPath, JSON.stringify(payload));
  try {
    const stdinResult = runInventory(payload);
    const fileResult = runInventory(null, inputPath);

    expect(fileResult).toEqual(stdinResult);
    expect(stdinResult.recommended_source_ids, 'ac-4 ready connector precedes single document').toEqual(['drive-primary']);
    expect(stdinResult.fallback_available, 'ac-4 single-document availability remains separate').toBe(true);
    expect(stdinResult.can_start_warm_path, 'ac-4 warm path starts from ready connector').toBe(true);
    expect(stdinResult.can_start_fallback_path, 'ac-4 fallback path is not conflated with warm path').toBe(false);
    expect(stdinResult.waiting_for_authorization).toEqual([
      expect.objectContaining({ source_id: 'gmail-waiting', readiness: 'waiting_for_authorization' }),
    ]);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('story-ten-minute-world-onboarding ac-3 and ac-5 failure replay keeps unsafe metadata and malformed waiting scopes unconfirmed', () => {
  const payload = {
    sources: [
      source({ evidence_ref: 'https://user:password@example.com/health?token=secret' }),
      source({
        source_id: 'gmail-malformed-waiting',
        source_system: 'gmail',
        connector_type: 'gmail',
        readiness: 'waiting_for_authorization',
        authorization_status: 'pending',
        available_scopes: { account_id: 'account-1', query: 'newer_than:30d' },
      }),
      source({
        source_id: 'drive-token-scope',
        available_scopes: [{
          account_id: 'account-1',
          scope_ref: 'https://internal.example/scope?token=opaque-value-123',
        }],
      }),
      source({
        source_id: 'folder-token-allowlist',
        source_system: 'local_folder',
        connector_type: 'local_folder',
        authorization_status: 'permitted',
        available_scopes: [{
          root: '/approved/folder',
          file_type_allowlist: [
            'pdf',
            'id_token=opaque-value-456',
            'authToken=opaque-value-567',
            'token%3Dopaque-value-678',
          ],
        }],
      }),
      source({
        source_id: 'gmail-json-token',
        source_system: 'gmail',
        connector_type: 'gmail',
        available_scopes: [{
          account_id: 'account-1',
          query: '{"token":"opaque-value-789"}',
        }],
      }),
      source({
        source_id: 'gmail-encoded-token-key',
        source_system: 'gmail',
        connector_type: 'gmail',
        available_scopes: [{
          account_id: 'account-1',
          query: 'https://internal.example/?%74oken=opaque-value-890',
        }],
      }),
      source({
        source_id: 'gmail-token-scheme',
        source_system: 'gmail',
        connector_type: 'gmail',
        available_scopes: [{
          account_id: 'account-1',
          query: 'Authorization: Token opaque-value-901',
        }],
      }),
      source({
        source_id: 'gmail-malformed-encoding',
        source_system: 'gmail',
        connector_type: 'gmail',
        available_scopes: [{
          account_id: 'account-1',
          query: 'token%3Dopaque-malformed%',
        }],
      }),
      source({
        source_id: 'gmail-unicode-token',
        source_system: 'gmail',
        connector_type: 'gmail',
        available_scopes: [{
          account_id: 'account-1',
          query: '{"\\u0074oken":"opaque-json-unicode"}',
        }],
      }),
      source({
        source_id: 'gmail-deep-encoding',
        source_system: 'gmail',
        connector_type: 'gmail',
        available_scopes: [{
          account_id: 'account-1',
          query: '%25252574oken%2525253Dopaque-four-layer',
        }],
      }),
      ...[
        ['gmail-uri-userinfo', 'https://alice:s3cr3t-value@example.com/resource'],
        ['gmail-basic-auth', 'Authorization: Basic dXNlcjpzdXBlcnNlY3JldA=='],
        ['gmail-cookie', 'Cookie: session_id=opaque-session-value'],
        ['gmail-private-key', '-----BEGIN OPENSSH PRIVATE KEY----- opaque-key-material'],
        ['gmail-jsessionid', 'JSESSIONID=opaque-jsession-value'],
        ['gmail-connect-sid', 'connect.sid=opaque-connect-value'],
        ['gmail-phpsessid', 'PHPSESSID=opaque-php-value'],
        ['gmail-auth-equals', 'Authorization=Basic opaque-basic-value'],
        ['gmail-digest-equals', 'Authorization=Digest opaque-digest-value'],
        ['gmail-proxy-auth', 'Proxy-Authorization: Basic opaque-proxy-value'],
        ['gmail-html-auth', 'Authorization&colon; Basic opaque-html-auth-value'],
        ['gmail-html-digest', 'Authorization&equals;Digest opaque-html-digest-value'],
        ['gmail-html-cookie', 'Set-Cookie&colon; JSESSIONID&equals;opaque-html-cookie-value'],
        ['gmail-html-session', 'JSESSIONID&equals;opaque-html-session-value'],
        ['gmail-json-auth', '{"authorization":"Basic opaque-json-auth-value"}'],
        ['gmail-json-proxy', '{"proxy-authorization":"Digest opaque-json-proxy-value"}'],
        ['gmail-json-cookie', '{"cookie":"connect.sid=opaque-json-cookie-value"}'],
        ['gmail-json-session', '{"JSESSIONID":"opaque-json-session-value"}'],
        ['gmail-bracket-session', 'session[id]=opaque-bracket-session-value'],
        ['gmail-relative-userinfo', '//alice:opaque-relative-password@example.com'],
        ['gmail-x-auth', 'X-Authorization: Basic opaque-x-auth-value'],
        ['gmail-colon-session', 'session_id: opaque-colon-session-value'],
        ['gmail-encoded-colon-session', 'session_id%3A%20opaque-encoded-colon-value'],
        ['gmail-compact-jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGFxdWUifQ.opaque-jwt-signature'],
        ['gmail-named-json-auth', '{&quot;authorization&quot;&colon;&quot;Basic opaque-named-json-value&quot;}'],
        ['gmail-nested-session', 'session[data][id]=opaque-nested-session-value'],
        ['gmail-named-relative-userinfo', '&sol;&sol;alice&colon;opaque-named-uri-value&commat;example.com/resource'],
        ['gmail-double-html-auth', '{&amp;quot;authorization&amp;quot;&amp;colon;&amp;quot;Basic opaque-double-html-auth-value&amp;quot;}'],
        ['gmail-double-html-userinfo', '&amp;sol;&amp;sol;alice&amp;colon;opaque-double-html-uri-value&amp;commat;example.com/resource'],
        ['gmail-json-auth-array', '{"authorization":["Basic opaque-json-array-value"]}'],
        ['gmail-auth-header-tuple', '["Authorization","Basic opaque-header-tuple-value"]'],
        ['gmail-nested-auth-object', '{"headers":{"authorization":{"scheme":"Basic","value":"opaque-nested-auth-value"}}}'],
        ['gmail-backslash-json-auth', '{\\"authorization\\":\\"Basic opaque-backslash-json-value\\"}'],
        ['gmail-solidus-userinfo', '\\/\\/alice:opaque-solidus-uri-value@example.com/path'],
        ['gmail-short-jwt', 'eyJhbGciOiJIUzI1NiJ9.e30.abcdefghABCDEFGH'],
        ['gmail-detached-jws', 'eyJhbGciOiJIUzI1NiJ9..abcdefghABCDEFGH'],
        ['gmail-padded-jwt', 'eyJhbGciOiJIUzI1NiJ9.e30=.abcdefghABCDEFGH=='],
      ].map(([sourceId, query]) => source({
        source_id: sourceId,
        source_system: 'gmail',
        connector_type: 'gmail',
        available_scopes: [{ account_id: 'account-1', query }],
      })),
    ],
  };
  const result = runInventory(payload);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-onboarding-failure-e2e-'));
  const inputPath = path.join(temporaryDirectory, 'sources.json');
  fs.writeFileSync(inputPath, JSON.stringify(payload));
  let fileResult;
  try {
    fileResult = runInventory(null, inputPath);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  expect(fileResult).toEqual(result);
  expect(result.can_start_onboarding, 'ac-3 unsafe sources fail closed').toBe(false);
  expect(result.ready_sources, 'ac-5 invalid provider scopes never remain ready').toEqual([]);
  expect(result.waiting_for_authorization).toEqual([]);
  expect(result.unconfirmed_sources).toEqual([
    expect.objectContaining({
      source_id: 'drive-primary',
      readiness: 'unconfirmed',
      evidence_ref: null,
    }),
    expect.objectContaining({
      source_id: 'gmail-malformed-waiting',
      readiness: 'unconfirmed',
      available_scopes: [],
      issues: expect.arrayContaining(['invalid_scope_value']),
    }),
    expect.objectContaining({
      source_id: 'drive-token-scope',
      readiness: 'unconfirmed',
      issues: expect.arrayContaining(['sensitive_scope_value_removed']),
    }),
    expect.objectContaining({
      source_id: 'folder-token-allowlist',
      readiness: 'unconfirmed',
      issues: expect.arrayContaining(['sensitive_scope_value_removed']),
    }),
    expect.objectContaining({
      source_id: 'gmail-json-token',
      readiness: 'unconfirmed',
      issues: expect.arrayContaining(['sensitive_scope_value_removed']),
    }),
    expect.objectContaining({
      source_id: 'gmail-encoded-token-key',
      readiness: 'unconfirmed',
      issues: expect.arrayContaining(['sensitive_scope_value_removed']),
    }),
    expect.objectContaining({
      source_id: 'gmail-token-scheme',
      readiness: 'unconfirmed',
      issues: expect.arrayContaining(['sensitive_scope_value_removed']),
    }),
    expect.objectContaining({
      source_id: 'gmail-malformed-encoding',
      readiness: 'unconfirmed',
      issues: expect.arrayContaining(['sensitive_scope_value_removed']),
    }),
    expect.objectContaining({
      source_id: 'gmail-unicode-token',
      readiness: 'unconfirmed',
      issues: expect.arrayContaining(['sensitive_scope_value_removed']),
    }),
    expect.objectContaining({
      source_id: 'gmail-deep-encoding',
      readiness: 'unconfirmed',
      issues: expect.arrayContaining(['sensitive_scope_value_removed']),
    }),
    ...[
      'gmail-uri-userinfo',
      'gmail-basic-auth',
      'gmail-cookie',
      'gmail-private-key',
      'gmail-jsessionid',
      'gmail-connect-sid',
      'gmail-phpsessid',
      'gmail-auth-equals',
      'gmail-digest-equals',
      'gmail-proxy-auth',
      'gmail-html-auth',
      'gmail-html-digest',
      'gmail-html-cookie',
      'gmail-html-session',
      'gmail-json-auth',
      'gmail-json-proxy',
      'gmail-json-cookie',
      'gmail-json-session',
      'gmail-bracket-session',
      'gmail-relative-userinfo',
      'gmail-x-auth',
      'gmail-colon-session',
      'gmail-encoded-colon-session',
      'gmail-compact-jwt',
      'gmail-named-json-auth',
      'gmail-nested-session',
      'gmail-named-relative-userinfo',
      'gmail-double-html-auth',
      'gmail-double-html-userinfo',
      'gmail-json-auth-array',
      'gmail-auth-header-tuple',
      'gmail-nested-auth-object',
      'gmail-backslash-json-auth',
      'gmail-solidus-userinfo',
      'gmail-short-jwt',
      'gmail-detached-jws',
      'gmail-padded-jwt',
    ].map((sourceId) => expect.objectContaining({
      source_id: sourceId,
      readiness: 'unconfirmed',
      issues: expect.arrayContaining(['sensitive_scope_value_removed']),
    })),
  ]);
  expect(JSON.stringify(result)).not.toContain('password');
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(JSON.stringify(result)).not.toContain('opaque-value');
  expect(JSON.stringify(result)).not.toContain('s3cr3t-value');
  expect(JSON.stringify(result)).not.toContain('dXNlcjpzdXBlcnNlY3JldA==');
  expect(JSON.stringify(result)).not.toContain('opaque-session-value');
  expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');
  expect(JSON.stringify(result)).not.toContain('opaque-jsession-value');
  expect(JSON.stringify(result)).not.toContain('opaque-connect-value');
  expect(JSON.stringify(result)).not.toContain('opaque-php-value');
  expect(JSON.stringify(result)).not.toContain('opaque-basic-value');
  expect(JSON.stringify(result)).not.toContain('opaque-digest-value');
  expect(JSON.stringify(result)).not.toContain('opaque-proxy-value');
  expect(JSON.stringify(result)).not.toContain('opaque-json-auth-value');
  expect(JSON.stringify(result)).not.toContain('opaque-jwt-signature');
});
