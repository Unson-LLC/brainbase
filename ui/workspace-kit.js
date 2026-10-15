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


let workspaceSequence = 0;
/** Shared explanatory help: hover/focus above the control, click for touch. */
export function workspaceHelp(doc, { text, label } = {}) {
  const wrap = el(doc, 'span', { className: 'bb-ws-help' });
  const control = workspaceButton(doc, { text: 'i', attrs: { 'aria-label': `${label}の説明`, 'aria-expanded': 'false' } });
  control.className = 'bb-ws-help-button';
  const bubble = el(doc, 'span', { className: 'bb-ws-help-bubble', text, attrs: { id: `bb-ws-help-${++workspaceSequence}`, role: 'tooltip' } });
  control.setAttribute('aria-describedby', bubble.id || bubble.getAttribute?.('id') || bubble.attributes?.id);
  control.addEventListener('click', event => {
    event.stopPropagation(); event.preventDefault();
    const opened = wrap.classList.toggle('is-open');
    wrap.classList.remove('is-dismissed');
    control.setAttribute('aria-expanded', String(opened));
  });
  wrap.addEventListener('mouseleave', () => wrap.classList.remove('is-dismissed'));
  control.addEventListener('blur', () => { wrap.classList.remove('is-open', 'is-dismissed'); control.setAttribute('aria-expanded', 'false'); });
  control.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    wrap.classList.remove('is-open'); wrap.classList.add('is-dismissed');
    control.setAttribute('aria-expanded', 'false'); event.stopPropagation();
  });
  wrap.append(control, bubble); return wrap;
}

const drawerClosings = new WeakMap();
const notificationClosings = new WeakMap();
const reducedMotion = node => node.ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

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
    if (event.target === dialog && event.animationName === 'bb-ws-drawer-out') complete();
  };
  drawerClosings.set(dialog, cancel);
  dialog.addEventListener('animationend', ended);
  dialog.addEventListener('close', cancel);
  dialog.classList.add('is-closing');
  timer = setTimeout(complete, 360); // Animation cancellation / background-tab fallback.
  return cancel;
}

/** Native modal, optionally a right drawer. close() animates; dispose() tears down immediately. */
export function workspaceDialog(doc, { title, content, opener, presentation = 'center', onClose } = {}) {
  const dialog = el(doc, 'dialog', { className: 'bb-ws-dialog' });
  if (presentation === 'drawer') workspaceApplyDrawer(dialog);
  const headingId = `bb-ws-dialog-${++workspaceSequence}`;
  dialog.setAttribute('aria-labelledby', headingId);
  const head = el(doc, 'header', { className: 'bb-ws-dialog-head' });
  const nativeClose = dialog.close.bind(dialog);
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
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
  head.append(el(doc, 'h2', { text: title, attrs: { id: headingId } }), close);
  const body = el(doc, 'div', { className: 'bb-ws-dialog-body' }); appendContent(body, doc, content);
  dialog.append(head, body); doc.body.append(dialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', cleanup, { once: true });
  try { dialog.showModal(); close.focus(); } catch (error) { cleanup(); throw error; }
  return dialog;
}

/** Anchored advanced search. Hosts destroy it before replacing its controls. */
export function workspaceFilterPopover(doc, { content, open = false, onToggle, trigger, panel: suppliedPanel, initialFocus } = {}) {
  const root = el(doc, 'span', { className: 'bb-ws-filter-anchor' });
  const panel = suppliedPanel || el(doc, 'div', { className: 'bb-ws-filter-popover', attrs: { id: `bb-ws-filter-${++workspaceSequence}`, role: 'region', 'aria-label': '詳細検索' } });
  if (!panel.id && !panel.getAttribute?.('id')) panel.setAttribute('id', `bb-ws-filter-${++workspaceSequence}`);
  panel.classList?.add('bb-ws-filter-popover');
  const control = trigger || workspaceButton(doc, { text: '詳細検索', variant: 'quiet' });
  control.setAttribute('aria-controls', panel.id || panel.getAttribute?.('id') || panel.attributes?.id);
  appendContent(panel, doc, content); root.append(control, panel);
  let destroyed = false;
  const removeListeners = () => { doc.removeEventListener?.('pointerdown', outside); doc.removeEventListener?.('keydown', escape); };
  const setOpen = (value, focus = false) => {
    if (destroyed) return;
    removeListeners(); panel.hidden = !value; control.setAttribute('aria-expanded', String(value));
    onToggle?.(value);
    if (value) {
      doc.addEventListener?.('pointerdown', outside); doc.addEventListener?.('keydown', escape);
      if (focus) (typeof initialFocus === 'function' ? initialFocus() : initialFocus || panel.querySelector?.('input:not(:disabled),select:not(:disabled),button:not(:disabled)'))?.focus();
    }
  };
  const outside = event => { if (!root.contains?.(event.target)) setOpen(false); };
  const escape = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation(); setOpen(false); control.focus();
  };
  const toggle = () => setOpen(panel.hidden, true);
  control.addEventListener('click', toggle); setOpen(open);
  return { root, control, panel, destroy() {
    destroyed = true; removeListeners(); control.removeEventListener?.('click', toggle);
    panel.hidden = true; control.setAttribute('aria-expanded', 'false');
  } };
}

/** Compact notification with a fixed-center, purely visual spinner. */
export function workspaceLoadingCard(doc, { title = 'ロード中' } = {}) {
  const card = el(doc, 'section', { className: 'bb-ws-error-card bb-ws-loading-card', attrs: { role: 'status', 'aria-live': 'polite' } });
  card.append(el(doc, 'span', { className: 'bb-ws-loading-spinner', attrs: { 'aria-hidden': 'true' } }), el(doc, 'span', { text: title }));
  return card;
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
  card.classList.add('is-dismissing'); timer = setTimeout(complete, 500);
  return cancel;
}

/** Persistent, initially closed notification. The caller owns its lifecycle. */
export function workspaceErrorCard(doc, { title, message, tone = 'danger', onRetry } = {}) {
  const card = el(doc, 'section', { className: `bb-ws-error-card is-${tone}`, attrs: { role: 'listitem' } });
  const details = el(doc, 'details');
  const summary = el(doc, 'summary', { attrs: { 'aria-label': `${title}の通知` } });
  summary.append(el(doc, 'span', { className: 'bb-ws-error-symbol', text: '!', attrs: { 'aria-hidden': 'true' } }), el(doc, 'span', { text: title }));
  details.append(summary, el(doc, 'p', { text: message })); card.append(details);
  if (onRetry) card.append(workspaceButton(doc, { text: '再試行', attrs: { 'aria-label': `${title}を再試行` }, onClick: onRetry }));
  return card;
}

export function workspaceDisclosure(doc, { title, help, content, open = false, onToggle } = {}) {
  const details = el(doc, 'details', { className: 'bb-ws-disclosure' }); details.open = open;
  const summary = el(doc, 'summary');
  summary.append(el(doc, 'h2', { text: title }));
  if (help) summary.append(workspaceHelp(doc, { label: title, text: help }));
  details.append(summary, content);
  if (onToggle) details.addEventListener('toggle', () => onToggle(details.open));
  return details;
}
