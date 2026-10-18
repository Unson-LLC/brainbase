import {
  assertSafePersistentValue,
  normalizeSourceInventory,
  type CandidateInput,
  type ConnectedOnboardingRun,
  type FirstValueInput,
  type ReviewAction,
  type SourceInventoryInput,
  type SourceMode,
  type SourceReceiptInput,
  type SourceStatus,
  type WorkflowState
} from './connected-onboarding.js';

/** Shared state and receipt vocabulary for host onboarding runtimes. */
export const ONBOARDING_RUNTIME_CONTRACT_VERSION = 'connected_onboarding.v1' as const;

export const ONBOARDING_WORKFLOW_STATES = [
  'initialized',
  'source_ready',
  'candidates_ready',
  'promotion_reviewed',
  'first_value_ready',
  'first_value_answer_reviewed'
] as const;

export const ONBOARDING_SOURCE_MODES = ['mcp', 'drive', 'gmail', 'local_folder', 'single_document'] as const;
export const ONBOARDING_SOURCE_STATUSES = ['ready', 'waiting_for_authorization', 'unavailable', 'error', 'unconfirmed'] as const;
export const ONBOARDING_OBSERVATION_CLASSES = ['observed', 'inferred'] as const;

export const FIRST_VALUE_PRESENTATION_CONTRACT = Object.freeze({
  version: 'first_value_clarity.v1',
  sections: ['覚えていたこと', 'つながったこと', '次にできること'] as const,
  humanReviewRequired: true
});

export type {
  CandidateInput,
  ConnectedOnboardingRun,
  FirstValueInput,
  ReviewAction,
  SourceInventoryInput,
  SourceMode,
  SourceReceiptInput,
  SourceStatus,
  WorkflowState
};

export { assertSafePersistentValue, normalizeSourceInventory };

export interface OnboardingPermissionSnapshot {
  visibility?: string;
  collectedBy?: string;
  provider?: string;
  connectionId?: string;
  grantId?: string;
  accountId?: string;
  folderId?: string;
  projectCode?: string;
  roleMin?: string;
  sensitivity?: string;
  scope?: string | string[];
  scopes?: string[];
  roles?: string[];
  clearance?: string;
  authorizedAt?: string;
  expiresAt?: string;
}

export interface OnboardingSourceReceiptContract {
  sourceId: string;
  evidencePointer: string;
  contentHash: string;
  permissionSnapshot: OnboardingPermissionSnapshot;
  collectionStatus: 'collected';
}

export interface FirstValueRecordContract {
  answerHash: string;
  usedCanonicalIds: string[];
  missingContext: string[];
}

const PERMISSION_KEYS = new Set([
  'visibility', 'collectedBy', 'provider', 'connectionId', 'grantId', 'accountId',
  'folderId', 'projectCode', 'roleMin', 'sensitivity', 'scope', 'scopes', 'roles',
  'clearance', 'authorizedAt', 'expiresAt'
]);

function requiredText(value: unknown, field: string, maxLength = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`onboarding contract field is invalid: ${field}`);
  }
  return value.trim();
}

export function normalizeOnboardingPermissionSnapshot(value: unknown): OnboardingPermissionSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('permissionSnapshot must be an object');
  assertSafePersistentValue(value, ['permissionSnapshot']);
  const candidate = value as Record<string, unknown>;
  const forbidden = Object.keys(candidate).find((key) => !PERMISSION_KEYS.has(key));
  if (forbidden) throw new Error(`permissionSnapshot field is not allowed: ${forbidden}`);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(candidate)) {
    if (child === null || ['string', 'number', 'boolean'].includes(typeof child)) {
      output[key] = child;
    } else if (Array.isArray(child) && child.length <= 50 && child.every((item) => typeof item === 'string' && item.length <= 500)) {
      output[key] = [...child];
    } else {
      throw new Error(`permissionSnapshot.${key} must be scalar or bounded strings`);
    }
  }
  return output as OnboardingPermissionSnapshot;
}

export function normalizeOnboardingSourceReceipt(value: unknown): OnboardingSourceReceiptContract {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('source receipt must be an object');
  const candidate = value as Record<string, unknown>;
  if (candidate.collectionStatus !== 'collected') throw new Error('source receipt must be collected');
  const contentHash = requiredText(candidate.contentHash, 'contentHash', 80);
  if (!/^sha256:[a-f0-9]{64}$/u.test(contentHash)) throw new Error('contentHash must be sha256:<hex>');
  return {
    sourceId: requiredText(candidate.sourceId, 'sourceId'),
    evidencePointer: requiredText(candidate.evidencePointer, 'evidencePointer'),
    contentHash,
    permissionSnapshot: normalizeOnboardingPermissionSnapshot(candidate.permissionSnapshot),
    collectionStatus: 'collected'
  };
}

export function normalizeFirstValueRecord(value: unknown): FirstValueRecordContract {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('first value record must be an object');
  const candidate = value as Record<string, unknown>;
  if (!/^sha256:[a-f0-9]{64}$/u.test(requiredText(candidate.answerHash, 'answerHash', 80))) {
    throw new Error('answerHash must be sha256:<hex>');
  }
  if (!Array.isArray(candidate.usedCanonicalIds) || !candidate.usedCanonicalIds.every((item) => typeof item === 'string' && item.trim())) {
    throw new Error('usedCanonicalIds must be a list of IDs');
  }
  const missingContext = candidate.missingContext === undefined ? [] : candidate.missingContext;
  if (!Array.isArray(missingContext) || !missingContext.every((item) => typeof item === 'string' && item.length <= 500)) {
    throw new Error('missingContext must be bounded strings');
  }
  return {
    answerHash: requiredText(candidate.answerHash, 'answerHash', 80),
    usedCanonicalIds: [...candidate.usedCanonicalIds] as string[],
    missingContext: [...missingContext] as string[]
  };
}
