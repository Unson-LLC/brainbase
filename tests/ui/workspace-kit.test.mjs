import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  workspaceButton,
  workspaceDefinition,
  workspaceDetailEmpty,
  workspaceLedger,
  workspaceMetrics,
  workspaceNotice,
  workspaceNotificationCard,
  workspaceErrorCard,
  workspaceLoadingCard,
  workspaceLoadingStage,
  workspacePageHeader,
  workspaceRailBlock,
  workspaceRailHead,
} from '../../ui/workspace-kit.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.hidden = false;
  }
  append(...children) { for (const child of children) if (child !== null && child !== undefined) this.children.push(child); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
}
class FakeDocument { createElement(tagName) { return new FakeElement(tagName); } }
const doc = new FakeDocument();
const text = (node) => `${node?.textContent ?? ''}${(node?.children ?? []).map(text).join('')}`;
const findAll = (node, predicate, found = []) => {
  if (predicate(node)) found.push(node);
  for (const child of node.children ?? []) findAll(child, predicate, found);
  return found;
};
const byClass = (node, className) => findAll(node, (item) => String(item.className).split(' ').includes(className));

describe('workspace kit (the organization edition screen pattern)', () => {
  it('builds the page head with breadcrumb, title, lead and the source label', () => {
    const page = workspacePageHeader(doc, { crumbs: ['あなたのBrainbase', 'プロジェクトと関係者'], title: 'プロジェクトと関係者', lead: '誰がどう関わるか', source: '手元のGraph' });
    expect(text(byClass(page, 'bb-ws-breadcrumb')[0])).toBe('あなたのBrainbase/プロジェクトと関係者');
    expect(findAll(page, (node) => node.tagName === 'H1')[0].textContent).toBe('プロジェクトと関係者');
    expect(byClass(page, 'bb-ws-lead')[0].textContent).toBe('誰がどう関わるか');
    expect(byClass(page, 'bb-ws-source')[0].textContent).toBe('手元のGraph');
  });

  it('labels a notice and marks warnings as alerts', () => {
    const info = workspaceNotice(doc, { label: '出典', text: 'このMacのGraph' });
    expect(info.className).toBe('bb-ws-notice is-info');
    expect(info.attributes.role).toBeUndefined();
    expect(text(info)).toBe('出典このMacのGraph');
    expect(workspaceNotice(doc, { label: '移行', text: '必要', tone: 'warning' }).attributes.role).toBe('alert');
  });

  it('shows an unknown metric as 未確認, never as zero', () => {
    const summary = workspaceMetrics(doc, [{ label: 'プロジェクト', value: 5, note: '有効' }, { label: '関係者', value: null }]);
    expect(summary.className).toContain('is-2');
    const values = findAll(summary, (node) => node.tagName === 'STRONG').map((node) => node.textContent);
    expect(values).toEqual(['5', '未確認']);
  });

  it('keeps up to six metrics in one row', () => {
    const items = (n) => Array.from({ length: n }, (_, index) => ({ label: `項目${index}`, value: index }));
    expect(workspaceMetrics(doc, items(5)).className).toContain('is-5');
    expect(workspaceMetrics(doc, items(6)).className).toContain('is-6');
    expect(workspaceMetrics(doc, items(8)).className).toContain('is-6');
  });

  it('renders ledger rows the owner selects, with the selection marked and the column template left to the caller', () => {
    const selected = [];
    const ledger = workspaceLedger(doc, {
      className: 'bb-graph-project-ledger',
      columns: ['プロジェクト', '状態'],
      rows: [
        { key: 'a', cells: [{ primary: 'Atlas導入', secondary: 'project-atlas' }, '進行中'], selected: true, onSelect: (key) => selected.push(key) },
        { key: 'b', cells: ['Beta', { text: '未記録', className: 'is-unresolved' }], onSelect: (key) => selected.push(key) },
      ],
    });
    expect(ledger.className).toBe('bb-ws-ledger bb-graph-project-ledger');
    const rows = byClass(ledger, 'bb-ws-ledger-row');
    expect(rows[0].className).toContain('bb-ws-ledger-head');
    expect(rows[1].tagName).toBe('BUTTON');
    expect(rows[1].className).toContain('is-selected');
    expect(rows[1].attributes['aria-pressed']).toBe('true');
    expect(rows[1].attributes['aria-label']).toBe('Atlas導入');
    expect(rows[2].attributes['aria-label']).toBe('Beta');
    expect(text(rows[1])).toBe('Atlas導入project-atlas進行中');
    rows[2].listeners.get('click')();
    expect(selected).toEqual(['b']);
    expect(byClass(rows[2], 'is-unresolved')[0].textContent).toBe('未記録');
  });

  it('says why a ledger is empty instead of leaving a blank table', () => {
    const ledger = workspaceLedger(doc, { columns: ['名前'], rows: [], empty: 'まだ登録がありません。' });
    expect(byClass(ledger, 'bb-ws-ledger-empty')[0].textContent).toBe('まだ登録がありません。');
  });

  it('builds the right rail: head, blocks, term and value pairs, and an empty state', () => {
    const head = workspaceRailHead(doc, { kicker: 'プロジェクト', title: 'Atlas導入', sub: 'project-atlas' });
    expect(text(head)).toBe('プロジェクトAtlas導入project-atlas');
    const block = workspaceRailBlock(doc, { title: '概要', content: workspaceDefinition(doc, [['状態', '進行中'], ['目的', null]]) });
    expect(block.attributes['aria-label']).toBe('概要');
    expect(text(block)).toBe('概要状態進行中目的未記録');
    expect(text(workspaceDetailEmpty(doc, { mark: 'P', title: 'プロジェクトを選択', text: '一覧から選ぶと詳細が出ます。' }))).toContain('プロジェクトを選択');
  });

  it('makes primary buttons and wires clicks', () => {
    let clicked = 0;
    const button = workspaceButton(doc, { text: '関係者を加える', variant: 'primary', onClick: () => { clicked += 1; } });
    expect(button.className).toBe('bb-ws-button is-primary');
    expect(button.attributes.type).toBe('button');
    button.listeners.get('click')();
    expect(clicked).toBe(1);
  });
});


describe('reusable notification surfaces', () => {
  it('shares the surface with expandable errors and normalizes semantic tones', () => {
    const content = doc.createElement('button');
    const card = workspaceNotificationCard(doc, { tone: 'attention', content, tag: 'p', className: 'host-placement' });
    expect(card.tagName).toBe('P');
    expect(card.className).toContain('bb-ws-notification-card is-warning');
    expect(card.children).toContain(content);
    expect(workspaceNotificationCard(doc, { tone: 'unexpected' }).className).toContain('is-info');
    const loading = workspaceLoadingCard(doc);
    expect(loading.className).toContain('bb-ws-notification-card is-info');
    expect(loading.attributes['aria-live']).toBe('polite');
    expect(loading.attributes.role).toBe('status');
    const retry = () => {};
    const error = workspaceErrorCard(doc, { title: '読み取り失敗', message: '0件とは未確認', onRetry: retry });
    expect(error.className).toContain('bb-ws-notification-card is-danger');
    expect(text(error)).toContain('0件とは未確認');
    expect(byClass(error, 'bb-ws-button')[0].listeners.get('click')).toBe(retry);
  });
});


describe('centered loading stage', () => {
  it('renders a friendly status with three dots inside a hidden mark, a title and an optional detail', () => {
    const stage = workspaceLoadingStage(doc, { title: '目的と現状を準備しています', detail: '正本を読み込んでいます' });
    expect(stage.tagName).toBe('DIV');
    expect(stage.className).toBe('bb-ws-loading-stage');
    expect(stage.attributes.role).toBe('status');
    expect(stage.attributes['aria-live']).toBe('polite');
    expect(stage.attributes['aria-busy']).toBeUndefined();
    const mark = byClass(stage, 'bb-ws-loading-stage-mark')[0];
    expect(mark.attributes['aria-hidden']).toBe('true');
    const dots = byClass(stage, 'bb-ws-loading-stage-dot');
    expect(dots).toHaveLength(3);
    // The dots inherit hidden semantics from the mark; they carry no redundant aria-hidden.
    expect(dots.every(dot => dot.attributes['aria-hidden'] === undefined)).toBe(true);
    expect(byClass(stage, 'bb-ws-loading-stage-title')[0].textContent).toBe('目的と現状を準備しています');
    expect(byClass(stage, 'bb-ws-loading-stage-detail')[0].textContent).toBe('正本を読み込んでいます');
  });

  it('uses the default title and adds the slow detail only when no detail was given', () => {
    const plain = workspaceLoadingStage(doc);
    expect(byClass(plain, 'bb-ws-loading-stage-title')[0].textContent).toBe('準備しています');
    expect(byClass(plain, 'bb-ws-loading-stage-detail')).toHaveLength(0);
    expect(plain.className).not.toContain('is-slow');

    const slow = workspaceLoadingStage(doc, { slow: true });
    expect(slow.className).toContain('is-slow');
    expect(byClass(slow, 'bb-ws-loading-stage-detail')[0].textContent).toBe('時間がかかっています。このままお待ちください。');

    const given = workspaceLoadingStage(doc, { slow: true, detail: 'もうすぐ表示できます' });
    expect(byClass(given, 'bb-ws-loading-stage-detail')[0].textContent).toBe('もうすぐ表示できます');
  });

  it('covers the loading dots in the reduced-motion rule', () => {
    const css = readFileSync(new URL('../../ui/workspace-kit.css', import.meta.url), 'utf8');
    const blockAt = (start) => {
      const open = css.indexOf('{', start);
      let depth = 0;
      for (let index = open; index < css.length; index += 1) {
        if (css[index] === '{') depth += 1;
        else if (css[index] === '}') {
          depth -= 1;
          if (depth === 0) return css.slice(start, index + 1);
        }
      }
      return '';
    };
    const reducedMotion = [...css.matchAll(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/g)]
      .map(match => blockAt(match.index))
      .join('\n');
    expect(reducedMotion).toMatch(/\.bb-ws-loading-stage-dot[^{}]*\{[^{}]*animation:\s*none/);
    expect(reducedMotion).toMatch(/\.bb-ws-loading-stage-dot[^{}]*\{[^{}]*opacity:\s*\.7/);
    expect(reducedMotion).toMatch(/\.bb-ws-loading-stage-dot[^{}]*\{[^{}]*transform:\s*none/);
  });
});
