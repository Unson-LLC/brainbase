/**
 * Filesystem Source
 * Loads entities from local _codex directory (existing implementation)
 */
import type { EntitySource } from './entity-source.js';
import type { Project, Person, Organization, RACI, App, Customer, Decision } from '../indexer/types.js';
/**
 * FilesystemSource
 * Loads entities from local _codex directory
 */
export declare class FilesystemSource implements EntitySource {
    private codexPath;
    constructor(codexPath: string);
    /**
     * Initialize (no-op for filesystem)
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
     * Scan a directory for markdown files
     */
    private scanDirectory;
}
