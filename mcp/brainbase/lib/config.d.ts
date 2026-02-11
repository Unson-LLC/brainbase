/**
 * Configuration Loader
 * Loads environment variables for brainbase MCP
 */
export type EntitySourceMode = 'filesystem' | 'graphapi' | 'hybrid';
export interface BrainbaseConfig {
    /**
     * Entity source mode (filesystem, graphapi, or hybrid)
     */
    sourceMode: EntitySourceMode;
    /**
     * Graph SSOT API URL (for graphapi/hybrid modes)
     */
    graphApiUrl?: string;
    /**
     * _codex path (for filesystem/hybrid modes)
     */
    codexPath?: string;
    /**
     * Project codes to filter (comma-separated, for graphapi/hybrid modes)
     */
    projectCodes?: string[];
}
/**
 * Load configuration from environment variables
 */
export declare function loadConfig(): BrainbaseConfig;
