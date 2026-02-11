/**
 * Configuration Loader
 * Loads environment variables for brainbase MCP
 */
/**
 * Load configuration from environment variables
 */
export function loadConfig() {
    const sourceMode = (process.env.BRAINBASE_ENTITY_SOURCE || 'filesystem');
    const graphApiUrl = process.env.BRAINBASE_GRAPH_API_URL;
    const codexPath = process.env.CODEX_PATH;
    const projectCodesStr = process.env.BRAINBASE_PROJECT_CODES;
    // Parse project codes
    const projectCodes = projectCodesStr
        ? projectCodesStr.split(',').map(code => code.trim())
        : undefined;
    // Validate configuration
    if (sourceMode === 'filesystem' && !codexPath) {
        throw new Error('CODEX_PATH is required for filesystem mode');
    }
    if ((sourceMode === 'graphapi' || sourceMode === 'hybrid') && !graphApiUrl) {
        throw new Error('BRAINBASE_GRAPH_API_URL is required for graphapi/hybrid mode');
    }
    if (sourceMode === 'hybrid' && !codexPath) {
        throw new Error('CODEX_PATH is required for hybrid mode (fallback)');
    }
    return {
        sourceMode,
        graphApiUrl,
        codexPath,
        projectCodes,
    };
}
