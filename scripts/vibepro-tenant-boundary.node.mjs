import assert from 'node:assert/strict';
import test from 'node:test';
import { attachCanonicalTenantBinding, copyCanonicalTenantBinding, resolveCanonicalTenantIdentity } from '../src/vibepro-contract/canonical-tenant-identity.js';
import { OutcomeCaseService } from '../src/vibepro-contract/outcome-case-service.js';
import { createVibeproHandoffIssuer } from '../src/vibepro-contract/vibepro-handoff-issuer.js';

test('missing or conflicting claims fail closed, including forged JSON bindings', () => {
  for (const actor of [{}, { organizationId: 'one', organization_id: 'two' }, { organizationId: 'one', tenantId: 'two', canonicalTenantBinding: { organizationId: 'one', tenantId: 'two' } }]) {
    assert.notEqual(resolveCanonicalTenantIdentity(actor).state, 'confirmed');
    assert.throws(() => OutcomeCaseService.prototype.assertOrganizationAccess(actor), { status: 403 });
  }
});

test('trusted namespace mapping survives internal projections but is not serialized', () => {
  const actor = attachCanonicalTenantBinding({ organizationId: 'one', tenantId: 'two' }, { organizationId: 'one', tenantId: 'two' });
  assert.equal(resolveCanonicalTenantIdentity(actor).organizationId, 'one');
  assert.equal(resolveCanonicalTenantIdentity(JSON.parse(JSON.stringify(actor))).state, 'ambiguous');
  assert.equal(resolveCanonicalTenantIdentity(copyCanonicalTenantBinding(actor, structuredClone(actor))).state, 'confirmed');
  assert.equal(resolveCanonicalTenantIdentity({ ...actor, tenantId: 'three' }).state, 'ambiguous');
});

test('issuer denies conflicting identity before reading a case or adopted source', async () => {
  let reads = 0;
  const issuer = createVibeproHandoffIssuer({
    outcomeCaseService: { read: async () => { reads++; } },
    readAdoptedHandoff: async () => { reads++; },
    signingKey: 'synthetic-test-only-key-01234567890123456789',
    keyId: 'test-key',
  });
  await assert.rejects(issuer.issue({ caseId: 'case', resolutionId: 'resolution' }, { organizationId: 'one', tenantId: 'two' }), { status: 403 });
  assert.equal(reads, 0);
});
