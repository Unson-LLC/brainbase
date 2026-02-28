import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import { describe, it, expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

const HTML_PATH = path.join(repoRoot, 'public/index.html');
const APP_PATH = path.join(repoRoot, 'public/app.js');

const GET_ID_RE = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
const GET_CLASS_RE = /getElementsByClassName\(\s*['"]([^'"]+)['"]\s*\)/g;
const SELECTOR_RE = /\.(querySelectorAll|querySelector|closest|matches)\(\s*['"]([^'"]+)['"]\s*\)/g;
const ID_ATTR_RE = /id\s*=\s*['"]([^'"]+)['"]/g;
const ID_ASSIGN_RE = /\.id\s*=\s*['"]([^'"]+)['"]/g;
const ID_SETATTR_RE = /setAttribute\(\s*['"]id['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
const CLASS_ATTR_RE = /class\s*=\s*['"]([^'"]+)['"]/g;
const CLASS_ASSIGN_RE = /\.className\s*=\s*['"]([^'"]+)['"]/g;
const CLASS_SETATTR_RE = /setAttribute\(\s*['"]class['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
const CLASSLIST_RE = /\.classList\.(add|remove|toggle)\(([^)]+)\)/g;
const DATA_ATTR_RE = /data-([a-zA-Z0-9_-]+)\s*=/g;
const DATA_SETATTR_RE = /setAttribute\(\s*['"]data-([a-zA-Z0-9_-]+)['"]\s*,/g;
const DATASET_ASSIGN_RE = /\.dataset\.([a-zA-Z0-9_-]+)\s*=/g;
const IMPORT_RE = /import\s+[^;]+?\s+from\s+['"](\.[^'"]+)['"]/g;

function extractIdsFromModule(source) {
  const ids = new Set();
  for (const match of source.matchAll(GET_ID_RE)) {
    ids.add(match[1]);
  }
  for (const match of source.matchAll(SELECTOR_RE)) {
    const selector = match[2];
    for (const idMatch of selector.matchAll(/#([a-zA-Z0-9_-]+)/g)) {
      ids.add(idMatch[1]);
    }
  }
  return ids;
}

function extractClassesFromSelectors(source) {
  const classes = new Set();
  for (const match of source.matchAll(SELECTOR_RE)) {
    const selector = match[2];
    for (const classMatch of selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
      classes.add(classMatch[1]);
    }
  }
  for (const match of source.matchAll(GET_CLASS_RE)) {
    match[1]
      .split(/\s+/)
      .map((c) => c.trim())
      .filter(Boolean)
      .forEach((c) => classes.add(c));
  }
  return classes;
}

function extractDataAttrsFromSelectors(source) {
  const dataAttrs = new Set();
  for (const match of source.matchAll(SELECTOR_RE)) {
    const selector = match[2];
    for (const dataMatch of selector.matchAll(/\[data-([a-zA-Z0-9_-]+)/g)) {
      dataAttrs.add(dataMatch[1]);
    }
  }
  return dataAttrs;
}

function getIdsFromHtml(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  return new Set([...document.querySelectorAll('[id]')].map((el) => el.id));
}

function getClassesFromHtml(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const classes = new Set();
  document.querySelectorAll('[class]').forEach((el) => {
    el.className
      .split(/\s+/)
      .map((c) => c.trim())
      .filter(Boolean)
      .forEach((c) => classes.add(c));
  });
  return classes;
}

function getDataAttrsFromHtml(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const dataAttrs = new Set();
  document.querySelectorAll('*').forEach((el) => {
    for (const attr of el.getAttributeNames()) {
      if (attr.startsWith('data-')) {
        dataAttrs.add(attr.replace(/^data-/, ''));
      }
    }
  });
  return dataAttrs;
}

function collectProvidedIds(sources) {
  const ids = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(ID_ATTR_RE)) {
      ids.add(match[1]);
    }
    for (const match of source.matchAll(ID_ASSIGN_RE)) {
      ids.add(match[1]);
    }
    for (const match of source.matchAll(ID_SETATTR_RE)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

function collectProvidedClasses(sources) {
  const classes = new Set();
  const addClassesFromValue = (value) => {
    const cleaned = value.replace(/\$\{[^}]+\}/g, ' ').trim();
    cleaned
      .split(/\s+/)
      .map((c) => c.trim())
      .filter(Boolean)
      .forEach((c) => classes.add(c));
  };
  for (const source of sources) {
    for (const match of source.matchAll(CLASS_ATTR_RE)) {
      addClassesFromValue(match[1]);
    }
    for (const match of source.matchAll(CLASS_ASSIGN_RE)) {
      addClassesFromValue(match[1]);
    }
    for (const match of source.matchAll(CLASS_SETATTR_RE)) {
      addClassesFromValue(match[1]);
    }
    for (const match of source.matchAll(CLASSLIST_RE)) {
      const args = match[2]
        .split(',')
        .map((part) => part.trim())
        .map((part) => part.replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      args.forEach((c) => classes.add(c));
    }
  }
  return classes;
}

function collectProvidedDataAttrs(sources) {
  const dataAttrs = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(DATA_ATTR_RE)) {
      dataAttrs.add(match[1]);
    }
    for (const match of source.matchAll(DATA_SETATTR_RE)) {
      dataAttrs.add(match[1]);
    }
    for (const match of source.matchAll(DATASET_ASSIGN_RE)) {
      dataAttrs.add(match[1]);
    }
  }
  return dataAttrs;
}

function resolveImportGraph(entryPath) {
  const resolved = new Set();
  const toVisit = [entryPath];

  while (toVisit.length > 0) {
    const current = toVisit.pop();
    if (resolved.has(current)) continue;
    resolved.add(current);

    const source = readFileSync(current, 'utf-8');
    const baseDir = path.dirname(current);

    for (const match of source.matchAll(IMPORT_RE)) {
      const rel = match[1];
      const candidate = path.resolve(baseDir, rel.endsWith('.js') ? rel : `${rel}.js`);
      if (!candidate.startsWith(repoRoot)) continue;
      if (!candidate.endsWith('.js')) continue;
      if (!resolved.has(candidate) && candidate.startsWith(path.join(repoRoot, 'public'))) {
        toVisit.push(candidate);
      }
    }
  }

  return [...resolved].filter((p) => p !== entryPath);
}

describe('DOM consistency', () => {
  it('app modules only reference ids that exist in static or generated DOM', () => {
    const html = readFileSync(HTML_PATH, 'utf-8');
    const htmlIds = getIdsFromHtml(html);
    const htmlClasses = getClassesFromHtml(html);
    const htmlDataAttrs = getDataAttrsFromHtml(html);
    const appSource = readFileSync(APP_PATH, 'utf-8');
    const importedModules = resolveImportGraph(APP_PATH);

    const moduleSources = [appSource];
    for (const modulePath of importedModules) {
      moduleSources.push(readFileSync(modulePath, 'utf-8'));
    }

    const providedIds = collectProvidedIds(moduleSources);
    const providedClasses = collectProvidedClasses(moduleSources);
    const providedDataAttrs = collectProvidedDataAttrs(moduleSources);
    const availableIds = new Set([...htmlIds, ...providedIds]);
    const availableClasses = new Set([...htmlClasses, ...providedClasses]);
    const availableDataAttrs = new Set([...htmlDataAttrs, ...providedDataAttrs]);

    const missingByModule = [];
    for (const modulePath of [APP_PATH, ...importedModules]) {
      const source = modulePath === APP_PATH ? appSource : readFileSync(modulePath, 'utf-8');
      const ids = extractIdsFromModule(source);
      const missing = [...ids].filter((id) => !availableIds.has(id));
      if (missing.length) {
        const relPath = path.relative(repoRoot, modulePath);
        missingByModule.push(`${relPath}: ${missing.join(', ')}`);
      }
    }

    const missingClassesByModule = [];
    for (const modulePath of [APP_PATH, ...importedModules]) {
      const source = modulePath === APP_PATH ? appSource : readFileSync(modulePath, 'utf-8');
      const classes = extractClassesFromSelectors(source);
      const missing = [...classes].filter((c) => !availableClasses.has(c));
      if (missing.length) {
        const relPath = path.relative(repoRoot, modulePath);
        missingClassesByModule.push(`${relPath}: ${missing.join(', ')}`);
      }
    }

    const missingDataAttrsByModule = [];
    for (const modulePath of [APP_PATH, ...importedModules]) {
      const source = modulePath === APP_PATH ? appSource : readFileSync(modulePath, 'utf-8');
      const dataAttrs = extractDataAttrsFromSelectors(source);
      const missing = [...dataAttrs].filter((d) => !availableDataAttrs.has(d));
      if (missing.length) {
        const relPath = path.relative(repoRoot, modulePath);
        missingDataAttrsByModule.push(`${relPath}: ${missing.join(', ')}`);
      }
    }

    expect(missingByModule).toEqual([]);
    expect(missingClassesByModule).toEqual([]);
    expect(missingDataAttrsByModule).toEqual([]);
  });
});
