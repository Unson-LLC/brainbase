/**
 * Hybrid Source
 * Prioritizes Graph API, falls back to filesystem on failure
 */
import type { EntitySource } from './entity-source.js';
import type { Project, Person, Organization, RACI, App, Customer, Decision } from '../indexer/types.js';
/**
 * HybridSource
 * API-first with filesystem fallback
 */
export declare class HybridSource implements EntitySource {
    private apiSource;
    private fsSource;
    private useApi;
    constructor(apiSource: EntitySource, fsSource: EntitySource);
    /**
     * Initialize both sources
     */
    initialize(): Promise<void>;
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
     * Execute with fallback
     */
    private executeWithFallback;
}
