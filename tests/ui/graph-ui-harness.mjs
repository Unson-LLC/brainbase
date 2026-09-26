/*
 * Harness for the Graph screen parts: a small fake DOM, and the real Graph
 * HTTP handler on a synthetic data directory so the parts are checked against
 * the actual API shapes and status codes instead of hand-written payloads.
 */
import { createServer } from 'node:http';
import { createGraphWebHttpHandler } from '../../src/graph-web-http.js';
import { FIXTURE_NOW } from '../graph-web-fixture.js';

export const TOKEN = 'graph-ui-test-token-0123456789';

export class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.selected = false;
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
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  dispatch(name, event = {}) { return this.listeners.get(name)?.({ preventDefault() {}, target: this, ...event }); }
}

export class FakeDocument { createElement(tagName) { return new FakeElement(tagName); } }

export function collectText(node) {
  return `${node?.textContent ?? ''}${(node?.children ?? []).map(collectText).join('')}`;
}

/** Text a person sees without opening the 記録の詳細 / 履歴 disclosures. */
export function visibleText(node) {
  if (!node || node.tagName === 'DETAILS') return '';
  return `${node.textContent ?? ''}${(node.children ?? []).map(visibleText).join('')}`;
}

export function findAll(node, predicate, result = []) {
  if (!node) return result;
  if (predicate(node)) result.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, result);
  return result;
}

export function section(root, label) {
  return findAll(root, (node) => node.tagName === 'SECTION' && node.attributes['aria-label'] === label)[0];
}

export function buttonsNamed(root, label) {
  return findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent === label);
}

export function control(root, name) {
  return findAll(root, (node) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) && node.attributes.name === name)[0];
}

/** Types into a control the way a browser reports it: value, then an input event. */
export function type(root, name, value) {
  const element = control(root, name);
  if (!element) throw new Error(`no control ${name}`);
  element.value = value;
  element.dispatch('input');
  element.dispatch('change');
  return element;
}

export function submit(root) {
  const form = findAll(root, (node) => node.tagName === 'FORM' && node.className.includes('bb-graph-form') && !node.className.includes('bb-gr-search'))[0];
  if (!form) throw new Error('no correction form');
  return form.dispatch('submit');
}

export async function waitFor(check, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for the view');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/**
 * Serves the real Graph routes for `dataDir`.  Writes require the launch token
 * header the parts send, as the local Web host does.
 */
export async function startGraphApi(dataDir, { now = FIXTURE_NOW } = {}) {
  const handler = createGraphWebHttpHandler({
    dataDir,
    now: () => now,
    assertWriteAllowed(request) {
      if (request.headers['x-brainbase-review-token'] !== TOKEN) {
        throw Object.assign(new Error('A valid launch token is required'), { statusCode: 403, code: 'web_token_required' });
      }
    },
  });
  const server = createServer((request, response) => {
    void handler(request, response).then((handled) => {
      if (handled) return;
      response.statusCode = 404;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const requests = [];
  const fetcher = async (path, init = {}) => {
    requests.push({ path, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    return fetch(`${base}${path}`, init);
  };
  return {
    fetcher,
    requests,
    posts: () => requests.filter((request) => request.method === 'POST'),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
