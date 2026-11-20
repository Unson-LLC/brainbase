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

function toggleWorkspaceClass(node, name, active) {
  if (!node) return;
  const names = new Set(String(node.className || '').split(/\s+/u).filter(Boolean));
  if (active) names.add(name); else names.delete(name);
  node.className = [...names].join(' ');
}

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
export function workspacePageHeader(doc, { crumbs = [], title, lead, help, preserveLead = false, source, actions = [] } = {}) {
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
  const description = typeof lead === 'string' ? lead.trim() : '';
  const sentences = description.match(/[^。！？!?]+[。！？!?]?/gu) ?? [];
  const longLead = !preserveLead && (description.length > 60 || sentences.length > 1);
  const summary = longLead ? (sentences[0]?.length <= 60 ? sentences[0] : '') : description;
  if (summary) copy.append(el(doc, 'p', { className: 'bb-ws-lead', text: summary }));
  head.append(copy);
  const side = el(doc, 'div', { className: 'bb-ws-page-side' });
  if (help || longLead) {
    const guide = workspaceHelp(doc, { label: title, text: [longLead ? description : '', help].filter(Boolean).join('\n\n') });
    guide.className += ' is-page-guide';
    guide.children[0].textContent = '？';
    side.append(guide);
  }
  if (source) side.append(el(doc, 'span', { className: 'bb-ws-source', text: source }));
  if (actions.length > 0) side.append(workspaceActions(doc, actions));
  if (help || longLead || source || actions.length > 0) head.append(side);
  wrap.append(head);
  return wrap;
}

/** Shared search presentation. The caller keeps the input, value and handlers. */
export function workspaceSearchControl(doc, { input, appearance } = {}) {
  if (!input || typeof input.tagName !== 'string') throw new TypeError('search_input_required');
  const search = el(doc, 'label', { className: 'bb-ws-search-control' });
  if (appearance === 'compact') toggleWorkspaceClass(search, 'bb-ws-search-control--compact', true);
  search.append(workspaceActionIcon(doc, 'search'), input);
  return search;
}

/** A shared title bar, with an optional search input owned by the caller. */
export function workspaceTopbar(doc, { title = '', query, tabs, tools, wrap = false, alignment } = {}) {
  const header = el(doc, 'header', { className: `bb-ws-topbar${wrap ? ' bb-ws-topbar--wrap' : ''}` });
  header.append(el(doc, 'h1', { text: title }));
  let search;
  let currentQuery;
  let tabsSlot;
  let toolsSlot;
  header.setTabs = content => {
    if (Array.isArray(content) && !content.some(Boolean)) content = null;
    tabsSlot?.remove(); tabsSlot = null;
    if (content) {
      tabsSlot = el(doc, 'div', { className: 'bb-ws-topbar-tabs' });
      appendContent(tabsSlot, doc, content); header.append(tabsSlot);
      if (search) header.append(search);
      if (toolsSlot) header.append(toolsSlot);
    }
    toggleWorkspaceClass(header, 'has-tabs', Boolean(content));
  };
  header.setTools = content => {
    if (Array.isArray(content) && !content.some(Boolean)) content = null;
    toolsSlot?.remove(); toolsSlot = null;
    if (content) { toolsSlot = el(doc, 'div', { className: 'bb-ws-topbar-tools' }); appendContent(toolsSlot, doc, content); header.append(toolsSlot); }
    toggleWorkspaceClass(header, 'has-tools', Boolean(content));
  };
  header.setQuery = input => {
    if (input === currentQuery) return;
    search?.remove(); search = null; currentQuery = input;
    if (input) { search = workspaceSearchControl(doc, { input }); header.append(search); if (toolsSlot) header.append(toolsSlot); }
    toggleWorkspaceClass(header, 'has-query', Boolean(input));
  };
  header.setAlignment = value => {
    toggleWorkspaceClass(header, 'bb-ws-topbar--content-aligned', value === 'content');
    return header;
  };
  header.setAlignment(alignment);
  header.setTabs(tabs); header.setQuery(query); header.setTools(tools);
  return header;
}

/**
 * Backdrop click closes a modal. Browsers with `closedby` do it natively and fire `cancel`,
 * which the caller already handles; the pointer check is the fallback where it is missing (Safari).
 */
function workspaceLightDismiss(doc, dialog, close) {
  dialog.setAttribute('closedby', 'any');
  const NativeDialog = doc.defaultView?.HTMLDialogElement;
  if (NativeDialog && 'closedBy' in NativeDialog.prototype) return;
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
}

/** A reusable right inspector whose content can refresh without replacing the modal. */
export function workspaceDetailDrawer(doc, { title = '詳細', opener, onClose, beforeClose } = {}) {
  const dialog = workspaceApplyDrawer(el(doc, 'dialog', { className: 'bb-ws-dialog bb-ws-detail-drawer' }));
  const titleId = `bb-ws-inspector-${nextWorkspaceSequence()}`;
  dialog.setAttribute('aria-labelledby', titleId);
  const head = el(doc, 'header', { className: 'bb-ws-detail-closebar' });
  const label = el(doc, 'h2', { className: 'bb-ws-visually-hidden', text: title, attrs: { id: titleId } });
  const body = el(doc, 'div', { className: 'bb-ws-detail-content' });
  let disposed = false;
  let cancelClosing;
  let fallbackOpener;
  const finish = (restoreFocus) => {
    cancelClosing?.(); cancelClosing = null;
    if (dialog.open) dialog.close();
    const target = (typeof opener === 'function' ? opener() : opener) ?? fallbackOpener;
    if (restoreFocus && target?.isConnected) target.focus({ preventScroll: true });
  };
  const close = ({ restoreFocus = true, immediate = false } = {}) => {
    if (!dialog.open) return;
    if (!immediate && beforeClose?.() === false) return;
    // Clear the caller's open state before an asynchronous content update arrives.
    if (cancelClosing && !immediate) return;
    if (!cancelClosing) onClose?.();
    if (immediate) finish(restoreFocus);
    else cancelClosing = workspaceCloseDrawer(dialog, () => finish(restoreFocus));
  };
  const button = workspaceButton(doc, { text: '閉じる', onClick: () => close() });
  head.append(label, button); dialog.append(head, body); doc.body.append(dialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  workspaceLightDismiss(doc, dialog, () => close());
  return {
    dialog,
    setContent(...content) { if (!disposed) body.replaceChildren(...content); },
    setTitle(title) { if (!disposed) label.textContent = String(title); },
    open(target) {
      if (disposed) return;
      cancelClosing?.(); cancelClosing = null;
      if (dialog.open) return;
      fallbackOpener = target ?? doc.activeElement;
      dialog.showModal(); button.focus();
    },
    close,
    dispose() { if (disposed) return; close({ restoreFocus: false, immediate: true }); disposed = true; dialog.remove(); },
  };
}

/** A notice with a short label, like 接続範囲 on the organization screens. */
export function workspaceNotice(doc, { label, text, tone = 'info', role } = {}) {
  const notice = el(doc, 'div', { className: `bb-ws-notice is-${tone}`, attrs: { role: role ?? (tone === 'info' ? undefined : 'alert') } });
  if (label) notice.append(el(doc, 'strong', { text: label }));
  appendContent(notice, doc, text);
  return notice;
}

/** One-line status/alert surface with optional icon, action and dismissal. */
export function workspaceInlineNotice(doc, { text, tone = 'success', icon, action, onDismiss, role } = {}) {
  const appearance = tone === 'danger' ? 'danger' : 'success';
  const notice = el(doc, 'div', { className: `bb-ws-inline-notice is-${appearance}`, attrs: {
    role: role || (appearance === 'danger' ? 'alert' : 'status'),
    'aria-live': appearance === 'danger' ? 'assertive' : 'polite',
    'aria-atomic': 'true',
  } });
  if (icon) {
    const mark = el(doc, 'span', { className: 'bb-ws-inline-notice-icon', attrs: { 'aria-hidden': 'true' } });
    appendContent(mark, doc, icon); notice.append(mark);
  }
  const message = el(doc, 'span', { className: 'bb-ws-inline-notice-text' });
  appendContent(message, doc, text); notice.append(message);
  if (action || onDismiss) {
    const actions = el(doc, 'span', { className: 'bb-ws-inline-notice-actions' });
    if (action) actions.append(typeof action.tagName === 'string' ? action : workspaceButton(doc, action));
    if (onDismiss) {
      const dismiss = workspaceButton(doc, { variant: 'quiet', attrs: { 'aria-label': 'お知らせを閉じる' }, onClick: onDismiss });
      dismiss.classList?.add('bb-ws-inline-notice-dismiss'); actions.append(dismiss);
      dismiss.append(workspaceActionIcon(doc, 'close'));
    }
    notice.append(actions);
  }
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

export function workspaceButton(doc, { text, variant = 'default', size, onClick, disabled = false, attrs = {} } = {}) {
  const classes = ['bb-ws-button'];
  if (variant === 'primary') classes.push('is-primary');
  else if (variant === 'danger') classes.push('is-danger');
  else if (variant === 'accent') classes.push('is-accent');
  else if (variant === 'quiet') classes.push('is-quiet');
  else if (variant === 'icon') classes.push('is-icon');
  if (size === 'compact') classes.push('bb-ws-button--compact');
  const button = el(doc, 'button', {
    className: classes.join(' '),
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

/** A business-neutral status label. The host supplies its text and meaning. */
export function workspaceStatusPill(doc, { label, tone = 'neutral', width, appearance, attrs = {} } = {}) {
  const tones = new Set(['neutral', 'success', 'warning', 'danger']);
  const pill = el(doc, 'span', { className: `bb-ws-status-pill is-${tones.has(tone) ? tone : 'neutral'}${appearance === 'compact' ? ' bb-ws-status-pill--compact' : ''}`, text: label, attrs });
  if (Number.isFinite(width) && width > 0) pill.style?.setProperty('--bb-status-pill-width', `${width}px`);
  return pill;
}

/** A segmented visual proportion. Hosts supply confirmed quantities and meaning. */
export function workspaceProgressBar(doc, { segments = [], label } = {}) {
  const tones = new Set(['done', 'remaining', 'review']);
  if (!Array.isArray(segments) || !segments.length || segments.some(segment =>
    !segment || !Number.isFinite(segment.value) || segment.value < 0 || !tones.has(segment.tone))) {
    throw new TypeError('workspace_progress_segments_required');
  }
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (!Number.isFinite(total) || total <= 0) throw new RangeError('workspace_progress_total_must_be_positive');
  const svgElement = (name, attrs) => {
    const node = typeof doc.createElementNS === 'function'
      ? doc.createElementNS('http://www.w3.org/2000/svg', name) : doc.createElement(name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };
  const root = svgElement('svg', { class: 'bb-ws-progress-bar', viewBox: '0 0 100 6', preserveAspectRatio: 'none',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }) });
  let offset = 0;
  // Review is always the final portion; the caller's array is never mutated.
  const ordered = [...segments.filter(segment => segment.tone !== 'review'), ...segments.filter(segment => segment.tone === 'review')];
  for (const segment of ordered) {
    if (segment.value === 0) continue;
    const width = segment.value / total * 100;
    root.append(svgElement('rect', { class: `bb-ws-progress-segment is-${segment.tone}`, x: offset, y: 0, width, height: 6 }));
    offset += width;
  }
  return root;
}

/** An empty list invitation. Copy and action remain owned by the host. */
export function workspaceEmptyState(doc, { text, icon = 'folder', action } = {}) {
  const root = el(doc, 'div', { className: 'bb-ws-empty-state' });
  const mark = el(doc, 'span', { className: 'bb-ws-empty-state-mark', attrs: { 'aria-hidden': 'true' } });
  mark.append(workspaceActionIcon(doc, icon));
  root.append(mark, el(doc, 'p', { text }));
  if (action) {
    const actions = el(doc, 'div', { className: 'bb-ws-empty-state-action' });
    appendContent(actions, doc, action);
    root.append(actions);
  }
  return root;
}

/** Native checkbox with the shared compact mark and caller-owned selection. */
export function workspaceCheckbox(doc, { label, checked = false, indeterminate = false, disabled = false, onChange, attrs = {} } = {}) {
  const checkbox = el(doc, 'input', { className: 'bb-ws-checkbox', attrs: {
    ...attrs, type: 'checkbox', 'aria-label': attrs['aria-label'] ?? label, checked: Boolean(checked), disabled: Boolean(disabled),
  } });
  checkbox.checked = Boolean(checked);
  checkbox.indeterminate = Boolean(indeterminate);
  checkbox.addEventListener('change', () => onChange?.(checkbox.checked, checkbox.indeterminate, checkbox));
  return checkbox;
}

/** Shared selection bar; the host owns its placement and action callbacks. */
export function workspaceSelectionBar(doc, { count = 0, actions = [], onDismiss, label = '選択中の項目', announce = false } = {}) {
  const root = el(doc, 'div', { className: `bb-ws-selection-bar${onDismiss ? ' has-dismiss' : ''}`, attrs: { role: 'region', 'aria-label': label } });
  if (onDismiss) {
    const dismiss = workspaceButton(doc, { variant: 'quiet', attrs: { 'aria-label': '選択を解除' }, onClick: onDismiss });
    dismiss.classList?.add('bb-ws-selection-bar-dismiss');
    dismiss.append(workspaceActionIcon(doc, 'close'));
    root.append(dismiss);
  }
  const countLabel = typeof count === 'number' && Number.isFinite(count) ? `${count}件を選択中` : String(count ?? '');
  root.append(el(doc, 'span', { className: 'bb-ws-selection-bar-count', text: countLabel, attrs: { 'aria-live': announce ? 'polite' : undefined } }));
  const actionSlot = el(doc, 'div', { className: 'bb-ws-selection-bar-actions' });
  for (const action of actions) {
    if (action) actionSlot.append(typeof action.tagName === 'string' ? action : workspaceButton(doc, action));
  }
  root.append(actionSlot);
  return root;
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


let workspaceSequence = 0;
// Capability-isolated modules coexist with an older kit in the same document.
const workspaceIdScope = new URL(import.meta.url).searchParams.get('capability') ?? '';
function nextWorkspaceSequence() {
  const next = ++workspaceSequence;
  return workspaceIdScope ? `${encodeURIComponent(workspaceIdScope)}-${next}` : next;
}
const workspaceHelpDismissers = new WeakMap();

/** Shared explanatory help: hover/focus above the control, click for touch. */
export function workspaceHelp(doc, { text, label, content, icon = 'i', placement } = {}) {
  const wrap = el(doc, content === undefined ? 'span' : 'div', { className: 'bb-ws-help' });
  const control = workspaceButton(doc, { text: icon, attrs: { 'aria-label': `${label}の説明`, 'aria-expanded': 'false' } });
  control.className = 'bb-ws-help-button';
  const bubble = el(doc, content === undefined ? 'span' : 'div', { className: 'bb-ws-help-bubble', text, attrs: { id: `bb-ws-help-${nextWorkspaceSequence()}`, role: 'tooltip' } });
  if (content !== undefined) { bubble.textContent = ''; appendContent(bubble, doc, content); }
  if (placement === 'bottom-end') toggleWorkspaceClass(wrap, 'bb-ws-help--bottom-end', true);
  control.setAttribute('aria-describedby', bubble.id || bubble.getAttribute?.('id') || bubble.attributes?.id);
  control.addEventListener('click', event => {
    event.stopPropagation(); event.preventDefault();
    const opened = wrap.classList.toggle('is-open');
    wrap.classList.remove('is-dismissed');
    control.setAttribute('aria-expanded', String(opened));
  });
  let hovered = false;
  wrap.addEventListener('mouseenter', () => { hovered = true; });
  wrap.addEventListener('mouseleave', () => {
    hovered = false;
    if (!wrap.contains?.(doc.activeElement)) wrap.classList.remove('is-dismissed');
  });
  wrap.addEventListener('focusout', event => {
    if (wrap.contains?.(event.relatedTarget)) return;
    wrap.classList.remove('is-open'); control.setAttribute('aria-expanded', 'false');
    if (!hovered) wrap.classList.remove('is-dismissed');
  });
  const dismissExplanation = event => {
    if (event.key !== 'Escape' || event.defaultPrevented || wrap.classList.contains('is-dismissed')) return false;
    if (!wrap.classList.contains('is-open') && !hovered && !wrap.contains?.(doc.activeElement)) return false;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
    wrap.classList.remove('is-open'); wrap.classList.add('is-dismissed');
    control.setAttribute('aria-expanded', 'false'); return true;
  };
  workspaceHelpDismissers.set(wrap, dismissExplanation);
  control.addEventListener('keydown', dismissExplanation);
  wrap.append(control, bubble); return wrap;
}

const drawerClosings = new WeakMap();
const notificationClosings = new WeakMap();
const reducedMotion = node => node.ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
const animationFallback = (node, margin, fallback) => {
  const durations = node.ownerDocument?.defaultView?.getComputedStyle?.(node).animationDuration;
  const duration = Math.max(...(durations ?? '').split(',').map(value => {
    const match = value.trim().match(/^(\d*\.?\d+)(ms|s)$/);
    return match ? Number(match[1]) * (match[2] === 's' ? 1000 : 1) : NaN;
  }));
  return Number.isFinite(duration) && duration > 0 ? duration + margin : fallback;
};

/** Apply the same native-dialog presentation to host-owned and kit drawers. */
export function workspaceApplyDrawer(dialog) {
  dialog.classList.add('bb-ws-drawer');
  return dialog;
}

/** Keep the modal/focus trap alive until the exit motion finishes. Returns cancellation cleanup. */
export function workspaceCloseDrawer(dialog, finish) {
  if (drawerClosings.has(dialog)) return drawerClosings.get(dialog);
  if (!dialog.open || reducedMotion(dialog)) { finish(); return () => {}; }
  let timer;
  let active = true;
  const cancel = () => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    dialog.removeEventListener('animationend', ended);
    dialog.removeEventListener('close', cancel);
    dialog.classList.remove('is-closing');
    drawerClosings.delete(dialog);
  };
  const complete = () => { if (!active) return; cancel(); finish(); };
  const ended = event => {
    if (event.target === dialog && ['bb-ws-drawer-out', 'bb-ws-input-frame-out'].includes(event.animationName)) complete();
  };
  drawerClosings.set(dialog, cancel);
  dialog.addEventListener('animationend', ended);
  dialog.addEventListener('close', cancel);
  dialog.classList.add('is-closing');
  timer = setTimeout(complete, animationFallback(dialog, 70, 220)); // Animation cancellation / background-tab fallback.
  return cancel;
}

/** Native modal, optionally a right drawer. close() animates; dispose() tears down immediately. */
export function workspaceDialog(doc, { title, content, opener, presentation = 'center', onClose, appearance, headerTools, compactWidth } = {}) {
  const dialog = el(doc, 'dialog', { className: 'bb-ws-dialog' });
  workspaceDialogAppearance(dialog, { appearance, compactWidth });
  if (presentation === 'drawer') workspaceApplyDrawer(dialog);
  const headingId = `bb-ws-dialog-${nextWorkspaceSequence()}`;
  dialog.setAttribute('aria-labelledby', headingId);
  const head = el(doc, 'header', { className: 'bb-ws-dialog-head' });
  const nativeClose = dialog.close.bind(dialog);
  let disposed = false;
  const dismissVisibleHelp = event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    for (const help of dialog.querySelectorAll?.('.bb-ws-help') ?? []) {
      if (workspaceHelpDismissers.get(help)?.(event)) return;
    }
  };
  dialog.addEventListener('keydown', dismissVisibleHelp, true);
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    dialog.removeEventListener('keydown', dismissVisibleHelp, true);
    drawerClosings.get(dialog)?.();
    dialog.remove();
    try { onClose?.(); } finally {
      const target = typeof opener === 'function' ? opener() : opener;
      if (target?.isConnected) target.focus();
    }
  };
  dialog.close = value => {
    if (disposed) return;
    const finish = () => { nativeClose(value); cleanup(); };
    if (presentation === 'drawer') workspaceCloseDrawer(dialog, finish);
    else finish();
  };
  dialog.dispose = () => {
    if (disposed) return;
    drawerClosings.get(dialog)?.();
    nativeClose(); cleanup();
  };
  const close = workspaceButton(doc, { text: '×', attrs: { 'aria-label': '閉じる' }, onClick: () => dialog.close() });
  head.append(el(doc, 'h2', { text: title, attrs: { id: headingId } }));
  if (headerTools) {
    const tools = el(doc, 'div', { className: 'bb-ws-dialog-tools' }); appendContent(tools, doc, headerTools); head.append(tools);
  }
  head.append(close);
  const body = el(doc, 'div', { className: 'bb-ws-dialog-body' }); appendContent(body, doc, content);
  dialog.append(head, body); doc.body.append(dialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  workspaceLightDismiss(doc, dialog, () => dialog.close());
  dialog.addEventListener('close', cleanup, { once: true });
  try { dialog.showModal(); close.focus(); } catch (error) { cleanup(); throw error; }
  return dialog;
}

/** Apply shared dialog appearance to a host-owned native dialog without owning its lifecycle. */
export function workspaceDialogAppearance(dialog, { appearance, compactWidth } = {}) {
  if (!dialog || typeof dialog.setAttribute !== 'function') throw new TypeError('dialog_element_required');
  const isConfirmation = appearance === 'confirmation';
  const isCompact = appearance === 'compact' || isConfirmation;
  toggleWorkspaceClass(dialog, 'bb-ws-dialog', true);
  toggleWorkspaceClass(dialog, 'bb-ws-dialog--compact', isCompact);
  toggleWorkspaceClass(dialog, 'bb-ws-dialog--confirmation', isConfirmation);
  if (isCompact && Number.isFinite(compactWidth) && compactWidth > 0) dialog.style?.setProperty('--bb-dialog-compact-width', `${compactWidth}px`);
  else dialog.style?.removeProperty?.('--bb-dialog-compact-width');
  return dialog;
}

/** Applied condition with an explicit, individually removable value. */
export function workspaceFilterChip(doc, { label, onRemove, attrs = {} } = {}) {
  const chip = workspaceButton(doc, { text: `${label} ×`, attrs: { 'aria-label': `${label}を解除`, ...attrs }, onClick: onRemove });
  chip.className += ' bb-ws-filter-chip';
  return chip;
}

const anchoredPopoverBindings = new WeakMap();

function workspacePositionAnchoredElement(element, positionAnchor, {
  align = 'start', placement = 'bottom', gap = 4, inset = 8, view, doc, flip = false, clampHeight = false, clampOverflow = 'auto', preciseWidth = false, bounds,
} = {}) {
  const at = positionAnchor.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  const viewportWidth = view?.innerWidth || doc?.documentElement?.clientWidth || 1024;
  const viewportHeight = view?.innerHeight || doc?.documentElement?.clientHeight || 768;
  const boundary = bounds?.getBoundingClientRect?.() ?? bounds;
  const leftInset = Math.max(inset, boundary?.left + inset || inset);
  const topInset = Math.max(inset, boundary?.top + inset || inset);
  const rightEdge = Math.min(viewportWidth - inset, boundary?.right - inset || viewportWidth - inset);
  const bottomEdge = Math.min(viewportHeight - inset, boundary?.bottom - inset || viewportHeight - inset);
  const computedWidth = preciseWidth ? Number.parseFloat(view?.getComputedStyle?.(element)?.width) : NaN;
  const panelWidth = (Number.isFinite(computedWidth) && computedWidth > 0 ? computedWidth : 0) || element.offsetWidth || box.width || box.right - box.left;
  let panelHeight = element.offsetHeight || box.height || box.bottom - box.top;
  const anchorLeft = at.left ?? at.x ?? 0;
  const anchorRight = at.right ?? anchorLeft + (at.width ?? 0);
  const anchorTop = at.top ?? at.y ?? 0;
  const anchorBottom = at.bottom ?? anchorTop + (at.height ?? 0);
  const anchorWidth = at.width ?? anchorRight - anchorLeft;
  const x = align === 'end' ? anchorRight - panelWidth : align === 'center' ? anchorLeft + (anchorWidth - panelWidth) / 2 : anchorLeft;
  let y;
  let side = placement;
  if (flip) {
    const availableBelow = Math.max(0, bottomEdge - anchorBottom - gap);
    const availableAbove = Math.max(0, anchorTop - topInset - gap);
    side = placement === 'top' ? 'top' : 'bottom';
    if (side !== 'top' && panelHeight > availableBelow && availableAbove > availableBelow) side = 'top';
    const available = side === 'top' ? availableAbove : availableBelow;
    if (clampHeight && panelHeight > available) {
      element.style?.setProperty('max-height', `${available}px`);
      element.style?.setProperty('overflow-y', clampOverflow);
      panelHeight = element.offsetHeight || Math.min(panelHeight, available);
    } else if (clampHeight) {
      element.style?.removeProperty?.('max-height');
      element.style?.removeProperty?.('overflow-y');
    }
    y = side === 'top' ? anchorTop - gap - panelHeight : anchorBottom + gap;
  } else y = placement === 'overlap' ? anchorTop - 10 : anchorBottom + gap;
  return {
    left: Math.max(leftInset, Math.min(x, rightEdge - panelWidth)),
    top: Math.max(topInset, Math.min(y, bottomEdge - panelHeight)),
    width: panelWidth, height: panelHeight, side, viewportWidth, viewportHeight,
  };
}

/** Non-modal anchored surface. Content and visibility have independent lifecycles. */
export function workspaceAnchoredPopover(doc, {
  anchor, positionAnchor = anchor, content, label, surface = 'default', width = 276, placement = 'bottom', align = 'start', padding, onClose,
} = {}) {
  if (!anchor || typeof anchor.getBoundingClientRect !== 'function') throw new TypeError('popover_anchor_required');
  if (!positionAnchor || typeof positionAnchor.getBoundingClientRect !== 'function') throw new TypeError('popover_position_anchor_required');
  const element = el(doc, 'div', { className: `bb-ws-anchored-popover${surface === 'muted' ? ' bb-ws-anchored-popover--muted' : ''}`, attrs: {
    role: 'dialog', 'aria-label': label || '詳細', tabindex: '-1', id: `bb-ws-popover-${nextWorkspaceSequence()}`,
  } });
  if (padding === 'none') toggleWorkspaceClass(element, 'bb-ws-anchored-popover--flush', true);
  const binding = anchoredPopoverBindings.get(anchor) || { original: new Map(['aria-controls', 'aria-expanded', 'aria-haspopup'].map(name => [name, anchor.getAttribute?.(name)])) };
  const displaced = binding.owner;
  const owner = {};
  binding.owner = owner; anchoredPopoverBindings.set(anchor, binding);
  displaced?.revoke?.();
  const ownsAnchor = () => anchoredPopoverBindings.get(anchor)?.owner === owner;
  const panelId = element.getAttribute('id');
  anchor.setAttribute('aria-controls', panelId); anchor.setAttribute('aria-haspopup', 'dialog'); anchor.setAttribute('aria-expanded', 'false');
  if (Number.isFinite(width) && width > 0) element.style?.setProperty('--bb-anchored-width', `${width}px`);
  let opened = false;
  let destroyed = false;
  let modalHost;
  const view = doc.defaultView;
  const setContent = next => {
    if (destroyed) return;
    element.replaceChildren(); appendContent(element, doc, next);
    if (opened) reposition();
  };
  const reposition = () => {
    if (!opened || destroyed) return;
    if (anchor.isConnected === false || positionAnchor.isConnected === false) { close({ restoreFocus: false }); return; }
    const point = workspacePositionAnchoredElement(element, positionAnchor, { align, placement, gap: 4, inset: 8, view, doc });
    element.style?.setProperty('left', `${point.left}px`);
    element.style?.setProperty('top', `${point.top}px`);
  };
  const removeListeners = () => {
    doc.removeEventListener?.('pointerdown', outside); doc.removeEventListener?.('keydown', escape);
    doc.removeEventListener?.('scroll', reposition, true); view?.removeEventListener?.('resize', reposition);
    modalHost?.removeEventListener?.('close', modalClosed); modalHost = undefined;
  };
  const close = ({ restoreFocus = true } = {}) => {
    if (!opened) return;
    opened = false; removeListeners(); element.hidden = true; element.inert = true;
    element.setAttribute('aria-hidden', 'true');
    if (ownsAnchor()) anchor.setAttribute('aria-expanded', 'false');
    if (restoreFocus && anchor.isConnected) anchor.focus?.({ preventScroll: true });
    onClose?.();
  };
  const modalClosed = () => close({ restoreFocus: false });
  const outside = event => {
    if (!element.contains?.(event.target) && !anchor.contains?.(event.target)) close({ restoreFocus: false });
  };
  const escape = event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault(); event.stopPropagation(); close();
  };
  const open = ({ focus = true } = {}) => {
    if (destroyed || opened || !ownsAnchor() || anchor.isConnected === false || positionAnchor.isConnected === false || anchor.disabled || anchor.getAttribute?.('aria-disabled') === 'true') return;
    // A surface opened inside a native modal must remain inside that top layer.
    const modal = anchor.closest?.('dialog[open]');
    (modal || doc.body).append(element); modalHost = modal;
    modalHost?.addEventListener?.('close', modalClosed);
    opened = true; element.hidden = false; element.inert = false; element.removeAttribute('aria-hidden');
    anchor.setAttribute('aria-expanded', 'true'); reposition();
    if (!opened) return;
    doc.addEventListener?.('pointerdown', outside); doc.addEventListener?.('keydown', escape);
    doc.addEventListener?.('scroll', reposition, true); view?.addEventListener?.('resize', reposition);
    if (focus) (element.querySelector?.('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') || element).focus?.({ preventScroll: true });
  };
  owner.revoke = () => close({ restoreFocus: false });
  element.hidden = true; element.inert = true; element.setAttribute('aria-hidden', 'true');
  setContent(content);
  return { element, setContent, open, close, reposition, get isOpen() { return opened; }, destroy() {
    if (destroyed) return;
    destroyed = true; close({ restoreFocus: false }); removeListeners(); element.remove();
    // Do not overwrite a newer surface bound to the same trigger.
    if (ownsAnchor()) {
      anchoredPopoverBindings.delete(anchor);
      for (const [name, value] of binding.original) {
        if (value === null || value === undefined) anchor.removeAttribute?.(name); else anchor.setAttribute(name, value);
      }
    }
  } };
}

/** A checkable row with sibling status/actions, so retry buttons never nest in buttons. */
export function workspaceSelectionRow(doc, { label, checked = false, disabled = false, leading, trailing, color, onChange } = {}) {
  const root = el(doc, 'div', { className: 'bb-ws-selection-row' });
  const control = workspaceButton(doc, { attrs: { role: 'checkbox', 'aria-label': label } });
  control.className += ' bb-ws-selection-control';
  const check = el(doc, 'span', { className: 'bb-ws-selection-check', attrs: { 'aria-hidden': 'true' } });
  check.append(workspaceActionIcon(doc, 'check')); control.append(check);
  if (leading) appendContent(control, doc, leading);
  control.append(el(doc, 'span', { className: 'bb-ws-selection-label', text: label }));
  root.append(control);
  if (trailing) {
    const slot = el(doc, 'span', { className: 'bb-ws-selection-trailing' }); appendContent(slot, doc, trailing); root.append(slot);
  }
  if (color) root.style?.setProperty('--bb-selection-color', color);
  let selected = Boolean(checked), unavailable = Boolean(disabled), destroyed = false;
  const update = ({ checked: nextChecked, disabled: nextDisabled } = {}) => {
    if (destroyed) return;
    if (nextChecked !== undefined) selected = Boolean(nextChecked);
    if (nextDisabled !== undefined) unavailable = Boolean(nextDisabled);
    control.setAttribute('aria-checked', String(selected)); control.disabled = unavailable;
    toggleWorkspaceClass(root, 'is-disabled', unavailable);
  };
  const click = () => { if (!destroyed && !unavailable) { update({ checked: !selected }); onChange?.(selected); } };
  control.addEventListener('click', click); update();
  return { root, control, update, destroy() { destroyed = true; control.removeEventListener?.('click', click); } };
}

/** Native button keyboard activation with controlled switch state. */
export function workspaceSwitch(doc, { label, checked = false, disabled = false, onChange } = {}) {
  const control = workspaceButton(doc, { attrs: { role: 'switch', 'aria-label': label } });
  control.className += ' bb-ws-switch';
  control.append(el(doc, 'span', { className: 'bb-ws-switch-track', attrs: { 'aria-hidden': 'true' } }), el(doc, 'span', { text: label }));
  let selected = Boolean(checked), unavailable = Boolean(disabled), destroyed = false;
  const update = ({ checked: nextChecked, disabled: nextDisabled } = {}) => {
    if (destroyed) return;
    if (nextChecked !== undefined) selected = Boolean(nextChecked);
    if (nextDisabled !== undefined) unavailable = Boolean(nextDisabled);
    control.setAttribute('aria-checked', String(selected)); control.disabled = unavailable;
  };
  const click = () => { if (!destroyed && !unavailable) { update({ checked: !selected }); onChange?.(selected); } };
  control.addEventListener('click', click); update();
  return { root: control, control, update, destroy() { destroyed = true; control.removeEventListener?.('click', click); } };
}

/** One filter choice; callers retain selection and lifecycle ownership. */
export function workspaceFilterOption(doc, { label, count, checked = false, disabled = false, role = 'radio', attrs = {}, onClick } = {}) {
  const button = workspaceButton(doc, { attrs: { ...attrs, role, 'aria-checked': String(checked) }, disabled, onClick });
  button.className += ' bb-ws-filter-option';
  const check = el(doc, 'span', { className: 'bb-ws-filter-option-check', attrs: { 'aria-hidden': 'true' } });
  button.append(check, el(doc, 'span', { className: 'bb-ws-filter-option-label', text: `${label}${count === undefined || count === null ? '' : ' '}` }));
  if (count !== undefined && count !== null) button.append(el(doc, 'span', { className: 'bb-ws-filter-option-count', text: count }));
  return button;
}

/** Anchored advanced search. Hosts destroy it before replacing its controls. */
export function workspaceFilterPopover(doc, { content, open = false, onToggle, trigger, panel: suppliedPanel, initialFocus, appearance } = {}) {
  const root = el(doc, 'span', { className: 'bb-ws-filter-anchor' });
  const panel = suppliedPanel || el(doc, 'div', { className: 'bb-ws-filter-popover', attrs: { id: `bb-ws-filter-${nextWorkspaceSequence()}`, role: 'region', 'aria-label': '詳細検索' } });
  if (!panel.id && !panel.getAttribute?.('id')) panel.setAttribute('id', `bb-ws-filter-${nextWorkspaceSequence()}`);
  panel.classList?.add('bb-ws-filter-popover');
  if (appearance === 'panel') toggleWorkspaceClass(panel, 'bb-ws-filter-popover--panel', true);
  const control = trigger || workspaceButton(doc, { text: appearance === 'icon' ? undefined : '詳細検索', variant: 'quiet' });
  if (appearance === 'icon') {
    control.classList?.add('bb-ws-filter-icon-trigger');
    if (!control.getAttribute?.('aria-label')) control.setAttribute('aria-label', '絞り込む');
    if (!Array.from(control.children ?? []).some(child => String(child.tagName).toLowerCase() === 'svg')) {
      const caption = el(doc, 'span', { className: 'bb-ws-visually-hidden' });
      const nodes = Array.from(control.childNodes ?? control.children ?? []);
      if (nodes.length) caption.append(...nodes); else caption.textContent = control.textContent || '';
      control.replaceChildren(workspaceActionIcon(doc, 'filter'), caption);
    }
  }
  control.setAttribute('aria-controls', panel.id || panel.getAttribute?.('id') || panel.attributes?.id);
  appendContent(panel, doc, content); root.append(control, panel);
  let destroyed = false;
  let isOpen = null;
  let timer;
  const removeListeners = () => { doc.removeEventListener?.('pointerdown', outside); doc.removeEventListener?.('keydown', escape); };
  const cancelExit = () => {
    clearTimeout(timer); timer = undefined;
    panel.removeEventListener?.('animationend', ended);
    panel.classList?.remove('is-closing');
  };
  const finishExit = () => { cancelExit(); if (!isOpen) panel.hidden = true; };
  const ended = event => { if (event.target === panel && event.animationName === 'bb-ws-filter-exit') finishExit(); };
  const setOpen = (value, focus = false) => {
    if (destroyed) return;
    const next = Boolean(value);
    if (next === isOpen) return;
    const wasOpen = isOpen === true;
    isOpen = next; removeListeners(); cancelExit();
    control.setAttribute('aria-expanded', String(next));
    panel.inert = !next;
    if (next) {
      panel.removeAttribute?.('inert'); panel.removeAttribute?.('aria-hidden'); panel.hidden = false;
      doc.addEventListener?.('pointerdown', outside); doc.addEventListener?.('keydown', escape);
      if (focus) (typeof initialFocus === 'function' ? initialFocus() : initialFocus || panel.querySelector?.('input:not(:disabled),select:not(:disabled),button:not(:disabled)'))?.focus();
    } else {
      panel.setAttribute('inert', ''); panel.setAttribute('aria-hidden', 'true');
      if (wasOpen && panel.isConnected !== false && panel.classList && !reducedMotion(panel)) {
        panel.classList.add('is-closing'); panel.addEventListener('animationend', ended);
        timer = setTimeout(finishExit, animationFallback(panel, 50, appearance === 'panel' ? 210 : 230));
      } else panel.hidden = true;
    }
    onToggle?.(next);
  };
  const outside = event => { if (!root.contains?.(event.target)) setOpen(false); };
  const escape = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation(); setOpen(false); control.focus();
  };
  const pointerFocus = () => root.setAttribute('data-pointer-focus', 'true');
  const keyboardFocus = () => root.removeAttribute?.('data-pointer-focus');
  root.addEventListener('pointerdown', pointerFocus);
  root.addEventListener('keydown', keyboardFocus);
  const toggle = () => setOpen(!isOpen, true);
  control.addEventListener('click', toggle); setOpen(open);
  return { root, control, panel, setOpen, get isOpen() { return isOpen === true; }, destroy() {
    root.removeEventListener?.('pointerdown', pointerFocus); root.removeEventListener?.('keydown', keyboardFocus);
    destroyed = true; isOpen = false; removeListeners(); cancelExit(); control.removeEventListener?.('click', toggle);
    panel.hidden = true; panel.inert = true; panel.setAttribute('inert', ''); panel.setAttribute('aria-hidden', 'true'); control.setAttribute('aria-expanded', 'false');
  } };
}

/** Reusable notification surface. Hosts own content, placement and lifecycle.
 * Tones use shared semantic tokens; unknown values stay informational.
 */
export function workspaceNotificationCard(doc, { tone = 'info', content, tag = 'section', className = '', role } = {}) {
  const severity = tone === 'attention' ? 'warning' : ['info', 'warning', 'danger'].includes(tone) ? tone : 'info';
  const card = el(doc, tag, { className: `bb-ws-notification-card is-${severity} ${className}`.trim(), attrs: { role } });
  appendContent(card, doc, content);
  return card;
}

/** Compact notification with a fixed-center, purely visual spinner. */
export function workspaceLoadingCard(doc, { title = 'ロード中' } = {}) {
  const card = workspaceNotificationCard(doc, { className: 'bb-ws-error-card bb-ws-loading-card', role: 'status' });
  card.setAttribute('aria-live', 'polite');
  card.append(el(doc, 'span', { className: 'bb-ws-loading-spinner', attrs: { 'aria-hidden': 'true' } }), el(doc, 'span', { text: title }));
  return card;
}

/** Friendly, centered loading stage for a whole screen. */
export function workspaceLoadingStage(doc, { title = '準備しています', detail, slow = false } = {}) {
  const stage = el(doc, 'div', {
    className: `bb-ws-loading-stage${slow ? ' is-slow' : ''}`,
    // No aria-busy here: on a live region it would hold back the announcement (Codex r2).
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const mark = el(doc, 'span', { className: 'bb-ws-loading-stage-mark', attrs: { 'aria-hidden': 'true' } });
  // The dots sit inside the aria-hidden mark, so they need no aria-hidden of their own.
  for (let index = 0; index < 3; index += 1) {
    mark.append(el(doc, 'span', { className: 'bb-ws-loading-stage-dot' }));
  }
  stage.append(mark, el(doc, 'p', { className: 'bb-ws-loading-stage-title', text: title }));
  const detailText = typeof detail === 'string' && detail.trim() ? detail : (slow ? '時間がかかっています。このままお待ちください。' : null);
  if (detailText) stage.append(el(doc, 'p', { className: 'bb-ws-loading-stage-detail', text: detailText }));
  return stage;
}

/** Fade right then remove. Calling the returned cancel function restores a reusable card. */
export function workspaceDismissNotification(card, onDismiss) {
  const remove = () => {
    if (typeof card.remove === 'function') card.remove();
    else if (card.parentNode?.removeChild) card.parentNode.removeChild(card);
    else if (card.parentNode?.replaceChildren) card.parentNode.replaceChildren(...Array.from(card.parentNode.children).filter(node => node !== card));
  };
  if (notificationClosings.has(card)) return notificationClosings.get(card);
  if (!card.classList || reducedMotion(card)) { remove(); onDismiss?.(); return () => {}; }
  let timer;
  let active = true;
  const cancel = () => {
    if (!active) return;
    active = false; clearTimeout(timer);
    card.removeEventListener('animationend', ended);
    card.classList.remove('is-dismissing'); notificationClosings.delete(card);
  };
  const complete = () => { if (!active) return; cancel(); remove(); onDismiss?.(); };
  const ended = event => { if (event.target === card && event.animationName === 'bb-ws-notification-out') complete(); };
  notificationClosings.set(card, cancel); card.addEventListener('animationend', ended);
  card.classList.add('is-dismissing'); timer = setTimeout(complete, animationFallback(card, 50, 250));
  return cancel;
}

/** Persistent notification, closed unless `open`. The caller owns its lifecycle. */
export function workspaceErrorCard(doc, { title, message, tone = 'danger', onRetry, open = false } = {}) {
  const card = workspaceNotificationCard(doc, { tone, className: 'bb-ws-error-card', role: 'listitem' });
  const details = el(doc, 'details'); details.open = open;
  const summary = el(doc, 'summary', { attrs: { 'aria-label': `${title}の通知` } });
  summary.append(el(doc, 'span', { className: 'bb-ws-error-symbol', text: '!', attrs: { 'aria-hidden': 'true' } }), el(doc, 'span', { text: title }));
  details.append(summary, el(doc, 'p', { text: message })); card.append(details);
  if (onRetry) card.append(workspaceButton(doc, { text: '再試行', attrs: { 'aria-label': `${title}を再試行` }, onClick: onRetry }));
  return card;
}

export function workspaceDisclosure(doc, { title, help, content, open = false, onToggle, appearance, headingLevel = 2 } = {}) {
  const compact = appearance === 'compact';
  const level = [2, 3, 4, 5, 6].includes(headingLevel) ? headingLevel : 2;
  const details = el(doc, 'details', { className: `bb-ws-disclosure${compact ? ' bb-ws-disclosure--compact' : ''}` }); details.open = open;
  const summary = el(doc, 'summary');
  summary.append(el(doc, `h${level}`, { text: title }));
  if (help) summary.append(workspaceHelp(doc, { label: title, text: help }));
  details.append(summary, content);
  if (onToggle) details.addEventListener('toggle', () => onToggle(details.open));
  return details;
}

function comboboxText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja');
}

/**
 * Dropdown whose list can be searched. The trigger shows the chosen label;
 * opening it moves focus to a search box (role=combobox) that narrows a
 * listbox. Arrow keys move the active option, Enter chooses it, Escape closes
 * and returns focus to the trigger, and typing on the trigger starts a search.
 * Long lists render the first `limit` matches and say how many the search
 * would still reveal. Options are `{ value, label, hint?, keywords? }`; the
 * host owns the chosen value and receives it through `onChange`.
 */
export function workspaceCombobox(doc, {
  label, options = [], value = '', placeholder = '選択してください', searchLabel, searchPlaceholder = '絞り込む',
  emptyText = '一致する候補はありません', limit = 100, searchable = 'auto', className, onChange, onSelect,
  multiple = false, values = [], selectionLabel = '', renderIcon, renderValue, showCount = true, showHints = true, align = 'start', appearance, boxed = false, borderless = false, popupAppearance, suggested = false, matchTriggerWidth = false, triggerHeight, popupWidth, active = false,
  popupPlacement,
} = {}) {
  const sequence = nextWorkspaceSequence();
  const listId = `bb-ws-combobox-${sequence}-list`;
  const root = el(doc, 'span', { className: ['bb-ws-combobox', className].filter(Boolean).join(' ') });
  const useViewportPopup = popupPlacement === 'viewport';
  if (useViewportPopup) toggleWorkspaceClass(root, 'bb-ws-combobox--viewport-popup', true);
  if (appearance === 'compact') toggleWorkspaceClass(root, 'bb-ws-combobox--compact', true);
  if (boxed) { toggleWorkspaceClass(root, 'is-boxed', true); toggleWorkspaceClass(root, 'bb-ws-combobox--stable-box', true); }
  if (borderless) toggleWorkspaceClass(root, 'bb-ws-combobox--borderless', true);
  if (popupAppearance === 'control-panel') toggleWorkspaceClass(root, 'bb-ws-combobox--control-panel', true);
  if (suggested) toggleWorkspaceClass(root, 'bb-ws-combobox--suggested', true);
  if (active) toggleWorkspaceClass(root, 'is-active', true);
  if (matchTriggerWidth) toggleWorkspaceClass(root, 'bb-ws-combobox--match-width', true);
  if (triggerHeight === 32) toggleWorkspaceClass(root, 'bb-ws-combobox--tall', true);
  if (Number.isFinite(popupWidth) && popupWidth > 0) {
    toggleWorkspaceClass(root, 'bb-ws-combobox--fixed-width', true);
    root.style?.setProperty('--bb-combobox-popup-width', `${popupWidth}px`);
  }
  if (multiple) root.classList?.add('bb-ws-combobox-multiple');
  if (align === 'end') root.classList?.add('bb-ws-combobox-align-end');
  const trigger = el(doc, 'button', { className: 'bb-ws-combobox-trigger', attrs: { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': listId } });
  const triggerText = el(doc, 'span', { className: 'bb-ws-combobox-value' });
  const chevron = workspaceDropdownChevron(doc);
  let suggestionMark;
  trigger.append(triggerText, chevron);
  const popup = el(doc, 'div', { className: 'bb-ws-combobox-popup' });
  popup.hidden = true;
  const search = el(doc, 'input', { className: 'bb-ws-combobox-search', attrs: {
    type: 'text', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'true', 'aria-controls': listId,
    'aria-label': searchLabel || `${label || '候補'}を絞り込む`, placeholder: searchPlaceholder, autocomplete: 'off', spellcheck: 'false',
  } });
  const list = el(doc, 'ul', { className: 'bb-ws-combobox-list', attrs: { id: listId, role: 'listbox', 'aria-label': label || '候補', tabindex: '-1' } });
  if (multiple) list.setAttribute('aria-multiselectable', 'true');
  const status = el(doc, 'p', { className: 'bb-ws-combobox-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  popup.append(search, list, status);
  root.append(trigger, popup);

  const state = { selectionLabel: String(selectionLabel ?? ''), options: [], values: [...new Set((Array.isArray(values) ? values : []).map(String))].filter(Boolean), value: String(value ?? ''), query: '', active: -1, shown: [], open: false, disabled: false, suggested: Boolean(suggested) };
  let optionNodes = [];
  let portal;
  let modalHost;
  let portalMotionPending = false;
  let pendingPortalFocus = false;
  let portalMotionTimer;
  let destroyed = false;
  let exitTimer;
  const cancelExit = () => { clearTimeout(exitTimer); exitTimer = undefined; popup.removeEventListener?.('animationend', exitEnded); toggleWorkspaceClass(popup, 'is-closing', false); };
  const finishExit = () => {
    cancelExit();
    if (!state.open) { popup.hidden = true; if (useViewportPopup) restoreViewportPopup(); }
  };
  const exitEnded = event => { if (event.target === popup && event.animationName === 'bb-ws-compact-dropdown-out') finishExit(); };
  const usesSearch = () => searchable === true || (searchable === 'auto' && state.options.length > 8);
  const focusTarget = () => (usesSearch() ? search : list);
  const chosen = () => state.options.find(option => option.value === state.value);

  function syncPortalClasses() {
    if (!portal) return;
    portal.className = `${root.className} bb-ws-combobox-portal`;
    if (Number.isFinite(popupWidth) && popupWidth > 0) portal.style?.setProperty('--bb-combobox-popup-width', `${popupWidth}px`);
  }

  function clearPortalMotionTimer() {
    clearTimeout(portalMotionTimer); portalMotionTimer = undefined;
  }

  function dialogHasRunningTransform() {
    if (!modalHost) return false;
    const active = modalHost.getAnimations?.().some(animation => animation.effect?.target === modalHost && animation.playState === 'running') === true;
    const transform = doc.defaultView?.getComputedStyle?.(modalHost)?.transform;
    return active && transform !== 'none';
  }

  function repositionViewportPopup() {
    if (!useViewportPopup || !state.open || !portal || portalMotionPending) return;
    if (root.isConnected === false || trigger.isConnected === false || (modalHost && !modalHost.open)) { close(false, true); return; }
    const triggerRect = trigger.getBoundingClientRect();
    const viewportWidth = doc.defaultView?.innerWidth || doc.documentElement?.clientWidth || 1024;
    const dialogRect = modalHost?.getBoundingClientRect?.();
    const listScrollTop = list.scrollTop;
    const maxWidth = Math.max(0, Math.min(viewportWidth - 16, dialogRect ? dialogRect.width - 16 : viewportWidth - 16));
    popup.style?.setProperty('max-width', `${maxWidth}px`);
    if (matchTriggerWidth) popup.style?.setProperty('width', `${Math.max(0, Math.min(triggerRect.width || 0, maxWidth))}px`);
    else popup.style?.removeProperty?.('width');
    popup.style?.removeProperty?.('max-height');
    popup.style?.removeProperty?.('overflow-y');
    const point = workspacePositionAnchoredElement(popup, trigger, {
      align, placement: 'bottom', gap: 6, inset: 8, view: doc.defaultView, doc, flip: true, clampHeight: true, clampOverflow: 'hidden', preciseWidth: true, bounds: dialogRect,
    });
    popup.style?.setProperty('left', `${point.left}px`);
    popup.style?.setProperty('top', `${point.top}px`);
    if (Number.isFinite(listScrollTop)) list.scrollTop = listScrollTop;
  }

  function finishPortalMotion() {
    if (!portalMotionPending || !state.open) return;
    if (modalHost?.classList?.contains('is-closing')) { close(false, true); return; }
    if (dialogHasRunningTransform()) return;
    clearPortalMotionTimer(); portalMotionPending = false;
    repositionViewportPopup();
    popup.style?.removeProperty?.('visibility');
    if (pendingPortalFocus) { pendingPortalFocus = false; focusTarget().focus?.({ preventScroll: true }); }
  }

  function portalDialogAnimationStart(event) {
    if (event.target !== modalHost) return;
    if (modalHost?.classList?.contains('is-closing')) { close(false, true); return; }
    if (doc.defaultView?.getComputedStyle?.(modalHost)?.transform !== 'none') {
      portalMotionPending = true; pendingPortalFocus = true;
      popup.style?.setProperty('visibility', 'hidden');
      clearPortalMotionTimer(); portalMotionTimer = setTimeout(finishPortalMotion, animationFallback(modalHost, 24, 240));
    }
  }

  function portalDialogAnimationEnd(event) {
    if (event.target !== modalHost) return;
    if (modalHost?.classList?.contains('is-closing')) { close(false, true); return; }
    finishPortalMotion();
  }

  function mountViewportPopup() {
    if (!useViewportPopup) return;
    modalHost = root.closest?.('dialog[open]') || null;
    if (!portal) {
      portal = el(doc, 'span', { className: `${root.className} bb-ws-combobox-portal` });
      portal.style?.setProperty('display', 'contents');
    }
    syncPortalClasses();
    toggleWorkspaceClass(popup, 'bb-ws-combobox-popup--viewport', true);
    const portalParent = modalHost || doc.body;
    if (portal.parentNode !== portalParent) portalParent.append(portal);
    if (popup.parentNode !== portal) portal.append(popup);
    doc.addEventListener?.('scroll', repositionViewportPopup, true);
    doc.defaultView?.addEventListener?.('resize', repositionViewportPopup);
    doc.defaultView?.visualViewport?.addEventListener?.('resize', repositionViewportPopup);
    doc.defaultView?.visualViewport?.addEventListener?.('scroll', repositionViewportPopup);
    if (modalHost) {
      modalHost.addEventListener?.('close', closeForDialog);
      modalHost.addEventListener?.('cancel', closeForDialog);
      modalHost.addEventListener?.('animationstart', portalDialogAnimationStart);
      modalHost.addEventListener?.('animationend', portalDialogAnimationEnd);
      modalHost.addEventListener?.('transitionrun', portalDialogAnimationStart);
      modalHost.addEventListener?.('transitionstart', portalDialogAnimationStart);
      modalHost.addEventListener?.('transitionend', portalDialogAnimationEnd);
    }
    if (dialogHasRunningTransform()) {
      portalMotionPending = true; pendingPortalFocus = true;
      popup.style?.setProperty('visibility', 'hidden');
      portalMotionTimer = setTimeout(finishPortalMotion, animationFallback(modalHost, 24, 240));
    } else repositionViewportPopup();
  }

  function returnViewportPopupToRoot({ hide = true } = {}) {
    if (!useViewportPopup) return;
    if (hide) popup.hidden = true;
    toggleWorkspaceClass(popup, 'bb-ws-combobox-popup--viewport', false);
    for (const property of ['left', 'top', 'width', 'max-width', 'max-height', 'overflow-y', 'visibility']) popup.style?.removeProperty?.(property);
    if (portal) { root.append(popup); portal.remove(); portal = undefined; }
    modalHost = undefined; portalMotionPending = false; pendingPortalFocus = false; clearPortalMotionTimer();
  }

  function restoreViewportPopup() { returnViewportPopupToRoot({ hide: true }); }

  function setOptions(next) {
    state.options = (Array.isArray(next) ? next : []).map(option => ({
      ...option, value: String(option?.value ?? ''), label: String(option?.label ?? option?.value ?? ''),
      hint: option?.hint ? String(option.hint) : '', keywords: option?.keywords ? String(option.keywords) : '', group: option?.group ? String(option.group) : '',
    }));
  }

  function renderTrigger() {
    const option = multiple ? (state.values.length === 1 ? state.options.find(option => option.value === state.values[0]) : state.options.find(option => !option.value)) : chosen();
    const summary = multiple && state.values.length > 1 ? `${state.values.length}件選択中` : null;
    const text = state.selectionLabel || summary || (option ? option.label : multiple ? state.values.join('、') || placeholder : state.value || placeholder);
    if (state.suggested) {
      if (!suggestionMark) {
        suggestionMark = el(doc, 'span', { className: 'bb-ws-combobox-suggestion-mark', attrs: { 'aria-hidden': 'true' } });
        suggestionMark.append(workspaceActionIcon(doc, 'sparkles'));
      }
      trigger.insertBefore(suggestionMark, triggerText);
    } else suggestionMark?.remove();
    triggerText.textContent = text;
    if (!state.selectionLabel && !summary && option && typeof renderValue === 'function') {
      triggerText.textContent = '';
      appendContent(triggerText, doc, renderValue(option));
    } else if (!state.selectionLabel && !summary && option && typeof renderIcon === 'function') {
      const icon = renderIcon(option);
      if (icon) { triggerText.textContent = ''; triggerText.append(icon, el(doc, 'span', { className: 'bb-ws-combobox-text', text })); }
    }
    toggleWorkspaceClass(root, 'is-multi-selected', Boolean(summary));
    const accessibleText = !state.selectionLabel && !summary && option?.group ? `${option.group}・${option.label}` : text;
    trigger.setAttribute('aria-label', `${label ? `${label}: ` : ''}${accessibleText}`);
    trigger.setAttribute('data-empty', String(multiple ? !state.values.length : !option && !state.value));
    if (state.disabled) trigger.setAttribute('disabled', ''); else trigger.removeAttribute('disabled');
    syncPortalClasses();
  }

  function activeDescendant(node) {
    for (const target of [search, list]) {
      if (node) target.setAttribute('aria-activedescendant', node.getAttribute('id'));
      else target.removeAttribute('aria-activedescendant');
    }
  }

  function renderList({ reveal = false } = {}) {
    const scrollTop = list.scrollTop;
    const terms = comboboxText(state.query).split(/\s+/u).filter(Boolean);
    const matches = terms.length
      ? state.options.filter(option => { const text = comboboxText(`${option.label}\n${option.hint}\n${option.keywords}\n${option.group}`); return terms.every(term => text.includes(term)); })
      : state.options;
    const max = Math.max(1, Number(limit) || 100);
    state.shown = matches.slice(0, max);
    if (state.active >= state.shown.length) state.active = state.shown.length - 1;
    list.replaceChildren(); optionNodes = [];
    let groupName = '';
    let groupNode;
    let groupOptions;
    state.shown.forEach((option, index) => {
      if (option.group && option.group !== groupName) {
        groupName = option.group;
        groupNode = el(doc, 'li', { className: 'bb-ws-combobox-group', attrs: { role: 'group', 'aria-label': groupName } });
        groupOptions = el(doc, 'ul', { className: 'bb-ws-combobox-group-options', attrs: { role: 'presentation' } });
        groupNode.append(el(doc, 'span', { className: 'bb-ws-combobox-group-label', text: groupName, attrs: { 'aria-hidden': 'true' } }), groupOptions);
        list.append(groupNode);
      } else if (!option.group) { groupName = ''; groupNode = undefined; groupOptions = undefined; }
      const selected = multiple ? option.value ? state.values.includes(option.value) : state.values.length === 0 : option.value === state.value;
      const item = el(doc, 'li', { className: `bb-ws-combobox-option${index === state.active ? ' is-active' : ''}`, attrs: { id: `bb-ws-combobox-${sequence}-option-${index}`, role: 'option', 'aria-selected': String(selected), 'data-value': option.value } });
      const optionLabel = el(doc, 'span', { className: 'bb-ws-combobox-option-label', text: option.label });
      if (typeof renderIcon === 'function') { const icon = renderIcon(option); if (icon) { optionLabel.textContent = ''; optionLabel.append(icon, el(doc, 'span', { className: 'bb-ws-combobox-text', text: option.label })); } }
      if (appearance === 'compact') {
        const check = el(doc, 'span', { className: multiple ? 'bb-ws-combobox-check' : 'bb-ws-combobox-mark', attrs: { 'aria-hidden': 'true' } });
        check.append(workspaceActionIcon(doc, 'check')); item.append(check);
      }
      item.append(optionLabel);
      if (showHints && option.hint) item.append(el(doc, 'span', { className: 'bb-ws-combobox-option-hint', text: option.hint }));
      item.addEventListener('pointerdown', event => event.preventDefault?.());
      item.addEventListener('click', () => choose(option));
      (groupOptions || list).append(item); optionNodes.push(item);
    });
    const active = optionNodes[state.active];
    activeDescendant(active);
    if (scrollTop !== undefined) list.scrollTop = scrollTop;
    if (reveal) {
      const activeRect = active?.getBoundingClientRect?.(), listRect = list.getBoundingClientRect?.();
      const top = activeRect && listRect ? activeRect.top - listRect.top + list.scrollTop : active?.offsetTop;
      const height = activeRect?.height ?? active?.offsetHeight;
      if (Number.isFinite(top) && Number.isFinite(height)) {
        if (top < list.scrollTop) list.scrollTop = top;
        else if (top + height > list.scrollTop + list.clientHeight) list.scrollTop = top + height - list.clientHeight;
      }
    }
    const rest = matches.length - state.shown.length;
    status.hidden = !showCount && matches.length > 0 && rest === 0;
    status.textContent = !matches.length ? emptyText : rest > 0 ? `${matches.length}件中${state.shown.length}件を表示。ほか${rest}件は絞り込むと出ます` : `${matches.length}件`;
    if (state.open && useViewportPopup) repositionViewportPopup();
  }

  function move(index) {
    if (!state.shown.length) return;
    state.active = Math.min(state.shown.length - 1, Math.max(0, index));
    renderList({ reveal: true });
  }

  function closeForDialog() { close(false, true); }

  function removeListeners() {
    doc.removeEventListener?.('pointerdown', outside);
    if (!useViewportPopup) return;
    doc.removeEventListener?.('scroll', repositionViewportPopup, true);
    doc.defaultView?.removeEventListener?.('resize', repositionViewportPopup);
    doc.defaultView?.visualViewport?.removeEventListener?.('resize', repositionViewportPopup);
    doc.defaultView?.visualViewport?.removeEventListener?.('scroll', repositionViewportPopup);
    modalHost?.removeEventListener?.('close', closeForDialog);
    modalHost?.removeEventListener?.('cancel', closeForDialog);
    modalHost?.removeEventListener?.('animationstart', portalDialogAnimationStart);
    modalHost?.removeEventListener?.('animationend', portalDialogAnimationEnd);
    modalHost?.removeEventListener?.('transitionrun', portalDialogAnimationStart);
    modalHost?.removeEventListener?.('transitionstart', portalDialogAnimationStart);
    modalHost?.removeEventListener?.('transitionend', portalDialogAnimationEnd);
    clearPortalMotionTimer(); portalMotionPending = false; pendingPortalFocus = false;
    popup.style?.removeProperty?.('visibility');
  }

  function outside(event) {
    if (!root.contains?.(event.target) && !popup.contains?.(event.target) && !portal?.contains?.(event.target)) close(false);
  }

  function open(query = '') {
    if (state.disabled || (useViewportPopup && destroyed)) return;
    cancelExit(); popup.inert = false; popup.removeAttribute?.('inert'); popup.removeAttribute?.('aria-hidden');
    if (!state.open) { state.open = true; doc.addEventListener?.('pointerdown', outside); }
    state.query = query; search.value = query; search.hidden = !usesSearch();
    const selectedIndex = state.options.findIndex(option => multiple ? state.values.includes(option.value) : option.value === state.value);
    state.active = query ? 0 : Math.max(0, selectedIndex);
    popup.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    if (useViewportPopup) mountViewportPopup();
    renderList({ reveal: true });
    if (useViewportPopup) repositionViewportPopup();
    if (!portalMotionPending) focusTarget().focus?.({ preventScroll: true });
  }

  function close(returnFocus = true, immediate = false) {
    if (!state.open) return;
    state.open = false; removeListeners();
    if (useViewportPopup && !immediate) returnViewportPopupToRoot({ hide: false });
    if (immediate) {
      cancelExit(); popup.hidden = true;
      if (useViewportPopup) restoreViewportPopup();
    } else if (appearance === 'compact' && !reducedMotion(popup) && popup.isConnected !== false) {
      popup.inert = true; popup.setAttribute('inert', ''); popup.setAttribute('aria-hidden', 'true');
      toggleWorkspaceClass(popup, 'is-closing', true); popup.addEventListener?.('animationend', exitEnded);
      exitTimer = setTimeout(finishExit, animationFallback(popup, 50, 190));
    } else { popup.hidden = true; if (useViewportPopup) restoreViewportPopup(); }
    trigger.setAttribute('aria-expanded', 'false'); activeDescendant(null);
    if (returnFocus) trigger.focus?.();
  }

  function choose(option) {
    if (multiple) {
      state.active = state.shown.findIndex(candidate => candidate.value === option.value);
      state.values = !option.value ? [] : state.values.includes(option.value) ? state.values.filter(value => value !== option.value) : [...state.values, option.value];
      renderTrigger(); renderList(); onChange?.([...state.values], option); return;
    }
    const changed = option.value !== state.value;
    state.value = option.value; renderTrigger(); close(true);
    if (changed) onChange?.(option.value, option);
    onSelect?.(option.value, option);
  }

  function viewportTabTarget(backward) {
    const scope = modalHost?.open ? modalHost : doc;
    const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const candidates = Array.from(scope.querySelectorAll?.(selector) ?? []).filter(node => {
      if (node === popup || popup.contains?.(node) || portal?.contains?.(node)) return false;
      if (node.disabled || node.hidden || node.matches?.(':disabled') || node.getAttribute?.('aria-hidden') === 'true') return false;
      const style = doc.defaultView?.getComputedStyle?.(node);
      if (style?.display === 'none' || style?.visibility === 'hidden' || node.getClientRects?.().length === 0) return false;
      return true;
    });
    const index = candidates.indexOf(trigger);
    if (index < 0) return modalHost?.open ? trigger : null;
    const direction = backward ? -1 : 1;
    const adjacent = candidates[index + direction];
    if (adjacent) return adjacent;
    if (modalHost?.open && candidates.length > 1) return candidates[backward ? candidates.length - 1 : 0];
    return null;
  }

  function keydown(event) {
    const page = 10;
    const keys = {
      ArrowDown: () => move(state.active + 1), ArrowUp: () => move(state.active - 1),
      PageDown: () => move(state.active + page), PageUp: () => move(state.active - page),
      Enter: () => { const option = state.shown[state.active]; if (option) choose(option); },
      Escape: () => close(true),
    };
    // Home and End move the caret while a search box is shown.
    if (!usesSearch()) Object.assign(keys, { Home: () => move(0), End: () => move(state.shown.length - 1) });
    if (event.key === 'Tab') {
      if (useViewportPopup) {
        const target = viewportTabTarget(Boolean(event.shiftKey));
        close(false, true);
        if (target) { event.preventDefault?.(); target.focus?.({ preventScroll: true }); }
        return;
      }
      close(false); return;
    }
    if (multiple && event.key === ' ' && !usesSearch()) keys[' '] = keys.Enter;
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault?.(); event.stopPropagation?.();
    action();
  }

  trigger.addEventListener('click', () => (state.open ? close(true) : open()));
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault?.(); open(); return; }
    const printable = typeof event.key === 'string' && event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (printable && usesSearch()) { event.preventDefault?.(); open(event.key); }
  });
  search.addEventListener('input', () => { state.query = search.value; state.active = 0; renderList(); });
  search.addEventListener('keydown', keydown);
  list.addEventListener('keydown', keydown);

  setOptions(options); renderTrigger();
  return {
    root, trigger, popup, search, list,
    get value() { return state.value; },
    get values() { return [...state.values]; },
    get isOpen() { return state.open; },
    open, close,
    update({ options: nextOptions, value: nextValue, values: nextValues, selectionLabel: nextSelectionLabel, disabled, active: nextActive, suggested: nextSuggested } = {}) {
      if (nextActive !== undefined) toggleWorkspaceClass(root, 'is-active', Boolean(nextActive));
      const previous = JSON.stringify([state.options, state.value, state.values, state.selectionLabel, state.disabled, state.suggested]);
      if (nextSuggested !== undefined) {
        state.suggested = Boolean(nextSuggested);
        toggleWorkspaceClass(root, 'bb-ws-combobox--suggested', state.suggested);
      }
      syncPortalClasses();
      if (nextOptions !== undefined) setOptions(nextOptions);
      if (nextSelectionLabel !== undefined) state.selectionLabel = String(nextSelectionLabel ?? '');
      if (nextValue !== undefined) state.value = String(nextValue ?? '');
      if (nextValues !== undefined) state.values = [...new Set((Array.isArray(nextValues) ? nextValues : []).map(String))].filter(Boolean);
      if (disabled !== undefined) { state.disabled = Boolean(disabled); if (state.disabled) close(false); }
      if (previous === JSON.stringify([state.options, state.value, state.values, state.selectionLabel, state.disabled, state.suggested])) return;
      renderTrigger();
      if (state.open) { search.hidden = !usesSearch(); renderList(); }
    },
    destroy() {
      if (useViewportPopup) {
        if (destroyed) return;
        destroyed = true;
        if (state.open) close(false, true);
        removeListeners(); cancelExit(); restoreViewportPopup();
        return;
      }
      close(false); removeListeners(); cancelExit(); popup.hidden = true;
    },
  };
}

/** Small shared icons for list actions. No icon font or host sprite is required. */
export function workspaceActionIcon(doc, name) {
  const svg = typeof doc.createElementNS === 'function' ? doc.createElementNS('http://www.w3.org/2000/svg', 'svg') : doc.createElement('svg');
  for (const [key, value] of Object.entries({ class: 'bb-ws-action-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const path = typeof doc.createElementNS === 'function' ? doc.createElementNS('http://www.w3.org/2000/svg', 'path') : doc.createElement('path');
  const paths = { edit: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4', undo: 'M4 5v5h5 M4.6 10A8 8 0 1 1 6.3 17.7', check: 'M5 12l5 5 9-10', sliders: 'M4 8h8M18 8h2M4 16h2M12 16h8 M17.4 8a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0 M11.4 16a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0', plus: 'M12 5v14M5 12h14', search: 'M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0', filter: 'M4 7h16M7 12h10M10 17h4', sort: 'M8 4v16m-3-3 3 3 3-3M16 20V4m-3 3 3-3 3 3', close: 'M6 6l12 12M18 6L6 18', sparkles: 'M12 3l1.8 6.7 6.7 1.8-6.7 1.8L12 20l-1.8-6.7-6.7-1.8 6.7-1.8z M19 2v4 M17 4h4' };
  Object.assign(paths, {
    copy: 'M9 9h12v12H9z M5 15H3V3h12v2',
    lock: 'M6 10h12v11H6z M8 10V7a4 4 0 1 1 8 0v3',
    clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2',
    users: 'M12.2 8a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0 M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5 M16 5.2a3.2 3.2 0 0 1 0 5.6 M18 14.8c1.9.7 3 2.5 3 5.2',
    calendar: 'M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2 M8 2v4 M16 2v4 M3 10h18',
    share: 'M20.6 5a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0 M8.6 12a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0 M20.6 19a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0 M8.3 10.7l7.4-4.3 M8.3 13.3l7.4 4.3',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  });
  path.setAttribute('d', paths[name] || paths.filter); svg.append(path); return svg;
}

/** One-row list actions. Reuses the caller's query, reset and combobox state/handlers. */
export function workspaceCompactToolbar(doc, { root, query, filters, sort, reset, filterLabel = 'フィルター', sortLabel = '並べ替え' } = {}) {
  root ||= el(doc, 'div');
  root.classList.add('bb-ws-compact-toolbar');
  const primary = el(doc, 'div', { className: 'bb-ws-toolbar-primary' });
  const controls = el(doc, 'div', { className: 'bb-ws-toolbar-controls' });
  const search = el(doc, 'span', { className: 'bb-ws-toolbar-query' });
  search.append(workspaceActionIcon(doc, 'search'), query);
  const filterButton = workspaceButton(doc, { variant: 'quiet', attrs: { 'aria-label': filterLabel } });
  filterButton.classList.add('bb-ws-toolbar-filter');
  const caret = el(doc, 'span', { className: 'bb-ws-toolbar-caret', text: '⌄', attrs: { 'aria-hidden': 'true' } });
  filterButton.append(workspaceActionIcon(doc, 'filter'), el(doc, 'span', { className: 'bb-ws-toolbar-button-label', text: filterLabel }), caret);
  const filter = workspaceFilterPopover(doc, {
    content: filters, trigger: filterButton,
    onToggle: open => { if (open && sort?.trigger.getAttribute('aria-expanded') === 'true') sort.trigger.click(); },
  });
  filter.panel.setAttribute('aria-label', filterLabel);
  filter.panel.classList.add('bb-ws-toolbar-filter-panel');
  const clearSlot = el(doc, 'span', { className: 'bb-ws-toolbar-clear-slot' });
  if (reset) {
    reset.textContent = '×'; reset.classList.add('bb-ws-toolbar-clear');
    reset.setAttribute('aria-label', `${filterLabel}を解除`); reset.setAttribute('title', `${filterLabel}を解除`);
    clearSlot.append(reset);
  }
  filter.root.append(clearSlot);
  const group = el(doc, 'span', { className: 'bb-ws-toolbar-filter-group' }); group.append(filter.root);
  if (sort) {
    sort.root.classList.add('bb-ws-toolbar-sort');
    sort.trigger.classList.add('bb-ws-toolbar-sort-trigger');
    sort.trigger.append(workspaceActionIcon(doc, 'sort'), el(doc, 'span', { className: 'bb-ws-toolbar-button-label', text: sortLabel }));
  }
  controls.append(search, group); if (sort) controls.append(sort.root);
  root.replaceChildren(primary, controls);
  const closeFilter = () => filter.setOpen(false);
  const clear = () => { closeFilter(); filterButton.focus({ preventScroll: true }); };
  const sortClick = () => { if (sort?.trigger.getAttribute('aria-expanded') === 'true') closeFilter(); };
  reset?.addEventListener('click', clear); sort?.trigger.addEventListener('click', sortClick); sort?.trigger.addEventListener('keydown', sortClick);
  return { root, primary, filter, setFiltered(active) {
    if (active) group.classList.add('is-filtered'); else group.classList.remove('is-filtered');
    filterButton.setAttribute('aria-label', active ? `${filterLabel}（適用中）` : filterLabel);
  }, destroy() {
    filter.destroy(); reset?.removeEventListener('click', clear); sort?.trigger.removeEventListener('click', sortClick); sort?.trigger.removeEventListener('keydown', sortClick);
  } };
}

/** Apply the common tab appearance without changing semantics, state or handlers.
 * Hosts may also use the documented bb-ws-tabs CSS class directly.
 */
export function workspaceTabList(root) {
  if (!root || typeof root.className !== 'string') throw new TypeError('tab_root_required');
  const classes = root.className.split(/\s+/u).filter(Boolean);
  if (!classes.includes('bb-ws-tabs')) classes.push('bb-ws-tabs');
  root.className = classes.join(' ');
  return root;
}

const TAB_STRIP_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);
// How long a key move may wait for the host to redraw before focus is no longer brought back.
const TAB_STRIP_FOCUS_WINDOW_MS = 5000;
const tabStrips = new WeakMap();
const tabStripMemory = new Map();
const isEnabledTab = node => node?.getAttribute?.('role') === 'tab' && !node.hidden && !node.disabled && node.getAttribute('aria-disabled') !== 'true';
const isSelectedTab = node => node?.getAttribute?.('aria-selected') === 'true' || node?.getAttribute?.('aria-current') === 'page' || node?.getAttribute?.('aria-pressed') === 'true';

/** Opt-in keyboard switching and a sliding indicator on top of `workspaceTabList`.
 * Selection stays with the host: a key move calls the tab's own click().  Hosts
 * that redraw the strip as new nodes pass the same `memoryKey`; hosts that keep
 * the root and replace its children call `update()` after drawing.
 */
export function workspaceTabStrip(root, { memoryKey, appearance } = {}) {
  workspaceTabList(root);
  if (appearance === 'prominent') toggleWorkspaceClass(root, 'bb-ws-tabs--prominent', true);
  if (appearance === 'segmented') toggleWorkspaceClass(root, 'bb-ws-tabs--segmented', true);
  if (appearance === 'header') toggleWorkspaceClass(root, 'bb-ws-tabs--header', true);
  if (tabStrips.has(root)) return tabStrips.get(root);
  const doc = root.ownerDocument;
  const view = doc?.defaultView;
  const schedule = typeof view?.requestAnimationFrame === 'function' ? fn => view.requestAnimationFrame(fn) : fn => { Promise.resolve().then(fn); };
  const key = typeof memoryKey === 'string' && memoryKey ? memoryKey : null;
  if (key && !tabStripMemory.has(key)) tabStripMemory.set(key, { x: null, width: null, focusUntil: 0 });
  const local = { x: null, width: null, focusUntil: 0 };
  const memory = () => (key ? tabStripMemory.get(key) : local);
  const children = () => Array.from(root.children ?? []);
  const tabs = () => children().filter(isEnabledTab);
  const selectedTab = () => children().find(isSelectedTab) ?? null;
  let placed = false;
  let destroyed = false;

  const setIndicator = ({ x, width }) => {
    root.style.setProperty('--bb-tab-indicator-x', `${x}px`);
    root.style.setProperty('--bb-tab-indicator-width', `${width}px`);
  };
  const placeIndicator = tab => {
    const width = tab?.offsetWidth;
    if (!(width > 0) || typeof root.style?.setProperty !== 'function') {
      toggleWorkspaceClass(root, 'is-indicator-ready', false); placed = false; return;
    }
    // Measure from the strip itself: before the strip is positioned, offsetLeft counts from an outer box.
    const box = tab.getBoundingClientRect?.();
    const origin = root.getBoundingClientRect?.();
    const target = box && origin ? { x: box.left - origin.left + (root.scrollLeft || 0), width: box.width } : { x: tab.offsetLeft, width };
    const mem = memory();
    if (!placed) {
      // A new strip starts where the last strip with the same key left the bar, then slides.
      const from = mem.width > 0 && !reducedMotion(root) ? mem : target;
      toggleWorkspaceClass(root, 'is-indicator-instant', true);
      setIndicator(from); toggleWorkspaceClass(root, 'is-indicator-ready', true);
      void root.offsetWidth;
      toggleWorkspaceClass(root, 'is-indicator-instant', false);
    }
    setIndicator(target); placed = true;
    mem.x = target.x; mem.width = target.width;
  };
  const restoreFocus = () => {
    const mem = memory();
    if (!(mem.focusUntil > Date.now())) return;
    const target = selectedTab();
    if (!target || root.isConnected === false) return;
    const active = doc?.activeElement ?? null;
    if (active === target) { mem.focusUntil = 0; return; }
    const lost = !active || active === doc.body || active.isConnected === false;
    // Focus moved somewhere else: the viewer chose it, so leave it there.
    if (!lost && !root.contains?.(active)) { mem.focusUntil = 0; return; }
    // Still on a tab of this strip: the host has not finished selecting yet.
    if (!lost) return;
    target.focus?.({ preventScroll: true });
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    mem.focusUntil = 0;
  };
  const update = () => {
    // A strip the host already replaced must not move the shared memory back.
    if (destroyed || root.isConnected === false) return;
    const all = tabs();
    const selected = selectedTab();
    const focusable = all.includes(selected) ? selected : all[0];
    for (const tab of all) tab.setAttribute('tabindex', tab === focusable ? '0' : '-1');
    placeIndicator(selected);
    restoreFocus();
  };
  const keydown = event => {
    if (!TAB_STRIP_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const all = tabs();
    const current = all.indexOf(event.target);
    if (current < 0 || all.length < 2) return;
    event.preventDefault?.();
    const last = all.length - 1;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? last : (current + (event.key === 'ArrowRight' ? 1 : last)) % all.length;
    const next = all[index];
    if (next === event.target) return;
    memory().focusUntil = Date.now() + TAB_STRIP_FOCUS_WINDOW_MS;
    next.focus?.({ preventScroll: true });
    if (!isSelectedTab(next)) next.click?.();
    schedule(update);
  };
  root.addEventListener?.('keydown', keydown);
  const controller = { root, update, destroy() {
    destroyed = true; root.removeEventListener?.('keydown', keydown); tabStrips.delete(root);
    toggleWorkspaceClass(root, 'is-indicator-ready', false);
    root.style?.removeProperty?.('--bb-tab-indicator-x'); root.style?.removeProperty?.('--bb-tab-indicator-width');
  } };
  tabStrips.set(root, controller);
  schedule(update);
  return controller;
}

/** The shared shallow dropdown chevron, sized and colored through shared CSS. */
export function workspaceDropdownChevron(doc) {
  const wrap = el(doc, 'span', { className: 'bb-ws-combobox-chevron', attrs: { 'aria-hidden': 'true' } });
  const create = tag => typeof doc.createElementNS === 'function' ? doc.createElementNS('http://www.w3.org/2000/svg', tag) : doc.createElement(tag);
  const svg = create('svg'); svg.setAttribute('viewBox', '0 0 12 8'); svg.setAttribute('width', '10'); svg.setAttribute('height', '6'); svg.setAttribute('class', 'bb-ws-dropdown-chevron');
  const path = create('path'); path.setAttribute('d', 'M1 2.5l5 3 5-3'); svg.append(path); wrap.append(svg); return wrap;
}

/** Opt-in shared search band. The host retains scope options and query handlers. */
export function workspaceSearchBand(doc, { root, query, filters, sort, reset, onResetSort } = {}) {
  root ||= el(doc, 'div'); root.classList.add('bb-ws-search-band');
  const primary = el(doc, 'div', { className: 'bb-ws-toolbar-primary' });
  const controls = el(doc, 'div', { className: 'bb-ws-toolbar-controls' });
  const search = el(doc, 'span', { className: 'bb-ws-toolbar-query' }); search.append(workspaceActionIcon(doc, 'search'), query);
  const scopeSlot = el(doc, 'span', { className: 'bb-ws-toolbar-scope' });
  const trigger = workspaceButton(doc, { variant: 'quiet', attrs: { 'aria-label': 'フィルター', title: 'フィルター' } });
  trigger.classList.add('bb-ws-toolbar-filter'); trigger.append(workspaceActionIcon(doc, 'filter'));
  const filter = workspaceFilterPopover(doc, { content: filters, trigger, appearance: 'icon',
    onToggle: open => { if (open) sort?.close(false); },
  });
  filter.root.classList.add('bb-ws-toolbar-filter-group'); filter.panel.classList.add('bb-ws-toolbar-filter-panel');
  if (reset) {
    reset.textContent = 'フィルターを解除'; reset.setAttribute('aria-label', 'フィルターを解除');
    const footer = el(doc, 'div', { className: 'bb-ws-menu-reset' }); footer.append(reset); filters.append(footer);
  }
  const closeFilter = () => filter.setOpen(false);
  const clear = () => { closeFilter(); trigger.focus({ preventScroll: true }); };
  const sortClick = () => closeFilter();
  const sortReset = workspaceButton(doc, { text: '初期順に戻す', attrs: { 'aria-label': '並べ替えを初期順に戻す' } });
  const resetSort = () => { sort?.close(false); onResetSort?.(); sort?.trigger.focus({ preventScroll: true }); };
  if (sort) {
    sort.root.classList.add('bb-ws-toolbar-sort'); sort.trigger.classList.add('bb-ws-toolbar-sort-trigger');
    sort.trigger.replaceChildren(workspaceActionIcon(doc, 'sort')); sort.trigger.setAttribute('title', '並べ替え');
    sort.popup.append(sortReset); sortReset.addEventListener('click', resetSort);
    sort.trigger.addEventListener('click', sortClick); sort.trigger.addEventListener('keydown', sortClick);
  }
  controls.append(search, scopeSlot, filter.root); if (sort) controls.append(sort.root); root.replaceChildren(primary, controls);
  reset?.addEventListener('click', clear);
  return { root, primary, scopeSlot, filter,
    setFiltered(active) { toggleWorkspaceClass(filter.root, 'is-filtered', Boolean(active)); trigger.setAttribute('aria-label', active ? 'フィルター（適用中）' : 'フィルター'); },
    setSorted(active) { toggleWorkspaceClass(sort?.root, 'is-sorted', Boolean(active)); sortReset.hidden = !active; },
    destroy() { filter.destroy(); reset?.removeEventListener('click', clear); sortReset.removeEventListener('click', resetSort); sort?.trigger.removeEventListener('click', sortClick); sort?.trigger.removeEventListener('keydown', sortClick); },
  };
}

/** Business-neutral compositions. Labels, values and mutations belong to the host. */

export function workspaceConditionChips(doc, { items = [], reset, resetLabel = '初めの状態に戻す' } = {}) {
  const root = el(doc, 'div', { className: 'bb-ws-condition-chips' });
  for (const { label, onRemove } of items) {
    const chip = el(doc, 'span', { className: 'bb-ws-condition-chip' });
    chip.append(el(doc, 'span', { text: label }));
    const remove = workspaceButton(doc, { attrs: { 'aria-label': `${label}を解除` }, onClick: onRemove });
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M6 6l12 12M18 6L6 18'); svg.append(path); remove.append(svg);
    chip.append(remove); root.append(chip);
  }
  if (reset) {
    const button = workspaceButton(doc, { attrs: { 'aria-label': resetLabel, title: resetLabel }, onClick: reset });
    button.className = 'bb-ws-condition-reset';
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 5v5h5 M4.6 10A8 8 0 1 1 6.3 17.7'); svg.append(path); button.append(svg); root.append(button);
  }
  return root;
}

export function workspacePills(doc, { label, items = [], value, onChange } = {}) {
  const root = el(doc, 'div', { className: 'bb-ws-pills', attrs: { role: 'group', 'aria-label': label } });
  const buttons = items.map(item => {
    const button = workspaceButton(doc, { text: item.label, disabled: Boolean(item.disabled),
      attrs: { 'aria-pressed': String(item.value === value) }, onClick: () => onChange?.(item.value, item) });
    if (item.icon) button.prepend(item.icon);
    root.append(button); return button;
  });
  root.update = next => buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(items[i].value === next)));
  return root;
}

export function workspaceControlRow(doc, { label, control, tight = false } = {}) {
  const root = el(doc, 'div', { className: `bb-ws-control-row${tight ? ' is-tight' : ''}` });
  const slot = el(doc, 'div', { className: 'bb-ws-control-slot' });
  if (control) slot.append(control);
  root.append(el(doc, 'span', { className: 'bb-ws-control-label', text: label }), slot);
  return root;
}

export function workspaceFormRow(doc, { label, control, required = false, top = false, appearance } = {}) {
  const root = el(doc, 'div', { className: `bb-ws-form-row${top ? ' is-top' : ''}${appearance === 'quiet' ? ' is-quiet' : ''}${appearance === 'stacked' ? ' is-stacked' : ''}` });
  const caption = el(doc, control?.id ? 'label' : 'span', { className: 'bb-ws-form-label', text: label,
    attrs: { for: control?.id || undefined } });
  if (required) {
    caption.append(el(doc, 'span', { className: 'bb-ws-form-required', text: '※', attrs: { 'aria-label': '必須' } }));
    control?.setAttribute('aria-required', 'true');
    if (control && ['INPUT', 'TEXTAREA', 'SELECT'].includes(control.tagName)) control.required = true;
  }
  if (control && !control.id && !control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby')) control.setAttribute('aria-label', label);
  root.append(caption); if (control) root.append(control);
  return root;
}

/** Uses the canonical modal, Escape/backdrop/close animation and focus return. */
export function workspaceInputFrame(doc, { title, opener, onClose, beforeClose, tools = [], preview, rows = [], footer = [], showTitle = true } = {}) {
  const drawer = workspaceDetailDrawer(doc, { title, opener, onClose, beforeClose });
  drawer.dialog.classList.add('bb-ws-input-frame');
  if (tools.length) drawer.dialog.classList.add('has-tools');
  drawer.dialog.querySelector('.bb-ws-detail-closebar > button')?.setAttribute('aria-label', '閉じる');
  const top = el(doc, 'div', { className: 'bb-ws-input-top' });
  const toolRow = el(doc, 'div', { className: 'bb-ws-input-tools' }); toolRow.append(...tools);
  const heading = el(doc, 'h2', { text: title }); if (showTitle) top.append(heading); if (preview) top.append(preview);
  const form = el(doc, 'div', { className: 'bb-ws-input-fields' }); form.append(...rows);
  const foot = el(doc, 'div', { className: 'bb-ws-input-footer' }); foot.append(...footer);
  drawer.dialog.querySelector('.bb-ws-detail-closebar').prepend(toolRow);
  drawer.setContent(top, form, foot);
  return { ...drawer, top, tools: toolRow, fields: form, footer: foot,
    setTitle(next) { drawer.setTitle(next); heading.textContent = String(next); },
  };
}

export function workspaceCardRow(doc, { cells = [], stripe, selected = false, key, onSelect, label, preview = false, columnGap, selectionAppearance, appearance } = {}) {
  const root = el(doc, onSelect ? 'button' : 'div', { className: `bb-ws-card-row${selected ? ' is-selected' : ''}${preview ? ' is-preview' : ''}${selectionAppearance === 'soft' ? ' bb-ws-card-row--soft-selected' : ''}${appearance === 'compact-panel' ? ' bb-ws-card-row--compact-panel' : ''}${appearance === 'busy' ? ' bb-ws-card-row--busy' : ''}`,
    attrs: { type: onSelect ? 'button' : undefined, 'data-key': key, 'aria-label': label, 'aria-pressed': onSelect ? String(selected) : undefined } });
  if (stripe) root.style.setProperty('--bb-card-stripe', stripe);
  if (Number.isFinite(columnGap) && columnGap >= 0) root.style?.setProperty('--bb-ws-card-column-gap', `${columnGap}px`);
  for (const cell of cells) {
    const descriptor = cell && typeof cell === 'object' && typeof cell.tagName !== 'string' && ('className' in cell || 'content' in cell) ? cell : null;
    const cellClass = typeof descriptor?.className === 'string' && descriptor.className.trim() ? ` ${descriptor.className.trim()}` : '';
    const slot = el(doc, 'span', { className: `bb-ws-card-cell${cellClass}` });
    if (descriptor) appendContent(slot, doc, descriptor.content);
    else if (cell && typeof cell === 'object' && typeof cell.tagName === 'string') slot.append(cell);
    else slot.textContent = String(cell ?? '');
    root.append(slot);
  }
  if (onSelect) root.addEventListener('click', () => onSelect(key));
  return root;
}

function workspaceCardLength(value, fallback) {
  if (Number.isFinite(value) && value >= 0) return `${value}px`;
  if (typeof value === 'string' && /^(?:\d+(?:\.\d+)?)(?:px|%|rem|em|ch)$/u.test(value.trim())) return value.trim();
  return fallback;
}

/** Skeleton rows use the same caller-provided column grid as card rows. */
export function workspaceCardRowSkeleton(doc, { cells = [], stripe, columnGap } = {}) {
  const root = el(doc, 'div', { className: 'bb-ws-card-row bb-ws-card-row--skeleton', attrs: { 'aria-hidden': 'true', role: 'presentation' } });
  if (stripe) root.style?.setProperty('--bb-card-stripe', stripe);
  if (Number.isFinite(columnGap) && columnGap >= 0) root.style?.setProperty('--bb-ws-card-column-gap', `${columnGap}px`);
  for (const item of cells) {
    const config = typeof item === 'object' && item !== null ? item : { width: item };
    const slot = el(doc, 'span', { className: 'bb-ws-card-cell' });
    const line = el(doc, 'span', { className: 'bb-ws-card-skeleton-line' });
    line.style?.setProperty('--bb-card-skeleton-width', workspaceCardLength(config.width, '100%'));
    const height = workspaceCardLength(config.height, '10px');
    line.style?.setProperty('--bb-card-skeleton-height', height);
    if (parseFloat(height) > 12) line.style?.setProperty('--bb-card-skeleton-radius', '7px');
    slot.append(line); root.append(slot);
  }
  return root;
}

/** FLIP keyed retained or redrawn rows; capture immediately before a host redraw. */
export function workspaceRowMotion(root) {
  let previous = new Map();
  const animations = new Set();
  return {
    capture() { previous = new Map(Array.from(root.querySelectorAll('[data-key]'), node => [node.getAttribute('data-key'), node.getBoundingClientRect().top])); },
    play() {
      for (const animation of animations) animation.cancel(); animations.clear();
      if (root.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { previous.clear(); return; }
      const style = root.ownerDocument.defaultView?.getComputedStyle(root);
      const rawDuration = style?.getPropertyValue('--bb-row-move-duration').trim();
      const amount = parseFloat(rawDuration);
      const duration = Number.isFinite(amount) && amount >= 0 ? amount * (rawDuration.endsWith('ms') ? 1 : 1000) : 320;
      const easing = style?.getPropertyValue('--bb-row-move-ease').trim() || 'cubic-bezier(.2,.8,.2,1)';
      for (const node of root.querySelectorAll('[data-key]')) {
        const old = previous.get(node.getAttribute('data-key'));
        const dy = old === undefined ? 0 : old - node.getBoundingClientRect().top;
        if (!dy || !node.animate) continue;
        const animation = node.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration, easing });
        animations.add(animation); animation.finished?.then(() => animations.delete(animation), () => animations.delete(animation));
      }
      previous.clear();
    },
    destroy() { for (const animation of animations) animation.cancel(); animations.clear(); previous.clear(); },
  };
}
