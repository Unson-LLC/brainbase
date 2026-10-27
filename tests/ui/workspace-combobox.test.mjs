import { describe, expect, it, vi } from 'vitest';
import { workspaceCombobox } from '../../ui/workspace-kit.js';

class Node {
  constructor(doc, tagName) {
    this.ownerDocument = doc; this.tagName = tagName.toUpperCase(); this.children = []; this.attributes = {};
    this.listeners = new Map(); this.className = ''; this.textContent = ''; this.hidden = false; this.value = '';
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) || []), callback]); }
  removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item !== callback)); }
  dispatch(name, values = {}) {
    const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...values };
    for (const callback of [...(this.listeners.get(name) || [])]) callback(event);
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
}
class Document extends Node {
  constructor() { super(null, '#document'); this.ownerDocument = this; this.body = this.createElement('body'); }
  createElement(tagName) { return new Node(this, tagName); }
}

const people = [
  { value: '', label: 'すべての担当者' },
  { value: '__unassigned__', label: '担当者未確認' },
  ...Array.from({ length: 30 }, (_, index) => ({ value: `per_${index}`, label: `担当者${index}`, hint: index === 7 ? '営業部' : '' })),
];

function setup(options = {}) {
  const doc = new Document(); const onChange = vi.fn();
  const box = workspaceCombobox(doc, { label: '担当', options: people, onChange, ...options });
  doc.body.append(box.root);
  return { doc, box, onChange };
}
const optionLabels = box => box.list.children.map(item => item.children[0].textContent);
const press = (node, key) => node.dispatch('keydown', { key });

describe('workspaceCombobox', () => {
  it('opens from the trigger into a labelled search box that drives a listbox', () => {
    const { doc, box } = setup({ value: 'per_3' });
    expect(box.trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(box.trigger.getAttribute('aria-label')).toBe('担当: 担当者3');
    box.trigger.dispatch('click');
    expect(box.trigger.getAttribute('aria-expanded')).toBe('true');
    expect(box.popup.hidden).toBe(false);
    expect(doc.activeElement).toBe(box.search);
    expect(box.search.getAttribute('role')).toBe('combobox');
    expect(box.search.getAttribute('aria-controls')).toBe(box.list.getAttribute('id'));
    expect(box.list.getAttribute('role')).toBe('listbox');
    // The chosen option starts active and is announced as selected.
    const active = box.list.children.find(item => item.getAttribute('id') === box.search.getAttribute('aria-activedescendant'));
    expect(active.getAttribute('data-value')).toBe('per_3');
    expect(active.getAttribute('aria-selected')).toBe('true');
  });

  it('filters by label and hint, width-insensitively, and chooses with the keyboard', () => {
    const { doc, box, onChange } = setup();
    box.open();
    box.search.value = '営業'; box.search.dispatch('input');
    expect(optionLabels(box)).toEqual(['担当者7']);
    box.search.value = '担当者１'; box.search.dispatch('input');
    expect(optionLabels(box)).toEqual(['担当者1', ...Array.from({ length: 10 }, (_, index) => `担当者${10 + index}`)]);
    press(box.search, 'ArrowDown');
    press(box.search, 'Enter');
    expect(onChange).toHaveBeenCalledWith('per_10', expect.objectContaining({ label: '担当者10' }));
    expect(box.value).toBe('per_10');
    expect(box.isOpen).toBe(false);
    expect(doc.activeElement).toBe(box.trigger);
    expect(box.trigger.getAttribute('aria-label')).toBe('担当: 担当者10');
  });

  it('keeps an unassigned choice reachable and says when nothing matches', () => {
    const { box } = setup();
    box.open('未確認');
    expect(optionLabels(box)).toEqual(['担当者未確認']);
    box.search.value = 'zzz'; box.search.dispatch('input');
    expect(box.list.children).toHaveLength(0);
    expect(box.list.getAttribute('aria-activedescendant')).toBe(null);
    expect(box.popup.children[2].textContent).toBe('一致する候補はありません');
  });

  it('renders only the first matches of a long list and says how many remain', () => {
    const { box } = setup({ limit: 5 });
    box.open();
    expect(box.list.children).toHaveLength(5);
    expect(box.popup.children[2].textContent).toBe('32件中5件を表示。ほか27件は絞り込むと出ます');
    press(box.search, 'PageDown');
    expect(box.search.getAttribute('aria-activedescendant')).toBe(box.list.children[4].getAttribute('id'));
  });

  it('closes without choosing on Escape, Tab and an outside press', () => {
    const { doc, box, onChange } = setup();
    box.open(); press(box.search, 'Escape');
    expect(box.isOpen).toBe(false); expect(doc.activeElement).toBe(box.trigger);
    box.open(); press(box.search, 'Tab');
    expect(box.isOpen).toBe(false);
    box.open(); doc.dispatch('pointerdown', { target: doc.body });
    expect(box.isOpen).toBe(false);
    expect(doc.listeners.get('pointerdown')).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('starts a search from a typed character on the trigger and chooses by pointer', () => {
    const { box, onChange } = setup();
    const event = press(box.trigger, '9');
    expect(event.defaultPrevented).toBe(true);
    expect(box.search.value).toBe('9');
    expect(optionLabels(box)).toEqual(['担当者9', '担当者19', '担当者29']);
    box.list.children[1].dispatch('click');
    expect(onChange).toHaveBeenCalledWith('per_19', expect.anything());
  });

  it('hides the search box for short lists and moves through them with Home and End', () => {
    const doc = new Document();
    const box = workspaceCombobox(doc, { label: '並べ替え', value: 'due', options: [{ value: '', label: '標準' }, { value: 'due', label: '期限が近い順' }, { value: 'updated', label: '更新が新しい順' }] });
    box.trigger.dispatch('click');
    expect(box.search.hidden).toBe(true);
    expect(doc.activeElement).toBe(box.list);
    press(box.list, 'End');
    expect(box.list.getAttribute('aria-activedescendant')).toBe(box.list.children[2].getAttribute('id'));
    press(box.list, 'Home'); press(box.list, 'Enter');
    expect(box.value).toBe('');
  });

  it('shows a value the options do not offer instead of looking unset, and can be disabled', () => {
    const { box } = setup({ value: 'per_missing' });
    expect(box.trigger.getAttribute('aria-label')).toBe('担当: per_missing');
    box.update({ value: '', options: [] });
    expect(box.trigger.getAttribute('data-empty')).toBe('true');
    box.update({ disabled: true });
    expect(box.trigger.getAttribute('disabled')).toBe('');
    box.open();
    expect(box.isOpen).toBe(false);
  });
});


describe('opt-in multiple scope choices', () => {
  it('toggles choices without closing or resetting the list scroll, and clears with the empty choice', () => {
    const { box, onChange, doc } = setup({ multiple: true, values: ['per_3'], searchable: false, showCount: false, showHints: false, align: 'end' });
    box.open(); expect(doc.activeElement).toBe(box.list);
    expect(box.list.getAttribute('aria-multiselectable')).toBe('true');
    box.list.scrollTop = 120;
    box.list.children.find(item => item.getAttribute('data-value') === 'per_7').dispatch('click');
    expect(box.values).toEqual(['per_3', 'per_7']); expect(box.isOpen).toBe(true); expect(box.list.scrollTop).toBe(120);
    expect(box.trigger.getAttribute('aria-label')).toBe('担当: 2件選択中');
    press(box.list, ' '); expect(box.values).toEqual(['per_3']);
    press(box.list, ' '); expect(box.values).toEqual(['per_3', 'per_7']);
    expect(box.popup.children[2].hidden).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(['per_3', 'per_7'], expect.anything());
    box.list.children[0].dispatch('click'); expect(box.values).toEqual([]); expect(box.isOpen).toBe(true);
    press(box.list, 'End'); press(box.list, ' '); expect(box.values).toEqual(['per_29']);
    press(box.list, 'Escape'); expect(doc.activeElement).toBe(box.trigger);
  });

  it('does not rebuild identical open options, but still exposes empty and truncated-list feedback', () => {
    const { box } = setup({ multiple: true, values: ['per_3'], searchable: false, showCount: false });
    box.open(); const first = box.list.children[0];
    box.update({ options: people.map(option => ({ ...option })), values: ['per_3'] });
    expect(box.list.children[0]).toBe(first);
    box.update({ options: [] }); expect(box.popup.children[2].hidden).toBe(false);
    expect(box.popup.children[2].textContent).toBe('一致する候補はありません');
    const limited = setup({ showCount: false, limit: 2 }).box; limited.open();
    expect(limited.popup.children[2].hidden).toBe(false);
    expect(limited.popup.children[2].textContent).toContain('ほか');
  });
});
