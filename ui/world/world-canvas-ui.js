/*
 * Canvas-only controls and read-only overlays. The host supplies every business,
 * warning and detail node; this module never fetches, persists or invents data.
 * Coordinates passed to setTaskAnchor are stage-local CSS pixels. An explicit
 * unanchored:true omits the pointer for a real record without a drawable lot.
 */

import { workspaceNotificationCard } from '../../workspace-kit.js';

// Shared so the standard presentation can reuse the same sky artwork and labels
// (RQ-152). The icons are fixed code, never host data.
export const SKY_MODES = Object.freeze([
  { value: 'auto', label: '自動（現在時刻）', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5l3 1.8"/>' },
  { value: 'day', label: '昼', icon: '<circle cx="12" cy="12" r="5" fill="currentColor" fill-opacity=".12"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/><path d="M10 12h.01M14 12h.01m-4 2.5q2 1.6 4 0"/>' },
  { value: 'dusk', label: '夕方', icon: '<path d="M5.5 13a6.5 6.5 0 0 1 13 0" fill="currentColor" fill-opacity=".12"/><path d="M12 2v2M3.5 5.5 5 7m15.5-1.5L19 7M2 13h20M3 17q3-2 6 0t6 0 6 0M6 21q3-2 6 0t6 0"/>' },
  { value: 'night', label: '夜', icon: '<path d="M19.5 15.5A8.5 8.5 0 0 1 8.5 4.5a8.5 8.5 0 1 0 11 11Z" fill="currentColor" fill-opacity=".12"/><path d="m18 3 .7 2.3L21 6l-2.3.7L18 9l-.7-2.3L15 6l2.3-.7ZM22 11h.01"/>' },
]);

/** The sky mode after `mode`, cycling in the listed order. */
export function nextSkyMode(mode) {
  const index = SKY_MODES.findIndex((entry) => entry.value === mode);
  return SKY_MODES[(Math.max(0, index) + 1) % SKY_MODES.length];
}

/** "空：{現在}。次は{次}" — the single sky-control label, used in both presentations. */
export function skyModeLabel(mode) {
  const match = SKY_MODES.find((entry) => entry.value === mode) ?? SKY_MODES[0];
  return `空：${match.label}。次は${nextSkyMode(match.value).label}`;
}

/** The fixed-artwork SVG for a sky mode, as inner HTML for an aria-hidden icon span. */
export function skyModeIconSvg(mode) {
  const match = SKY_MODES.find((entry) => entry.value === mode) ?? SKY_MODES[0];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${match.icon}</svg>`;
}

const CLOSE_DELAY = 220;
let instanceId = 0;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const nodeList = (nodes) => (Array.isArray(nodes) ? nodes : [nodes]).filter((node) => node != null);

/**
 * @param {object} options
 * @param {Document} options.doc
 * @param {HTMLElement} options.stage Positioned canvas container.
 * @param {boolean} [options.reducedMotion]
 * @param {() => void} [options.onReset] Return to the entire world.
 * @param {(code: string) => void} [options.onCity] Enter a known business.
 * @param {(mode: 'auto'|'day'|'dusk'|'night') => void} [options.onSky]
 * @param {() => void} [options.onDismissTask] User dismissed task details.
 * @param {{purpose?: string, knownCityAction?: string, unavailableCity?: string}} [options.context]
 *
 * showRail/showTask/setHelp accept actual DOM nodes, preserving their events and
 * all source details. showRail never opens the drawer; openRail opens it without
 * moving focus (a picked station opens its city's details). showTask does not move
 * focus unless its optional second argument is { focus: true }.
 * addNote shows a quest only for an explicit nonempty summary; its full text
 * remains in help. No summary is inferred from a long or nonurgent notice.
 * A quest with a `link` or an `action` is pressable as a whole row; one without
 * is drawn flat and may say its `reason` (why nothing opens from it).
 */
export function createWorldCanvasUI({
  doc,
  stage,
  reducedMotion = false,
  onReset,
  onCity,
  onSky,
  onDismissTask,
  context = {},
}) {
  const id = `bb-world-canvas-${++instanceId}`;
  const listeners = [];
  let disposed = false;
  let railOpen = false;
  let railHovered = false;
  let railTimer = null;
  let restoringRailFocus = false;
  let taskOpen = false;
  let taskAnchor = null;
  let helpOpen = false;
  let skyMode = 'auto';
  let businesses = new Set();
  let overlayOrder = [];
  let overlayLayer = 10;
  const worldContext = {
    purpose: context.purpose ?? '事業と案件、関連する仕事を地図で確認します。',
    knownCityAction: context.knownCityAction ?? '都市を選ぶと、その事業の区画に入ります。',
    unavailableCity: context.unavailableCity ?? '現在、選べる事業を確認できません。',
  };

  function element(tag, className, text, attrs = {}) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }
  function listen(target, name, handler) {
    target.addEventListener(name, handler);
    listeners.push(() => target.removeEventListener(name, handler));
  }
  function button(className, label, text = label) {
    return element('button', className, text, { type: 'button', 'aria-label': label, title: label });
  }
  function panel(className, label, panelId) {
    const node = element('section', className, null, { id: panelId, 'aria-label': label, 'aria-hidden': 'true' });
    node.inert = true;
    return node;
  }
  function reveal(node, open) {
    node.classList.toggle('is-open', open);
    node.setAttribute('aria-hidden', String(!open));
    node.inert = !open;
  }
  function activate(name, node) {
    overlayOrder = overlayOrder.filter((entry) => entry !== name);
    overlayOrder.push(name);
    node.style.zIndex = String(++overlayLayer);
  }
  function forget(name) {
    overlayOrder = overlayOrder.filter((entry) => entry !== name);
  }
  function focusedWithin(node) { return node.contains(doc.activeElement); }
  function focus(node) { node?.focus?.({ preventScroll: true }); }
  function focusCanvas() {
    const canvas = [...stage.querySelectorAll('canvas')].find((node) => !node.hidden);
    focus(canvas ?? reset);
  }
  function heading(container) { return container.querySelector('h1, h2, h3, [role="heading"]'); }
  function focusContent(container, fallback) {
    const target = heading(container) ?? fallback;
    target.setAttribute('tabindex', '-1');
    focus(target);
  }
  function replaceBody(container, nodes) {
    const previous = focusedWithin(container) ? doc.activeElement : null;
    const scrollTop = container.scrollTop;
    container.replaceChildren(...nodeList(nodes));
    if (previous) {
      // Reuse a retained node, or a unique equivalent control in freshly built
      // source details. Never move focus here when it began outside the panel.
      let target = container.contains(previous) ? previous : null;
      if (!target) {
        const key = ['id', 'href', 'name', 'aria-label'].find((name) => previous.getAttribute(name));
        const candidates = [...container.querySelectorAll('a, button, input, select, textarea, [tabindex], h1, h2, h3, h4')]
          .filter((node) => node.tagName === previous.tagName && !node.disabled
            && (key ? node.getAttribute(key) === previous.getAttribute(key) : node.textContent === previous.textContent));
        if (candidates.length === 1) target = candidates[0];
      }
      if (target) focus(target);
      else focusContent(container, container);
    }
    container.scrollTop = scrollTop;
  }

  const root = element('div', `bb-world-canvas-ui${reducedMotion ? ' is-reduced-motion' : ''}`);
  const toolbar = element('div', 'bb-world-canvas-toolbar', null, { 'aria-label': '世界の表示操作' });
  const reset = button('bb-world-canvas-control bb-world-canvas-reset', '世界全体に戻る', '全体に戻る');
  const city = element('select', 'bb-world-canvas-control bb-world-canvas-city', null, { 'aria-label': '都市を選ぶ' });
  const sky = button('bb-world-canvas-control bb-world-canvas-sky', '空：時刻に合わせる', '');
  const skyIcon = element('span', 'bb-world-canvas-sky-icon', '', { 'aria-hidden': 'true' });
  sky.append(skyIcon);
  toolbar.append(reset, city, sky);
  const contextRoot = element('div', 'bb-world-canvas-context', null, {
    'aria-label': 'この画面で確認できること',
  });
  const contextPurpose = element('p', 'bb-world-canvas-context-purpose', worldContext.purpose, {
    'data-world-context': 'purpose',
  });
  const contextNextAction = element('p', 'bb-world-canvas-context-next-action', worldContext.unavailableCity, {
    'data-world-context': 'next-action',
  });
  contextRoot.append(contextNextAction);
  const quests = element('div', 'bb-world-canvas-quests', null, { 'aria-live': 'polite', 'aria-label': '確認が必要なこと' });

  const edge = button('bb-world-canvas-edge', '都市の詳細を開く', '');
  edge.setAttribute('aria-controls', `${id}-rail`);
  edge.setAttribute('aria-expanded', 'false');
  const rail = panel('bb-world-canvas-drawer', '都市の詳細', `${id}-rail`);
  const railTop = element('div', 'bb-world-canvas-panel-top');
  const railTitle = element('h2', '', '都市の詳細', { tabindex: '-1' });
  const railClose = button('bb-world-canvas-close', '都市の詳細を閉じる', '×');
  const railBody = element('div', 'bb-world-canvas-rail-body');
  railTop.append(railTitle, railClose);
  rail.append(railTop, railBody);

  const task = panel('bb-world-canvas-task', '仕事の詳細', `${id}-task`);
  task.hidden = true;
  const taskTop = element('div', 'bb-world-canvas-panel-top');
  const taskClose = button('bb-world-canvas-close', '仕事の詳細を閉じる', '×');
  const taskBody = element('div', 'bb-world-canvas-task-body', null, { tabindex: '-1' });
  taskTop.append(taskClose);
  task.append(taskTop, taskBody);

  const helpButton = button('bb-world-canvas-help-button', '世界の見方と凡例', '?');
  helpButton.setAttribute('aria-controls', `${id}-help`);
  helpButton.setAttribute('aria-expanded', 'false');
  const help = panel('bb-world-canvas-help', '世界の見方と凡例', `${id}-help`);
  const helpTop = element('div', 'bb-world-canvas-panel-top');
  const helpTitle = element('h2', '', '世界の見方', { tabindex: '-1' });
  const helpClose = button('bb-world-canvas-close', '世界の見方を閉じる', '×');
  helpTop.append(helpTitle, helpClose);
  const helpBody = element('div', 'bb-world-canvas-help-body');
  const helpContent = element('div', 'bb-world-canvas-help-content');
  const notes = element('div', 'bb-world-canvas-notes');
  helpBody.append(helpContent, notes);
  help.append(helpTop, helpBody);
  root.append(toolbar, contextRoot, quests, edge, rail, task, helpButton, help);
  stage.append(root);

  function setCities(items = [], selectedCode = null) {
    if (disposed) return;
    businesses = new Set();
    const placeholder = element('option', '', '都市を選ぶ', { value: '', disabled: 'disabled' });
    placeholder.value = '';
    const options = [placeholder];
    for (const business of items) {
      if (!business?.code || businesses.has(String(business.code))) continue;
      const code = String(business.code);
      businesses.add(code);
      const option = element('option', '', business.name || code, { value: code });
      option.value = code;
      options.push(option);
    }
    city.replaceChildren(...options);
    city.disabled = businesses.size === 0;
    contextRoot.hidden = businesses.size > 0;
    contextNextAction.textContent = businesses.size === 0
      ? worldContext.unavailableCity
      : worldContext.knownCityAction;
    setCity(selectedCode);
  }
  function setCity(code) {
    if (disposed) return;
    city.value = businesses.has(String(code)) ? String(code) : '';
  }
  function setSky(mode) {
    if (disposed) return;
    const match = SKY_MODES.find((entry) => entry.value === mode);
    if (!match) return;
    skyMode = mode;
    // Artwork is fixed code, never host data. Native button activation covers Enter/Space.
    skyIcon.innerHTML = skyModeIconSvg(mode);
    const label = skyModeLabel(mode);
    sky.setAttribute('aria-label', label);
    sky.setAttribute('title', label);
  }
  function cancelRailTimer() {
    if (railTimer != null) clearTimeout(railTimer);
    railTimer = null;
  }
  function openRail() {
    if (disposed) return;
    cancelRailTimer();
    if (railOpen) return;
    railOpen = true;
    reveal(rail, true);
    edge.setAttribute('aria-expanded', 'true');
    activate('rail', rail);
  }
  function closeRail() {
    cancelRailTimer();
    if (!railOpen) return;
    const restoreFocus = focusedWithin(rail);
    railOpen = false;
    railHovered = false;
    reveal(rail, false);
    edge.setAttribute('aria-expanded', 'false');
    forget('rail');
    if (restoreFocus) {
      restoringRailFocus = true;
      focus(edge);
      restoringRailFocus = false;
    }
  }
  function queueRailClose() {
    cancelRailTimer();
    if (disposed || !railOpen) return;
    railTimer = setTimeout(() => {
      railTimer = null;
      if (!railHovered && !focusedWithin(rail) && doc.activeElement !== edge) closeRail();
    }, CLOSE_DELAY);
  }
  function railEnter(event) {
    if (event.pointerType === 'touch') return;
    railHovered = true;
    openRail();
  }
  function railLeave(event) {
    if (edge.contains(event.relatedTarget) || rail.contains(event.relatedTarget)) return;
    railHovered = false;
    queueRailClose();
  }
  function showRail(nodes) {
    if (disposed) return;
    // Retain the complete host-built rail, with its native links and handlers.
    replaceBody(railBody, nodes);
  }

  function positionTask() {
    if (disposed || !taskOpen) return;
    const rect = stage.getBoundingClientRect();
    const width = stage.clientWidth || rect.width;
    const height = stage.clientHeight || rect.height;
    const anchor = taskAnchor;
    const visible = anchor?.visible !== false && Number.isFinite(anchor?.x) && Number.isFinite(anchor?.y)
      && width > 0 && height > 0 && anchor.x >= 0 && anchor.x <= width && anchor.y >= 0 && anchor.y <= height;
    const restoreFocus = !visible && focusedWithin(task);
    task.hidden = !visible;
    reveal(task, visible);
    if (restoreFocus) focusCanvas();
    if (!visible) return;
    const inset = Math.min(10, width / 4, height / 4);
    const panelWidth = Math.min(330, width - inset * 2);
    const toolbarRect = toolbar.getBoundingClientRect();
    const toolbarBottom = toolbarRect.bottom > rect.top ? toolbarRect.bottom - rect.top + 12 : (width <= 460 ? 60 : 68);
    const topLimit = Math.max(inset, Math.min(toolbarBottom, height - inset - 40));
    const maxHeight = Math.max(1, Math.min(370, height - topLimit - inset));
    task.style.width = `${panelWidth}px`;
    task.style.maxHeight = `${maxHeight}px`;
    const panelHeight = Math.min(task.offsetHeight || 220, maxHeight);
    const left = clamp(anchor.x - panelWidth / 2, inset, width - panelWidth - inset);
    const above = anchor.y - panelHeight - 18;
    const below = above < topLimit;
    const top = clamp(below ? anchor.y + 18 : above, topLimit, height - panelHeight - inset);
    task.style.left = `${Math.round(left)}px`;
    task.style.top = `${Math.round(top)}px`;
    task.style.setProperty('--bb-world-task-pointer-x', `${clamp(anchor.x - left, 18, panelWidth - 18)}px`);
    task.classList.toggle('is-below', below);
    task.classList.toggle('is-unanchored', Boolean(anchor.unanchored));
  }
  function showTask(nodes, { focus: shouldFocus = false } = {}) {
    if (disposed) return;
    replaceBody(taskBody, nodes);
    if (!taskOpen) {
      taskOpen = true;
      activate('task', task);
    }
    positionTask();
    if (shouldFocus && !task.hidden) focusContent(taskBody, taskBody);
  }
  function closeTask() {
    if (disposed) return;
    const restoreFocus = focusedWithin(task);
    taskOpen = false;
    task.hidden = true;
    reveal(task, false);
    forget('task');
    if (restoreFocus) focusCanvas();
  }
  function dismissTask() {
    closeTask();
    onDismissTask?.();
  }
  function setTaskAnchor(anchor) {
    if (disposed) return;
    taskAnchor = anchor;
    positionTask();
  }
  function closeHelp() {
    if (!helpOpen) return;
    const shouldRestore = focusedWithin(help);
    helpOpen = false;
    reveal(help, false);
    helpButton.setAttribute('aria-expanded', 'false');
    forget('help');
    if (shouldRestore) focus(helpButton);
  }
  function toggleHelp() {
    if (helpOpen) return closeHelp();
    helpOpen = true;
    reveal(help, true);
    helpButton.setAttribute('aria-expanded', 'true');
    activate('help', help);
    focus(helpTitle);
  }
  function addNote({ label = '', text = '', tone = '', summary, link = null, action = null, reason = null } = {}) {
    if (disposed) return;
    const note = element('section', 'bb-world-canvas-note');
    if (label) note.append(element('h3', '', label));
    if (text || summary) note.append(element('p', '', text || summary));
    if (label || text || summary) notes.append(note);
    if (typeof summary !== 'string' || !summary.trim()) return;
    // A quest is a way down (a link already checked by the caller, or an action in this page) and then the
    // whole row is pressable; without one it is drawn flat, so it never looks pressable (story-world-clickable-honesty-v1).
    const way = link?.href ? 'link' : typeof action?.onClick === 'function' ? 'action' : null;
    const quest = workspaceNotificationCard(doc, { tag: 'p', tone, className: `bb-world-canvas-quest ${way ? 'has-way' : 'is-static'}` });
    const icon = ['attention', 'warning', 'danger'].includes(tone) ? '!' : 'i';
    quest.append(
      element('span', 'bb-world-canvas-quest-symbol bb-ws-notification-symbol', icon, { 'aria-hidden': 'true' }),
      element('span', 'bb-world-canvas-quest-text', summary.trim()),
    );
    // The accessible name contains the unabridged summary even when visual text
    // is ellipsized on a narrow canvas; the long explanation remains in help.
    quest.setAttribute('aria-label', summary.trim());
    if (way === 'link') {
      quest.append(element('a', link.className ?? '', link.label ?? summary.trim(), { href: link.href }));
    } else if (way === 'action') {
      const press = element('button', `bb-world-canvas-quest-action ${action.className ?? ''}`.trim(), action.label ?? summary.trim(), { type: 'button' });
      listen(press, 'click', () => action.onClick());
      quest.append(press);
    } else if (typeof reason === 'string' && reason.trim()) {
      // Why nothing opens from here (未接続 and the like), said in the row instead of only in help.
      quest.append(element('span', 'bb-world-canvas-quest-reason', reason.trim()));
    }
    quests.append(quest);
  }
  function clearNotes() {
    if (disposed) return;
    quests.replaceChildren();
    notes.replaceChildren();
  }
  function dismissOverlay() {
    if (disposed) return false;
    // A selected task outside the camera is not a visible overlay to dismiss.
    const name = [...overlayOrder].reverse().find((entry) => entry !== 'task' || !task.hidden);
    if (!name) return false;
    if (name === 'help') closeHelp();
    else if (name === 'rail') closeRail();
    else if (name === 'task') dismissTask();
    return true;
  }

  listen(reset, 'click', () => {
    closeHelp();
    closeRail();
    closeTask();
    onReset?.();
  });
  listen(city, 'change', () => { if (businesses.has(city.value)) onCity?.(city.value); });
  listen(sky, 'click', () => {
    const next = nextSkyMode(skyMode);
    setSky(next.value);
    onSky?.(next.value);
  });
  for (const target of [edge, rail]) {
    listen(target, 'pointerenter', railEnter);
    listen(target, 'pointerleave', railLeave);
    listen(target, 'focusout', (event) => {
      if (!rail.contains(event.relatedTarget) && event.relatedTarget !== edge) queueRailClose();
    });
  }
  listen(edge, 'focus', () => { if (!restoringRailFocus) openRail(); });
  listen(edge, 'click', () => { openRail(); focusContent(railBody, railTitle); });
  listen(rail, 'focusin', cancelRailTimer);
  listen(railClose, 'click', closeRail);
  listen(taskClose, 'click', dismissTask);
  listen(helpButton, 'click', toggleHelp);
  listen(helpClose, 'click', closeHelp);
  listen(root, 'keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && dismissOverlay()) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  // Pointer activity in an overlay must never start the canvas's orbit/picking
  // gesture. Wheel scrolling stays native inside long details.
  for (const name of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel']) {
    listen(root, name, (event) => event.stopPropagation());
  }
  const view = doc.defaultView;
  if (view?.addEventListener) listen(view, 'resize', positionTask);
  const Observer = view?.ResizeObserver ?? globalThis.ResizeObserver;
  const observer = Observer ? new Observer(positionTask) : null;
  observer?.observe(stage);
  observer?.observe(taskBody);
  setCities([]);
  setSky(skyMode);

  return {
    setCities, setCity, setSky, showRail, openRail, showTask, closeTask, setTaskAnchor,
    setHelp(nodes) { if (!disposed) helpContent.replaceChildren(contextPurpose, element('p', '', worldContext.knownCityAction), ...nodeList(nodes)); },
    addNote, clearNotes, dismissOverlay,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelRailTimer();
      observer?.disconnect();
      for (const remove of listeners) remove();
      overlayOrder = [];
      root.remove();
    },
  };
}
