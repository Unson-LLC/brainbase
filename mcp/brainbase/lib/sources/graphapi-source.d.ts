/**
 * Graph API Source
 * Loads entities from Graph SSOT API
 */
import type { EntitySource } from './entity-source.js';
import type { Project, Person, Organization, RACI, App, Customer, Decision } from '../indexer/types.js';
import { TokenManager } from '../auth/token-manager.js';
/**
 * GraphAPISource
 * Fetches entities from Graph SSOT API
 */
export declare class GraphAPISource implements EntitySource {
    private apiUrl;
    private tokenManager;
    private projectCodes?;
    private entities;
    constructor(apiUrl: string, tokenManager: TokenManager, projectCodes?: string[]);
    /**
     * Initialize: Fetch all entities from Graph API
     */
    initialize(): Promise<void>;
    /**
     * Fetch with retry on 401 (token expired)
     */
    private fetchWithRetry;
    /**
     * Filter entities by project codes (if specified)
     */
    private filterByProjectCodes;
    /**
     * Get all projects
     */
    getProjects(): Promise<Project[]>;
    /**
     * Get all people
     */
    getPeople(): Promise<Person[]>;
    /**
     * Get all organizations
     */
    getOrganizations(): Promise<Organization[]>;
    /**
     * Get all RACI definitions
     */
    getRACIs(): Promise<RACI[]>;
    /**
     * Get all apps
     */
    getApps(): Promise<App[]>;
    /**
     * Get all customers
     */
    getCustomers(): Promise<Customer[]>;
    /**
     * Get all decisions
     */
    getDecisions(): Promise<Decision[]>;
    /**
     * Convert Graph Entity to Project
     */
    private convertToProject;
    /**
     * Convert Graph Entity to Person
     */
    private convertToPerson;
    /**
     * Convert Graph Entity to Organization
     */
    private convertToOrg;
    /**
     * Convert Graph Entity to RACI
     */
    private convertToRACI;
    /**
     * Convert Graph Entity to App
     */
    private convertToApp;
    /**
     * Convert Graph Entity to Customer
     */
    private convertToCustomer;
    /**
     * Convert Graph Entity to Decision
     */
    private convertToDecision;
    /**
     * Ensure value is an array
     */
    private ensureArray;
}
