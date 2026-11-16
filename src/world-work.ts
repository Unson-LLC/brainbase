/**
 * The work inside a city of the world (story-world-work-sites-and-gaps-v1).
 *
 * A pure projection of what the host read with the member's grants: the
 * business's Canonical Tasks (Task API) and, from the organization Graph, its
 * people, decisions and relations.  Two things are kept apart throughout:
 *
 *   - the work as recorded (A): a task's `status` and `waiting_on`, as written;
 *   - what we can see of it (B): gaps found only from structured fields
 *     (an empty assignee field, no source link, a review date passed), never
 *     from reading the free text as a judgment of the work.
 *
 * A gap says what is known, what is not connected or not confirmed, where it
 * comes from and when, and what to check next.  Nothing here concludes that
 * work has stopped, and nothing unreadable becomes zero.
 */

export const WORLD_WORK_VERSION = 'world-work.v1' as const;

export type WorldWorkReadState = 'complete' | 'partial' | 'failed' | 'forbidden' | 'not_connected';
export interface WorldWorkRead<T = unknown> {
  readonly state: WorldWorkReadState;
  readonly read_at?: string | null;
  readonly reason?: string | null;
  readonly items?: readonly T[];
}

export type WorldWorkStatus = 'pending' | 'in_progress' | 'waiting' | 'completed' | 'cancelled';
const OPEN_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'waiting']);
const STATUS_LABELS: Readonly<Record<WorldWorkStatus, string>> = Object.freeze({
  pending: '未着手',
  in_progress: '進行中',
  waiting: '待ち',
  completed: '完了',
  cancelled: '取消',
});

export type WorldWorkGapKind =
  | 'assignee_unlinked_mentioned'
  | 'assignee_unrecorded'
  | 'source_unlinked'
  | 'outcome_unlinked'
  | 'review_overdue';
export const WORLD_WORK_GAP_KINDS: readonly WorldWorkGapKind[] = Object.freeze([
  'assignee_unlinked_mentioned',
  'assignee_unrecorded',
  'outcome_unlinked',
  'source_unlinked',
  'review_overdue',
]);
export const WORLD_WORK_GAP_LABELS: Readonly<Record<WorldWorkGapKind, string>> = Object.freeze({
  assignee_unlinked_mentioned: '担当欄に未接続（本文に人物あり）',
  assignee_unrecorded: '担当の記録なし',
  outcome_unlinked: '完了条件はあるが成果物の記録が未接続',
  source_unlinked: '出典リンクなし',
  review_overdue: '見直し予定を過ぎた（古い情報の可能性）',
});

export type WorldWorkLink = 'recorded' | 'inferred' | 'unreadable';

export interface WorldWorkSource {
  readonly system: 'task_api' | 'organization_graph';
  readonly record_id: string;
  readonly fields: readonly string[];
}

export interface WorldWorkPersonRef {
  readonly person_id: string | null;
  readonly name: string;
}

export interface WorldWorkGap {
  readonly kind: WorldWorkGapKind;
  readonly label: string;
  /** What the records do say. */
  readonly fact: string;
  /** What is not connected or not confirmed, and how far that reaches. */
  readonly unknown: string;
  /** What to check next to see further.  Never a task to create. */
  readonly next_check: string;
  /** Who could answer, when the records name someone; null when they do not. */
  readonly check_with: WorldWorkPersonRef | null;
  readonly source: WorldWorkSource;
  /** The newest check the record itself notes (a dated note in its text), else its last update. */
  readonly checked_at: string | null;
  readonly checked_at_basis: 'text_note' | 'updated_at' | null;
}

export interface WorldWorkPersonLink extends WorldWorkPersonRef {
  readonly link: Exclude<WorldWorkLink, 'unreadable'>;
  readonly basis: 'assignee_field' | 'text_person_id' | 'text_full_name';
  /** The text puts 「担当」 right before the person (e.g. 実担当は…).  Still not the assignee field. */
  readonly stated_as_assignee?: boolean;
}

/** Words in the text that match more than one Graph person: left undecided, never picked. */
export interface WorldWorkAmbiguousMention {
  readonly text: string;
  readonly candidates: readonly WorldWorkPersonRef[];
}

/** Optional current actors supplied by an authoritative host; the common UI owns no membership store. */
export interface WorldWorkActor {
  readonly id: string;
  readonly name: string;
  readonly task_id: string;
  readonly kind?: string;
  readonly state: WorldWorkStatus | null;
  readonly activity?: { readonly state: string; readonly moving: boolean; readonly heartbeat_at?: string | null; readonly checked_at?: string };
}

export interface WorldWorkSite {
  readonly actors_state?: 'confirmed' | 'unconfirmed';
  readonly actors?: readonly WorldWorkActor[];
  readonly task_id: string;
  readonly title: string;
  /** What the work is for, as the task record states it (`purpose_label`); null when it states none. */
  readonly purpose_label: string | null;
  readonly project_codes: readonly string[];
  /** Codes of other visible businesses this task also belongs to (work across a boundary). */
  readonly other_business_codes: readonly string[];
  readonly work: {
    readonly status: WorldWorkStatus | null;
    readonly label: string;
    readonly open: boolean;
    readonly waiting_on: string | null;
    readonly due_at: string | null;
    readonly past_due: boolean;
    readonly review_at: string | null;
    readonly created_at: string | null;
    readonly updated_at: string | null;
    readonly completed_at: string | null;
  };
  readonly people: readonly WorldWorkPersonLink[];
  readonly ambiguous_mentions: readonly WorldWorkAmbiguousMention[];
  readonly source_refs: readonly { readonly type: string | null; readonly url: string | null; readonly label: string }[];
  /** The completion condition the text states, quoted; null when it states none. */
  readonly expected_outcome: string | null;
  /** Dated check notes in the text, newest first. */
  readonly audit_notes: readonly { readonly date: string; readonly text: string }[];
  readonly gaps: readonly WorldWorkGap[];
  readonly description: string | null;
  readonly source: WorldWorkSource & { readonly version: number | null; readonly web_url: string | null };
}

export interface WorldWorkRelation {
  readonly link: WorldWorkLink;
  /** What the relation is, in plain words. */
  readonly label: string;
  readonly kind: string;
  readonly counterpart: { readonly id: string | null; readonly type: string | null; readonly name: string } | null;
  /** The counterpart is another business of this world (drawn as a road between cities). */
  readonly business_code: string | null;
  readonly direction: 'incoming' | 'outgoing' | null;
  readonly basis: string;
  readonly source: WorldWorkSource | null;
  /** Tasks that carry this relation (people named in tasks). */
  readonly task_ids: readonly string[];
}

export interface WorldWorkPolicy {
  readonly decision_id: string;
  readonly title: string;
  readonly decided_at: string | null;
  readonly link: Exclude<WorldWorkLink, 'unreadable'>;
  readonly basis: string;
  readonly scope_code: string | null;
}

export interface WorldWorkSummary {
  readonly business_code: string;
  readonly state: WorldWorkReadState;
  readonly read_at: string | null;
  readonly reason: string | null;
  /** Counts only when the tasks were read; null otherwise (not zero). */
  readonly open: number | null;
  readonly total: number | null;
  readonly by_status: Readonly<Partial<Record<WorldWorkStatus | 'unknown', number>>> | null;
  /** For each kind of gap, the open tasks that show it: the reason behind every count. */
  readonly gaps: Readonly<Partial<Record<WorldWorkGapKind, readonly string[]>>> | null;
  /** Open tasks with at least one gap. */
  readonly needs_check: readonly string[] | null;
}

export interface WorldWorkReads {
  readonly tasks: { readonly state: WorldWorkReadState; readonly read_at: string | null; readonly reason: string | null; readonly count: number | null };
  readonly persons: { readonly state: WorldWorkReadState; readonly reason: string | null };
  readonly decisions: { readonly state: WorldWorkReadState; readonly reason: string | null };
  readonly relations: { readonly state: WorldWorkReadState; readonly reason: string | null };
}

export type WorldWorkResponse =
  | {
    readonly status: 'ok';
    readonly version: typeof WORLD_WORK_VERSION;
    readonly as_of: string;
    readonly business: { readonly id: string; readonly code: string; readonly name: string };
    readonly reads: WorldWorkReads;
    readonly purpose: {
      readonly text: string | null;
      readonly state: 'registered' | 'unregistered';
      readonly summary: string | null;
      readonly policies: readonly WorldWorkPolicy[];
    };
    readonly people: readonly (WorldWorkPersonRef & { readonly roles: readonly string[]; readonly link: Exclude<WorldWorkLink, 'unreadable'>; readonly task_ids: readonly string[] })[];
    readonly members_state: 'registered' | 'unregistered' | 'unreadable';
    readonly relations: readonly WorldWorkRelation[];
    readonly sites: readonly WorldWorkSite[];
    readonly summary: WorldWorkSummary;
  }
  | { readonly status: 'not_connected' | 'unavailable' | 'forbidden' | 'not_found'; readonly version: typeof WORLD_WORK_VERSION; readonly reason: string };

export interface WorldWorkBusinessInput {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly summary?: string | null;
  readonly purpose?: string | null;
  readonly aliases?: readonly string[];
  /** Codes of this business's engagements: their tasks are this city's work too. */
  readonly engagement_codes?: readonly string[];
}

export interface WorldWorkProjectInput {
  readonly owner?: WorldWorkPersonRef | null;
  readonly people?: readonly (WorldWorkPersonRef & { readonly roles: readonly string[] })[];
  readonly members_state?: 'registered' | 'unregistered' | 'unreadable';
  /** Decisions the business's own records cite as their source (`source_decision_ids`, merged records included). */
  readonly source_decision_ids?: readonly string[];
  /** Aliases of terms the Graph records as belonging to this business (used only to infer, never to record). */
  readonly term_aliases?: readonly { readonly term: string; readonly alias: string }[];
}

/** Other businesses of the world, to name a counterpart city and tasks that cross a boundary. */
export interface WorldWorkNeighbour {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly engagement_codes?: readonly string[];
  readonly record_ids?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function payloadOf(record: Record<string, unknown>): Record<string, unknown> {
  return isRecord(record.payload) ? record.payload : isRecord(record.metadata) ? record.metadata : {};
}

function time(value: string | null): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function squash(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
}

function dateText(value: string | null): string {
  const at = time(value);
  if (!Number.isFinite(at)) return '日付不明';
  // Shown in Japan time, where the records are kept.
  const jst = new Date(at + 9 * 60 * 60 * 1000);
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

interface PersonEntry { readonly id: string; readonly name: string; readonly keys: readonly { readonly key: string; readonly word: string }[] }

function personDirectory(read: WorldWorkRead | undefined): { readonly readable: boolean; readonly byId: Map<string, PersonEntry>; readonly entries: readonly PersonEntry[] } {
  const readable = read?.state === 'complete' || read?.state === 'partial';
  const entries: PersonEntry[] = [];
  for (const record of readable ? read?.items ?? [] : []) {
    if (!isRecord(record)) continue;
    const id = text(record.id);
    const payload = payloadOf(record);
    const name = text(payload.name) ?? text(record.name);
    if (!id || !name) continue;
    const aliases = Array.isArray(payload.aliases) ? payload.aliases.map(text).filter((alias): alias is string => alias !== null) : [];
    // Only names of three characters or more (spaces removed) are matched, so a bare surname or a
    // two-character word in the text does not become a person.
    const keys = [name, ...aliases].map((word) => ({ key: squash(word), word })).filter((entry) => entry.key.length >= 3);
    entries.push({ id, name, keys });
  }
  return { readable, byId: new Map(entries.map((entry) => [entry.id, entry])), entries };
}

const PERSON_ID = /\bper_[A-Za-z0-9_]+/gu;
const STATED_ASSIGNEE = /担当/u;

/**
 * People the text names.  A Graph person id names one person.  A name or alias names one person only
 * when no other visible person shares it; a word shared by several (a duplicate record, a common
 * alias) is kept as an ambiguous mention with its candidates.
 */
function mentionedPeople(description: string | null, people: ReturnType<typeof personDirectory>): { found: WorldWorkPersonLink[]; ambiguous: WorldWorkAmbiguousMention[] } {
  if (!description || !people.readable) return { found: [], ambiguous: [] };
  const found = new Map<string, WorldWorkPersonLink>();
  for (const match of description.matchAll(PERSON_ID)) {
    const entry = people.byId.get(match[0]);
    if (!entry || found.has(entry.id)) continue;
    const before = description.slice(Math.max(0, (match.index ?? 0) - 30), match.index ?? 0);
    found.set(entry.id, { person_id: entry.id, name: entry.name, link: 'inferred', basis: 'text_person_id', stated_as_assignee: STATED_ASSIGNEE.test(before) });
  }
  const body = squash(description);
  const owners = new Map<string, { word: string; ids: Set<string> }>();
  for (const entry of people.entries) {
    for (const { key, word } of entry.keys) {
      if (!body.includes(key)) continue;
      const owner = owners.get(key) ?? { word, ids: new Set<string>() };
      owner.ids.add(entry.id);
      owners.set(key, owner);
    }
  }
  const ambiguous = new Map<string, WorldWorkAmbiguousMention>();
  for (const [key, { word, ids }] of owners) {
    // A key inside a longer matched key (高木 in 高木幹太) is the same mention.
    if ([...owners.keys()].some((other) => other !== key && other.includes(key) && owners.get(other)!.ids.size === 1 && [...ids].some((id) => owners.get(other)!.ids.has(id)))) continue;
    if (ids.size === 1) {
      const id = [...ids][0]!;
      if (found.has(id)) continue;
      const at = body.indexOf(key);
      found.set(id, { person_id: id, name: people.byId.get(id)!.name, link: 'inferred', basis: 'text_full_name', stated_as_assignee: STATED_ASSIGNEE.test(body.slice(Math.max(0, at - 8), at)) });
    } else if (![...ids].some((id) => found.has(id))) {
      ambiguous.set(key, { text: word, candidates: [...ids].map((id) => ({ person_id: id, name: people.byId.get(id)!.name })) });
    }
  }
  return { found: [...found.values()], ambiguous: [...ambiguous.values()] };
}

// A dated note of a check that was made (「[2026-09-18確認]」「2026-09-18監査」).  「2026-09-25再確認」 is a
// plan, not a check, so it is not read as one.
const AUDIT_NOTE = /(?<!\d)(\d{4}-\d{2}-\d{2})\s*(確認|監査)(?!する)/gu;
function auditNotes(description: string | null): { date: string; text: string }[] {
  if (!description) return [];
  const notes = new Map<string, string>();
  for (const match of description.matchAll(AUDIT_NOTE)) {
    const date = match[1]!;
    if (!notes.has(date)) notes.set(date, match[2]!);
  }
  return [...notes].map(([date, kind]) => ({ date, text: kind })).sort((a, b) => b.date.localeCompare(a.date));
}

/** The text after 「完了条件」, up to the end of its sentence. */
function expectedOutcome(description: string | null): string | null {
  if (!description) return null;
  const match = /完了条件\s*[:：]?\s*([^\n。]+。?)/u.exec(description);
  return match ? match[1]!.trim().replace(/。$/u, '') : null;
}

function sourceRefs(value: unknown): WorldWorkSite['source_refs'] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((ref) => {
    const type = text(ref.type);
    const url = text(ref.url) ?? text(ref.minutes_url);
    const label = type === 'meeting_minutes' ? '議事録' : type === 'slack' ? 'Slack' : type ?? 'リンク';
    return { type, url, label };
  });
}

interface TaskReadContext {
  readonly businessCode: string;
  readonly ownCodes: ReadonlySet<string>;
  readonly businessOfCode: ReadonlyMap<string, string>;
  readonly people: ReturnType<typeof personDirectory>;
  readonly now: number;
  readonly readAt: string | null;
}

function workSite(record: Record<string, unknown>, context: TaskReadContext): WorldWorkSite | null {
  const id = text(record.id);
  if (!id) return null;
  const title = text(record.title) ?? '（題名なし）';
  const statusValue = text(record.status);
  const status = statusValue && statusValue in STATUS_LABELS ? (statusValue as WorldWorkStatus) : null;
  const open = status !== null && OPEN_STATUSES.has(status);
  const description = text(record.description);
  const projectCodes = Array.isArray(record.project_codes) ? record.project_codes.map(text).filter((code): code is string => code !== null) : [];
  const otherBusinessCodes = [...new Set(projectCodes.map((code) => context.businessOfCode.get(code)).filter((code): code is string => Boolean(code) && code !== context.businessCode))];
  const dueAt = text(record.due_at);
  const reviewAt = text(record.review_at);
  const updatedAt = text(record.updated_at);
  const assigneeId = text(record.assignee_person_id);
  const assigneeName = text(record.assignee_display_name);
  const refs = sourceRefs(record.source_refs);
  const notes = auditNotes(description);
  const outcome = expectedOutcome(description);
  const people: WorldWorkPersonLink[] = [];
  if (assigneeId || assigneeName) {
    people.push({ person_id: assigneeId, name: assigneeName ?? context.people.byId.get(assigneeId ?? '')?.name ?? assigneeId!, link: 'recorded', basis: 'assignee_field' });
  }
  const mentions = mentionedPeople(description, context.people);
  const recordedAssignee: WorldWorkPersonRef | null = people[0]?.link === 'recorded' ? { person_id: people[0].person_id, name: people[0].name } : null;
  const mentioned = mentions.found.filter((person) => person.person_id !== assigneeId);
  people.push(...mentioned);
  const checkedAt = notes[0] ? notes[0].date : updatedAt;
  const checkedAtBasis = notes[0] ? 'text_note' as const : updatedAt ? 'updated_at' as const : null;
  const source = (fields: string[]): WorldWorkSource => ({ system: 'task_api', record_id: id, fields });
  const gap = (kind: WorldWorkGapKind, fields: string[], body: Pick<WorldWorkGap, 'fact' | 'unknown' | 'next_check' | 'check_with'>): WorldWorkGap => ({
    kind,
    label: WORLD_WORK_GAP_LABELS[kind],
    ...body,
    source: source(fields),
    checked_at: checkedAt,
    checked_at_basis: checkedAtBasis,
  });
  const gaps: WorldWorkGap[] = [];
  if (status !== 'cancelled') {
    if (!assigneeId && !assigneeName) {
      const stated = mentioned.filter((person) => person.stated_as_assignee);
      if (stated.length > 0) {
        const names = stated.map((person) => person.name).join('・');
        gaps.push(gap('assignee_unlinked_mentioned', ['assignee_person_id', 'description'], {
          fact: `本文は担当として「${names}」を挙げています（${stated[0]!.basis === 'text_person_id' ? '人物IDつき' : '氏名の一致'}）。担当欄は空です。`,
          unknown: '本文と担当欄がつながっていないため、担当で絞る一覧や通知にはこの仕事が出ません。',
          next_check: `担当欄に${names}を接続できるか（本文の記載と担当欄をそろえる）。`,
          check_with: { person_id: stated[0]!.person_id, name: stated[0]!.name },
        }));
      } else if (mentioned.length > 0 || mentions.ambiguous.length > 0) {
        const named = mentioned.map((person) => `「${person.name}」`);
        const unsure = mentions.ambiguous.map((mention) => `「${mention.text}」（組織のGraphの${mention.candidates.map((candidate) => candidate.name).join('・')}のどれか一意に決まらない）`);
        gaps.push(gap('assignee_unlinked_mentioned', ['assignee_person_id', 'description'], {
          fact: `本文に${[...named, ...unsure].join('、')}の記載があります。担当欄は空です。`,
          unknown: '本文の人物がこの仕事の担当か、関係者として書かれているだけかは確認されていません。',
          next_check: `本文の人物（${[...mentioned.map((person) => person.name), ...mentions.ambiguous.map((mention) => mention.text)].join('・')}）がこの仕事でどんな役割か。担当なら担当欄に接続する。`,
          check_with: mentioned.length === 1 && mentions.ambiguous.length === 0 ? { person_id: mentioned[0]!.person_id, name: mentioned[0]!.name } : null,
        }));
      } else {
        gaps.push(gap('assignee_unrecorded', ['assignee_person_id', 'description'], {
          fact: context.people.readable
            ? '担当欄が空です。本文にも、組織のGraphに登録された人物は見つかりません。'
            : '担当欄が空です。組織のGraphの人物を読めなかったため、本文の人物とは照合できていません。',
          unknown: '誰がこの仕事を担っているかは、記録からは分かりません。担当者がいないとは限りません。',
          next_check: '誰が担当しているか。確認先の人物は記録からは分かりません。',
          check_with: null,
        }));
      }
    }
    if (refs.length === 0) {
      if (outcome) {
        gaps.push(gap('outcome_unlinked', ['description', 'source_refs'], {
          fact: `本文に完了条件があります：「${outcome}」。成果物や提示の記録へのリンクは0件です。`,
          unknown: '完了条件にある成果物を作ったか、提示したかは確認されていません。仕事が止まっているとは限りません。',
          next_check: '完了条件にある成果物（または提示した記録）がどこにあるか。',
          check_with: recordedAssignee,
        }));
      } else {
        gaps.push(gap('source_unlinked', ['source_refs'], {
          fact: 'この仕事の出典や関連記録（議事録・Slack・資料）へのリンクは0件です。',
          unknown: 'どこから生まれた仕事か、何を作ったかは、この記録からはたどれません。',
          next_check: 'この仕事の元になった記録や、作ったものの場所。',
          check_with: recordedAssignee,
        }));
      }
    }
  }
  if (open && Number.isFinite(time(reviewAt)) && time(reviewAt) < context.now) {
    gaps.push(gap('review_overdue', ['review_at', 'updated_at'], {
      fact: `見直し予定（${dateText(reviewAt)}）を過ぎています。記録の最終更新は${dateText(updatedAt)}です。`,
      unknown: `${dateText(updatedAt)}より後の進み具合は記録されていません。状態「${status ? STATUS_LABELS[status] : '不明'}」は古い可能性があります。`,
      next_check: '今の状態（進んだか・終わったか・待ちのままか）を確かめ、記録を更新する。',
      check_with: recordedAssignee,
    }));
  }
  const version = typeof record.version === 'number' && Number.isInteger(record.version) ? record.version : null;
  return {
    task_id: id,
    title,
    purpose_label: text(record.purpose_label),
    project_codes: projectCodes,
    other_business_codes: otherBusinessCodes,
    work: {
      status,
      label: status ? STATUS_LABELS[status] : '状態の記録なし',
      open,
      waiting_on: text(record.waiting_on),
      due_at: dueAt,
      past_due: open && Number.isFinite(time(dueAt)) && time(dueAt) < context.now,
      review_at: reviewAt,
      created_at: text(record.created_at),
      updated_at: updatedAt,
      completed_at: text(record.completed_at),
    },
    people,
    ambiguous_mentions: mentions.ambiguous,
    source_refs: refs,
    expected_outcome: outcome,
    audit_notes: notes,
    gaps,
    description,
    source: { ...source(['*']), version, web_url: text(record.web_url) },
  };
}

function readOf(read: WorldWorkRead | undefined): WorldWorkReads['tasks'] {
  const state = read?.state ?? 'not_connected';
  const readable = state === 'complete' || state === 'partial';
  return { state, read_at: read?.read_at ?? null, reason: read?.reason ?? null, count: readable ? (read?.items ?? []).length : null };
}

function businessIndex(business: WorldWorkBusinessInput, neighbours: readonly WorldWorkNeighbour[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const other of neighbours) {
    index.set(other.code, other.code);
    for (const code of other.engagement_codes ?? []) index.set(code, other.code);
  }
  index.set(business.code, business.code);
  for (const code of business.engagement_codes ?? []) index.set(code, business.code);
  return index;
}

function sitesOf(
  business: WorldWorkBusinessInput,
  tasks: WorldWorkRead | undefined,
  persons: WorldWorkRead | undefined,
  neighbours: readonly WorldWorkNeighbour[],
  now: Date
): WorldWorkSite[] {
  if (!(tasks?.state === 'complete' || tasks?.state === 'partial')) return [];
  const ownCodes = new Set([business.code, ...(business.engagement_codes ?? [])]);
  const context: TaskReadContext = {
    businessCode: business.code,
    ownCodes,
    businessOfCode: businessIndex(business, neighbours),
    people: personDirectory(persons),
    now: now.getTime(),
    readAt: tasks.read_at ?? null,
  };
  const sites: WorldWorkSite[] = [];
  const seen = new Set<string>();
  for (const record of tasks.items ?? []) {
    if (!isRecord(record)) continue;
    const codes = Array.isArray(record.project_codes) ? record.project_codes.map(text) : [];
    if (!codes.some((code) => code !== null && ownCodes.has(code))) continue;
    const site = workSite(record, context);
    if (!site || seen.has(site.task_id)) continue;
    seen.add(site.task_id);
    sites.push(site);
  }
  return sites.sort((a, b) => a.task_id.localeCompare(b.task_id));
}

function summaryOf(businessCode: string, tasks: WorldWorkRead | undefined, sites: readonly WorldWorkSite[]): WorldWorkSummary {
  const read = readOf(tasks);
  if (read.count === null) {
    return { business_code: businessCode, state: read.state, read_at: read.read_at, reason: read.reason, open: null, total: null, by_status: null, gaps: null, needs_check: null };
  }
  const byStatus: Partial<Record<WorldWorkStatus | 'unknown', number>> = {};
  const gaps: Partial<Record<WorldWorkGapKind, string[]>> = {};
  const needsCheck: string[] = [];
  for (const site of sites) {
    const key = site.work.status ?? 'unknown';
    byStatus[key] = (byStatus[key] ?? 0) + 1;
    if (!site.work.open) continue;
    if (site.gaps.length) needsCheck.push(site.task_id);
    for (const gap of site.gaps) (gaps[gap.kind] ??= []).push(site.task_id);
  }
  return {
    business_code: businessCode,
    state: read.state,
    read_at: read.read_at,
    reason: read.reason,
    open: sites.filter((site) => site.work.open).length,
    total: sites.length,
    by_status: byStatus,
    gaps,
    needs_check: needsCheck,
  };
}

/** Per business, what the world shows above the city: counts with the tasks behind them. */
export function summarizeWorldWork(
  input: {
    readonly businesses: readonly WorldWorkNeighbour[];
    readonly tasks: Readonly<Record<string, WorldWorkRead>>;
    readonly persons?: WorldWorkRead;
  },
  options: { readonly now?: Date } = {}
): Readonly<Record<string, WorldWorkSummary>> {
  const now = options.now ?? new Date();
  const result: Record<string, WorldWorkSummary> = {};
  for (const business of input.businesses) {
    const tasks = input.tasks[business.code];
    const others = input.businesses.filter((other) => other.code !== business.code);
    const sites = sitesOf(business, tasks, input.persons, others, now);
    result[business.code] = summaryOf(business.code, tasks, sites);
  }
  return result;
}

function decisionRows(read: WorldWorkRead | undefined): { id: string; title: string; decided_at: string | null; scope_code: string | null }[] {
  if (!(read?.state === 'complete' || read?.state === 'partial')) return [];
  return (read.items ?? []).filter(isRecord).map((record) => {
    const payload = payloadOf(record);
    return {
      id: text(record.id) ?? '',
      title: text(payload.title) ?? text(payload.name) ?? text(payload.decision) ?? text(record.name) ?? '',
      decided_at: text(payload.decided_at) ?? text(record.validFrom) ?? null,
      scope_code: text(record.project_code) ?? text(payload.project_code),
    };
  }).filter((row) => row.id && row.title);
}

function policiesOf(business: WorldWorkBusinessInput, project: WorldWorkProjectInput, decisions: WorldWorkRead | undefined): WorldWorkPolicy[] {
  const rows = decisionRows(decisions);
  const cited = new Set(project.source_decision_ids ?? []);
  const ownCodes = new Set([business.code, ...(business.engagement_codes ?? [])]);
  const words = [
    { word: business.name, basis: `事業名「${business.name}」` },
    ...(business.aliases ?? []).map((alias) => ({ word: alias, basis: `事業の別名「${alias}」` })),
    ...(project.term_aliases ?? []).map((entry) => ({ word: entry.alias, basis: `事業に属す用語「${entry.term}」の別名「${entry.alias}」` })),
  ].filter((entry) => squash(entry.word).length >= 3);
  const policies: WorldWorkPolicy[] = [];
  for (const row of rows) {
    if (cited.has(row.id)) {
      policies.push({ decision_id: row.id, title: row.title, decided_at: row.decided_at, link: 'recorded', basis: 'この事業の記録が出典として挙げる決定（source_decision_ids）', scope_code: row.scope_code });
      continue;
    }
    if (row.scope_code && ownCodes.has(row.scope_code)) {
      policies.push({ decision_id: row.id, title: row.title, decided_at: row.decided_at, link: 'recorded', basis: 'この事業の範囲コードで記録された決定', scope_code: row.scope_code });
      continue;
    }
    const title = squash(row.title);
    const hit = words.find((entry) => title.includes(squash(entry.word)));
    if (hit) {
      policies.push({ decision_id: row.id, title: row.title, decided_at: row.decided_at, link: 'inferred', basis: `題名に${hit.basis}を含む（範囲コードは ${row.scope_code ?? '未記録'}）`, scope_code: row.scope_code });
    }
  }
  return policies.sort((a, b) => (a.link === b.link ? 0 : a.link === 'recorded' ? -1 : 1) || String(b.decided_at ?? '').localeCompare(String(a.decided_at ?? '')));
}

const RELATION_WORDS: Readonly<Record<string, string>> = Object.freeze({
  has_engagement: '案件として持つ',
  belongs_to_project: 'この事業に属す',
  member_of: 'メンバー',
  assigned_to: '担当',
  owned_by: '責任者',
  governs: '決める',
});

function relationsOf(
  business: WorldWorkBusinessInput,
  relations: WorldWorkRead | undefined,
  neighbours: readonly WorldWorkNeighbour[],
  sites: readonly WorldWorkSite[]
): WorldWorkRelation[] {
  const result: WorldWorkRelation[] = [];
  const businessOfRecord = new Map<string, WorldWorkNeighbour>();
  for (const other of neighbours) for (const id of [other.id, ...(other.record_ids ?? [])]) businessOfRecord.set(id, other);
  const readable = relations?.state === 'complete' || relations?.state === 'partial';
  for (const item of readable ? relations?.items ?? [] : []) {
    if (!isRecord(item)) continue;
    const kind = text(item.relation) ?? text(item.rel_type) ?? 'related';
    const counterpartRecord = isRecord(item.counterpart) ? item.counterpart : null;
    const counterpartId = text(counterpartRecord?.id);
    const neighbour = counterpartId ? businessOfRecord.get(counterpartId) : undefined;
    const direction = item.direction === 'incoming' || item.direction === 'outgoing' ? item.direction : null;
    const counterpartName = text(counterpartRecord?.name) ?? counterpartId ?? '名前の無い記録';
    const word = RELATION_WORDS[kind] ?? kind;
    result.push({
      link: 'recorded',
      kind,
      label: neighbour
        ? direction === 'incoming' ? `${neighbour.name} が ${business.name} を${word}` : `${business.name} が ${neighbour.name} を${word}`
        : `${counterpartName}（${word}）`,
      counterpart: counterpartRecord ? { id: counterpartId, type: text(counterpartRecord.type), name: counterpartName } : null,
      business_code: neighbour?.code ?? null,
      direction,
      basis: '組織のGraphに記録された関係',
      source: text(item.id) ? { system: 'organization_graph', record_id: text(item.id)!, fields: ['relation'] } : null,
      task_ids: [],
    });
  }
  if (!readable || relations?.state === 'partial') {
    result.push({
      link: 'unreadable',
      kind: 'unreadable',
      label: relations?.state === 'partial' ? 'Graphの関係の一部を読めませんでした' : 'Graphの関係を読めませんでした',
      counterpart: null,
      business_code: null,
      direction: null,
      basis: relations?.reason ?? relations?.state ?? 'not_connected',
      source: null,
      task_ids: [],
    });
  }
  // Work that crosses into another business, by the tasks' own project codes (recorded).
  const crossing = new Map<string, string[]>();
  for (const site of sites) for (const code of site.other_business_codes) crossing.set(code, [...(crossing.get(code) ?? []), site.task_id]);
  for (const [code, taskIds] of crossing) {
    const neighbour = neighbours.find((other) => other.code === code);
    result.push({
      link: 'recorded',
      kind: 'shared_task',
      label: `${neighbour?.name ?? code} にもまたがる仕事 ${taskIds.length}件`,
      counterpart: neighbour ? { id: neighbour.id, type: 'project', name: neighbour.name } : null,
      business_code: code,
      direction: null,
      basis: 'タスクのプロジェクト欄に両方の事業のコードがある',
      source: null,
      task_ids: taskIds,
    });
  }
  return result;
}

/** The work of one business for its city: sites, purpose, people, relations and the summary. */
export function projectWorldWork(
  input: {
    readonly business: WorldWorkBusinessInput;
    readonly tasks: WorldWorkRead;
    readonly persons?: WorldWorkRead;
    readonly decisions?: WorldWorkRead;
    readonly relations?: WorldWorkRead;
    readonly project?: WorldWorkProjectInput;
    readonly neighbours?: readonly WorldWorkNeighbour[];
  },
  options: { readonly now?: Date } = {}
): WorldWorkResponse {
  const now = options.now ?? new Date();
  const { business } = input;
  const project = input.project ?? {};
  const neighbours = (input.neighbours ?? []).filter((other) => other.code !== business.code);
  const sites = sitesOf(business, input.tasks, input.persons, neighbours, now);
  const peopleIndex = new Map<string, { person_id: string | null; name: string; roles: Set<string>; link: 'recorded' | 'inferred'; task_ids: string[] }>();
  const addPerson = (person: WorldWorkPersonRef, role: string, link: 'recorded' | 'inferred', taskId?: string) => {
    const key = person.person_id ?? `name:${person.name}`;
    const entry = peopleIndex.get(key) ?? { person_id: person.person_id, name: person.name, roles: new Set<string>(), link, task_ids: [] };
    entry.roles.add(role);
    if (link === 'recorded') entry.link = 'recorded';
    if (taskId && !entry.task_ids.includes(taskId)) entry.task_ids.push(taskId);
    peopleIndex.set(key, entry);
  };
  if (project.owner) addPerson(project.owner, '責任者（プロジェクトの記録）', 'recorded');
  for (const person of project.people ?? []) for (const role of person.roles) addPerson(person, role, 'recorded');
  for (const site of sites) {
    for (const person of site.people) {
      addPerson(person, person.link === 'recorded' ? '仕事の担当（担当欄）' : '仕事の本文に記載（推定）', person.link, site.task_id);
    }
  }
  const relations = relationsOf(business, input.relations, neighbours, sites);
  for (const entry of peopleIndex.values()) {
    if (entry.link !== 'inferred') continue;
    relations.push({
      link: 'inferred',
      kind: 'mentioned_person',
      label: `${entry.name}（仕事${entry.task_ids.length}件の本文に記載。担当欄には未接続）`,
      counterpart: { id: entry.person_id, type: 'person', name: entry.name },
      business_code: null,
      direction: null,
      basis: 'タスクの本文に人物IDか氏名がある',
      source: null,
      task_ids: entry.task_ids,
    });
  }
  const purposeText = text(business.purpose);
  const reads: WorldWorkReads = {
    tasks: readOf(input.tasks),
    persons: { state: input.persons?.state ?? 'not_connected', reason: input.persons?.reason ?? null },
    decisions: { state: input.decisions?.state ?? 'not_connected', reason: input.decisions?.reason ?? null },
    relations: { state: input.relations?.state ?? 'not_connected', reason: input.relations?.reason ?? null },
  };
  return {
    status: 'ok',
    version: WORLD_WORK_VERSION,
    as_of: now.toISOString(),
    business: { id: business.id, code: business.code, name: business.name },
    reads,
    purpose: {
      text: purposeText,
      state: purposeText ? 'registered' : 'unregistered',
      summary: text(business.summary),
      policies: policiesOf(business, project, input.decisions),
    },
    people: [...peopleIndex.values()].map((entry) => ({ person_id: entry.person_id, name: entry.name, roles: [...entry.roles], link: entry.link, task_ids: entry.task_ids })),
    members_state: project.members_state ?? 'unreadable',
    relations,
    sites,
    summary: summaryOf(business.code, input.tasks, sites),
  };
}
