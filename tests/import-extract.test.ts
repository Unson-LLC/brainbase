import { describe, expect, it } from 'vitest';
import {
  buildExtractedCandidateSet,
  extractCandidates,
  loadApplyCandidates,
  normalizeSource,
  parseProvider,
  planApply,
  type ApplyInput,
  type SourceRecord
} from '../src/import-extract.js';

const gmailRaw = [
  {
    id: 'm1',
    threadId: 't1',
    from: { email: 'Otawara@Cursorvers.com', name: '大田原正幸' },
    to: [{ email: 'k.sato.unson@gmail.com', name: '佐藤圭吾' }],
    subject: 'Re: brainbaseご提案',
    date: '2026-06-05',
    labelIds: ['INBOX'],
    snippet: 'ありがとうございます',
    body: 'SECRET BODY'
  },
  {
    id: 'm2',
    from: '大田原正幸 <otawara@cursorvers.com>',
    to: 'k.sato.unson@gmail.com',
    subject: '契約書の確認をお願いします',
    snippet: '確認ください'
  }
];

const calendarRaw = {
  events: [
    {
      id: 'e1',
      summary: 'Cursorvers AI駆動経営 定例',
      start: { dateTime: '2026-06-06T10:00:00+09:00' },
      organizer: { email: 'otawara@cursorvers.com', displayName: '大田原正幸' },
      attendees: [{ email: 'k.sato.unson@gmail.com' }],
      description: 'PRIVATE NOTES'
    },
    {
      id: 'e2',
      summary: 'Cursorvers AI駆動経営 定例',
      start: { dateTime: '2026-06-13T10:00:00+09:00' },
      attendees: [{ email: 'otawara@cursorvers.com' }]
    }
  ]
};

function emptyBase(): ApplyInput {
  return { graphEntities: [], graphEdges: [], relationships: [], personalKg: [], decisions: [] };
}

describe('parseProvider', () => {
  it('accepts known providers and rejects others', () => {
    expect(parseProvider('gmail')).toBe('gmail');
    expect(() => parseProvider('slack')).toThrow(/gmail\|calendar\|drive\|local/);
  });
});

describe('normalizeSource gmail (INV-2 metadata-first)', () => {
  it('keeps metadata and drops mail body', () => {
    const records = normalizeSource('gmail', gmailRaw);
    expect(records).toHaveLength(2);
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain('SECRET BODY');
    expect(serialized).not.toContain('"body"');
    const [first] = records;
    expect(first.kind).toBe('gmail');
    if (first.kind === 'gmail') {
      expect(first.from.email).toBe('otawara@cursorvers.com');
      expect(first.subject).toBe('Re: brainbaseご提案');
      expect(first.labels).toEqual(['INBOX']);
    }
  });

  it('parses "Name <email>" participant strings', () => {
    const records = normalizeSource('gmail', gmailRaw);
    const second = records[1];
    if (second.kind === 'gmail') {
      expect(second.from).toEqual({ name: '大田原正幸', email: 'otawara@cursorvers.com' });
    }
  });
});

describe('normalizeSource calendar (S-2)', () => {
  it('drops private descriptions unless includeDescriptions is set', () => {
    const withoutDesc = normalizeSource('calendar', calendarRaw);
    expect(JSON.stringify(withoutDesc)).not.toContain('PRIVATE NOTES');

    const withDesc = normalizeSource('calendar', calendarRaw, { includeDescriptions: true });
    expect(JSON.stringify(withDesc)).toContain('PRIVATE NOTES');
  });
});

describe('extractCandidates (INV-3 deterministic)', () => {
  const records: SourceRecord[] = [
    ...normalizeSource('gmail', gmailRaw),
    ...normalizeSource('calendar', calendarRaw)
  ];

  it('ranks people by frequency and excludes self', () => {
    const candidates = extractCandidates(records, { selfEmails: ['k.sato.unson@gmail.com'] });
    const people = candidates.filter((candidate) => candidate.kind === 'person');
    expect(people).toHaveLength(1);
    expect(people[0].payload.email).toBe('otawara@cursorvers.com');
    expect(people[0].provenance.sources).toEqual(['calendar', 'gmail']);
  });

  it('derives org candidates from non-consumer domains only', () => {
    const candidates = extractCandidates(records, { selfEmails: ['k.sato.unson@gmail.com'] });
    const orgs = candidates.filter((candidate) => candidate.kind === 'org');
    expect(orgs.map((org) => org.payload.domain)).toEqual(['cursorvers.com']);
  });

  it('proposes a project from a recurring calendar title (S-4)', () => {
    const candidates = extractCandidates(records, { selfEmails: ['k.sato.unson@gmail.com'] });
    const projects = candidates.filter((candidate) => candidate.kind === 'project');
    expect(projects).toHaveLength(1);
    expect(projects[0].payload.name).toContain('Cursorvers AI駆動経営');
  });

  it('produces byte-identical output for identical input', () => {
    const a = extractCandidates(records, { selfEmails: ['k.sato.unson@gmail.com'] });
    const b = extractCandidates(records, { selfEmails: ['k.sato.unson@gmail.com'] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('derives candidate ids from content, not time or randomness', () => {
    const candidates = extractCandidates(records, { selfEmails: ['k.sato.unson@gmail.com'] });
    for (const candidate of candidates) {
      expect(candidate.id).toMatch(/^(person|org|project|relationship|next_action)-[a-z0-9]+$/);
    }
  });
});

describe('buildExtractedCandidateSet', () => {
  it('summarizes counts and never declares canonical writes', () => {
    const records = normalizeSource('gmail', gmailRaw);
    const set = buildExtractedCandidateSet(extractCandidates(records, { selfEmails: ['k.sato.unson@gmail.com'] }), '/tmp/x');
    expect(set.canonicalWrites).toBe(false);
    expect(set.counts.person).toBeGreaterThanOrEqual(1);
    expect(set.candidatePath).toContain('/tmp/x/candidates/extracted-');
  });
});

describe('planApply (INV-4/INV-5 selection + dry-run)', () => {
  const records: SourceRecord[] = [
    ...normalizeSource('gmail', gmailRaw),
    ...normalizeSource('calendar', calendarRaw)
  ];
  const candidates = loadApplyCandidates({ candidates: extractCandidates(records, { selfEmails: ['k.sato.unson@gmail.com'] }) });

  it('does not invent a project edge for an extracted person without an explicit project id', () => {
    const personId = candidates.find((candidate) => candidate.kind === 'person')!.id;
    const result = planApply(candidates, { ids: new Set([personId]), all: false }, emptyBase(), '2026-06-05T00:00:00.000Z');
    expect(result.applied).toEqual([]);
    expect(result.skipped).toContainEqual({ id: personId, reason: 'unresolved_project_reference: explicit payload.projectId is required' });
    expect(result.graphEntities).toHaveLength(0);
    expect(result.graphEdges).toHaveLength(0);
  });

  it('promotes standalone org/project candidates and leaves unscoped relationships unresolved', () => {
    const result = planApply(candidates, { ids: new Set(), all: true }, emptyBase(), '2026-06-05T00:00:00.000Z');
    expect(result.relationships).toHaveLength(0);
    expect(result.skipped.some((item) => item.reason.startsWith('unresolved_project_reference:'))).toBe(true);
    expect(result.graphEntities.some((entity) => entity.type === 'org')).toBe(true);
    expect(result.graphEntities.some((entity) => entity.type === 'project')).toBe(true);
  });

  it('is a pure plan: same input yields same applied ids', () => {
    const first = planApply(candidates, { ids: new Set(), all: true }, emptyBase(), '2026-06-05T00:00:00.000Z');
    const second = planApply(candidates, { ids: new Set(), all: true }, emptyBase(), '2026-06-05T00:00:00.000Z');
    expect(first.applied.map((item) => item.id)).toEqual(second.applied.map((item) => item.id));
  });

  it('connects selected project and person by stable ids independent of candidate order', () => {
    const project = { id: 'project-candidate', kind: 'project', payload: { name: 'Alpha' } };
    const projectId = 'project-11pyri';
    const person = { id: 'person-candidate', kind: 'person', payload: { name: 'Aki', projectId, role: 'owner' } };

    const first = planApply([person, project], { ids: new Set(), all: true }, emptyBase(), '2026-08-05T01:00:00.000Z');
    const second = planApply([project, person], { ids: new Set(), all: true }, emptyBase(), '2026-08-05T01:00:00.000Z');

    expect(first.graphEdges).toEqual(second.graphEdges);
    expect(first.graphEdges).toEqual([
      expect.objectContaining({ fromId: expect.stringMatching(/^person-/), relation: 'participates_in', toId: projectId, role: 'owner' })
    ]);
    const personReceipt = first.applied.find((item) => item.id === person.id)!;
    expect(personReceipt.canonicalIds).toContain(first.graphEdges[0].id);
    expect(first.canonicalWrites.edges).toEqual(first.graphEdges);
  });

  it('is idempotent when the same canonical writes are planned again', () => {
    const project = { id: 'project-candidate', kind: 'project', payload: { name: 'Alpha' } };
    const projectId = 'project-11pyri';
    const person = { id: 'person-candidate', kind: 'person', payload: { name: 'Aki', projectId } };
    const first = planApply([project, person], { ids: new Set(), all: true }, emptyBase(), '2026-08-05T01:00:00.000Z');
    const second = planApply([project, person], { ids: new Set(), all: true }, {
      graphEntities: first.graphEntities,
      graphEdges: first.graphEdges,
      relationships: first.relationships,
      personalKg: first.personalKgAdditions,
      decisions: first.decisionAdditions
    }, '2026-08-05T01:00:00.000Z');
    expect(second.graphEntities).toEqual(first.graphEntities);
    expect(second.graphEdges).toEqual(first.graphEdges);
  });

  it('preserves ontology semantics when promoting a decision candidate', () => {
    const decision = {
      id: 'decision-candidate',
      kind: 'decision',
      payload: {
        decision: 'Use the reviewed ontology kernel for current answers.',
        projectId: 'project-brainbase',
        topic: 'ontology-runtime',
        supersedes: ['decision-legacy'],
        effectiveAt: '2026-08-05T00:00:00.000Z',
        rationale: 'The reviewed kernel has explicit inference rules.',
        tags: ['ontology', 'reviewed']
      }
    };
    const result = planApply(
      [decision],
      { ids: new Set([decision.id]), all: false },
      {
        ...emptyBase(),
        graphEntities: [
          { id: 'project-brainbase', type: 'project', name: 'Brainbase' },
          { id: 'decision-legacy', type: 'decision', name: 'Legacy decision' }
        ]
      },
      '2026-08-05T01:00:00.000Z'
    );

    expect(result.decisionAdditions).toEqual([
      expect.objectContaining({
        decision: decision.payload.decision,
        topic: 'ontology-runtime',
        supersedes: ['decision-legacy'],
        effectiveAt: '2026-08-05T00:00:00.000Z',
        rationale: 'The reviewed kernel has explicit inference rules.',
        tags: ['ontology', 'reviewed']
      })
    ]);
    expect(result.graphEntities).toContainEqual(expect.objectContaining({
      id: result.decisionAdditions[0].id,
      type: 'decision',
      validFrom: '2026-08-05T00:00:00.000Z'
    }));
    expect(result.graphEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromId: result.decisionAdditions[0].id, relation: 'governs', toId: 'project-brainbase' }),
      expect.objectContaining({ fromId: result.decisionAdditions[0].id, relation: 'supersedes', toId: 'decision-legacy' })
    ]));
  });
});

describe('loadApplyCandidates', () => {
  it('reads both wrapped sets and bare arrays', () => {
    expect(loadApplyCandidates({ candidates: [{ id: 'a', kind: 'person', payload: { name: 'X' } }] })).toHaveLength(1);
    expect(loadApplyCandidates([{ id: 'b', kind: 'org', payload: {} }])).toHaveLength(1);
    expect(() => loadApplyCandidates({ nope: true })).toThrow(/candidates array/);
  });
});
