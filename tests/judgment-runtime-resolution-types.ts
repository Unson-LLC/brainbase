import {
  resolveJudgmentRuntimeCore,
  validateManifest,
  validateRuntimeInput,
  type JudgmentRuntimeInput,
  type JudgmentRuntimeManifest,
  type JudgmentRuntimeManifestLock,
  type JudgmentRuntimeResolutionPlan,
  type JudgmentRuntimeStatus,
} from '@unson/brainbase-mcp/judgment-runtime-resolution';

declare const manifest: JudgmentRuntimeManifest;
declare const lock: JudgmentRuntimeManifestLock;
declare const rawInput: unknown;

const manifestDigest: string = validateManifest(manifest, lock);
const normalizedInput: JudgmentRuntimeInput = validateRuntimeInput(rawInput, manifest);
const plan: JudgmentRuntimeResolutionPlan = resolveJudgmentRuntimeCore({
  input: normalizedInput,
  manifest,
  applicablePolicies: [],
  ownerPersonId: null,
  clientCapabilities: [],
});
const status: JudgmentRuntimeStatus = plan.status;

void manifestDigest;
void status;
