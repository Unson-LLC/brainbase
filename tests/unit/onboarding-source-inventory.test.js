import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import {
  normalizeOnboardingSourceInventory,
  normalizeOnboardingSourceInventoryInput,
} from '../../scripts/normalize-onboarding-source-inventory.mjs';

const scopesByConnector = {
  mcp: [{ server_id: 'server-1', resource_id: 'resource-1' }],
  google_drive: [{ account_id: 'account-1', folder_id: 'folder-1' }],
  gmail: [{ account_id: 'account-1', query: 'newer_than:30d' }],
  local_folder: [{ root: '/explicit/onboarding/root' }],
  single_document: [{ resource_id: 'document-1' }],
};

const readySource = (overrides = {}) => {
  const connectorType = overrides.connector_type ?? 'google_drive';
  return {
    source_id: 'drive-primary',
    source_system: connectorType,
    connector_type: connectorType,
    readiness: 'ready',
    authorization_status: connectorType === 'single_document'
      ? 'not_required'
      : connectorType === 'local_folder' ? 'permitted' : 'authorized',
    available_scopes: scopesByConnector[connectorType],
    health_checked_at: new Date().toISOString(),
    evidence_ref: `connector://${connectorType}/health`,
    ...overrides,
  };
};

describe('normalizeOnboardingSourceInventory', () => {
  it('証拠とscopeが揃ったsourceだけをreadyとして扱う', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({
        available_scopes: [{ account_id: 'account-1', folder_id: 'folder-1' }],
      }),
      readySource({ source_id: 'missing-evidence', evidence_ref: '' }),
      readySource({ source_id: 'missing-scope', available_scopes: [{ access_token: 'secret' }] }),
    ]);

    expect(result.ready_sources.map((source) => source.source_id)).toEqual(['drive-primary']);
    expect(result.unconfirmed_sources.map((source) => source.source_id)).toEqual([
      'missing-evidence',
      'missing-scope',
    ]);
    expect(result.can_start_warm_path).toBe(true);
    expect(result.ready_sources[0].available_scopes).toEqual([
      { account_id: 'account-1', folder_id: 'folder-1' },
    ]);
  });

  it('認可待ち、取得失敗、未確認をreadyや空データへ丸めない', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({
        source_id: 'gmail-waiting',
        connector_type: 'gmail',
        source_system: 'gmail',
        readiness: 'waiting_for_authorization',
        authorization_status: 'pending',
      }),
      readySource({ source_id: 'mcp-error', connector_type: 'mcp', readiness: 'error' }),
      readySource({ source_id: 'local-unknown', connector_type: 'local_folder', readiness: 'unconfirmed' }),
      readySource({ source_id: 'drive-unavailable', readiness: 'unavailable' }),
    ]);

    expect(result.ready_sources).toEqual([]);
    expect(result.waiting_for_authorization.map((source) => source.source_id)).toEqual(['gmail-waiting']);
    expect(result.failed_sources.map((source) => source.source_id)).toEqual(['mcp-error']);
    expect(result.unconfirmed_sources.map((source) => source.source_id)).toEqual(['local-unknown']);
    expect(result.unavailable_sources.map((source) => source.source_id)).toEqual(['drive-unavailable']);
    expect(result.can_start_warm_path).toBe(false);
  });

  it.each(Object.entries(scopesByConnector))('%s固有のscopeだけをreadyとして受理する', (connectorType, availableScopes) => {
    const valid = readySource({ source_id: `${connectorType}-valid`, connector_type: connectorType, available_scopes: availableScopes });
    const invalid = readySource({ source_id: `${connectorType}-invalid`, connector_type: connectorType, available_scopes: [{ file_type: 'pdf' }] });
    const result = normalizeOnboardingSourceInventory([valid, invalid]);

    expect(result.ready_sources.map((source) => source.source_id)).toEqual([`${connectorType}-valid`]);
    expect(result.unconfirmed_sources[0].issues).toContain('invalid_connector_scope');
  });

  it('空値、ネストした秘密値、不正timestampと証拠refをfail-closedにする', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({
        available_scopes: [{ account_id: ' ', folder_id: '', query: { access_token: 'secret' } }],
        health_checked_at: 'not-a-date',
        evidence_ref: 'token=secret',
      }),
    ]);

    expect(result.ready_sources).toEqual([]);
    expect(result.unconfirmed_sources[0].available_scopes).toEqual([]);
    expect(result.unconfirmed_sources[0].health_checked_at).toBeNull();
    expect(result.unconfirmed_sources[0].evidence_ref).toBeNull();
    expect(result.unconfirmed_sources[0].issues).toEqual(expect.arrayContaining([
      'invalid_scope_value',
      'sensitive_scope_value_removed',
      'ready_without_available_scope',
      'ready_without_valid_health_check',
      'ready_without_valid_evidence_ref',
    ]));
  });

  it('重複source IDを推薦せず未確認へ降格する', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({ source_id: 'duplicate' }),
      readySource({ source_id: 'duplicate' }),
    ]);

    expect(result.recommended_source_ids).toEqual([]);
    expect(result.unconfirmed_sources).toHaveLength(2);
    expect(result.unconfirmed_sources.every((source) => source.issues.includes('duplicate_source_id'))).toBe(true);
  });

  it('識別子とauthorizationの任意文字列をinventoryへ反射しない', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({
        source_id: 'access_token=secret',
        source_system: 'password=secret',
        authorization_status: 'bearer secret',
      }),
    ]);

    expect(result.ready_sources).toEqual([]);
    expect(result.unconfirmed_sources[0]).toMatchObject({
      source_id: 'unidentified-1',
      source_system: 'google_drive',
      authorization_status: 'unconfirmed',
      declared_readiness: 'ready',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('credentialを含むURIと既知token形式を出力へ反射しない', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({
        available_scopes: [{ account_id: 'ghp_1234567890', folder_id: 'folder-1' }],
        evidence_ref: 'https://user:pass@example.com/health?token=ghp_1234567890',
      }),
    ]);

    expect(result.ready_sources).toEqual([]);
    expect(result.unconfirmed_sources[0].available_scopes).toEqual([{ folder_id: 'folder-1' }]);
    expect(result.unconfirmed_sources[0].evidence_ref).toBeNull();
    expect(JSON.stringify(result)).not.toContain('ghp_1234567890');
  });

  it('provider固有scopeへ別providerのfieldを混在させない', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({
        available_scopes: [{ account_id: 'account-1', folder_id: 'folder-1', query: 'from:private@example.com' }],
      }),
    ]);

    expect(result.ready_sources).toEqual([]);
    expect(result.unconfirmed_sources[0].issues).toContain('invalid_connector_scope');
  });

  it('未知のscope制約を黙って削除せずunconfirmedにする', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({
        available_scopes: [{ account_id: 'account-1', folder_id: 'folder-1', folder_exclude: 'private' }],
      }),
    ]);

    expect(result.ready_sources).toEqual([]);
    expect(result.unconfirmed_sources[0].issues).toContain('invalid_scope_value');
    expect(result.can_start_onboarding).toBe(false);
  });

  it('未知のsource fieldと型不正source_systemを黙って補正しない', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({ source_id: 'unknown-field', metadata: { region: 'jp' } }),
      readySource({ source_id: 'bad-source-system', source_system: { name: 'drive' } }),
    ]);

    expect(result.ready_sources).toEqual([]);
    expect(result.unconfirmed_sources[0].issues).toContain('unknown_source_field');
    expect(result.unconfirmed_sources[1].issues).toContain('invalid_source_system');
  });

  it('evidence URIは明示したschemeだけを受理する', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({ source_id: 'unsafe-scheme', evidence_ref: 'javascript://alert/health' }),
    ]);

    expect(result.ready_sources).toEqual([]);
    expect(result.unconfirmed_sources[0].evidence_ref).toBeNull();
    expect(result.unconfirmed_sources[0].issues).toContain('ready_without_valid_evidence_ref');
  });

  it('providerごとのauthorization semanticsを強制する', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({ source_id: 'drive-not-required', authorization_status: 'not_required' }),
      readySource({
        source_id: 'document-not-required',
        connector_type: 'single_document',
        source_system: 'single_document',
        authorization_status: 'not_required',
      }),
    ]);

    expect(result.ready_sources.map((source) => source.source_id)).toEqual(['document-not-required']);
    expect(result.unconfirmed_sources[0].issues).toContain('ready_without_authorization_evidence');
  });

  it('非ready状態でも不正scopeはunconfirmedへfail-closedにする', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({
        readiness: 'waiting_for_authorization',
        authorization_status: 'pending',
        available_scopes: [{ account_id: 'account-1', query: { credential: 'secret' } }],
      }),
    ]);

    expect(result.waiting_for_authorization).toEqual([]);
    expect(result.unconfirmed_sources[0].issues).toEqual(expect.arrayContaining([
      'invalid_scope_value',
      'sensitive_scope_value_removed',
    ]));
  });

  it('非ready状態で非配列scopeを黙って空配列化しない', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({
        readiness: 'waiting_for_authorization',
        authorization_status: 'pending',
        available_scopes: { account_id: 'account-1', folder_id: 'folder-1' },
      }),
    ]);

    expect(result.waiting_for_authorization).toEqual([]);
    expect(result.unconfirmed_sources[0]).toMatchObject({
      readiness: 'unconfirmed',
      available_scopes: [],
    });
    expect(result.unconfirmed_sources[0].issues).toContain('invalid_scope_value');
  });

  it('未知fieldとtop-level metadata内の秘密値を黙って捨てずunconfirmedにする', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({
        source_id: 'nested-secret',
        available_scopes: [{ account_id: 'account-1', folder_id: 'folder-1', metadata: { access_token: 'top-secret-value' } }],
      }),
      readySource({
        source_id: 'top-level-secret',
        metadata: { credentials: { password: 'top-secret-value' } },
      }),
    ]);

    expect(result.ready_sources).toEqual([]);
    expect(result.unconfirmed_sources).toHaveLength(2);
    expect(result.unconfirmed_sources.every((source) => source.issues.some((issue) => issue.includes('sensitive')))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('top-secret-value');
  });

  it('scalarとarrayのscopeに埋め込まれた一般token表現を正規化後に除去する', () => {
    const variants = [
      'https://internal.example/scope?token=opaque-value-123',
      'id_token=opaque-value-234',
      'auth_token=opaque-value-345',
      'authToken=opaque-value-456',
      '{"token":"opaque-value-567"}',
      'token%3Dopaque-value-678',
      'https://internal.example/scope?%74oken=opaque-value-789',
      'Authorization: Token opaque-value-890',
      'token%3Dopaque-malformed%',
      '{"\\u0074oken":"opaque-json-unicode"}',
      '%25252574oken%2525253Dopaque-four-layer',
      '&#x74;oken&#x3d;opaque-html-encoded',
      'https://alice:s3cr3t-value@example.com/resource',
      'Authorization: Basic dXNlcjpzdXBlcnNlY3JldA==',
      'Cookie: session_id=opaque-session-value',
      '-----BEGIN OPENSSH PRIVATE KEY----- opaque-key-material',
      'JSESSIONID=opaque-jsession-value',
      'connect.sid=opaque-connect-value',
      'PHPSESSID=opaque-php-value',
      'Authorization=Basic opaque-basic-value',
      'Authorization=Digest opaque-digest-value',
      'Proxy-Authorization: Basic opaque-proxy-value',
      'Authorization&colon; Basic opaque-html-auth-value',
      'Authorization&equals;Digest opaque-html-digest-value',
      'Set-Cookie&colon; JSESSIONID&equals;opaque-html-cookie-value',
      'JSESSIONID&equals;opaque-html-session-value',
      '{"authorization":"Basic opaque-json-auth-value"}',
      '{"proxy-authorization":"Digest opaque-json-proxy-value"}',
      '{"cookie":"connect.sid=opaque-json-cookie-value"}',
      '{"JSESSIONID":"opaque-json-session-value"}',
      'session[id]=opaque-bracket-session-value',
      '//alice:opaque-relative-password@example.com',
      'X-Authorization: Basic opaque-x-auth-value',
      'session_id: opaque-colon-session-value',
      'session_id%3A%20opaque-encoded-colon-value',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGFxdWUifQ.opaque-jwt-signature',
      '{&quot;authorization&quot;&colon;&quot;Basic opaque-named-json-value&quot;}',
      'session[data][id]=opaque-nested-session-value',
      '&sol;&sol;alice&colon;opaque-named-uri-value&commat;example.com/resource',
      '{&amp;quot;authorization&amp;quot;&amp;colon;&amp;quot;Basic opaque-double-html-auth-value&amp;quot;}',
      '&amp;sol;&amp;sol;alice&amp;colon;opaque-double-html-uri-value&amp;commat;example.com/resource',
      '{"authorization":["Basic opaque-json-array-value"]}',
      '["Authorization","Basic opaque-header-tuple-value"]',
      '{"headers":{"authorization":{"scheme":"Basic","value":"opaque-nested-auth-value"}}}',
      '{\\"authorization\\":\\"Basic opaque-backslash-json-value\\"}',
      '\\/\\/alice:opaque-solidus-uri-value@example.com/path',
      'eyJhbGciOiJIUzI1NiJ9.e30.abcdefghABCDEFGH',
      'eyJhbGciOiJIUzI1NiJ9..abcdefghABCDEFGH',
      'eyJhbGciOiJIUzI1NiJ9.e30=.abcdefghABCDEFGH==',
    ];
    const scalarSources = variants.map((scopeRef, index) => readySource({
      source_id: `scalar-token-${index}`,
      available_scopes: [{ account_id: 'account-1', scope_ref: scopeRef }],
    }));
    const result = normalizeOnboardingSourceInventory([
      ...scalarSources,
      readySource({
        source_id: 'array-token',
        connector_type: 'local_folder',
        source_system: 'local_folder',
        authorization_status: 'permitted',
        available_scopes: [{
          root: '/approved/folder',
          file_type_allowlist: ['pdf', ...variants],
        }],
      }),
    ]);

    expect(result.ready_sources).toEqual([]);
    expect(result.unconfirmed_sources).toHaveLength(variants.length + 1);
    expect(result.unconfirmed_sources.every((item) => item.issues.includes('sensitive_scope_value_removed'))).toBe(true);
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

  it('JWT風だがcredentialではないdot区切りscopeを保持する', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({ available_scopes: [{ account_id: 'account-1', scope_ref: 'release/abcdefgh.ijklmnop.qrstuvwx' }] }),
    ]);

    expect(result.ready_sources[0].available_scopes[0].scope_ref).toBe('release/abcdefgh.ijklmnop.qrstuvwx');
  });

  it('存在しない暦日、鮮度窓より古い値、許容skewを超える未来のhealth timestampを拒否する', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({ source_id: 'impossible-date', health_checked_at: '2026-02-30T08:00:00.000Z' }),
      readySource({ source_id: 'stale-date', health_checked_at: '1970-01-01T00:00:00.000Z' }),
      readySource({ source_id: 'future-date', health_checked_at: '2999-01-01T00:00:00.000Z' }),
    ]);

    expect(result.ready_sources).toEqual([]);
    expect(result.unconfirmed_sources.every((source) => source.health_checked_at === null)).toBe(true);
    expect(result.unconfirmed_sources.every((source) => source.issues.includes('ready_without_valid_health_check'))).toBe(true);
  });

  it('非ready状態でも不正な認可、health、evidenceを監査issue付きでfail-closedにする', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({
        source_id: 'waiting-invalid-evidence',
        readiness: 'waiting_for_authorization',
        authorization_status: 'bogus',
        health_checked_at: '1970-01-01T00:00:00.000Z',
        evidence_ref: 'javascript://invalid/health',
      }),
    ]);

    expect(result.waiting_for_authorization).toEqual([]);
    expect(result.unconfirmed_sources[0]).toMatchObject({
      authorization_status: 'unconfirmed',
      health_checked_at: null,
      evidence_ref: null,
    });
    expect(result.unconfirmed_sources[0].issues).toEqual(expect.arrayContaining([
      'invalid_authorization_status',
      'invalid_health_check',
      'invalid_evidence_ref',
    ]));
  });

  it('非ready状態でもprovider固有authorization semanticsを強制する', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({
        source_id: 'drive-waiting-not-required',
        readiness: 'waiting_for_authorization',
        authorization_status: 'not_required',
      }),
    ]);

    expect(result.waiting_for_authorization).toEqual([]);
    expect(result.unconfirmed_sources[0].issues).toContain('invalid_provider_authorization_status');
  });

  it('health timestampの15分鮮度窓と5分未来skew境界を固定する', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T10:00:00.000Z'));
    try {
      const result = normalizeOnboardingSourceInventory([
        readySource({ source_id: 'past-boundary', health_checked_at: '2026-08-02T09:45:00.000Z' }),
        readySource({ source_id: 'past-over-limit', health_checked_at: '2026-08-02T09:44:59.999Z' }),
        readySource({ source_id: 'future-boundary', health_checked_at: '2026-08-02T10:05:00.000Z' }),
        readySource({ source_id: 'future-over-limit', health_checked_at: '2026-08-02T10:05:00.001Z' }),
      ]);

      expect(result.ready_sources.map((source) => source.source_id)).toEqual([
        'past-boundary',
        'future-boundary',
      ]);
      expect(result.unconfirmed_sources.map((source) => source.source_id)).toEqual([
        'past-over-limit',
        'future-over-limit',
      ]);
      expect(result.unconfirmed_sources.every(
        (source) => source.issues.includes('ready_without_valid_health_check'),
      )).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Gmail date_rangeは実在する昇順ISO日付区間だけを受理する', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({
        source_id: 'valid-range',
        connector_type: 'gmail',
        available_scopes: [{ account_id: 'account-1', date_range: '2026-07-01/2026-08-01' }],
      }),
      readySource({
        source_id: 'malformed-range',
        connector_type: 'gmail',
        available_scopes: [{ account_id: 'account-1', date_range: 'banana' }],
      }),
      readySource({
        source_id: 'impossible-range',
        connector_type: 'gmail',
        available_scopes: [{ account_id: 'account-1', date_range: '2026-02-30/2026-03-01' }],
      }),
    ]);

    expect(result.ready_sources.map((source) => source.source_id)).toEqual(['valid-range']);
    expect(result.unconfirmed_sources).toHaveLength(2);
    expect(result.unconfirmed_sources.every((source) => source.issues.includes('invalid_scope_value'))).toBe(true);
  });

  it('接続済み一次sourceがreadyなら単一文書より優先する', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({ source_id: 'gmail-ready', connector_type: 'gmail', source_system: 'gmail' }),
      readySource({
        source_id: 'single-doc',
        connector_type: 'single_document',
        source_system: 'single_document',
        authorization_status: 'not_required',
      }),
    ]);

    expect(result.recommended_source_ids).toEqual(['gmail-ready']);
    expect(result.fallback_available).toBe(true);
  });

  it('一次sourceがreadyでない時だけ利用可能な単一文書を推奨する', () => {
    const result = normalizeOnboardingSourceInventory([
      readySource({ source_id: 'drive-waiting', readiness: 'waiting_for_authorization', authorization_status: 'pending' }),
      readySource({
        source_id: 'single-doc',
        connector_type: 'single_document',
        source_system: 'single_document',
        authorization_status: 'not_required',
      }),
    ]);

    expect(result.recommended_source_ids).toEqual(['single-doc']);
    expect(result.can_start_warm_path).toBe(false);
    expect(result.can_start_fallback_path).toBe(true);
    expect(result.can_start_onboarding).toBe(true);
  });

  it('CLIはstdin配列とfile内sources objectを同じ契約で処理する', async () => {
    const payload = JSON.stringify({ sources: [readySource()] });
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-onboarding-'));
    const inputPath = path.join(tempDirectory, 'sources.json');
    await fs.writeFile(inputPath, payload);
    try {
      const stdinRun = spawnSync('node', ['scripts/normalize-onboarding-source-inventory.mjs', '-'], {
        cwd: process.cwd(), input: JSON.stringify([readySource()]), encoding: 'utf8',
      });
      const fileRun = spawnSync('node', ['scripts/normalize-onboarding-source-inventory.mjs', inputPath], {
        cwd: process.cwd(), encoding: 'utf8',
      });

      expect(stdinRun.status).toBe(0);
      expect(fileRun.status).toBe(0);
      expect(JSON.parse(stdinRun.stdout).recommended_source_ids).toEqual(['drive-primary']);
      expect(JSON.parse(fileRun.stdout).recommended_source_ids).toEqual(['drive-primary']);
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it('sources wrapperの未知fieldと秘密値を黙って破棄せずfail closedにする', () => {
    const unknown = normalizeOnboardingSourceInventoryInput({
      sources: [readySource()],
      metadata: { folder_exclude: 'private' },
    });
    const sensitive = normalizeOnboardingSourceInventoryInput({
      sources: [readySource()],
      access_token: 'secret-wrapper-value',
    });

    expect(unknown.can_start_onboarding).toBe(false);
    expect(unknown.unconfirmed_sources[0].issues).toContain('unknown_inventory_wrapper_field');
    expect(sensitive.can_start_onboarding).toBe(false);
    expect(sensitive.unconfirmed_sources[0].issues).toEqual(expect.arrayContaining([
      'unknown_inventory_wrapper_field',
      'sensitive_inventory_wrapper_value_removed',
    ]));
    expect(JSON.stringify(sensitive)).not.toContain('secret-wrapper-value');
  });

  it('CLIのsources wrapperに未知fieldがあればreadyを維持しない', () => {
    const run = spawnSync('node', ['scripts/normalize-onboarding-source-inventory.mjs', '-'], {
      cwd: process.cwd(),
      input: JSON.stringify({ sources: [readySource()], access_token: 'secret-wrapper-value' }),
      encoding: 'utf8',
    });

    expect(run.status).toBe(0);
    const result = JSON.parse(run.stdout);
    expect(result.can_start_onboarding).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      { source_id: 'drive-primary', issue: 'unknown_inventory_wrapper_field' },
      { source_id: 'drive-primary', issue: 'sensitive_inventory_wrapper_value_removed' },
    ]));
  });

  it('空のsources wrapperでもwrapper異常の監査理由を残す', () => {
    const result = normalizeOnboardingSourceInventoryInput({
      sources: [],
      access_token: 'secret-wrapper-value',
    });

    expect(result.can_start_onboarding).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      { source_id: null, issue: 'unknown_inventory_wrapper_field' },
      { source_id: null, issue: 'sensitive_inventory_wrapper_value_removed' },
    ]));
    expect(JSON.stringify(result)).not.toContain('secret-wrapper-value');
  });

  it('公開normalizerの余分な引数をissueとして反射しない', () => {
    const result = normalizeOnboardingSourceInventory(
      [readySource()],
      ['access_token=secret-module-value'],
    );

    expect(result.can_start_onboarding).toBe(true);
    expect(result.issues).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('secret-module-value');
  });
});

describe('brainbase-onboarding Skill contract', () => {
  it('接続起点、証拠境界、Promotion Gateを明記する', async () => {
    const skill = await fs.readFile('.claude/skills/brainbase-onboarding/SKILL.md', 'utf8');
    const capability = await fs.readFile(
      'docs/brainbase-capabilities/capabilities/onboarding.connected-world.yml',
      'utf8',
    );

    expect(skill).toContain('metadata-first');
    expect(skill).toContain('single_document');
    expect(skill).toContain('Promotion Gate');
    expect(skill).toContain('未確認');
    expect(capability).toContain('status: runtime_contract_implemented_host_entry_blocked');
    expect(capability).toContain('production_e2e: unverified');
  });

  it('callable sourceだけを列挙し、reviewからGraph再取得までの順序を固定する', async () => {
    const skill = await fs.readFile('.claude/skills/brainbase-onboarding/SKILL.md', 'utf8');
    const requiredSteps = [
      '実際に呼べるMCP',
      'metadata-firstで列挙',
      '人間レビューを行う',
      'Promotion Gateへ渡す',
      'Graph SSOTから改めてcontextを取得',
    ];
    const positions = requiredSteps.map((step) => skill.indexOf(step));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(skill).toContain('hostに存在しないconnectorや接続状態をBrainbase server内に捏造する');
    expect(skill).toContain('production E2E未確認の状態を提供済みと報告する');
  });
});
