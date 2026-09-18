import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TenantRoutingError, createTenantTokenRouterFromEnvironment } from '../src/auth/tenant-token-router.js';

function jwt(organizationId: string, projectCodes: string[]): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ organizationId, projectCodes, exp: 4_102_444_800 })}.signature`;
}

async function tokenFile(directory: string, name: string, organizationId: string, projectCodes: string[]): Promise<string> {
  const file = join(directory, `${name}.json`);
  await writeFile(file, JSON.stringify({ access_token: jwt(organizationId, projectCodes) }), { mode: 0o600 });
  return file;
}

test('tenant token router routes explicit tenants and uniquely owned projects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-tenant-router-'));
  const unson = await tokenFile(directory, 'unson', 'unson', ['brainbase']);
  const techknight = await tokenFile(directory, 'techknight', 'techknight', ['techknight', 'hotel-united']);
  process.env.BRAINBASE_MCP_TENANT_ROUTES_JSON = JSON.stringify({
    unson: { organization_id: 'unson', token_file: unson },
    techknight: { organization_id: 'techknight', token_file: techknight },
  });
  const router = createTenantTokenRouterFromEnvironment('https://example.invalid')!;
  assert.equal((await router.resolve({ tenant: 'techknight' }))?.organizationId, 'techknight');
  assert.equal((await router.resolve({ project_code: 'hotel-united' }))?.tenant, 'techknight');
  assert.equal(await router.resolve({}), undefined);
});

test('an explicit tenant does not read credentials for another tenant', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-tenant-router-'));
  const available = await tokenFile(directory, 'available', 'available', ['available-project']);
  process.env.BRAINBASE_MCP_TENANT_ROUTES_JSON = JSON.stringify({
    available: { organization_id: 'available', token_file: available },
    unavailable: { organization_id: 'unavailable', token_file: join(directory, 'missing.json') },
  });
  const router = createTenantTokenRouterFromEnvironment('https://example.invalid')!;
  assert.equal((await router.resolve({ tenant: 'available' }))?.organizationId, 'available');
});

test('tenant token router fails closed at tenant boundaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-tenant-router-'));
  const first = await tokenFile(directory, 'first', 'first', ['shared']);
  const second = await tokenFile(directory, 'second', 'second', ['shared']);
  process.env.BRAINBASE_MCP_TENANT_ROUTES_JSON = JSON.stringify({
    first: { organization_id: 'first', token_file: first },
    second: { organization_id: 'second', token_file: second },
  });
  const router = createTenantTokenRouterFromEnvironment('https://example.invalid')!;
  await assert.rejects(() => router.resolve({ project: 'shared' }), (error: unknown) => error instanceof TenantRoutingError && error.code === 'ambiguous_tenant');
  await assert.rejects(() => router.resolve({ tenant: 'first', project: 'missing' }), (error: unknown) => error instanceof TenantRoutingError && error.code === 'unknown_project');
  await assert.rejects(() => router.resolve({ tenant: 'missing' }), (error: unknown) => error instanceof TenantRoutingError && error.code === 'unknown_tenant');
  await assert.rejects(() => router.resolve({ project: 'first', project_code: 'second' }), (error: unknown) => error instanceof TenantRoutingError && error.code === 'conflicting_project');
});

test('tenant token router rejects inline credential material', () => {
  process.env.BRAINBASE_MCP_TENANT_ROUTES_JSON = JSON.stringify({
    unsafe: { organization_id: 'unsafe', token_file: '/tmp/unused', access_token: 'secret' },
  });
  assert.throws(
    () => createTenantTokenRouterFromEnvironment('https://example.invalid'),
    (error: unknown) => error instanceof TenantRoutingError && error.code === 'inline_credential_forbidden',
  );
});

test('tenant token router rejects token files readable by another user', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-tenant-router-'));
  const unsafe = await tokenFile(directory, 'unsafe', 'unsafe', ['unsafe-project']);
  await chmod(unsafe, 0o644);
  process.env.BRAINBASE_MCP_TENANT_ROUTES_JSON = JSON.stringify({
    unsafe: { organization_id: 'unsafe', token_file: unsafe },
  });
  const router = createTenantTokenRouterFromEnvironment('https://example.invalid')!;
  await assert.rejects(
    () => router.resolve({ tenant: 'unsafe' }),
    (error: unknown) => error instanceof TenantRoutingError && error.code === 'insecure_token_file',
  );
});

test('tenant token router rejects a token signed for another organization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-tenant-router-'));
  const mismatched = await tokenFile(directory, 'mismatched', 'other-tenant', ['tenant-project']);
  process.env.BRAINBASE_MCP_TENANT_ROUTES_JSON = JSON.stringify({
    expected: { organization_id: 'expected', token_file: mismatched },
  });
  const router = createTenantTokenRouterFromEnvironment('https://example.invalid')!;
  await assert.rejects(
    () => router.resolve({ tenant: 'expected' }),
    (error: unknown) => error instanceof TenantRoutingError && error.code === 'tenant_organization_mismatch',
  );
});
