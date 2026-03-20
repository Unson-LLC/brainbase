/**
 * Configuration Loader
 * Loads environment variables for brainbase MCP
 */

const DEFAULT_GRAPH_API_URL = 'https://graph.brain-base.work';

export type EntitySourceMode = 'graphapi';

export interface BrainbaseConfig {
  /**
   * Entity source mode (graphapi only)
   */
  sourceMode: EntitySourceMode;

  /**
   * Graph SSOT API URL
   */
  graphApiUrl: string;

  /**
   * Project codes to filter (comma-separated, for graphapi/hybrid modes)
   */
  projectCodes?: string[];
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): BrainbaseConfig {
  const requestedSourceMode = (process.env.BRAINBASE_ENTITY_SOURCE || 'graphapi').trim().toLowerCase();
  const graphApiUrl = (
    process.env.BRAINBASE_GRAPH_API_URL
    || process.env.BRAINBASE_API_BASE_URL
    || DEFAULT_GRAPH_API_URL
  ).trim().replace(/\/+$/, '');
  const projectCodesStr = process.env.BRAINBASE_PROJECT_CODES;

  // Parse project codes
  const projectCodes = projectCodesStr
    ? projectCodesStr.split(',').map(code => code.trim())
    : undefined;

  if (requestedSourceMode !== 'graphapi') {
    throw new Error('BRAINBASE_ENTITY_SOURCE must be graphapi');
  }

  return {
    sourceMode: 'graphapi',
    graphApiUrl,
    projectCodes,
  };
}
