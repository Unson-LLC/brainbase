import { z } from 'zod';
import { createJudgmentProblemPhilosophyReferenceResolver, type PhilosophyRevisionReader } from './philosophy-revision-reader.js';
import { judgmentFoundationContract } from './ontology-foundation.js';
import { digestFoundationDefinition } from './foundation-catalog.js';
import type { FoundationRevisionStore, FoundationStoreContext } from './foundation-store.js';
import {
  createJudgmentProblemFoundationReferenceProvider,
  validateJudgmentProblemSnapshot,
  JudgmentProblemSnapshotError,
  type JudgmentProblemReferenceProvider,
  type JudgmentProblemSnapshot
} from './judgment-problem-snapshot.js';
import type { FoundationHttpRoute } from './foundation-http.js';

export const FOUNDATION_PUBLIC_CONTRACT_VERSION = 'foundation-public.v1' as const;
const revision = z.string().regex(/^[1-9]\d*$/u);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u).transform((value) => value as `sha256:${string}`);
const readSchema = z.object({
  type: z.enum(['objective', 'variable', 'model', 'constraint']),
  id: z.string().min(1), revision, digest: digest.optional()
}).strict();
const referenceSchema = z.object({
  kind: z.enum(['objective', 'variable', 'model', 'constraint', 'philosophy']),
  id: z.string().min(1), revision, digest,
  scope: z.object({ type: z.enum(['personal', 'project', 'organization']), id: z.string().min(1) }).strict(),
  valid_from: z.string().datetime({ offset: true }),
  valid_to: z.string().datetime({ offset: true }).nullable().optional()
}).strict();
const problemSchema = z.object({ snapshot: z.unknown() }).strict();
const validateSchema = z.object({
  reference: referenceSchema,
  phase: z.enum(['read', 'historical_read']).default('read')
}).strict();

/** The host owns canonical storage and authentication. No body can supply either. */
export function createFoundationPublicProvider(options: {
  store: Pick<FoundationRevisionStore, 'read'>;
  philosophyReader?: PhilosophyRevisionReader;
  /** Canonical Observation/authority/etc. ports; cannot override Foundation or philosophy. */
  resolveOther?: JudgmentProblemReferenceProvider['resolve'];
}) {
  const resolvePhilosophy = options.philosophyReader
    ? createJudgmentProblemPhilosophyReferenceResolver({ reader: options.philosophyReader })
    : undefined;
  function assertContext(context: FoundationStoreContext): void {
    if (!context || typeof context.principal !== 'string' || !context.principal.trim()) {
      throw new Error('foundation_trusted_context_required');
    }
  }
  function referenceProvider(context: FoundationStoreContext): JudgmentProblemReferenceProvider {
    const provider = createJudgmentProblemFoundationReferenceProvider({
      store: { read: (reference) => options.store.read(reference, context) },
      resolveOther: (input) => input.reference.kind === 'philosophy'
        ? resolvePhilosophy?.(input) ?? { status: 'unresolved', message: 'Philosophy reader is not connected' }
        : options.resolveOther?.(input) ?? { status: 'unresolved', message: `No provider is registered for ${input.reference.kind}` }
    });
    return { resolve(input) {
      if (context.scope && !context.scope.subjectIds.includes(input.reference.scope.id)) {
        return { status: 'unauthorized', message: 'Reference is outside the trusted scope' };
      }
      return provider.resolve(input);
    } };
  }
  return {
    describe() {
      return {
        contractVersion: FOUNDATION_PUBLIC_CONTRACT_VERSION,
        foundation: judgmentFoundationContract,
        connection: 'configured',
        storage: 'canonical-provider',
        philosophy: { kind: 'philosophy', canonicalSource: 'host-provider', connected: Boolean(options.philosophyReader), immutableRevisionRequired: true },
        historicalRead: 'current-acl-and-exact-digest',
        executionPermission: 'none'
      };
    },
    async read(raw: unknown, context: FoundationStoreContext) {
      assertContext(context);
      const args = readSchema.parse(raw);
      const record = await options.store.read({ type: args.type, id: args.id, revision: args.revision }, context);
      if (!record) throw new Error('foundation_revision_missing');
      if (record.definition.id !== args.id || record.definition.type !== args.type || record.definition.revision !== args.revision
        || digestFoundationDefinition(record.definition) !== record.digest || (args.digest && args.digest !== record.digest)) {
        throw new Error('foundation_digest_or_identity_mismatch');
      }
      return record;
    },
    async validate(raw: unknown, context: FoundationStoreContext) {
      assertContext(context);
      const args = validateSchema.parse(raw);
      return referenceProvider(context).resolve({ reference: args.reference, phase: args.phase, context });
    },
    async validateProblem(raw: unknown, context: FoundationStoreContext) {
      assertContext(context);
      const args = problemSchema.parse(raw);
      const owner = (args.snapshot as Partial<JudgmentProblemSnapshot> | null)?.owner_scope;
      if (context.scope && owner && !context.scope.subjectIds.includes(owner.id)) {
        throw new JudgmentProblemSnapshotError('unauthorized', 'Snapshot owner is outside the trusted scope');
      }
      await validateJudgmentProblemSnapshot({
        snapshot: args.snapshot as JudgmentProblemSnapshot,
        access: context,
        referenceProvider: referenceProvider(context)
      });
      return { status: 'resolved' as const, executionPermission: 'none' as const };
    }
  };
}
export type FoundationPublicProvider = ReturnType<typeof createFoundationPublicProvider>;
export interface FoundationPublicConnection {
  provider: FoundationPublicProvider;
  resolveContext(): FoundationStoreContext | null | Promise<FoundationStoreContext | null>;
}

export const foundationPublicToolDefinitions = [
  { name: 'foundation_describe', description: 'Describe the connected versioned judgment foundation contract.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'foundation_read', description: 'Read an exact canonical foundation revision under current access rights.', inputSchema: {
    type: 'object', required: ['type', 'id', 'revision'], additionalProperties: false,
    properties: { type: { type: 'string', enum: ['objective', 'variable', 'model', 'constraint'] }, id: { type: 'string' }, revision: { type: 'string' }, digest: { type: 'string' } }
  } },
  { name: 'foundation_validate_reference', description: 'Validate an exact foundation or philosophy reference for judgment, including its dependencies.', inputSchema: {
    type: 'object', required: ['reference'], additionalProperties: false,
    properties: { reference: { type: 'object', required: ['kind', 'id', 'revision', 'digest', 'scope', 'valid_from'], additionalProperties: false,
      properties: { kind: { type: 'string', enum: ['objective', 'variable', 'model', 'constraint', 'philosophy'] }, id: { type: 'string' }, revision: { type: 'string' }, digest: { type: 'string' }, scope: { type: 'object', required: ['type', 'id'], additionalProperties: false, properties: { type: { type: 'string', enum: ['personal', 'project', 'organization'] }, id: { type: 'string' } } }, valid_from: { type: 'string' }, valid_to: { type: ['string', 'null'] } } }, phase: { type: 'string', enum: ['read', 'historical_read'] } }
  } },
  { name: 'foundation_validate_problem', description: 'Validate a complete judgment snapshot and canonical observation measurement conditions. Grants no execution permission.', inputSchema: { type: 'object', required: ['snapshot'], properties: { snapshot: { type: 'object' } }, additionalProperties: false } }
] as const;

export async function callFoundationPublicTool(name: string, args: unknown, connection?: FoundationPublicConnection): Promise<unknown> {
  if (!connection) throw new Error('foundation_provider_unconfigured');
  const context = await connection.resolveContext();
  if (!context?.principal?.trim()) throw new Error('foundation_trusted_context_required');
  if (name === 'foundation_describe') { z.object({}).strict().parse(args); return connection.provider.describe(); }
  if (name === 'foundation_read') return connection.provider.read(args, context);
  if (name === 'foundation_validate_problem') return connection.provider.validateProblem(args, context);
  if (name === 'foundation_validate_reference') return connection.provider.validate(args, context);
  throw new Error('foundation_tool_unknown');
}

/** Mounted with createFoundationHttpRouter, whose host resolves auth and CSRF. */
export function createFoundationPublicRoute(provider: FoundationPublicProvider): FoundationHttpRoute {
  const prefix = '/api/foundation';
  const matches = (request: Request) => {
    const pathname = new URL(request.url).pathname;
    return pathname === `${prefix}/contract` || pathname === `${prefix}/judgment-references/validate` || pathname === `${prefix}/judgment-problems/validate`
      || /^\/api\/foundation\/definitions\/[^/]+\/[^/]+$/u.test(pathname);
  };
  const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  return {
    name: 'foundation-public', methods: ['GET', 'POST'], paths: [`${prefix}/contract`, `${prefix}/definitions/:type/:id`, `${prefix}/judgment-references/validate`, `${prefix}/judgment-problems/validate`], matches,
    async handle(request, { context }) {
      try {
        const url = new URL(request.url);
        for (const key of url.searchParams.keys()) if (!['scope_id', 'revision', 'digest'].includes(key)) return json(400, { error: { code: 'invalid_query' } });
        if (url.pathname === `${prefix}/contract` && request.method === 'GET') return json(200, provider.describe());
        if ([`${prefix}/judgment-references/validate`, `${prefix}/judgment-problems/validate`].includes(url.pathname) && request.method === 'POST') {
          if (Number(request.headers.get('content-length')) > 65_536) return json(413, { error: { code: 'body_too_large' } });
          const body = await request.text();
          if (new TextEncoder().encode(body).length > 65_536) return json(413, { error: { code: 'body_too_large' } });
          const result = url.pathname.endsWith('/judgment-problems/validate')
            ? await provider.validateProblem(JSON.parse(body), context)
            : await provider.validate(JSON.parse(body), context);
          return json(result.status === 'resolved' ? 200 : result.status === 'unauthorized' ? 403 : 422, result);
        }
        const parts = /^\/api\/foundation\/definitions\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
        if (parts && request.method === 'GET') return json(200, await provider.read({ type: decodeURIComponent(parts[1]!), id: decodeURIComponent(parts[2]!), revision: url.searchParams.get('revision'), ...(url.searchParams.has('digest') ? { digest: url.searchParams.get('digest') } : {}) }, context));
        return json(405, { error: { code: 'method_not_allowed' } });
      } catch (error) {
        const rawCode = error instanceof Error && 'code' in error ? String(error.code) : error instanceof Error ? error.message : '';
        const knownCodes = ['authorization_denied', 'scope_violation', 'foundation_revision_missing', 'foundation_digest_or_identity_mismatch', 'foundation_trusted_context_required', 'corrupt_catalog', 'unauthorized', 'invalid_request', 'unresolved_constraint', 'integrity_mismatch', 'missing_reference', 'not_applicable'];
        const code = knownCodes.includes(rawCode) ? rawCode : 'foundation_read_failed';
        const status = ['authorization_denied', 'scope_violation', 'unauthorized'].includes(code) ? 403 : code === 'foundation_revision_missing' ? 404 : code === 'invalid_request' || error instanceof z.ZodError || error instanceof SyntaxError || error instanceof URIError ? 400 : 422;
        return json(status, { error: { code: status === 400 ? 'invalid_request' : code, ...(error instanceof JudgmentProblemSnapshotError && error.reference ? { reference: { kind: error.reference.kind, id: error.reference.id, revision: error.reference.revision } } : {}) } });
      }
    }
  };
}
