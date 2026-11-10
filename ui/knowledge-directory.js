import { makeWorkspaceElement as el, workspaceSearchControl, workspaceFilterPopover, workspaceButton, workspaceDialog } from './workspace-kit.js';

const SCOPES = [['all', 'すべて'], ['project', 'プロジェクトの記録'], ['organization', '組織共通']];
const STATUSES = [['active', '有効な記録'], ['inactive', '現在は非適用'], ['all', 'すべて']];

/** Presentation only: callers keep the query, project and API state. */
export function knowledgeDirectoryToolbar(doc, { filters, queryInput, onCompositionEnd, projects = [], projectCode = '', onChange, onProject, onRegister, actions = [] }) {
  const root = el(doc, 'div', { className: 'knowledge-directory-toolbar' });
  const query = queryInput || el(doc, 'input', { attrs: { type: 'search', 'aria-label': 'タイトルや要旨から探す', placeholder: 'タイトルや要旨から探す', maxlength: '200' } });
  query.value = filters.q || '';
  const search = workspaceSearchControl(doc, { input: query });
  let composing = false;
  const submitQuery = () => {
    if (query.value === filters.q) return false;
    onChange({ ...filters, q: query.value }); return true;
  };
  const startComposition = () => { composing = true; };
  const finishComposition = () => { composing = false; if (!submitQuery()) onCompositionEnd?.(); };
  const input = event => { if (!composing && !event.isComposing) submitQuery(); };
  const keydown = event => { if (event.key === 'Enter' && !composing && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submitQuery(); } };
  query.addEventListener('compositionstart', startComposition);
  query.addEventListener('compositionend', finishComposition);
  query.addEventListener('input', input);
  query.addEventListener('keydown', keydown);
  root.append(search);
  const chips = el(doc, 'div', { className: 'knowledge-directory-chips' });
  const chip = (label, clear) => chips.append(workspaceButton(doc, { text: `${label} ×`, attrs: { 'aria-label': `${label}を解除` }, onClick: clear }));
  const panel = el(doc, 'div', { attrs: { 'aria-label': '知識の絞り込み' } });
  const field = (label, name, choices, selected, onChangeField) => {
    const wrap = el(doc, 'label', { className: 'knowledge-directory-field', text: label });
    const select = el(doc, 'select', { className: 'knowledge-control', attrs: { name, 'aria-label': label } });
    for (const [value, text] of choices) select.append(el(doc, 'option', { text, attrs: { value } }));
    select.value = selected;
    select.addEventListener('change', () => onChangeField(select.value));
    wrap.append(select); panel.append(wrap);
  };
  field('プロジェクト', 'knowledge_project', [['', 'すべてのプロジェクト'], ...projects.map(p => [p.code, p.name])], projectCode, code => onProject(code || null, filters));
  field('範囲', 'scope', SCOPES, filters.scope, scope => onChange({ ...filters, scope }));
  field('有効状態', 'status', STATUSES, filters.status, status => onChange({ ...filters, status }));
  if (projectCode) chip(projects.find(p => p.code === projectCode)?.name || projectCode, () => onProject(null, filters));
  if (filters.scope !== 'all') chip(SCOPES.find(([v]) => v === filters.scope)?.[1] || filters.scope, () => onChange({ ...filters, scope: 'all' }));
  if (filters.status !== 'active') chip(STATUSES.find(([v]) => v === filters.status)?.[1] || filters.status, () => onChange({ ...filters, status: 'active' }));
  root.append(chips);
  const popover = workspaceFilterPopover(doc, { panel, appearance: 'icon' });
  popover.control.setAttribute('aria-label', '絞り込む');
  if (projectCode || filters.scope !== 'all' || filters.status !== 'active') popover.control.classList.add('is-filtered');
  root.append(popover.root);
  const add = workspaceButton(doc, { text: '＋ 知識を登録', variant: 'primary', onClick: onRegister });
  root.append(add);
  for (const action of actions) root.append(action);
  return { root, query, get isComposing() { return composing; }, destroy() {
    popover.destroy();
    query.removeEventListener('compositionstart', startComposition);
    query.removeEventListener('compositionend', finishComposition);
    query.removeEventListener('input', input);
    query.removeEventListener('keydown', keydown);
  } };
}

/** A project is chosen explicitly here; no implicit save destination is invented. */
export function knowledgeRegistrationChooser(doc, { projects, opener, onSelect }) {
  const body = el(doc, 'div', { className: 'knowledge-registration-choice' });
  const label = el(doc, 'label', { className: 'knowledge-directory-field', text: 'プロジェクト' });
  const select = el(doc, 'select', { className: 'knowledge-control', attrs: { 'aria-label': '登録するプロジェクト' } });
  select.append(el(doc, 'option', { text: '選択してください', attrs: { value: '' } }));
  for (const p of projects) select.append(el(doc, 'option', { text: p.name, attrs: { value: p.code } }));
  label.append(select); body.append(label);
  if (!projects.length) body.append(el(doc, 'p', { text: '登録先に選べるプロジェクトを確認できません。', attrs: { role: 'status' } }));
  let dialog;
  const next = workspaceButton(doc, { text: '登録内容へ', variant: 'primary', disabled: true, onClick: () => {
    const code = select.value;
    if (!projects.some(p => p.code === code)) return;
    dialog.dispose(); onSelect(code);
  } });
  select.addEventListener('change', () => { next.disabled = !projects.some(p => p.code === select.value); });
  body.append(next);
  dialog = workspaceDialog(doc, { title: '知識を登録', presentation: 'drawer', content: body, opener });
  return dialog;
}
