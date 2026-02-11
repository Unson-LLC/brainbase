/**
 * brainbase Entity Type Definitions
 */
export interface BaseEntity {
    id: string;
    filePath: string;
    updated?: string;
}
export interface Project extends BaseEntity {
    type: 'project';
    project_id: string;
    name: string;
    status: 'active' | 'paused' | 'archived' | string;
    team: string[];
    orgs: string[];
    apps: string[];
    customers: string[];
    content: string;
    beta_partners?: number;
}
export interface Person extends BaseEntity {
    type: 'person';
    name: string;
    role: string;
    org: string;
    org_tags: string[];
    projects: string[];
    aliases: string[];
    status: 'active' | 'inactive' | 'stakeholder' | string;
    content: string;
}
export interface Organization extends BaseEntity {
    type: 'org';
    org_id: string;
    name: string;
    aliases: string[];
    orgType: 'legal_entity' | 'brand' | 'internal' | 'partner' | string;
    content: string;
}
export interface RACI extends BaseEntity {
    type: 'raci';
    org_id: string;
    name: string;
    members: string[];
    positions: PositionEntry[];
    decisions: DecisionEntry[];
    assignments: AssignmentEntry[];
    products: string[];
    content: string;
    entries?: RACIEntry[];
    project_id?: string;
}
export interface PositionEntry {
    person: string;
    assets: string;
    authority: string;
}
export interface DecisionEntry {
    domain: string;
    decider: string;
}
export interface AssignmentEntry {
    person: string;
    areas: string;
}
export interface RACIEntry {
    item: string;
    responsible: string;
    accountable: string;
    consulted: string;
    informed: string;
}
export interface App extends BaseEntity {
    type: 'app';
    app_id: string;
    name: string;
    project: string;
    orgs: string[];
    status: string;
    description: string;
}
export interface Customer extends BaseEntity {
    type: 'customer';
    customer_id: string;
    name: string;
    salesOrg: string;
    implOrg: string;
    project: string;
    contractType: string;
    upfront: string;
    status: string;
    notes: string;
}
export interface Decision extends BaseEntity {
    type: 'decision';
    decision_id: string;
    title: string;
    content: string;
    decided_at: string;
    decider: string;
    project_id?: string;
    meeting_id?: string;
    status: 'active' | 'superseded' | 'deprecated' | string;
    tags: string[];
}
export type Entity = Project | Person | Organization | RACI | App | Customer | Decision;
export type EntityType = 'project' | 'person' | 'org' | 'raci' | 'app' | 'customer' | 'decision';
export interface EntityIndex {
    projects: Map<string, Project>;
    people: Map<string, Person>;
    orgs: Map<string, Organization>;
    raci: Map<string, RACI>;
    apps: Map<string, App>;
    customers: Map<string, Customer>;
    decisions: Map<string, Decision>;
    aliasToPersonId: Map<string, string>;
    aliasToOrgId: Map<string, string>;
}
export interface ParsedFile<T> {
    data: Partial<T>;
    content: string;
}
