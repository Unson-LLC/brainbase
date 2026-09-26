import { afterEach, describe, expect, it } from 'vitest';
import { createObjectiveEditorController, normalizeObjectiveError } from '../../ui/objective-editor.js';
import {
  createObjectiveEditorHttpPort,
  ObjectiveEditorHttpError,
  OBJECTIVE_AUTHORITY_FIELDS,
  stripObjectiveAuthorityFields,
} from '../../ui/objective-editor-http-port.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
  }

  append(...children) {
    for (const child of children) {
      if (child === null || child === undefined) continue;
      child.parentNode = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'value') this.value = String(value); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
}

class FakeDocument { createElement(tagName) { return new FakeElement(tagName); } }

function collectText(node) {
  return `${node?.textContent ?? ''}${(node?.children ?? []).map(collectText).join('')}`;
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const TOKEN = 'launch-token-0123456789';

function recordingFetcher(respond) {
  const calls = [];
  const fetcher = async (path, init = {}) => {
    const call = { path, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return respond(call);
  };
  return { fetcher, calls };
}

const draft = {
  id: 'objective-focus',
  type: 'objective',
  revision: '1',
  meaning: '深い仕事の時間を確保する',
  desiredState: '週に10時間',
  beneficiaryIds: ['self'],
  criteria: [],
  evaluationPeriod: { from: '', until: '' },
  adoptionState: 'draft',
  authorizedUses: ['draft'],
  acl: { ownerId: 'self', visibility: 'private', readerIds: [], writerIds: [] },
  scope: { subjectIds: ['self'], validFrom: '2026-01-01T00:00:00.000Z' },
  storage: 'ontology',
  provenance: [],
};

const previousDocument = globalThis.document;
afterEach(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

describe('Objective editor HTTP port', () => {
  it('sends only domain fields, with the token, and wraps an update in the CAS envelope', async () => {
    const { fetcher, calls } = recordingFetcher(() => jsonResponse(201, { state: 'saved_unverified', ref: { id: 'objective-focus', type: 'objective', revision: '1' } }));
    const port = createObjectiveEditorHttpPort({ fetcher, token: TOKEN });
    await port.createObjective(draft, { principal: 'ignored' });
    await port.updateObjective('objective/focus', '1', draft, { principal: 'ignored' });

    const [create, update] = calls;
    expect(create).toMatchObject({ path: '/api/foundation/objectives', method: 'POST' });
    expect(create.headers['X-Brainbase-Review-Token']).toBe(TOKEN);
    for (const field of ['acl', 'scope', 'storage', 'provenance', 'authorizedUses']) expect(create.body).not.toHaveProperty(field);
    expect(create.body).toMatchObject({ id: 'objective-focus', meaning: '深い仕事の時間を確保する', adoptionState: 'draft' });
    expect(JSON.stringify(create.body)).not.toContain('ignored');

    expect(update).toMatchObject({ path: '/api/foundation/objectives/objective%2Ffocus', method: 'PUT' });
    expect(Object.keys(update.body).sort()).toEqual(['definition', 'expectedRevision']);
    expect(update.body.expectedRevision).toBe('1');
    expect(update.body.definition).not.toHaveProperty('acl');
    expect(OBJECTIVE_AUTHORITY_FIELDS.some((field) => Object.hasOwn(update.body.definition, field))).toBe(false);
  });

  it('reads without the token, passes the revision and reports the list payload to the host', async () => {
    const listPayload = { state: 'partial', records: [], absence_confirmed: false, unreadable: { count: 1, codes: ['authorization_denied'] } };
    const { fetcher, calls } = recordingFetcher(({ path }) => {
      if (path === '/api/foundation/objectives') return jsonResponse(200, listPayload);
      if (path.startsWith('/api/foundation/objectives/missing')) return jsonResponse(404, { error: { code: 'not_found', message: 'Objective missing was not found' } });
      return jsonResponse(200, { state: 'ready', refs: [], absence_confirmed: true });
    });
    const seen = [];
    const port = createObjectiveEditorHttpPort({ fetcher, token: TOKEN, onListResult: (payload) => seen.push(payload) });
    expect(await port.listObjectives({})).toBe(listPayload);
    expect(seen).toEqual([listPayload]);
    expect(await port.readObjective('missing', {}, '2')).toBeNull();
    await port.listObjectiveConstraintRefs({ id: 'objective-focus', type: 'objective', revision: '3' }, {});
    await port.checkObjectiveReadiness('objective-focus', {}, '3');
    expect(calls.map((call) => call.path)).toEqual([
      '/api/foundation/objectives',
      '/api/foundation/objectives/missing?revision=2',
      '/api/foundation/objectives/objective-focus/constraints?revision=3',
      '/api/foundation/objectives/objective-focus/readiness?revision=3',
    ]);
    expect(calls.every((call) => !('X-Brainbase-Review-Token' in call.headers))).toBe(true);
    // Constraint links and Story links are not written or read through this port.
    expect(port.replaceObjectiveConstraintRefs).toBeUndefined();
    expect(port.listStoryObjectiveLinks).toBeUndefined();
  });

  it('throws the host error with its code, status and current revision', async () => {
    const { fetcher } = recordingFetcher(({ method }) => (method === 'PUT'
      ? jsonResponse(409, { error: { code: 'revision_conflict', message: 'stale', currentRevision: '3' } })
      : jsonResponse(400, { error: { code: 'invalid_input', message: 'evaluationPeriod: invalid' } })));
    const port = createObjectiveEditorHttpPort({ fetcher, token: TOKEN });
    const conflict = await port.updateObjective('objective-focus', '2', draft).catch((error) => error);
    expect(conflict).toBeInstanceOf(ObjectiveEditorHttpError);
    expect(conflict).toMatchObject({ code: 'revision_conflict', status: 409, currentRevision: '3' });
    expect(normalizeObjectiveError(conflict)).toMatchObject({ state: 'conflict', currentRevision: '3' });
    const invalid = await port.createObjective(draft).catch((error) => error);
    expect(invalid).toMatchObject({ code: 'invalid_input', status: 400 });
    expect(invalid.message).toContain('evaluationPeriod: invalid');
  });

  it('lets the editor create an Objective and verify it by reading the new revision back', async () => {
    globalThis.document = new FakeDocument();
    const stored = new Map();
    const { fetcher, calls } = recordingFetcher(({ path, method, body }) => {
      if (method === 'POST') {
        const record = { definition: { ...body, revision: '1', acl: { ownerId: 'self' } }, digest: 'sha256:1' };
        stored.set(body.id, record);
        return jsonResponse(201, { state: 'saved_unverified', ref: { id: body.id, type: 'objective', revision: '1', digest: 'sha256:1' } });
      }
      if (path === '/api/foundation/objectives') return jsonResponse(200, { state: 'ready', records: [...stored.values()], absence_confirmed: true });
      const id = decodeURIComponent(path.split('/')[4].split('?')[0]);
      return stored.has(id) ? jsonResponse(200, { state: 'ready', record: stored.get(id) }) : jsonResponse(404, { error: { code: 'not_found' } });
    });
    const root = new FakeElement('div');
    const controller = createObjectiveEditorController({
      root, port: createObjectiveEditorHttpPort({ fetcher, token: TOKEN }), context: {}, canEdit: true, autoLoad: false,
      constraintsEditable: false, storyLinks: false,
    });
    controller.beginCreate();
    const result = await controller.saveObjective({ ...controller.state.editor.draft, id: 'objective-focus', meaning: '深い仕事', desiredState: '週10時間' });
    expect(result.state).toBe('verified');
    expect(collectText(root)).toContain('正本と一致');
    const post = calls.find((call) => call.method === 'POST');
    expect(post.body).not.toHaveProperty('authorizedUses');
    expect(stripObjectiveAuthorityFields({ a: 1, acl: {} })).toEqual({ a: 1 });
  });
});
