/**
 * Graph API Source
 * Loads entities from Graph SSOT API
 */
/**
 * GraphAPISource
 * Fetches entities from Graph SSOT API
 */
export class GraphAPISource {
    apiUrl;
    tokenManager;
    projectCodes;
    entities = [];
    constructor(apiUrl, tokenManager, projectCodes) {
        this.apiUrl = apiUrl;
        this.tokenManager = tokenManager;
        this.projectCodes = projectCodes;
    }
    /**
     * Initialize: Fetch all entities from Graph API
     */
    async initialize() {
        console.error('[GraphAPISource] Fetching entities from Graph API...');
        const token = await this.tokenManager.getToken();
        const url = `${this.apiUrl}/api/info/graph/entities`;
        const response = await this.fetchWithRetry(url, token);
        if (!response.ok) {
            throw new Error(`Failed to fetch entities: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        this.entities = data.entities;
        console.error(`[GraphAPISource] Loaded ${this.entities.length} entities from Graph API`);
    }
    /**
     * Fetch with retry on 401 (token expired)
     */
    async fetchWithRetry(url, token) {
        let response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
        // Retry on 401 (token expired)
        if (response.status === 401) {
            console.error('[GraphAPISource] Token expired, refreshing...');
            await this.tokenManager.refresh();
            const newToken = await this.tokenManager.getToken();
            response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${newToken}`,
                    'Content-Type': 'application/json',
                },
            });
        }
        return response;
    }
    /**
     * Filter entities by project codes (if specified)
     */
    filterByProjectCodes(entities) {
        if (!this.projectCodes || this.projectCodes.length === 0) {
            return entities;
        }
        return entities.filter(entity => {
            if (entity.entity_type === 'project') {
                const projectCode = entity.payload.code || '';
                return this.projectCodes.includes(projectCode);
            }
            // For non-project entities, include all for now
            // (In the future, we could filter by related projects)
            return true;
        });
    }
    /**
     * Get all projects
     */
    async getProjects() {
        const projectEntities = this.entities.filter(e => e.entity_type === 'project');
        const filtered = this.filterByProjectCodes(projectEntities);
        return filtered.map(e => this.convertToProject(e));
    }
    /**
     * Get all people
     */
    async getPeople() {
        const peopleEntities = this.entities.filter(e => e.entity_type === 'person');
        return peopleEntities.map(e => this.convertToPerson(e));
    }
    /**
     * Get all organizations
     */
    async getOrganizations() {
        const orgEntities = this.entities.filter(e => e.entity_type === 'org');
        return orgEntities.map(e => this.convertToOrg(e));
    }
    /**
     * Get all RACI definitions
     */
    async getRACIs() {
        const raciEntities = this.entities.filter(e => e.entity_type === 'raci');
        return raciEntities.map(e => this.convertToRACI(e));
    }
    /**
     * Get all apps
     */
    async getApps() {
        const appEntities = this.entities.filter(e => e.entity_type === 'app');
        return appEntities.map(e => this.convertToApp(e));
    }
    /**
     * Get all customers
     */
    async getCustomers() {
        const customerEntities = this.entities.filter(e => e.entity_type === 'customer');
        return customerEntities.map(e => this.convertToCustomer(e));
    }
    /**
     * Get all decisions
     */
    async getDecisions() {
        const decisionEntities = this.entities.filter(e => e.entity_type === 'decision');
        return decisionEntities.map(e => this.convertToDecision(e));
    }
    /**
     * Convert Graph Entity to Project
     */
    convertToProject(entity) {
        const payload = entity.payload;
        return {
            id: payload.code || entity.entity_id,
            filePath: `[Graph API: ${entity.entity_id}]`,
            type: 'project',
            project_id: payload.code || entity.entity_id,
            name: payload.name || '',
            status: payload.status || 'active',
            team: this.ensureArray(payload.team),
            orgs: this.ensureArray(payload.orgs),
            apps: this.ensureArray(payload.apps),
            customers: this.ensureArray(payload.customers),
            content: payload.description || '',
            beta_partners: payload.beta_partners,
            updated: entity.updated_at,
        };
    }
    /**
     * Convert Graph Entity to Person
     */
    convertToPerson(entity) {
        const payload = entity.payload;
        return {
            id: entity.entity_id,
            filePath: `[Graph API: ${entity.entity_id}]`,
            type: 'person',
            name: payload.name || '',
            role: payload.role || '',
            org: payload.org || '',
            org_tags: this.ensureArray(payload.org_tags),
            projects: this.ensureArray(payload.projects),
            aliases: this.ensureArray(payload.aliases),
            status: payload.status || 'active',
            content: payload.bio || '',
            updated: entity.updated_at,
        };
    }
    /**
     * Convert Graph Entity to Organization
     */
    convertToOrg(entity) {
        const payload = entity.payload;
        return {
            id: payload.org_id || entity.entity_id,
            filePath: `[Graph API: ${entity.entity_id}]`,
            type: 'org',
            org_id: payload.org_id || entity.entity_id,
            name: payload.name || '',
            aliases: this.ensureArray(payload.aliases),
            orgType: payload.type || 'unknown',
            content: payload.description || '',
            updated: entity.updated_at,
        };
    }
    /**
     * Convert Graph Entity to RACI
     */
    convertToRACI(entity) {
        const payload = entity.payload;
        // Parse positions
        const positions = [];
        const positionsData = payload.positions;
        if (Array.isArray(positionsData)) {
            for (const pos of positionsData) {
                positions.push({
                    person: pos.person || '',
                    assets: pos.assets || '',
                    authority: pos.authority || '',
                });
            }
        }
        // Parse decisions
        const decisions = [];
        const decisionsData = payload.decisions;
        if (Array.isArray(decisionsData)) {
            for (const dec of decisionsData) {
                decisions.push({
                    domain: dec.domain || '',
                    decider: dec.decider || '',
                });
            }
        }
        // Parse assignments
        const assignments = [];
        const assignmentsData = payload.assignments;
        if (Array.isArray(assignmentsData)) {
            for (const assign of assignmentsData) {
                assignments.push({
                    person: assign.person || '',
                    areas: assign.areas || '',
                });
            }
        }
        return {
            id: payload.org_id || entity.entity_id,
            filePath: `[Graph API: ${entity.entity_id}]`,
            type: 'raci',
            org_id: payload.org_id || entity.entity_id,
            name: payload.name || '',
            members: this.ensureArray(payload.members),
            positions,
            decisions,
            assignments,
            products: this.ensureArray(payload.products),
            content: payload.description || '',
            updated: entity.updated_at,
        };
    }
    /**
     * Convert Graph Entity to App
     */
    convertToApp(entity) {
        const payload = entity.payload;
        return {
            id: payload.app_id || entity.entity_id,
            filePath: `[Graph API: ${entity.entity_id}]`,
            type: 'app',
            app_id: payload.app_id || entity.entity_id,
            name: payload.name || '',
            project: payload.project || '',
            orgs: this.ensureArray(payload.orgs),
            status: payload.status || '',
            description: payload.description || '',
            updated: entity.updated_at,
        };
    }
    /**
     * Convert Graph Entity to Customer
     */
    convertToCustomer(entity) {
        const payload = entity.payload;
        return {
            id: payload.customer_id || entity.entity_id,
            filePath: `[Graph API: ${entity.entity_id}]`,
            type: 'customer',
            customer_id: payload.customer_id || entity.entity_id,
            name: payload.name || '',
            salesOrg: payload.salesOrg || '',
            implOrg: payload.implOrg || '',
            project: payload.project || '',
            contractType: payload.contractType || '',
            upfront: payload.upfront || '',
            status: payload.status || '',
            notes: payload.notes || '',
            updated: entity.updated_at,
        };
    }
    /**
     * Convert Graph Entity to Decision
     */
    convertToDecision(entity) {
        const payload = entity.payload;
        return {
            id: payload.decision_id || entity.entity_id,
            filePath: `[Graph API: ${entity.entity_id}]`,
            type: 'decision',
            decision_id: payload.decision_id || entity.entity_id,
            title: payload.title || '',
            content: payload.content || payload.description || '',
            decided_at: payload.decided_at || '',
            decider: payload.decider || '',
            project_id: payload.project_id || undefined,
            meeting_id: payload.meeting_id || undefined,
            status: payload.status || 'active',
            tags: this.ensureArray(payload.tags),
            updated: entity.updated_at,
        };
    }
    /**
     * Ensure value is an array
     */
    ensureArray(value) {
        if (Array.isArray(value)) {
            return value.filter(v => typeof v === 'string');
        }
        if (typeof value === 'string' && value.trim()) {
            return value.split(',').map(s => s.trim());
        }
        return [];
    }
}
