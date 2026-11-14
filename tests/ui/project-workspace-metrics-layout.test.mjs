import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The project overview sits beside the shell's rail (and a host's detail
// panel), so on an 800px screen it is only about 520px wide while the viewport
// is still "desktop". Four metrics then got about 90px each and a 30px value
// such as 未確認 broke inside the word. The metrics must follow the overview's
// own width, not the viewport.
const css = readFileSync(fileURLToPath(new URL('../../ui/project-workspace.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function blocks(source) {
  const found = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '{') {
      stack.push({ prelude: source.slice(start, i).trim(), open: i, parent: stack.at(-1)?.prelude ?? null });
      start = i + 1;
    } else if (source[i] === '}') {
      const block = stack.pop();
      found.push({ prelude: block.prelude, parent: block.parent, body: source.slice(block.open + 1, i) });
      start = i + 1;
    } else if (source[i] === ';' && stack.length === 0) {
      start = i + 1;
    }
  }
  return found;
}

const all = blocks(css);
const rulesFor = (selector) => all.filter((block) => block.prelude.split(',').map((part) => part.trim()).includes(selector));

describe('project overview metrics follow the overview width', () => {
  it('makes the overview a named inline-size container', () => {
    const own = rulesFor('.bb-pkw-dense-overview').filter((block) => block.parent === null);
    expect(own.map((block) => block.body).join('')).toMatch(/container:\s*bb-pkw-overview\s*\/\s*inline-size/);
  });

  it('switches the metrics to two per row from the container query, not a media query', () => {
    const twoColumns = rulesFor('.bb-pkw-dense-metrics')
      .filter((block) => /grid-template-columns:\s*repeat\(2,/.test(block.body));
    expect(twoColumns.map((block) => block.parent)).toEqual(['@container bb-pkw-overview (max-width: 600px)']);
  });

  it('keeps every metric padding rule for the narrow layout inside the same container query', () => {
    const narrow = all.filter((block) => block.prelude.includes('.bb-pkw-dense-metric') && block.parent?.startsWith('@media'));
    expect(narrow).toEqual([]);
  });
});
