/**
 * Entity Source Interface
 * Abstraction for loading entities from different sources (filesystem, API, etc.)
 */
import type { Project, Person, Organization, RACI, App, Customer, Decision } from '../indexer/types.js';
/**
 * EntitySource interface
 * Defines how to load entities from a data source
 */
export interface EntitySource {
    /**
     * Initialize the source (if needed)
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
}
