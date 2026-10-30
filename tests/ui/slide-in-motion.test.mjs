import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('shell and world slide-in motion', () => {
  const drawer = 'var(--bb-ease-drawer, cubic-bezier(0.32, 0.72, 0, 1))';
  const out = 'var(--bb-ease-out, cubic-bezier(0.23, 1, 0.32, 1))';

  for (const [file, selector, transition] of [
    ['local-web-shell.css', '.bb-shell-sidebar', `transform .2s ${drawer}`],
    ['world/world-canvas-ui.css', '.bb-world-canvas-ui .bb-world-canvas-drawer', `transform .24s ${drawer}, visibility .24s`],
    ['world/world-canvas-ui.css', '.bb-world-canvas-ui .bb-world-canvas-help', `transform .24s ${out}, opacity .24s ${out}, visibility .24s`],
  ]) {
    it(`${selector} uses easing tokens with literal fallbacks and preserves timing`, () => {
      const css = readFileSync(new URL(`../../ui/${file}`, import.meta.url), 'utf8');
      const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, selectors]) => selectors.trim() === selector)
        .map(([, , body]) => body);
      const transitions = rules.flatMap(body => [...body.matchAll(/transition:\s*([^;]+);/g)].map(match => match[1]));
      expect(transitions).toContain(transition);
      for (const value of transitions) expect(value).not.toMatch(/\bease\b(?!-)/);

      const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
      const reducedRule = reduced.slice(reduced.indexOf(selector)).split('}')[0];
      expect(reducedRule).toContain('transition: none;');
    });
  }
});
