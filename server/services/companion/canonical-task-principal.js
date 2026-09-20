// Compatibility entrypoint while callers move to the OSS package directly.
// The implementation authority is @unson/brainbase-mcp/canonical-task-principal.
export {
    createCanonicalTaskPrincipal,
    normalizeCanonicalTaskPrincipal,
    principalNamespace
} from '@unson/brainbase-mcp/canonical-task-principal';
