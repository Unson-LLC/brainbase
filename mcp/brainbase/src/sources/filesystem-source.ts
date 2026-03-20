/**
 * Filesystem Source
 * Loads entities from local _codex directory (existing implementation)
 */

import { readdir, readFile } from 'fs/promises';
import { join, basename, dirname } from 'path';
import type { EntitySource } from './entity-source.js';
import type {
  Project,
  Person,
  Organization,
  RACI,
  App,
  Customer,
  Decision,
} from '../indexer/types.js';
import { parseMarkdownFile, parseMarkdownString, ensureArray, extractIdFromPath } from '../indexer/frontmatter.js';
import { parseAppsTable, parseCustomersTable, parseRACITable, parsePositionTable, parseDecisionTable, parseAssignmentTable, parseProductsList } from '../indexer/table.js';

/**
 * FilesystemSource
 * Loads entities from local _codex directory
 */
export class FilesystemSource implements EntitySource {
  private codexPath: string;

  constructor(codexPath: string) {
    this.codexPath = codexPath;
  }

  /**
   * Initialize (no-op for filesystem)
   */
  async initialize(): Promise<void> {
    console.error(`[FilesystemSource] Loading entities from: ${this.codexPath}`);
  }

  /**
   * Get all projects
   */
  async getProjects(): Promise<Project[]> {
    const projects: Project[] = [];
    const projectsDir = join(this.codexPath, 'projects');
    const files = await this.scanDirectory(projectsDir);

    for (const filePath of files) {
      // Support nested project structure:
      // e.g. projects/baao/project.md and projects/baao/training/project.md
      if (basename(filePath) !== 'project.md') continue;

      try {
        const parsed = await parseMarkdownFile<{
          project_id?: string;
          name?: string;
          status?: string;
          team?: string | string[];
          orgs?: string | string[];
          apps?: string | string[];
          customers?: string | string[];
          updated?: string;
          beta_partners?: number;
        }>(filePath);

        const fallbackId = basename(dirname(filePath));
        const projectId = parsed.data.project_id || fallbackId;
        const project: Project = {
          id: projectId,
          filePath,
          type: 'project',
          project_id: projectId,
          name: parsed.data.name || fallbackId,
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
      } catch {
        // Skip files that can't be parsed
      }
    }

    return projects;
  }

  /**
   * Get all people
   */
  async getPeople(): Promise<Person[]> {
    const people: Person[] = [];
    const peopleDir = join(this.codexPath, 'common', 'meta', 'people');
    const files = await this.scanDirectory(peopleDir);

    for (const filePath of files) {
      const fileName = basename(filePath);
      if (fileName === 'README.md' || fileName === 'index.md') continue;

      try {
        const parsed = await parseMarkdownFile<{
          name?: string;
          role?: string;
          org?: string;
          org_tags?: string | string[];
          projects?: string | string[];
          aliases?: string | string[];
          status?: string;
          updated?: string;
        }>(filePath);

        const personId = extractIdFromPath(filePath);
        const person: Person = {
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
      } catch {
        // Skip files that can't be parsed
      }
    }

    return people;
  }

  /**
   * Get all organizations
   */
  async getOrganizations(): Promise<Organization[]> {
    const orgs: Organization[] = [];
    const orgsDir = join(this.codexPath, 'orgs');
    const files = await this.scanDirectory(orgsDir);

    for (const filePath of files) {
      try {
        const parsed = await parseMarkdownFile<{
          org_id?: string;
          name?: string;
          aliases?: string | string[];
          type?: string;
          updated?: string;
        }>(filePath);

        const orgId = parsed.data.org_id || extractIdFromPath(filePath);
        const org: Organization = {
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
      } catch {
        // Skip files that can't be parsed
      }
    }

    return orgs;
  }

  /**
   * Get all RACI definitions
   */
  async getRACIs(): Promise<RACI[]> {
    const racis: RACI[] = [];
    const raciDir = join(this.codexPath, 'common', 'meta', 'raci');
    const files = await this.scanDirectory(raciDir);

    for (const filePath of files) {
      // Skip README.md
      if (basename(filePath) === 'README.md') continue;

      try {
        const content = await readFile(filePath, 'utf-8');
        const raciId = extractIdFromPath(filePath);

        // Parse frontmatter for org_id, name, members
        const parsed = parseMarkdownString<{
          org_id?: string;
          name?: string;
          members?: string | string[];
          project_id?: string;  // Legacy
          updated?: string;
        }>(content);

        // Parse new position-based tables
        const positions = parsePositionTable(content);
        const decisions = parseDecisionTable(content);
        const assignments = parseAssignmentTable(content);
        const products = parseProductsList(content);

        // Parse legacy RACI table (for backward compatibility)
        const entries = parseRACITable(content);

        const raci: RACI = {
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
      } catch {
        // Skip files that can't be parsed
      }
    }

    return racis;
  }

  /**
   * Get all apps
   */
  async getApps(): Promise<App[]> {
    const apps: App[] = [];
    const appsFile = join(this.codexPath, 'common', 'meta', 'apps.md');

    try {
      const content = await readFile(appsFile, 'utf-8');
      const appsData = parseAppsTable(content);

      for (const appData of appsData) {
        if (!appData.app_id) continue;

        const app: App = {
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
    } catch {
      // apps.md doesn't exist or can't be parsed
    }

    return apps;
  }

  /**
   * Get all customers
   */
  async getCustomers(): Promise<Customer[]> {
    const customers: Customer[] = [];
    const customersFile = join(this.codexPath, 'common', 'meta', 'customers.md');

    try {
      const content = await readFile(customersFile, 'utf-8');
      const customersData = parseCustomersTable(content);

      for (const custData of customersData) {
        if (!custData.customer_id) continue;

        const customer: Customer = {
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
    } catch {
      // customers.md doesn't exist or can't be parsed
    }

    return customers;
  }

  /**
   * Get all decisions
   */
  async getDecisions(): Promise<Decision[]> {
    const decisions: Decision[] = [];

    // Scan common/meta/decisions/
    const commonDecisionsDir = join(this.codexPath, 'common', 'meta', 'decisions');
    const commonFiles = await this.scanDirectory(commonDecisionsDir);

    for (const filePath of commonFiles) {
      try {
        const parsed = await parseMarkdownFile<{
          decision_id?: string;
          title?: string;
          decided_at?: string;
          decider?: string;
          project_id?: string;
          meeting_id?: string;
          status?: string;
          tags?: string | string[];
          updated?: string;
        }>(filePath);

        const decisionId = parsed.data.decision_id || extractIdFromPath(filePath);
        const decision: Decision = {
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
      } catch {
        // Skip files that can't be parsed
      }
    }

    // Scan projects/*/decisions/
    const projectsDir = join(this.codexPath, 'projects');
    try {
      const projectEntries = await readdir(projectsDir, { withFileTypes: true });

      for (const projectEntry of projectEntries) {
        if (!projectEntry.isDirectory()) continue;

        const projectDecisionsDir = join(projectsDir, projectEntry.name, 'decisions');
        const projectFiles = await this.scanDirectory(projectDecisionsDir);

        for (const filePath of projectFiles) {
          try {
            const parsed = await parseMarkdownFile<{
              decision_id?: string;
              title?: string;
              decided_at?: string;
              decider?: string;
              meeting_id?: string;
              status?: string;
              tags?: string | string[];
              updated?: string;
            }>(filePath);

            const decisionId = parsed.data.decision_id || extractIdFromPath(filePath);
            const decision: Decision = {
              id: `${projectEntry.name}-${decisionId}`,
              filePath,
              type: 'decision',
              decision_id: decisionId,
              title: parsed.data.title || decisionId,
              content: parsed.content,
              decided_at: parsed.data.decided_at || '',
              decider: parsed.data.decider || '',
              project_id: projectEntry.name,  // Auto-assign project_id
              meeting_id: parsed.data.meeting_id,
              status: parsed.data.status || 'active',
              tags: ensureArray(parsed.data.tags),
              updated: parsed.data.updated,
            };

            decisions.push(decision);
          } catch {
            // Skip files that can't be parsed
          }
        }
      }
    } catch {
      // projects/ directory doesn't exist
    }

    return decisions;
  }

  /**
   * Scan a directory for markdown files
   */
  private async scanDirectory(dirPath: string): Promise<string[]> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const mdFiles: string[] = [];

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isFile() && entry.name.endsWith('.md')) {
          mdFiles.push(fullPath);
        } else if (entry.isDirectory()) {
          // Recursively scan subdirectories
          const subFiles = await this.scanDirectory(fullPath);
          mdFiles.push(...subFiles);
        }
      }

      return mdFiles;
    } catch {
      return [];
    }
  }
}
