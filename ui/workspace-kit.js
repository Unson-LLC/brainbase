/*
 * Workspace kit: the organization edition's screen pattern as shared parts.
 *
 * Every Brainbase screen is built the same way — breadcrumb and page head,
 * a notice about the source, actions, summary metrics, a ledger of rows the
 * owner selects, and a right rail with the selected item's detail. The look
 * comes from workspace-kit.css (organization design values through the
 * `--bb-*` tokens). Builders take the host's document and return elements;
 * they keep no state. Column widths are set by the caller's CSS class on the
 * ledger, because the hosts' CSP forbids inline styles.
 */

export const WORKSPACE_KIT_CONTRACT_VERSION = 'brainbase.workspace-kit.v1';

export function makeWorkspaceElement(doc, tag, { className, text, attrs = {} } = {}) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  return element;
}

const el = makeWorkspaceElement;

function appendContent(parent, doc, content) {
  if (content === undefined || content === null || content === false) return;
  if (Array.isArray(content)) {
    for (const item of content) appendContent(parent, doc, item);
    return;
  }
  if (typeof content === 'object' && typeof content.tagName === 'string') {
    parent.append(content);
    return;
  }
  if (typeof content === 'object' && 'text' in content) {
    parent.append(el(doc, 'span', { className: content.className, text: content.text }));
    return;
  }
  parent.append(el(doc, 'span', { text: String(content) }));
}

/** Breadcrumb, h1, lead, source label and actions, as on the organization screens. */
export function workspacePageHeader(doc, { crumbs = [], title, lead, source, actions = [] } = {}) {
  const wrap = el(doc, 'div', { className: 'bb-ws-page' });
  if (crumbs.length > 0) {
    const breadcrumb = el(doc, 'nav', { className: 'bb-ws-breadcrumb', attrs: { 'aria-label': 'パンくず' } });
    crumbs.forEach((crumb, index) => {
      if (index > 0) breadcrumb.append(el(doc, 'span', { className: 'bb-ws-breadcrumb-separator', text: '/', attrs: { 'aria-hidden': 'true' } }));
      breadcrumb.append(el(doc, 'span', { text: crumb }));
    });
    wrap.append(breadcrumb);
  }
  const head = el(doc, 'header', { className: 'bb-ws-page-head' });
  const copy = el(doc, 'div', { className: 'bb-ws-page-copy' });
  copy.append(el(doc, 'h1', { text: title }));
  if (lead) copy.append(el(doc, 'p', { className: 'bb-ws-lead', text: lead }));
  head.append(copy);
  const side = el(doc, 'div', { className: 'bb-ws-page-side' });
  if (source) side.append(el(doc, 'span', { className: 'bb-ws-source', text: source }));
  if (actions.length > 0) side.append(workspaceActions(doc, actions));
  if (source || actions.length > 0) head.append(side);
  wrap.append(head);
  return wrap;
}

/** A notice with a short label, like 接続範囲 on the organization screens. */
export function workspaceNotice(doc, { label, text, tone = 'info', role } = {}) {
  const notice = el(doc, 'div', { className: `bb-ws-notice is-${tone}`, attrs: { role: role ?? (tone === 'info' ? undefined : 'alert') } });
  if (label) notice.append(el(doc, 'strong', { text: label }));
  appendContent(notice, doc, text);
  return notice;
}

/**
 * The notice a host passes to a part in place of (or in addition to) the
 * part's own: `{ label, text }`, where `text` is a string or an element.  Null
 * when the host passed none.
 */
export function workspaceHostNotice(doc, notice) {
  if (!notice || typeof notice !== 'object' || Array.isArray(notice)) return null;
  const label = typeof notice.label === 'string' && notice.label.trim() ? notice.label.trim() : undefined;
  return workspaceNotice(doc, { label, text: notice.text });
}

/** A host's extra page-head buttons, `[{ text, variant, onClick, disabled }]`, as `workspaceActions` items. */
export function workspaceHostActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((action) => action && typeof action === 'object' && typeof action.text === 'string' && action.text.trim())
    .map(({ text, variant, onClick, disabled }) => ({ text, variant, onClick, disabled: disabled === true }));
}

export function workspaceButton(doc, { text, variant = 'default', onClick, disabled = false, attrs = {} } = {}) {
  const button = el(doc, 'button', {
    className: `bb-ws-button${variant === 'primary' ? ' is-primary' : variant === 'danger' ? ' is-danger' : variant === 'quiet' ? ' is-quiet' : ''}`,
    text,
    attrs: { type: 'button', disabled, ...attrs },
  });
  if (typeof onClick === 'function') button.addEventListener('click', onClick);
  return button;
}

export function workspaceActions(doc, buttons = []) {
  const actions = el(doc, 'div', { className: 'bb-ws-actions' });
  for (const button of buttons) {
    if (button) actions.append(typeof button.tagName === 'string' ? button : workspaceButton(doc, button));
  }
  return actions;
}

/** Summary metrics in one ruled row. `value` null means 未確認, never zero. */
export function workspaceMetrics(doc, items = [], { ariaLabel = '集計' } = {}) {
  const summary = el(doc, 'section', { className: `bb-ws-summary is-${Math.min(Math.max(items.length, 1), 6)}`, attrs: { 'aria-label': ariaLabel } });
  for (const item of items) {
    const card = el(doc, 'div', { className: 'bb-ws-metric' });
    card.append(
      el(doc, 'small', { text: item.label }),
      el(doc, 'strong', { text: item.value === null || item.value === undefined ? '未確認' : item.value }),
    );
    if (item.note) card.append(el(doc, 'span', { text: item.note }));
    summary.append(card);
  }
  return summary;
}

// A readable name for a row: its first cell's text (a button with role=row has no name of its own).
function ledgerRowLabel(cells = []) {
  const first = cells[0];
  if (first === null || first === undefined) return undefined;
  if (typeof first === 'object' && 'primary' in first) return String(first.primary);
  if (typeof first === 'object' && 'text' in first) return String(first.text);
  if (typeof first === 'object' && typeof first.tagName === 'string') return first.textContent || undefined;
  return String(first);
}

/**
 * A ledger: a header row and selectable rows. `className` sets the column
 * template in the caller's CSS. A cell is text, an element, `{ text, className }`,
 * or `{ primary, secondary, leading }` for a name with its id underneath and
 * an optional leading element (for example a project icon).
 */
export function workspaceLedger(doc, { columns = [], rows = [], className = '', ariaLabel, empty } = {}) {
  const ledger = el(doc, 'div', { className: `bb-ws-ledger${className ? ` ${className}` : ''}`, attrs: { role: 'table', 'aria-label': ariaLabel } });
  const head = el(doc, 'div', { className: 'bb-ws-ledger-row bb-ws-ledger-head', attrs: { role: 'row' } });
  for (const column of columns) head.append(el(doc, 'span', { text: column, attrs: { role: 'columnheader' } }));
  ledger.append(head);
  if (rows.length === 0 && empty) {
    ledger.append(el(doc, 'p', { className: 'bb-ws-ledger-empty', text: empty }));
    return ledger;
  }
  for (const row of rows) {
    const selectable = typeof row.onSelect === 'function';
    const item = el(doc, selectable ? 'button' : 'div', {
      className: `bb-ws-ledger-row${selectable ? ' is-selectable' : ''}${row.selected ? ' is-selected' : ''}${row.className ? ` ${row.className}` : ''}`,
      attrs: {
        type: selectable ? 'button' : undefined,
        role: 'row',
        'aria-pressed': selectable ? (row.selected ? 'true' : 'false') : undefined,
        'aria-label': row.label ?? ledgerRowLabel(row.cells),
        'data-key': row.key,
      },
    });
    for (const cell of row.cells ?? []) {
      if (cell && typeof cell === 'object' && 'primary' in cell) {
        const object = el(doc, 'span', { className: 'bb-ws-ledger-object', attrs: { role: 'cell' } });
        if (cell.leading && typeof cell.leading.tagName === 'string') object.append(cell.leading);
        object.append(el(doc, 'strong', { text: cell.primary }));
        if (cell.secondary) object.append(el(doc, 'code', { text: cell.secondary }));
        item.append(object);
        continue;
      }
      const span = el(doc, 'span', { attrs: { role: 'cell' } });
      if (cell && typeof cell === 'object' && typeof cell.tagName === 'string') span.append(cell);
      else if (cell && typeof cell === 'object' && 'text' in cell) {
        span.className = cell.className ?? '';
        span.textContent = String(cell.text);
      } else span.textContent = cell === null || cell === undefined ? '' : String(cell);
      item.append(span);
    }
    if (selectable) item.addEventListener('click', () => row.onSelect(row.key));
    ledger.append(item);
  }
  return ledger;
}

/** The selected item's head in the right rail. */
export function workspaceRailHead(doc, { kicker, title, sub, lead, leading } = {}) {
  const head = el(doc, 'div', { className: 'bb-ws-rail-head' });
  if (kicker) head.append(el(doc, 'small', { text: kicker }));
  if (leading && typeof leading.tagName === 'string') head.append(leading);
  head.append(el(doc, 'h2', { text: title }));
  if (sub) head.append(el(doc, 'span', { text: sub }));
  if (lead) head.append(el(doc, 'p', { text: lead }));
  return head;
}

export function workspaceRailBlock(doc, { title, content, className } = {}) {
  const block = el(doc, 'section', { className: `bb-ws-rail-block${className ? ` ${className}` : ''}`, attrs: { 'aria-label': title } });
  if (title) block.append(el(doc, 'h3', { text: title }));
  appendContent(block, doc, content);
  return block;
}

/** Term and value pairs; a null value is shown as 未記録. */
export function workspaceDefinition(doc, pairs = []) {
  const list = el(doc, 'dl', { className: 'bb-ws-definition' });
  for (const [term, value] of pairs) {
    list.append(el(doc, 'dt', { text: term }));
    const dd = el(doc, 'dd');
    appendContent(dd, doc, value === null || value === undefined || value === '' ? { text: '未記録', className: 'is-unrecorded' } : value);
    list.append(dd);
  }
  return list;
}

export function workspaceDetailEmpty(doc, { mark = '?', title, text } = {}) {
  const empty = el(doc, 'div', { className: 'bb-ws-detail-empty' });
  empty.append(el(doc, 'div', { className: 'bb-ws-empty-mark', text: mark, attrs: { 'aria-hidden': 'true' } }), el(doc, 'h2', { text: title }));
  if (text) empty.append(el(doc, 'p', { text }));
  return empty;
}

/** A plain section title inside the workspace, below the ledger. */
export function workspaceSectionTitle(doc, { title, lead } = {}) {
  const wrap = el(doc, 'div', { className: 'bb-ws-section-title' });
  wrap.append(el(doc, 'h2', { text: title }));
  if (lead) wrap.append(el(doc, 'p', { text: lead }));
  return wrap;
}
