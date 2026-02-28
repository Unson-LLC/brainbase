/**
 * Configuration Loader
 * Loads environment variables for brainbase MCP
 */
const DEFAULT_GRAPH_API_URL = 'https://graph.brain-base.work';
function normalizeUrl(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim().replace(/\/+$/, '');
}
/**
 * Load configuration from environment variables
 */
export function loadConfig() {
    const sourceMode = (process.env.BRAINBASE_ENTITY_SOURCE || 'graphapi').toLowerCase();
    const graphApiUrl = normalizeUrl(process.env.BRAINBASE_GRAPH_API_URL
        || process.env.BRAINBASE_API_BASE_URL
        || DEFAULT_GRAPH_API_URL);
    const codexPath = process.env.CODEX_PATH;
    const projectCodesStr = process.env.BRAINBASE_PROJECT_CODES;
    // Parse project codes
    const projectCodes = projectCodesStr
        ? projectCodesStr.split(',').map(code => code.trim())
        : undefined;
    // bundled brainbase MCP is graphapi-only in brainbase-unson distribution
    if (sourceMode !== 'graphapi') {
        throw new Error('BRAINBASE_ENTITY_SOURCE must be graphapi in brainbase-unson (filesystem/hybrid are disabled)');
    }
    if (!graphApiUrl) {
        throw new Error('BRAINBASE_GRAPH_API_URL (or BRAINBASE_API_BASE_URL) is required for graphapi mode');
    }
    return {
        sourceMode: 'graphapi',
        graphApiUrl,
        codexPath,
        projectCodes,
    };
}
