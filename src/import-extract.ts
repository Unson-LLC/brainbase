import type { DecisionRecord, GraphEntity, PersonalKgEntry, RelationshipRecord } from './types.js';

export type SourceProvider = 'gmail' | 'calendar' | 'drive' | 'local';

export interface GmailSourceRecord {
  kind: 'gmail';
  id: string;
  threadId?: string;
  from: Participant;
  to: Participant[];
  cc: Participant[];
  subject: string;
  date?: string;
  labels: string[];
  snippet: string;
}

export interface CalendarSourceRecord {
  kind: 'calendar';
  id: string;
  summary: string;
  start?: string;
  end?: string;
  organizer?: Participant;
  attendees: Participant[];
  location?: string;
  status?: string;
  description?: string;
}

export interface DriveSourceRecord {
  kind: 'drive';
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  owners: Participant[];
  parents: string[];
}

export interface LocalSourceRecord {
  kind: 'local';
  path: string;
  title: string;
  modified?: string;
  taskLines: string[];
}

export type SourceRecord = GmailSourceRecord | CalendarSourceRecord | DriveSourceRecord | LocalSourceRecord;

export interface Participant {
  email?: string;
  name?: string;
}

export interface ImportResult {
  provider: SourceProvider;
  sourcePath: string;
  count: number;
  records: SourceRecord[];
}

const PROVIDER_SOURCE_PATH: Record<SourceProvider, string> = {
  gmail: 'sources/gmail/threads.jsonl',
  calendar: 'sources/calendar/events.jsonl',
  drive: 'sources/drive/files.jsonl',
  local: 'sources/drive/local-files.jsonl'
};

const CONSUMER_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'yahoo.co.jp',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'docomo.ne.jp',
  'ezweb.ne.jp',
  'au.com',
  'softbank.ne.jp'
]);

const TASK_KEYWORDS = ['todo', 'follow up', 'followup', 'send', 'review', 'draft', 'prepare', 'reply', 'schedule', '対応', '確認', '送付', '返信', '準備', 'タスク', '提出', 'レビュー'];

export function sourcePathFor(provider: SourceProvider): string {
  return PROVIDER_SOURCE_PATH[provider];
}

export function parseProvider(value: string | undefined): SourceProvider {
  if (value === 'gmail' || value === 'calendar' || value === 'drive' || value === 'local') {
    return value;
  }
  throw new Error('onboard:import requires --source gmail|calendar|drive|local');
}

export interface NormalizeOptions {
  includeDescriptions?: boolean;
}

export function normalizeSource(provider: SourceProvider, raw: unknown, options: NormalizeOptions = {}): SourceRecord[] {
  const items = unwrapArray(provider, raw);
  switch (provider) {
    case 'gmail':
      return items.map((item, index) => normalizeGmail(item, index));
    case 'calendar':
      return items.map((item, index) => normalizeCalendar(item, index, options));
    case 'drive':
      return items.map((item, index) => normalizeDrive(item, index));
    case 'local':
      return items.map((item, index) => normalizeLocal(item, index));
    default:
      return [];
  }
}

export function renderSourceJsonl(records: SourceRecord[]): string {
  if (records.length === 0) {
    return '';
  }
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function unwrapArray(provider: SourceProvider, raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.filter(isRecord);
  }
  if (isRecord(raw)) {
    const containerKeys = ['messages', 'threads', 'events', 'items', 'files', 'records', provider, `${provider}s`];
    for (const key of containerKeys) {
      const value = raw[key];
      if (Array.isArray(value)) {
        return value.filter(isRecord);
      }
    }
  }
  throw new Error(`Could not find an array of ${provider} records in the imported JSON.`);
}

function normalizeGmail(item: Record<string, unknown>, index: number): GmailSourceRecord {
  return {
    kind: 'gmail',
    id: readString(item, ['id', 'messageId', 'threadId']) || `gmail-${index}`,
    threadId: readString(item, ['threadId', 'thread_id']) || undefined,
    from: parseParticipant(firstDefined(item, ['from', 'sender'])),
    to: parseParticipants(firstDefined(item, ['to', 'recipients'])),
    cc: parseParticipants(firstDefined(item, ['cc'])),
    subject: readString(item, ['subject', 'title']),
    date: readString(item, ['date', 'internalDate', 'receivedAt']) || undefined,
    labels: readStringArray(item, ['labels', 'labelIds']),
    snippet: truncate(readString(item, ['snippet', 'preview']), 280)
  };
}

function normalizeCalendar(item: Record<string, unknown>, index: number, options: NormalizeOptions): CalendarSourceRecord {
  const organizer = firstDefined(item, ['organizer', 'creator']);
  const record: CalendarSourceRecord = {
    kind: 'calendar',
    id: readString(item, ['id', 'iCalUID', 'eventId']) || `calendar-${index}`,
    summary: readString(item, ['summary', 'title', 'subject']),
    start: readDateField(firstDefined(item, ['start', 'startTime'])) || undefined,
    end: readDateField(firstDefined(item, ['end', 'endTime'])) || undefined,
    organizer: organizer ? parseParticipant(organizer) : undefined,
    attendees: parseParticipants(firstDefined(item, ['attendees', 'participants'])),
    location: readString(item, ['location']) || undefined,
    status: readString(item, ['status']) || undefined
  };
  if (options.includeDescriptions) {
    const description = truncate(readString(item, ['description', 'notes']), 280);
    if (description) {
      record.description = description;
    }
  }
  return record;
}

function normalizeDrive(item: Record<string, unknown>, index: number): DriveSourceRecord {
  return {
    kind: 'drive',
    id: readString(item, ['id', 'fileId']) || `drive-${index}`,
    name: readString(item, ['name', 'title']),
    mimeType: readString(item, ['mimeType', 'mime_type']) || undefined,
    modifiedTime: readString(item, ['modifiedTime', 'modified', 'updatedAt']) || undefined,
    owners: parseParticipants(firstDefined(item, ['owners'])),
    parents: readStringArray(item, ['parents', 'parentIds'])
  };
}

function normalizeLocal(item: Record<string, unknown>, index: number): LocalSourceRecord {
  const path = readString(item, ['path', 'file', 'name']) || `local-${index}`;
  const explicitTasks = readStringArray(item, ['taskLines', 'tasks']);
  const excerptTasks = extractTaskLines(readString(item, ['excerpt', 'preview', 'content']));
  return {
    kind: 'local',
    path,
    title: readString(item, ['title']) || basename(path),
    modified: readString(item, ['modified', 'modifiedTime', 'updatedAt']) || undefined,
    taskLines: dedupe([...explicitTasks, ...excerptTasks]).slice(0, 20)
  };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export type CandidateKind = 'person' | 'org' | 'project' | 'relationship' | 'next_action';

export interface ExtractedCandidate {
  id: string;
  kind: CandidateKind;
  payload: Record<string, string | string[] | undefined>;
  provenance: {
    count: number;
    sources: string[];
  };
  source: 'source-extraction';
  promoted: false;
}

export interface ExtractedCandidateSet {
  goal: string;
  canonicalWrites: false;
  candidatePath: string;
  counts: Record<CandidateKind, number>;
  candidates: ExtractedCandidate[];
  safetyRules: string[];
  nextCommands: string[];
}

export interface ExtractOptions {
  selfEmails?: string[];
  topRelationships?: number;
}

export function extractCandidates(records: SourceRecord[], options: ExtractOptions = {}): ExtractedCandidate[] {
  const selfEmails = new Set((options.selfEmails ?? []).map((email) => email.toLowerCase()));
  const topRelationships = options.topRelationships ?? 8;

  const people = new Map<string, { name?: string; email: string; count: number; sources: Set<string> }>();
  const orgs = new Map<string, { domain: string; count: number; sources: Set<string> }>();
  const projects = new Map<string, { name: string; count: number; sources: Set<string> }>();
  const nextActions = new Map<string, { text: string; sources: Set<string> }>();

  const notePerson = (participant: Participant, source: string): void => {
    const email = participant.email?.trim().toLowerCase();
    if (!email || selfEmails.has(email)) {
      return;
    }
    const existing = people.get(email) ?? { email, name: undefined, count: 0, sources: new Set<string>() };
    existing.count += 1;
    existing.sources.add(source);
    if (!existing.name && participant.name) {
      existing.name = participant.name;
    }
    people.set(email, existing);

    const domain = email.split('@')[1];
    if (domain && !CONSUMER_EMAIL_DOMAINS.has(domain)) {
      const org = orgs.get(domain) ?? { domain, count: 0, sources: new Set<string>() };
      org.count += 1;
      org.sources.add(source);
      orgs.set(domain, org);
    }
  };

  const noteProject = (rawName: string, source: string): void => {
    const name = rawName.trim();
    if (!name) {
      return;
    }
    const key = normalizeTitle(name);
    if (!key) {
      return;
    }
    const existing = projects.get(key) ?? { name, count: 0, sources: new Set<string>() };
    existing.count += 1;
    existing.sources.add(source);
    projects.set(key, existing);
  };

  const noteAction = (text: string, source: string): void => {
    const cleaned = text.trim();
    if (!cleaned) {
      return;
    }
    const key = normalizeTitle(cleaned);
    const existing = nextActions.get(key) ?? { text: cleaned, sources: new Set<string>() };
    existing.sources.add(source);
    nextActions.set(key, existing);
  };

  for (const record of records) {
    if (record.kind === 'gmail') {
      notePerson(record.from, 'gmail');
      record.to.forEach((participant) => notePerson(participant, 'gmail'));
      record.cc.forEach((participant) => notePerson(participant, 'gmail'));
      if (looksLikeTask(record.subject)) {
        noteAction(record.subject, 'gmail');
      }
    } else if (record.kind === 'calendar') {
      if (record.organizer) {
        notePerson(record.organizer, 'calendar');
      }
      record.attendees.forEach((participant) => notePerson(participant, 'calendar'));
      noteProject(record.summary, 'calendar');
      if (looksLikeTask(record.summary)) {
        noteAction(record.summary, 'calendar');
      }
    } else if (record.kind === 'drive') {
      record.owners.forEach((participant) => notePerson(participant, 'drive'));
      noteProject(record.name, 'drive');
    } else if (record.kind === 'local') {
      record.taskLines.forEach((line) => noteAction(line, 'local'));
    }
  }

  const candidates: ExtractedCandidate[] = [];

  const rankedPeople = [...people.values()].sort(byCountThenKey((person) => person.email));
  for (const person of rankedPeople) {
    const displayName = person.name || person.email;
    candidates.push({
      id: `person-${stableHash(person.email)}`,
      kind: 'person',
      payload: { name: displayName, email: person.email },
      provenance: { count: person.count, sources: sortedSources(person.sources) },
      source: 'source-extraction',
      promoted: false
    });
  }

  for (const org of [...orgs.values()].sort(byCountThenKey((entry) => entry.domain))) {
    candidates.push({
      id: `org-${stableHash(org.domain)}`,
      kind: 'org',
      payload: { name: org.domain, domain: org.domain },
      provenance: { count: org.count, sources: sortedSources(org.sources) },
      source: 'source-extraction',
      promoted: false
    });
  }

  for (const project of [...projects.values()].filter((entry) => entry.count >= 2).sort(byCountThenKey((entry) => entry.name))) {
    candidates.push({
      id: `project-${stableHash(normalizeTitle(project.name))}`,
      kind: 'project',
      payload: { name: project.name },
      provenance: { count: project.count, sources: sortedSources(project.sources) },
      source: 'source-extraction',
      promoted: false
    });
  }

  for (const person of rankedPeople.filter((entry) => entry.count >= 2).slice(0, topRelationships)) {
    const displayName = person.name || person.email;
    candidates.push({
      id: `relationship-${stableHash(person.email)}`,
      kind: 'relationship',
      payload: {
        person: displayName,
        email: person.email,
        context: `Frequent contact (${person.count} interactions across ${sortedSources(person.sources).join(', ')}).`
      },
      provenance: { count: person.count, sources: sortedSources(person.sources) },
      source: 'source-extraction',
      promoted: false
    });
  }

  for (const action of [...nextActions.values()].sort((a, b) => a.text.localeCompare(b.text))) {
    candidates.push({
      id: `next_action-${stableHash(normalizeTitle(action.text))}`,
      kind: 'next_action',
      payload: { text: action.text },
      provenance: { count: 1, sources: sortedSources(action.sources) },
      source: 'source-extraction',
      promoted: false
    });
  }

  return candidates;
}

export function buildExtractedCandidateSet(candidates: ExtractedCandidate[], dataDir: string): ExtractedCandidateSet {
  const counts: Record<CandidateKind, number> = {
    person: 0,
    org: 0,
    project: 0,
    relationship: 0,
    next_action: 0
  };
  for (const candidate of candidates) {
    counts[candidate.kind] += 1;
  }
  const fingerprint = stableHash(candidates.map((candidate) => candidate.id).join('|') || 'empty');
  return {
    goal: 'Review source-extracted candidates before promoting them into canonical Brainbase SSOT.',
    canonicalWrites: false,
    candidatePath: `${dataDir}/candidates/extracted-${fingerprint}.json`,
    counts,
    candidates,
    safetyRules: [
      'Extracted candidates are derived from secondary source material and are not canonical memory.',
      'Promote candidates only with onboard:apply --write after explicit selection.',
      'Review person, org, project, relationship, and next-action candidates with the user before promotion.'
    ],
    nextCommands: [
      'Review the extracted candidate file with the user.',
      'brainbase onboard:apply --from <candidate-file> --select <id> --write',
      'brainbase doctor'
    ]
  };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export interface ApplyInput {
  graphEntities: GraphEntity[];
  relationships: RelationshipRecord[];
  personalKg: PersonalKgEntry[];
  decisions: DecisionRecord[];
  ownerName?: string;
}

export interface ApplyResult {
  graphEntities: GraphEntity[];
  relationships: RelationshipRecord[];
  personalKgAdditions: PersonalKgEntry[];
  decisionAdditions: DecisionRecord[];
  ownerName?: string;
  applied: { id: string; kind: string; summary: string }[];
  skipped: { id: string; reason: string }[];
}

export interface ApplyCandidate {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
}

export function loadApplyCandidates(raw: unknown): ApplyCandidate[] {
  const container = isRecord(raw) && Array.isArray(raw.candidates) ? raw.candidates : raw;
  if (!Array.isArray(container)) {
    throw new Error('Candidate file does not contain a candidates array.');
  }
  return container.filter(isRecord).map((item, index) => ({
    id: readString(item, ['id']) || `candidate-${index}`,
    kind: readString(item, ['kind']) || 'unknown',
    payload: isRecord(item.payload) ? item.payload : {}
  }));
}

export function planApply(
  candidates: ApplyCandidate[],
  selection: { ids: Set<string>; all: boolean },
  base: ApplyInput,
  now: string
): ApplyResult {
  const graphEntities = [...base.graphEntities];
  const relationships = [...base.relationships];
  const personalKgAdditions: PersonalKgEntry[] = [];
  const decisionAdditions: DecisionRecord[] = [];
  const applied: ApplyResult['applied'] = [];
  const skipped: ApplyResult['skipped'] = [];
  let ownerName = base.ownerName;

  for (const candidate of candidates) {
    if (!selection.all && !selection.ids.has(candidate.id)) {
      skipped.push({ id: candidate.id, reason: 'not selected' });
      continue;
    }
    const payload = candidate.payload;
    switch (candidate.kind) {
      case 'self': {
        const name = payloadString(payload, 'name');
        if (!name) {
          skipped.push({ id: candidate.id, reason: 'self candidate missing name' });
          break;
        }
        ownerName = name;
        upsertEntity(graphEntities, { id: 'self', type: 'person', name, summary: 'Owner of this local Brainbase Personal OS.', tags: ['self'] });
        personalKgAdditions.push({ id: `self-${stableHash(name)}`, type: 'self', text: `I am ${name}.`, tags: ['self'], source: candidate.id, updatedAt: now });
        applied.push({ id: candidate.id, kind: candidate.kind, summary: name });
        break;
      }
      case 'person':
      case 'relationship': {
        const person = payloadString(payload, 'person') || payloadString(payload, 'name');
        if (!person) {
          skipped.push({ id: candidate.id, reason: 'person candidate missing name' });
          break;
        }
        const context = payloadString(payload, 'context') || payloadString(payload, 'email') || 'Imported from onboarding sources.';
        const role = payloadString(payload, 'role');
        upsertEntity(graphEntities, { id: `person-${stableHash(person)}`, type: 'person', name: person, summary: context, tags: ['relationship'] });
        if (candidate.kind === 'relationship' && !relationships.some((relationship) => relationship.person === person && relationship.context === context)) {
          relationships.push({ id: `relationship-${stableHash(`${person}|${context}`)}`, person, role: role || undefined, context, tags: ['relationship'], updatedAt: now });
        }
        applied.push({ id: candidate.id, kind: candidate.kind, summary: person });
        break;
      }
      case 'org': {
        const name = payloadString(payload, 'name') || payloadString(payload, 'domain');
        if (!name) {
          skipped.push({ id: candidate.id, reason: 'org candidate missing name' });
          break;
        }
        upsertEntity(graphEntities, { id: `org-${stableHash(name)}`, type: 'org', name, summary: 'Imported from onboarding sources.', tags: ['org'] });
        applied.push({ id: candidate.id, kind: candidate.kind, summary: name });
        break;
      }
      case 'project': {
        const name = payloadString(payload, 'name');
        if (!name) {
          skipped.push({ id: candidate.id, reason: 'project candidate missing name' });
          break;
        }
        upsertEntity(graphEntities, { id: `project-${stableHash(name)}`, type: 'project', name, summary: 'Imported from onboarding sources.', tags: ['work'] });
        personalKgAdditions.push({ id: `work-${stableHash(name)}`, type: 'work', text: name, tags: ['work'], source: candidate.id, updatedAt: now });
        applied.push({ id: candidate.id, kind: candidate.kind, summary: name });
        break;
      }
      case 'value': {
        const text = payloadString(payload, 'text');
        if (!text) {
          skipped.push({ id: candidate.id, reason: 'value candidate missing text' });
          break;
        }
        personalKgAdditions.push({ id: `value-${stableHash(text)}`, type: 'value', text, tags: ['onboarding'], source: candidate.id, updatedAt: now });
        applied.push({ id: candidate.id, kind: candidate.kind, summary: text });
        break;
      }
      case 'next_action': {
        const text = payloadString(payload, 'text');
        if (!text) {
          skipped.push({ id: candidate.id, reason: 'next_action candidate missing text' });
          break;
        }
        personalKgAdditions.push({ id: `next-action-${stableHash(text)}`, type: 'work', text, tags: ['next-action'], source: candidate.id, updatedAt: now });
        applied.push({ id: candidate.id, kind: candidate.kind, summary: text });
        break;
      }
      case 'decision': {
        const text = payloadString(payload, 'decision') || payloadString(payload, 'text');
        if (!text) {
          skipped.push({ id: candidate.id, reason: 'decision candidate missing decision text' });
          break;
        }
        decisionAdditions.push({ id: `decision-${stableHash(text)}`, title: 'Promoted decision principle', decision: text, tags: ['principle'], updatedAt: now });
        applied.push({ id: candidate.id, kind: candidate.kind, summary: text });
        break;
      }
      default:
        skipped.push({ id: candidate.id, reason: `unsupported candidate kind: ${candidate.kind}` });
    }
  }

  return { graphEntities, relationships, personalKgAdditions, decisionAdditions, ownerName, applied, skipped };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function byCountThenKey<T extends { count: number }>(key: (entry: T) => string): (a: T, b: T) => number {
  return (a, b) => b.count - a.count || key(a).localeCompare(key(b));
}

function sortedSources(sources: Set<string>): string[] {
  return [...sources].sort();
}

function looksLikeTask(text: string): boolean {
  const haystack = text.toLowerCase();
  return TASK_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function extractTaskLines(content: string): string[] {
  if (!content) {
    return [];
  }
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(- \[ \]|todo[:：]|□|☐|\* \[ \])/i.test(line) || looksLikeTask(line))
    .map((line) => line.replace(/^(- \[ \]|\* \[ \]|todo[:：]|□|☐)\s*/i, '').trim())
    .filter(Boolean);
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(re|fwd|fw)\s*[:：]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseParticipants(value: unknown): Participant[] {
  if (Array.isArray(value)) {
    return value.map((entry) => parseParticipant(entry)).filter((participant) => participant.email || participant.name);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => parseParticipant(part))
      .filter((participant) => participant.email || participant.name);
  }
  if (value === undefined || value === null) {
    return [];
  }
  const single = parseParticipant(value);
  return single.email || single.name ? [single] : [];
}

function parseParticipant(value: unknown): Participant {
  if (isRecord(value)) {
    return {
      email: normalizeEmail(readString(value, ['email', 'emailAddress', 'address'])),
      name: readString(value, ['name', 'displayName']) || undefined
    };
  }
  if (typeof value === 'string') {
    return parseParticipantString(value);
  }
  return {};
}

function parseParticipantString(value: string): Participant {
  const trimmed = value.trim();
  const angle = trimmed.match(/^(.*?)<([^>]+)>$/);
  if (angle) {
    return {
      name: angle[1].replace(/["']/g, '').trim() || undefined,
      email: normalizeEmail(angle[2])
    };
  }
  if (trimmed.includes('@')) {
    return { email: normalizeEmail(trimmed) };
  }
  return trimmed ? { name: trimmed } : {};
}

function normalizeEmail(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && trimmed.includes('@') ? trimmed : undefined;
}

function readDateField(value: unknown): string {
  if (isRecord(value)) {
    return readString(value, ['dateTime', 'date']);
  }
  return typeof value === 'string' ? value : '';
}

function firstDefined(item: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) {
      return item[key];
    }
  }
  return undefined;
}

function readString(item: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return '';
}

function readStringArray(item: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = item[key];
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim());
    }
  }
  return [];
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value.trim() : '';
}

function upsertEntity(entities: GraphEntity[], entity: GraphEntity): void {
  const index = entities.findIndex((candidate) => candidate.id === entity.id);
  if (index >= 0) {
    entities[index] = { ...entities[index], ...entity };
  } else {
    entities.push(entity);
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stableHash(value: string): string {
  let hashValue = 0;
  for (const char of value) {
    hashValue = ((hashValue << 5) - hashValue + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hashValue).toString(36);
}
