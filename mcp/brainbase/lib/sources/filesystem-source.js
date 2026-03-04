/**
 * Filesystem Source
 * Loads entities from local _codex directory (existing implementation)
 */
import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { parseMarkdownFile, parseMarkdownString, ensureArray, extractIdFromPath } from '../indexer/frontmatter.js';
import { parseAppsTable, parseCustomersTable, parseRACITable, parsePositionTable, parseDecisionTable, parseAssignmentTable, parseProductsList } from '../indexer/table.js';
/**
 * FilesystemSource
 * Loads entities from local _codex directory
 */
export class FilesystemSource {
    codexPath;
    constructor(codexPath) {
        this.codexPath = codexPath;
    }
    /**
     * Initialize (no-op for filesystem)
     */
    async initialize() {
        console.error(`[FilesystemSource] Loading entities from: ${this.codexPath}`);
    }
    /**
     * Get all projects
     */
    async getProjects() {
        const projects = [];
        const projectsDir = join(this.codexPath, 'projects');
        const entries = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const projectFile = join(projectsDir, entry.name, 'project.md');
            try {
                await stat(projectFile);
                const parsed = await parseMarkdownFile(projectFile);
                const projectId = parsed.data.project_id || entry.name;
                const project = {
                    id: projectId,
                    filePath: projectFile,
                    type: 'project',
                    project_id: projectId,
                    name: parsed.data.name || entry.name,
                    status: parsed.data.status || 'active',
                    team: ensureArray(parsed.data.team),
                    orgs: ensureArray(parsed.data.orgs),
                    apps: ensureArray(parsed.data.apps),
                    customers: ensureArray(parsed.data.customers),
                    content: parsed.content,
                    updated: parsed.data.updated,
                    beta_partners: parsed.data.beta_partners,
                };
                projects.push(project);
            }
            catch {
                // Skip if project.md doesn't exist
            }
        }
        return projects;
    }
    /**
     * Get all people
     */
    async getPeople() {
        const people = [];
        const peopleDir = join(this.codexPath, 'common', 'meta', 'people');
        const files = await this.scanDirectory(peopleDir);
        for (const filePath of files) {
            const fileName = basename(filePath);
            if (fileName === 'README.md' || fileName === 'index.md')
                continue;
            try {
                const parsed = await parseMarkdownFile(filePath);
                const personId = extractIdFromPath(filePath);
                const person = {
                    id: personId,
                    filePath,
                    type: 'person',
                    name: parsed.data.name || personId,
                    role: parsed.data.role || '',
                    org: parsed.data.org || '',
                    org_tags: ensureArray(parsed.data.org_tags),
                    projects: ensureArray(parsed.data.projects),
                    aliases: ensureArray(parsed.data.aliases),
                    status: parsed.data.status || 'active',
                    content: parsed.content,
                    updated: parsed.data.updated,
                };
                people.push(person);
            }
            catch {
                // Skip files that can't be parsed
            }
        }
        return people;
    }
    /**
     * Get all organizations
     */
    async getOrganizations() {
        const orgs = [];
        const orgsDir = join(this.codexPath, 'orgs');
        const files = await this.scanDirectory(orgsDir);
        for (const filePath of files) {
            try {
                const parsed = await parseMarkdownFile(filePath);
                const orgId = parsed.data.org_id || extractIdFromPath(filePath);
                const org = {
                    id: orgId,
                    filePath,
                    type: 'org',
                    org_id: orgId,
                    name: parsed.data.name || orgId,
                    aliases: ensureArray(parsed.data.aliases),
                    orgType: parsed.data.type || 'unknown',
                    content: parsed.content,
                    updated: parsed.data.updated,
                };
                orgs.push(org);
            }
            catch {
                // Skip files that can't be parsed
            }
        }
        return orgs;
    }
    /**
     * Get all RACI definitions
     */
    async getRACIs() {
        const racis = [];
        const raciDir = join(this.codexPath, 'common', 'meta', 'raci');
        const files = await this.scanDirectory(raciDir);
        for (const filePath of files) {
            // Skip README.md
            if (basename(filePath) === 'README.md')
                continue;
            try {
                const content = await readFile(filePath, 'utf-8');
                const raciId = extractIdFromPath(filePath);
                // Parse frontmatter for org_id, name, members
                const parsed = parseMarkdownString(content);
                // Parse new position-based tables
                const positions = parsePositionTable(content);
                const decisions = parseDecisionTable(content);
                const assignments = parseAssignmentTable(content);
                const products = parseProductsList(content);
                // Parse legacy RACI table (for backward compatibility)
                const entries = parseRACITable(content);
                const raci = {
                    id: raciId,
                    filePath,
                    type: 'raci',
                    org_id: parsed.data.org_id || raciId,
                    name: parsed.data.name || raciId,
                    members: ensureArray(parsed.data.members),
                    positions,
                    decisions,
                    assignments,
                    products,
                    content: parsed.content,
                    updated: parsed.data.updated,
                    // Legacy support
                    entries: entries.length > 0 ? entries : undefined,
                    project_id: parsed.data.project_id,
                };
                racis.push(raci);
            }
            catch {
                // Skip files that can't be parsed
            }
        }
        return racis;
    }
    /**
     * Get all apps
     */
    async getApps() {
        const apps = [];
        const appsFile = join(this.codexPath, 'common', 'meta', 'apps.md');
        try {
            const content = await readFile(appsFile, 'utf-8');
            const appsData = parseAppsTable(content);
            for (const appData of appsData) {
                if (!appData.app_id)
                    continue;
                const app = {
                    id: appData.app_id,
                    filePath: appsFile,
                    type: 'app',
                    app_id: appData.app_id,
                    name: appData.name,
                    project: appData.project,
                    orgs: appData.orgs,
                    status: appData.status,
                    description: appData.description,
                };
                apps.push(app);
            }
        }
        catch {
            // apps.md doesn't exist or can't be parsed
        }
        return apps;
    }
    /**
     * Get all customers
     */
    async getCustomers() {
        const customers = [];
        const customersFile = join(this.codexPath, 'common', 'meta', 'customers.md');
        try {
            const content = await readFile(customersFile, 'utf-8');
            const customersData = parseCustomersTable(content);
            for (const custData of customersData) {
                if (!custData.customer_id)
                    continue;
                const customer = {
                    id: custData.customer_id,
                    filePath: customersFile,
                    type: 'customer',
                    customer_id: custData.customer_id,
                    name: custData.name,
                    salesOrg: custData.salesOrg,
                    implOrg: custData.implOrg,
                    project: custData.project,
                    contractType: custData.contractType,
                    upfront: custData.upfront,
                    status: custData.status,
                    notes: custData.notes,
                };
                customers.push(customer);
            }
        }
        catch {
            // customers.md doesn't exist or can't be parsed
        }
        return customers;
    }
    /**
     * Get all decisions
     */
    async getDecisions() {
        const decisions = [];
        // Scan common/meta/decisions/
        const commonDecisionsDir = join(this.codexPath, 'common', 'meta', 'decisions');
        const commonFiles = await this.scanDirectory(commonDecisionsDir);
        for (const filePath of commonFiles) {
            try {
                const parsed = await parseMarkdownFile(filePath);
                const decisionId = parsed.data.decision_id || extractIdFromPath(filePath);
                const decision = {
                    id: decisionId,
                    filePath,
                    type: 'decision',
                    decision_id: decisionId,
                    title: parsed.data.title || decisionId,
                    content: parsed.content,
                    decided_at: parsed.data.decided_at || '',
                    decider: parsed.data.decider || '',
                    project_id: parsed.data.project_id,
                    meeting_id: parsed.data.meeting_id,
                    status: parsed.data.status || 'active',
                    tags: ensureArray(parsed.data.tags),
                    updated: parsed.data.updated,
                };
                decisions.push(decision);
            }
            catch {
                // Skip files that can't be parsed
            }
        }
        // Scan projects/*/decisions/
        const projectsDir = join(this.codexPath, 'projects');
        try {
            const projectEntries = await readdir(projectsDir, { withFileTypes: true });
            for (const projectEntry of projectEntries) {
                if (!projectEntry.isDirectory())
                    continue;
                const projectDecisionsDir = join(projectsDir, projectEntry.name, 'decisions');
                const projectFiles = await this.scanDirectory(projectDecisionsDir);
                for (const filePath of projectFiles) {
                    try {
                        const parsed = await parseMarkdownFile(filePath);
                        const decisionId = parsed.data.decision_id || extractIdFromPath(filePath);
                        const decision = {
                            id: `${projectEntry.name}-${decisionId}`,
                            filePath,
                            type: 'decision',
                            decision_id: decisionId,
                            title: parsed.data.title || decisionId,
                            content: parsed.content,
                            decided_at: parsed.data.decided_at || '',
                            decider: parsed.data.decider || '',
                            project_id: projectEntry.name, // Auto-assign project_id
                            meeting_id: parsed.data.meeting_id,
                            status: parsed.data.status || 'active',
                            tags: ensureArray(parsed.data.tags),
                            updated: parsed.data.updated,
                        };
                        decisions.push(decision);
                    }
                    catch {
                        // Skip files that can't be parsed
                    }
                }
            }
        }
        catch {
            // projects/ directory doesn't exist
        }
        return decisions;
    }
    /**
     * Scan a directory for markdown files
     */
    async scanDirectory(dirPath) {
        try {
            const entries = await readdir(dirPath, { withFileTypes: true });
            const mdFiles = [];
            for (const entry of entries) {
                const fullPath = join(dirPath, entry.name);
                if (entry.isFile() && entry.name.endsWith('.md')) {
                    mdFiles.push(fullPath);
                }
                else if (entry.isDirectory()) {
                    // Recursively scan subdirectories
                    const subFiles = await this.scanDirectory(fullPath);
                    mdFiles.push(...subFiles);
                }
            }
            return mdFiles;
        }
        catch {
            return [];
        }
    }
}
