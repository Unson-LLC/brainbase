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

/** A shared, title-only top bar. The host owns scrolling and immersive-page visibility. */
export function workspaceTopbar(doc, { title = '' } = {}) {
  const header = el(doc, 'header', { className: 'bb-ws-topbar' });
  header.append(el(doc, 'h1', { text: title }));
  return header;
}

/** A reusable right inspector whose content can refresh without replacing the modal. */
export function workspaceDetailDrawer(doc, { title = '詳細', opener, onClose } = {}) {
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
    // Clear the caller's open state before an asynchronous content update arrives.
    if (cancelClosing && !immediate) return;
    if (!cancelClosing) onClose?.();
    if (immediate) finish(restoreFocus);
    else cancelClosing = workspaceCloseDrawer(dialog, () => finish(restoreFocus));
  };
  const button = workspaceButton(doc, { text: '閉じる', onClick: () => close() });
  head.append(label, button); dialog.append(head, body); doc.body.append(dialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
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
// Capability-isolated modules coexist with an older kit in the same document.
const workspaceIdScope = new URL(import.meta.url).searchParams.get('capability') ?? '';
function nextWorkspaceSequence() {
  const next = ++workspaceSequence;
  return workspaceIdScope ? `${encodeURIComponent(workspaceIdScope)}-${next}` : next;
}
/** Shared explanatory help: hover/focus above the control, click for touch. */
export function workspaceHelp(doc, { text, label } = {}) {
  const wrap = el(doc, 'span', { className: 'bb-ws-help' });
  const control = workspaceButton(doc, { text: 'i', attrs: { 'aria-label': `${label}の説明`, 'aria-expanded': 'false' } });
  control.className = 'bb-ws-help-button';
  const bubble = el(doc, 'span', { className: 'bb-ws-help-bubble', text, attrs: { id: `bb-ws-help-${nextWorkspaceSequence()}`, role: 'tooltip' } });
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
    if (event.target === dialog && event.animationName === 'bb-ws-drawer-out') complete();
  };
  drawerClosings.set(dialog, cancel);
  dialog.addEventListener('animationend', ended);
  dialog.addEventListener('close', cancel);
  dialog.classList.add('is-closing');
  timer = setTimeout(complete, animationFallback(dialog, 70, 220)); // Animation cancellation / background-tab fallback.
  return cancel;
}

/** Native modal, optionally a right drawer. close() animates; dispose() tears down immediately. */
export function workspaceDialog(doc, { title, content, opener, presentation = 'center', onClose } = {}) {
  const dialog = el(doc, 'dialog', { className: 'bb-ws-dialog' });
  if (presentation === 'drawer') workspaceApplyDrawer(dialog);
  const headingId = `bb-ws-dialog-${nextWorkspaceSequence()}`;
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
  const panel = suppliedPanel || el(doc, 'div', { className: 'bb-ws-filter-popover', attrs: { id: `bb-ws-filter-${nextWorkspaceSequence()}`, role: 'region', 'aria-label': '詳細検索' } });
  if (!panel.id && !panel.getAttribute?.('id')) panel.setAttribute('id', `bb-ws-filter-${nextWorkspaceSequence()}`);
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

export function workspaceDisclosure(doc, { title, help, content, open = false, onToggle } = {}) {
  const details = el(doc, 'details', { className: 'bb-ws-disclosure' }); details.open = open;
  const summary = el(doc, 'summary');
  summary.append(el(doc, 'h2', { text: title }));
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
  emptyText = '一致する候補はありません', limit = 100, searchable = 'auto', className, onChange,
  multiple = false, values = [], renderIcon, showCount = true, showHints = true, align = 'start',
} = {}) {
  const sequence = nextWorkspaceSequence();
  const listId = `bb-ws-combobox-${sequence}-list`;
  const root = el(doc, 'span', { className: ['bb-ws-combobox', className].filter(Boolean).join(' ') });
  if (multiple) root.classList?.add('bb-ws-combobox-multiple');
  if (align === 'end') root.classList?.add('bb-ws-combobox-align-end');
  const trigger = el(doc, 'button', { className: 'bb-ws-combobox-trigger', attrs: { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': listId } });
  const triggerText = el(doc, 'span', { className: 'bb-ws-combobox-value' });
  trigger.append(triggerText, workspaceDropdownChevron(doc));
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

  const state = { options: [], values: [...new Set((Array.isArray(values) ? values : []).map(String))].filter(Boolean), value: String(value ?? ''), query: '', active: -1, shown: [], open: false, disabled: false };
  const usesSearch = () => searchable === true || (searchable === 'auto' && state.options.length > 8);
  const focusTarget = () => (usesSearch() ? search : list);
  const chosen = () => state.options.find(option => option.value === state.value);

  function setOptions(next) {
    state.options = (Array.isArray(next) ? next : []).map(option => ({
      ...option, value: String(option?.value ?? ''), label: String(option?.label ?? option?.value ?? ''),
      hint: option?.hint ? String(option.hint) : '', keywords: option?.keywords ? String(option.keywords) : '',
    }));
  }

  function renderTrigger() {
    const option = multiple ? (state.values.length === 1 ? state.options.find(option => option.value === state.values[0]) : state.options.find(option => !option.value)) : chosen();
    const summary = multiple && state.values.length > 1 ? `${state.values.length}件選択中` : null;
    const text = summary || (option ? option.label : multiple ? state.values.join('、') || placeholder : state.value || placeholder);
    triggerText.textContent = text;
    if (!summary && option && typeof renderIcon === 'function') {
      const icon = renderIcon(option);
      if (icon) { triggerText.textContent = ''; triggerText.append(icon, el(doc, 'span', { className: 'bb-ws-combobox-text', text })); }
    }
    toggleWorkspaceClass(root, 'is-multi-selected', Boolean(summary));
    trigger.setAttribute('aria-label', `${label ? `${label}: ` : ''}${text}`);
    trigger.setAttribute('data-empty', String(multiple ? !state.values.length : !option && !state.value));
    if (state.disabled) trigger.setAttribute('disabled', ''); else trigger.removeAttribute('disabled');
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
      ? state.options.filter(option => { const text = comboboxText(`${option.label}\n${option.hint}\n${option.keywords}`); return terms.every(term => text.includes(term)); })
      : state.options;
    const max = Math.max(1, Number(limit) || 100);
    state.shown = matches.slice(0, max);
    if (state.active >= state.shown.length) state.active = state.shown.length - 1;
    list.replaceChildren();
    state.shown.forEach((option, index) => {
      const selected = multiple ? option.value ? state.values.includes(option.value) : state.values.length === 0 : option.value === state.value;
      const item = el(doc, 'li', { className: `bb-ws-combobox-option${index === state.active ? ' is-active' : ''}`, attrs: { id: `bb-ws-combobox-${sequence}-option-${index}`, role: 'option', 'aria-selected': String(selected), 'data-value': option.value } });
      const optionLabel = el(doc, 'span', { className: 'bb-ws-combobox-option-label', text: option.label });
      if (typeof renderIcon === 'function') { const icon = renderIcon(option); if (icon) { optionLabel.textContent = ''; optionLabel.append(icon, el(doc, 'span', { className: 'bb-ws-combobox-text', text: option.label })); } }
      item.append(optionLabel);
      if (showHints && option.hint) item.append(el(doc, 'span', { className: 'bb-ws-combobox-option-hint', text: option.hint }));
      item.addEventListener('pointerdown', event => event.preventDefault?.());
      item.addEventListener('click', () => choose(option));
      list.append(item);
    });
    const active = list.children?.[state.active];
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
  }

  function move(index) {
    if (!state.shown.length) return;
    state.active = Math.min(state.shown.length - 1, Math.max(0, index));
    renderList({ reveal: true });
  }

  function removeListeners() { doc.removeEventListener?.('pointerdown', outside); }
  function outside(event) { if (!root.contains?.(event.target)) close(false); }

  function open(query = '') {
    if (state.disabled) return;
    if (!state.open) { state.open = true; doc.addEventListener?.('pointerdown', outside); }
    state.query = query; search.value = query; search.hidden = !usesSearch();
    const selectedIndex = state.options.findIndex(option => multiple ? state.values.includes(option.value) : option.value === state.value);
    state.active = query ? 0 : Math.max(0, selectedIndex);
    popup.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    renderList({ reveal: true });
    focusTarget().focus?.({ preventScroll: true });
  }

  function close(returnFocus = true) {
    if (!state.open) return;
    state.open = false; removeListeners();
    popup.hidden = true; trigger.setAttribute('aria-expanded', 'false'); activeDescendant(null);
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
    if (event.key === 'Tab') { close(false); return; }
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
    update({ options: nextOptions, value: nextValue, values: nextValues, disabled } = {}) {
      const previous = JSON.stringify([state.options, state.value, state.values, state.disabled]);
      if (nextOptions !== undefined) setOptions(nextOptions);
      if (nextValue !== undefined) state.value = String(nextValue ?? '');
      if (nextValues !== undefined) state.values = [...new Set((Array.isArray(nextValues) ? nextValues : []).map(String))].filter(Boolean);
      if (disabled !== undefined) { state.disabled = Boolean(disabled); if (state.disabled) close(false); }
      if (previous === JSON.stringify([state.options, state.value, state.values, state.disabled])) return;
      renderTrigger();
      if (state.open) { search.hidden = !usesSearch(); renderList(); }
    },
    destroy() { close(false); removeListeners(); },
  };
}

/** Small shared icons for list actions. No icon font or host sprite is required. */
export function workspaceActionIcon(doc, name) {
  const svg = typeof doc.createElementNS === 'function' ? doc.createElementNS('http://www.w3.org/2000/svg', 'svg') : doc.createElement('svg');
  for (const [key, value] of Object.entries({ class: 'bb-ws-action-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const path = typeof doc.createElementNS === 'function' ? doc.createElementNS('http://www.w3.org/2000/svg', 'path') : doc.createElement('path');
  const paths = { plus: 'M12 5v14M5 12h14', search: 'M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0', filter: 'M4 7h16M7 12h10M10 17h4', sort: 'M8 4v16m-3-3 3 3 3-3M16 20V4m-3 3 3-3 3 3' };
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
  const closeFilter = () => { if (!filter.panel.hidden) filterButton.click(); };
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
export function workspaceTabStrip(root, { memoryKey } = {}) {
  workspaceTabList(root);
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
  const filter = workspaceFilterPopover(doc, { content: filters, trigger,
    onToggle: open => { if (open) sort?.close(false); },
  });
  filter.root.classList.add('bb-ws-toolbar-filter-group'); filter.panel.classList.add('bb-ws-toolbar-filter-panel');
  if (reset) {
    reset.textContent = 'フィルターを解除'; reset.setAttribute('aria-label', 'フィルターを解除');
    const footer = el(doc, 'div', { className: 'bb-ws-menu-reset' }); footer.append(reset); filters.append(footer);
  }
  const closeFilter = () => { if (!filter.panel.hidden) trigger.click(); };
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
