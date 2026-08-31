/**
 * Side-effect-free public entrypoint for the Judgment DAG core contract.
 *
 * The package root remains the MCP server entrypoint. Consumers that only
 * need to validate a DAG can import this subpath without starting MCP.
 */
export {
  JUDGMENT_DAG_EDGE_RELATIONS,
  JUDGMENT_DAG_ALLOWED_KEYS,
  JUDGMENT_DAG_LAYERS,
  JUDGMENT_DAG_NODE_TYPE_TO_LAYER,
  JUDGMENT_DAG_NODE_TYPES,
  JUDGMENT_DAG_RUNNER_TYPES,
  JUDGMENT_DAG_SCOPE_TYPES,
  JudgmentDAGValidationError,
  assertValidJudgmentDAG,
  validateJudgmentDAG
} from './judgment-dag-core.js';

export { executeJudgmentDAG, JudgmentDAGExecutionError } from './judgment-dag-runner.js';

export {
  computeJudgmentDAGRunArtifactId,
  JUDGMENT_DAG_RUN_ARTIFACT_VERSION,
  JudgmentDAGArtifactError,
  loadJudgmentDAGRunArtifact,
  saveJudgmentDAGRunArtifact
} from './judgment-dag-artifact-store.js';

export {
  JUDGMENT_DAG_EVALUATION_EVENT_SET_VERSION,
  JUDGMENT_DAG_OUTCOME_ATTACHMENT_VERSION,
  JudgmentDAGReplayEvaluationError,
  createJudgmentDAGEvaluationEventSet,
  createJudgmentDAGOutcomeAttachment,
  evaluateJudgmentDAGVersions,
  replayJudgmentDAGRun
} from './judgment-dag-replay-evaluation.js';

export type {
  JudgmentDAG,
  JudgmentDAGEdge,
  JudgmentDAGEdgeRelation,
  JudgmentDAGLayer,
  JudgmentDAGMetadata,
  JudgmentDAGNode,
  JudgmentDAGNodeType,
  JudgmentDAGRunnerType,
  JudgmentDAGScope,
  JudgmentDAGScopeType,
  JudgmentDAGValidationCode,
  JudgmentDAGValidationDetails,
  JudgmentDAGValidationResult
} from './judgment-dag-core.js';

export type {
  JudgmentDAGDependencyOutput,
  JudgmentDAGExecutionCode,
  JudgmentDAGExecutionErrorDetails,
  JudgmentDAGJSONValue,
  JudgmentDAGNodeRunRecord,
  JudgmentDAGRunRecord,
  JudgmentDAGRunRequest,
  JudgmentDAGRunnerFailureKind,
  JudgmentDAGRunnerInput,
  JudgmentDAGRunnerRegistration,
  JudgmentDAGRunnerVersion
} from './judgment-dag-runner.js';

export type {
  JudgmentDAGArtifactErrorCode,
  JudgmentDAGRunArtifactId,
  JudgmentDAGRunArtifactReceipt,
  LoadJudgmentDAGRunArtifactRequest,
  SaveJudgmentDAGRunArtifactRequest
} from './judgment-dag-artifact-store.js';

export type {
  CreateJudgmentDAGEvaluationEventSetRequest,
  CreateJudgmentDAGOutcomeAttachmentRequest,
  EvaluateJudgmentDAGVersionsRequest,
  JudgmentDAGEvaluationCriterion,
  JudgmentDAGEvaluationEvent,
  JudgmentDAGEvaluationEventSet,
  JudgmentDAGEvaluationRun,
  JudgmentDAGEvaluationScoring,
  JudgmentDAGNodeCalibration,
  JudgmentDAGNodeCalibrationStatus,
  JudgmentDAGOutcomeAttachment,
  JudgmentDAGOutcomeObservation,
  JudgmentDAGReplayEvaluationErrorCode,
  JudgmentDAGReplayResult,
  JudgmentDAGRunArtifactReference,
  JudgmentDAGScoreSummary,
  JudgmentDAGVersionComparison,
  ReplayJudgmentDAGRunRequest
} from './judgment-dag-replay-evaluation.js';
