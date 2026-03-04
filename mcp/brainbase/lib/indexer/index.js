/**
 * brainbase Entity Indexer
 * Builds entity index from EntitySource (filesystem, API, or hybrid)
 */
/**
 * Create an empty entity index
 */
function createEmptyIndex() {
    return {
        projects: new Map(),
        people: new Map(),
        orgs: new Map(),
        raci: new Map(),
        apps: new Map(),
        customers: new Map(),
        decisions: new Map(),
        aliasToPersonId: new Map(),
        aliasToOrgId: new Map(),
    };
}
/**
 * Build alias mappings for people
 */
function buildPersonAliases(index) {
    for (const person of index.people.values()) {
        // Map name -> personId
        if (person.name) {
            index.aliasToPersonId.set(person.name, person.id);
            // Also map name without spaces (for Japanese names)
            const noSpace = person.name.replace(/\s+/g, '');
            if (noSpace !== person.name) {
                index.aliasToPersonId.set(noSpace, person.id);
            }
        }
        // Map each alias -> personId
        for (const alias of person.aliases) {
            index.aliasToPersonId.set(alias, person.id);
        }
    }
}
/**
 * Build alias mappings for orgs
 */
function buildOrgAliases(index) {
    for (const org of index.orgs.values()) {
        // Map name -> orgId
        if (org.name) {
            index.aliasToOrgId.set(org.name, org.org_id);
        }
        // Map each alias -> orgId
        for (const alias of org.aliases) {
            index.aliasToOrgId.set(alias, org.org_id);
        }
    }
}
/**
 * Build the complete entity index from EntitySource
 */
export async function buildIndex(source) {
    const index = createEmptyIndex();
    // Initialize source
    await source.initialize();
    // Load all entities in parallel
    const [projects, people, orgs, racis, apps, customers, decisions] = await Promise.all([
        source.getProjects(),
        source.getPeople(),
        source.getOrganizations(),
        source.getRACIs(),
        source.getApps(),
        source.getCustomers(),
        source.getDecisions(),
    ]);
    // Populate index
    for (const project of projects) {
        index.projects.set(project.id, project);
    }
    for (const person of people) {
        index.people.set(person.id, person);
    }
    for (const org of orgs) {
        index.orgs.set(org.id, org);
    }
    for (const raci of racis) {
        index.raci.set(raci.id, raci);
    }
    for (const app of apps) {
        index.apps.set(app.id, app);
    }
    for (const customer of customers) {
        index.customers.set(customer.id, customer);
    }
    for (const decision of decisions) {
        index.decisions.set(decision.id, decision);
    }
    // Build alias mappings
    buildPersonAliases(index);
    buildOrgAliases(index);
    return index;
}
/**
 * Resolve a person name to their ID using alias mappings
 */
export function resolvePersonId(index, nameOrAlias) {
    // Direct lookup first
    if (index.people.has(nameOrAlias)) {
        return nameOrAlias;
    }
    // Try alias mapping
    return index.aliasToPersonId.get(nameOrAlias);
}
/**
 * Resolve an org name to its ID using alias mappings
 */
export function resolveOrgId(index, nameOrAlias) {
    // Direct lookup first
    if (index.orgs.has(nameOrAlias)) {
        return nameOrAlias;
    }
    // Try alias mapping
    return index.aliasToOrgId.get(nameOrAlias);
}
/**
 * Get all entities of a specific type
 */
export function getEntitiesByType(index, type) {
    switch (type) {
        case 'project':
            return Array.from(index.projects.values());
        case 'person':
            return Array.from(index.people.values());
        case 'org':
            return Array.from(index.orgs.values());
        case 'raci':
            return Array.from(index.raci.values());
        case 'app':
            return Array.from(index.apps.values());
        case 'customer':
            return Array.from(index.customers.values());
        case 'decision':
            return Array.from(index.decisions.values());
        default:
            return [];
    }
}
/**
 * Get an entity by type and ID
 */
export function getEntity(index, type, id) {
    switch (type) {
        case 'project':
            return index.projects.get(id);
        case 'person':
            return index.people.get(id) || index.people.get(resolvePersonId(index, id) || '');
        case 'org':
            return index.orgs.get(id) || index.orgs.get(resolveOrgId(index, id) || '');
        case 'raci':
            return index.raci.get(id);
        case 'app':
            return index.apps.get(id);
        case 'customer':
            return index.customers.get(id);
        case 'decision':
            return index.decisions.get(id);
        default:
            return undefined;
    }
}
/**
 * Search entities by keyword in content and names
 */
export function searchEntities(index, query) {
    const results = [];
    const lowerQuery = query.toLowerCase();
    // Search all entity types
    const allEntities = [
        ...index.projects.values(),
        ...index.people.values(),
        ...index.orgs.values(),
        ...index.raci.values(),
        ...index.apps.values(),
        ...index.customers.values(),
        ...index.decisions.values(),
    ];
    for (const entity of allEntities) {
        // Check name/title - all entity types now have 'name' property
        const name = entity.name || entity.id;
        if (name.toLowerCase().includes(lowerQuery)) {
            results.push(entity);
            continue;
        }
        // Check content
        if ('content' in entity && entity.content.toLowerCase().includes(lowerQuery)) {
            results.push(entity);
            continue;
        }
        // Check aliases for person/org
        if ('aliases' in entity) {
            const aliases = entity.aliases;
            if (aliases.some(alias => alias.toLowerCase().includes(lowerQuery))) {
                results.push(entity);
                continue;
            }
        }
        // Check description for apps
        if (entity.type === 'app' && entity.description.toLowerCase().includes(lowerQuery)) {
            results.push(entity);
        }
    }
    return results;
}
/**
 * Get context for a specific topic/entity
 * Returns relevant entities and their relationships
 */
export function getContextForTopic(index, topic) {
    // Try to find the primary entity
    let primary;
    const related = [];
    // Search across entity types
    const lowerTopic = topic.toLowerCase();
    // Check projects
    for (const project of index.projects.values()) {
        if (project.project_id.toLowerCase() === lowerTopic ||
            project.name.toLowerCase().includes(lowerTopic)) {
            primary = project;
            break;
        }
    }
    // Check people
    if (!primary) {
        const personId = resolvePersonId(index, topic);
        if (personId) {
            primary = index.people.get(personId);
        }
    }
    // Check orgs
    if (!primary) {
        const orgId = resolveOrgId(index, topic);
        if (orgId) {
            primary = index.orgs.get(orgId);
        }
    }
    // If we found a primary, gather related entities
    if (primary) {
        if (primary.type === 'project') {
            // Get team members
            for (const memberName of primary.team) {
                const personId = resolvePersonId(index, memberName);
                if (personId) {
                    const person = index.people.get(personId);
                    if (person)
                        related.push(person);
                }
            }
            // Get related orgs
            for (const orgTag of primary.orgs) {
                const orgId = resolveOrgId(index, orgTag);
                if (orgId) {
                    const org = index.orgs.get(orgId);
                    if (org)
                        related.push(org);
                }
            }
            // Get RACI for related orgs (new format: RACI is per-org, not per-project)
            for (const orgTag of primary.orgs) {
                const orgId = resolveOrgId(index, orgTag);
                if (orgId) {
                    const raci = index.raci.get(orgId);
                    if (raci && !related.includes(raci))
                        related.push(raci);
                }
            }
            // Legacy: try project_id based RACI
            const legacyRaci = index.raci.get(primary.project_id);
            if (legacyRaci && !related.includes(legacyRaci))
                related.push(legacyRaci);
        }
        else if (primary.type === 'person') {
            // Get person's projects
            for (const projectId of primary.projects) {
                const project = index.projects.get(projectId);
                if (project)
                    related.push(project);
            }
            // Get person's orgs
            for (const orgTag of primary.org_tags) {
                const orgId = resolveOrgId(index, orgTag);
                if (orgId) {
                    const org = index.orgs.get(orgId);
                    if (org)
                        related.push(org);
                }
            }
        }
        else if (primary.type === 'org') {
            // Get projects associated with this org
            for (const project of index.projects.values()) {
                if (project.orgs.includes(primary.org_id)) {
                    related.push(project);
                }
            }
            // Get people in this org
            for (const person of index.people.values()) {
                if (person.org_tags.includes(primary.org_id)) {
                    related.push(person);
                }
            }
            // Get RACI for this org
            const raci = index.raci.get(primary.org_id);
            if (raci)
                related.push(raci);
        }
    }
    return { primary, related };
}
