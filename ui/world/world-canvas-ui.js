/*
 * Canvas-only controls and read-only overlays. The host supplies every business,
 * warning and detail node; this module never fetches, persists or invents data.
 * Coordinates passed to setTaskAnchor are stage-local CSS pixels. An explicit
 * unanchored:true omits the pointer for a real record without a drawable lot.
 */

const SKY_MODES = Object.freeze([
  { value: 'auto', label: '時刻に合わせる', icon: '◷' },
  { value: 'day', label: '昼', icon: '☀' },
  { value: 'dusk', label: '夕方', icon: '◒' },
  { value: 'night', label: '夜', icon: '☾' },
]);
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
 *
 * showRail/showTask/setHelp accept actual DOM nodes, preserving their events and
 * all source details. showRail never opens the drawer; openRail opens it without
 * moving focus (a picked station opens its city's details). showTask does not move
 * focus unless its optional second argument is { focus: true }.
 * addNote shows a quest only for an explicit nonempty summary; its full text
 * remains in help. No summary is inferred from a long or nonurgent notice.
 */
export function createWorldCanvasUI({ doc, stage, reducedMotion = false, onReset, onCity, onSky, onDismissTask }) {
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
  let skyOpen = false;
  let skyMode = 'auto';
  let businesses = new Set();
  let overlayOrder = [];
  let overlayLayer = 10;

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
  sky.setAttribute('aria-haspopup', 'menu');
  sky.setAttribute('aria-expanded', 'false');
  sky.setAttribute('aria-controls', `${id}-sky`);
  const skyIcon = element('span', 'bb-world-canvas-sky-icon', SKY_MODES[0].icon, { 'aria-hidden': 'true' });
  sky.append(skyIcon);
  toolbar.append(reset, city, sky);
  const skyMenu = element('div', 'bb-world-canvas-sky-menu', null, { id: `${id}-sky`, role: 'menu', 'aria-label': '空の時間帯' });
  skyMenu.hidden = true;
  const skyOptions = SKY_MODES.map((mode) => {
    const option = button('bb-world-canvas-sky-option', mode.label);
    option.setAttribute('role', 'menuitemradio');
    option.setAttribute('aria-checked', String(mode.value === skyMode));
    option.setAttribute('tabindex', '-1');
    listen(option, 'click', () => {
      setSky(mode.value);
      closeSky(true);
      onSky?.(mode.value);
    });
    skyMenu.append(option);
    return option;
  });
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
  root.append(toolbar, skyMenu, quests, edge, rail, task, helpButton, help);
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
    skyIcon.textContent = match.icon;
    sky.setAttribute('aria-label', `空：${match.label}`);
    sky.setAttribute('title', `空：${match.label}`);
    skyOptions.forEach((option, index) => option.setAttribute('aria-checked', String(SKY_MODES[index].value === mode)));
  }
  function openSky() {
    if (disposed) return;
    skyOpen = true;
    skyMenu.hidden = false;
    sky.setAttribute('aria-expanded', 'true');
    activate('sky', skyMenu);
    focus(skyOptions[SKY_MODES.findIndex((entry) => entry.value === skyMode)]);
  }
  function closeSky(restoreFocus = false) {
    if (!skyOpen) return;
    const shouldRestore = restoreFocus && focusedWithin(skyMenu);
    skyOpen = false;
    skyMenu.hidden = true;
    sky.setAttribute('aria-expanded', 'false');
    forget('sky');
    if (shouldRestore) focus(sky);
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
  function addNote({ label = '', text = '', tone = '', summary } = {}) {
    if (disposed) return;
    const note = element('section', 'bb-world-canvas-note');
    if (label) note.append(element('h3', '', label));
    if (text || summary) note.append(element('p', '', text || summary));
    if (label || text || summary) notes.append(note);
    if (typeof summary !== 'string' || !summary.trim()) return;
    const quest = element('p', 'bb-world-canvas-quest');
    const icon = tone === 'attention' || tone === 'warning' ? '!' : 'i';
    quest.append(
      element('span', 'bb-world-canvas-quest-symbol', icon, { 'aria-hidden': 'true' }),
      element('span', 'bb-world-canvas-quest-text', summary.trim()),
    );
    // The accessible name contains the unabridged summary even when visual text
    // is ellipsized on a narrow canvas; the long explanation remains in help.
    quest.setAttribute('aria-label', summary.trim());
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
    if (name === 'sky') closeSky(true);
    else if (name === 'help') closeHelp();
    else if (name === 'rail') closeRail();
    else if (name === 'task') dismissTask();
    return true;
  }

  listen(reset, 'click', () => {
    closeSky();
    closeHelp();
    closeRail();
    closeTask();
    onReset?.();
  });
  listen(city, 'change', () => { if (businesses.has(city.value)) onCity?.(city.value); });
  listen(sky, 'click', () => { if (skyOpen) closeSky(); else openSky(); });
  listen(sky, 'keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openSky(); }
  });
  listen(skyMenu, 'keydown', (event) => {
    let index = skyOptions.indexOf(doc.activeElement);
    if (event.key === 'ArrowDown') index = (index + 1) % skyOptions.length;
    else if (event.key === 'ArrowUp') index = (index - 1 + skyOptions.length) % skyOptions.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = skyOptions.length - 1;
    else if (event.key === 'Tab') { closeSky(true); return; }
    else return;
    event.preventDefault();
    focus(skyOptions[index]);
  });
  listen(skyMenu, 'focusout', (event) => {
    if (!skyMenu.contains(event.relatedTarget) && event.relatedTarget !== sky) closeSky();
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

  return {
    setCities, setCity, setSky, showRail, openRail, showTask, closeTask, setTaskAnchor,
    setHelp(nodes) { if (!disposed) helpContent.replaceChildren(...nodeList(nodes)); },
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
