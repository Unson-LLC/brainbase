import { FoundationStoreError } from './foundation-store.js';
import type {
  FoundationRevisionStore,
  FoundationStoreContext,
} from './foundation-store.js';
import type { FoundationRevision } from './ontology-foundation.js';
import {
  ConstraintError,
  type ConstraintAuthorizationContext,
  type ConstraintExceptionQuery,
  type ConstraintExceptionRecord,
  type ConstraintProjection,
  type ConstraintStore,
  type ConstraintStoreQuery,
  validateConstraintExceptionRecord,
} from './constraint-resolution.js';

type ExceptionAccess = 'read' | 'write';

/**
 * Exception records are deliberately a host supplied boundary.  The shared
 * foundation catalog currently stores the ontology-level exception reference
 * (Decision revision and scope), while Story04 also needs approval metadata,
 * expiry, and rationale.  A host must therefore provide the canonical
 * evidence/execution adapter for that record until the shared contract grows
 * those fields; this module never creates a private sidecar file.
 */
export interface ConstraintExceptionStore {
  append(
    exception: ConstraintExceptionRecord,
    context: ConstraintAuthorizationContext,
  ): Promise<ConstraintExceptionRecord>;
  list(
    query: ConstraintExceptionQuery,
    context: ConstraintAuthorizationContext,
  ): Promise<readonly ConstraintExceptionRecord[]>;
}

export interface FoundationConstraintStoreOptions {
  foundationStore: FoundationRevisionStore;
  exceptionStore: ConstraintExceptionStore;
}

/**
 * Adapts the Objective Story's GraphFoundationRevisionStore to the resolver's
 * ConstraintStore port.  Definitions are persisted in the existing PersonalOs
 * aggregate through FoundationRevisionStore; no second Graph or file is
 * created here.
 */
export class FoundationConstraintStore<TConstraint extends ConstraintProjection = ConstraintProjection>
  implements ConstraintStore<TConstraint>
{
  private readonly foundationStore: FoundationRevisionStore;
  private readonly exceptionStore: ConstraintExceptionStore;

  constructor(options: FoundationConstraintStoreOptions) {
    this.foundationStore = options.foundationStore;
    this.exceptionStore = options.exceptionStore;
  }

  async append(
    input: { record: TConstraint; expectedPreviousRevision?: string | null },
    context?: ConstraintAuthorizationContext,
  ): Promise<TConstraint> {
    const storeContext = toFoundationContext(context);
    let reference: FoundationRevision;
    try {
      if (input.expectedPreviousRevision === null) {
        reference = await this.foundationStore.create(input.record, storeContext);
      } else if (input.expectedPreviousRevision !== undefined) {
        reference = await this.foundationStore.update({
          reference: {
            id: input.record.id,
            type: 'constraint',
            revision: input.expectedPreviousRevision,
          },
          next: input.record,
          expectedRevision: input.expectedPreviousRevision,
        }, storeContext);
      } else {
        throw new ConstraintError(
          'revision_conflict',
          'Foundation constraint append requires an explicit previous revision or null for create',
          409,
        );
      }
    } catch (error) {
      throw normalizeFoundationError(error, input.record.id);
    }

    if (reference.id !== input.record.id || reference.type !== 'constraint' || reference.revision !== input.record.revision) {
      throw new ConstraintError(
        'constraint_store_corrupt',
        'Foundation store returned a different constraint revision than requested',
        500,
        {
          id: input.record.id,
          requestedRevision: input.record.revision,
          storedRevision: reference.revision,
        },
      );
    }
    const readback = await this.get({ id: reference.id, revision: reference.revision }, context);
    if (!readback) {
      throw new ConstraintError('constraint_store_corrupt', 'Foundation constraint readback was empty', 500, {
        id: reference.id,
        revision: reference.revision,
      });
    }
    return readback;
  }

  async get(
    ref: { id: string; revision: string },
    context?: ConstraintAuthorizationContext,
  ): Promise<TConstraint | null> {
    const storeContext = toFoundationContext(context);
    try {
      const record = await this.foundationStore.read({ id: ref.id, type: 'constraint', revision: ref.revision }, storeContext);
      return record?.definition.type === 'constraint' ? record.definition as TConstraint : null;
    } catch (error) {
      throw normalizeFoundationError(error, ref.id);
    }
  }

  async getLatest(id: string, context?: ConstraintAuthorizationContext): Promise<TConstraint | null> {
    const storeContext = toFoundationContext(context);
    try {
      const record = await this.foundationStore.readLatest('constraint', id, storeContext);
      return record?.definition.type === 'constraint' ? record.definition as TConstraint : null;
    } catch (error) {
      throw normalizeFoundationError(error, id);
    }
  }

  async list(
    query: ConstraintStoreQuery,
    context?: ConstraintAuthorizationContext,
  ): Promise<readonly TConstraint[]> {
    const storeContext = toFoundationContext(context);
    try {
      if (query.revision !== undefined && query.id !== undefined) {
        const exact = await this.get({ id: query.id, revision: query.revision }, context);
        return exact && (query.ownerId === undefined || exact.acl.ownerId === query.ownerId) ? [exact] : [];
      }
      const records = await this.foundationStore.list('constraint', storeContext);
      return records
        .map((record) => record.definition)
        .filter((definition): definition is TConstraint => definition.type === 'constraint')
        .filter((definition) => query.id === undefined || definition.id === query.id)
        .filter((definition) => query.ownerId === undefined || definition.acl.ownerId === query.ownerId)
        .map((definition) => definition as TConstraint);
    } catch (error) {
      throw normalizeFoundationError(error);
    }
  }

  async appendException(
    exception: ConstraintExceptionRecord,
    context?: ConstraintAuthorizationContext,
  ): Promise<ConstraintExceptionRecord> {
    const resolvedContext = context ?? missingContext();
    try {
      validateConstraintExceptionRecord(exception);
      await this.authorizeExceptionTarget(
        exception.constraintRef.id,
        exception.constraintRef.revision,
        resolvedContext,
        'write',
      );
      return await this.exceptionStore.append(exception, resolvedContext);
    } catch (error) {
      throw normalizeFoundationError(error, exceptionConstraintId(exception));
    }
  }

  async listExceptions(
    query: ConstraintExceptionQuery,
    context?: ConstraintAuthorizationContext,
  ): Promise<readonly ConstraintExceptionRecord[]> {
    const resolvedContext = context ?? missingContext();
    try {
      if (query.constraintId !== undefined) {
        await this.authorizeExceptionTarget(
          query.constraintId,
          query.constraintRevision,
          resolvedContext,
          'read',
        );
      }
      const exceptions = await this.exceptionStore.list(query, resolvedContext);
      for (const exception of exceptions) {
        validateConstraintExceptionRecord(exception);
        await this.authorizeExceptionTarget(
          exception.constraintRef.id,
          exception.constraintRef.revision,
          resolvedContext,
          'read',
        );
      }
      return exceptions;
    } catch (error) {
      throw normalizeFoundationError(error, query.constraintId);
    }
  }

  /**
   * The injected exception boundary is intentionally persistence-only and may
   * not enforce Foundation ACLs itself.  Resolve the referenced Constraint at
   * this adapter boundary before allowing exception evidence to cross it.
   * Current ACL controls access even when an exception points at an older
   * revision; the exact revision is still read to reject dangling references.
   */
  private async authorizeExceptionTarget(
    constraintId: string,
    constraintRevision: string | undefined,
    context: ConstraintAuthorizationContext,
    access: ExceptionAccess,
  ): Promise<void> {
    const storeContext = toFoundationContext(context);
    const current = await this.foundationStore.readLatest('constraint', constraintId, storeContext);
    if (!current || current.definition.type !== 'constraint') {
      throw new ConstraintError(
        'constraint_not_found',
        'exception target constraint was not found',
        404,
        { id: constraintId },
      );
    }
    if (constraintRevision !== undefined) {
      const referenced = await this.foundationStore.read({
        id: constraintId,
        type: 'constraint',
        revision: constraintRevision,
      }, storeContext);
      if (!referenced || referenced.definition.type !== 'constraint') {
        throw new ConstraintError(
          'constraint_not_found',
          'exception target constraint revision was not found',
          404,
          { id: constraintId, revision: constraintRevision },
        );
      }
    }

    const target = current.definition;
    if (target.acl.ownerId !== context.ownerId) {
      throw new ConstraintError(
        'scope_violation',
        'exception target constraint is outside the authorization context',
        403,
        { id: target.id, ownerId: target.acl.ownerId },
      );
    }
    const canRead = target.acl.visibility === 'public'
      || target.acl.ownerId === context.actorId
      || target.acl.readerIds.includes(context.actorId)
      || target.acl.writerIds.includes(context.actorId);
    if (!canRead) {
      throw new ConstraintError(
        'authorization_denied',
        'actor cannot read the exception target constraint',
        403,
        { id: target.id },
      );
    }
    if (access === 'write') {
      const canWrite = target.acl.ownerId === context.actorId || target.acl.writerIds.includes(context.actorId);
      if (!canWrite) {
        throw new ConstraintError(
          'authorization_denied',
          'actor cannot write exceptions for the target constraint',
          403,
          { id: target.id },
        );
      }
    }
  }
}

function exceptionConstraintId(exception: unknown): string | undefined {
  if (!exception || typeof exception !== 'object') return undefined;
  const reference = (exception as { constraintRef?: unknown }).constraintRef;
  if (!reference || typeof reference !== 'object') return undefined;
  const id = (reference as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

export function createFoundationConstraintStore(
  options: FoundationConstraintStoreOptions,
): ConstraintStore {
  return new FoundationConstraintStore(options);
}

function toFoundationContext(context?: ConstraintAuthorizationContext): FoundationStoreContext {
  // `ownerId` identifies the target scope.  It is caller supplied request
  // data and must never be promoted to an authenticated principal.  The
  // principal is the actor identity established by the trusted auth boundary.
  if (!context?.actorId) return missingContext();
  return { principal: context.actorId };
}

function missingContext(): never {
  throw new ConstraintError(
    'authorization_denied',
    'Foundation constraint persistence requires an authenticated actor context',
    403,
  );
}

function normalizeFoundationError(error: unknown, id?: string): ConstraintError {
  if (error instanceof ConstraintError) return error;
  if (error instanceof FoundationStoreError) {
    switch (error.code) {
      case 'invalid_input':
        return new ConstraintError('invalid_constraint', error.message, 400, { id });
      case 'not_found':
        return new ConstraintError('constraint_not_found', error.message, 404, { id });
      case 'revision_conflict':
        return new ConstraintError('revision_conflict', error.message, 409, {
          id,
          currentRevision: error.currentRevision,
        });
      case 'authorization_denied':
        return new ConstraintError('authorization_denied', error.message, 403, { id });
      case 'scope_violation':
        return new ConstraintError('scope_violation', error.message, 403, { id });
      case 'corrupt_catalog':
      case 'readback_mismatch':
        return new ConstraintError('constraint_store_corrupt', error.message, 500, { id });
      case 'unsupported_graph':
        return new ConstraintError('constraint_store_unavailable', error.message, 503, { id });
    }
  }
  return new ConstraintError('constraint_store_unavailable', 'Foundation constraint store failed', 503, { id });
}
