/**
 * Hybrid Source
 * Prioritizes Graph API, falls back to filesystem on failure
 */
/**
 * HybridSource
 * API-first with filesystem fallback
 */
export class HybridSource {
    apiSource;
    fsSource;
    useApi = true;
    constructor(apiSource, fsSource) {
        this.apiSource = apiSource;
        this.fsSource = fsSource;
    }
    /**
     * Initialize both sources
     */
    async initialize() {
        console.error('[HybridSource] Initializing hybrid source (API-first with FS fallback)');
        // Try API first
        try {
            await this.apiSource.initialize();
            console.error('[HybridSource] API source initialized successfully');
            this.useApi = true;
        }
        catch (error) {
            console.error('[HybridSource] API source failed, falling back to filesystem:', error);
            this.useApi = false;
            // Fall back to filesystem
            await this.fsSource.initialize();
            console.error('[HybridSource] Filesystem source initialized successfully');
        }
    }
    /**
     * Get all projects
     */
    async getProjects() {
        return this.executeWithFallback(() => this.apiSource.getProjects(), () => this.fsSource.getProjects());
    }
    /**
     * Get all people
     */
    async getPeople() {
        return this.executeWithFallback(() => this.apiSource.getPeople(), () => this.fsSource.getPeople());
    }
    /**
     * Get all organizations
     */
    async getOrganizations() {
        return this.executeWithFallback(() => this.apiSource.getOrganizations(), () => this.fsSource.getOrganizations());
    }
    /**
     * Get all RACI definitions
     */
    async getRACIs() {
        return this.executeWithFallback(() => this.apiSource.getRACIs(), () => this.fsSource.getRACIs());
    }
    /**
     * Get all apps
     */
    async getApps() {
        return this.executeWithFallback(() => this.apiSource.getApps(), () => this.fsSource.getApps());
    }
    /**
     * Get all customers
     */
    async getCustomers() {
        return this.executeWithFallback(() => this.apiSource.getCustomers(), () => this.fsSource.getCustomers());
    }
    /**
     * Get all decisions
     */
    async getDecisions() {
        return this.executeWithFallback(() => this.apiSource.getDecisions(), () => this.fsSource.getDecisions());
    }
    /**
     * Execute with fallback
     */
    async executeWithFallback(apiCall, fsCall) {
        if (this.useApi) {
            try {
                return await apiCall();
            }
            catch (error) {
                console.error('[HybridSource] API call failed, falling back to filesystem:', error);
                this.useApi = false;
                return await fsCall();
            }
        }
        else {
            return await fsCall();
        }
    }
}
