import fs from 'node:fs';

import {
  createDetachedJws,
  TENANT_CONTEXT_PROTECTED_TYP
} from '../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';

export function createPersonalKgAuthorityEnv({ projectId = 'project-a' } = {}): NodeJS.ProcessEnv {
  const cases = JSON.parse(fs.readFileSync(
    'contracts/mana-brainbase-company-authority/v1/fixtures/cases.json',
    'utf8'
  ));
  const key = JSON.parse(fs.readFileSync(
    'contracts/mana-brainbase-company-authority/v1/fixtures/test-key.json',
    'utf8'
  ));
  const fixture = cases.positive.find((entry: { id: string }) => entry.id === 'POS-PERSONAL-AUTO-OWNER');
  const context = structuredClone(fixture.context);
  context.scope.project_id = projectId;
  context.tenant_context.authorization.project_ids = [projectId];
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 3 * 60_000).toISOString();

  context.issued_at = issuedAt;
  context.expires_at = expiresAt;
  context.tenant_context.issued_at = issuedAt;
  context.tenant_context.expires_at = expiresAt;
  context.tenant_context.integrity.value = createDetachedJws(
    context.tenant_context,
    key.private_jwk,
    context.tenant_context.integrity.key_id,
    { typ: TENANT_CONTEXT_PROTECTED_TYP }
  );
  context.integrity.value = createDetachedJws(context, key.private_jwk, context.integrity.key_id);

  return {
    ...process.env,
    BRAINBASE_COMPANY_AUTHORITY_RESPONSE_JSON: JSON.stringify({
      schema_version: cases.schema_version,
      contract_id: cases.contract_id,
      correlation_id: fixture.request.correlation_id,
      context,
      error: null
    }),
    BRAINBASE_COMPANY_AUTHORITY_PUBLIC_JWK_JSON: JSON.stringify(key.public_jwk),
    BRAINBASE_TENANT_CONTEXT_PUBLIC_JWK_JSON: JSON.stringify(key.public_jwk),
    BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID: context.scope.placement_id
  };
}
