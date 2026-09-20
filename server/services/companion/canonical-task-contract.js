// Compatibility entrypoint while callers move to the OSS package directly.
// The implementation authority is @unson/brainbase-mcp/canonical-task-contract.
export {
    CANONICAL_TASK_PRIORITIES,
    CANONICAL_TASK_STATUSES,
    canTransitionCanonicalTaskStatus,
    hasInvalidCanonicalTaskProjectCode,
    isCanonicalTaskPriority,
    isCanonicalTaskStatus,
    normalizeCanonicalTaskProjectCodes
} from '@unson/brainbase-mcp/canonical-task-contract';
