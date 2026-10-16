/*
 * Area navigation shared by OSS Personal and the organization edition
 * (brainbase-project ledger D10, stage 2).
 *
 * The left side lists only the areas; the screens of the current area are tabs
 * above the page.  An area link opens the screen last used in that area, which
 * is remembered in the viewer's browser only (a display preference, not a fact
 * of the organization).  Every area link and tab is a link to a screen, so
 * screen addresses never change.  The part draws links only: showing and
 * loading screens stays with the caller (`show` in, `onSelect` out).
 */

export const AREA_NAV_CONTRACT_VERSION = 'brainbase.area-nav.v1';
export const AREA_NAV_MEMORY_KEY = 'brainbase.area-nav.last-screen.v1';

function makeElement(doc, tag, { className, text, attrs = {} } = {}) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  return element;
}

/**
 * The last screen per area, kept in the given storage (for example the
 * browser's localStorage).  A storage that is missing, full or blocked behaves
 * as if nothing was remembered.
 */
export function createAreaMemory(storage, key = AREA_NAV_MEMORY_KEY) {
  const read = () => {
    try {
      const raw = storage?.getItem?.(key);
      const value = raw ? JSON.parse(raw) : null;
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  };
  return Object.freeze({
    get(areaId) {
      const value = read()[areaId];
      return typeof value === 'string' ? value : null;
    },
    set(areaId, screenId) {
      try {
        storage?.setItem?.(key, JSON.stringify({ ...read(), [areaId]: screenId }));
      } catch {
        // Not remembered; the area opens its default screen next time.
      }
    },
  });
}

/** The browser's localStorage when it can be reached, otherwise null. */
export function browserAreaStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The screen an area link opens: the remembered screen if it is still shown
 * there, else the area's default, else its first shown screen.  External links
 * (opened in another tab) are never a target.
 */
export function resolveAreaTarget(area, { remembered = null, isShown = () => true } = {}) {
  const candidates = area.screens.filter((screen) => !screen.external && isShown(screen.id)).map((screen) => screen.id);
  if (remembered && candidates.includes(remembered)) return remembered;
  if (area.defaultScreen && candidates.includes(area.defaultScreen)) return area.defaultScreen;
  return candidates[0] ?? null;
}

/**
 * @param {object} options
 * @param {Document} options.document
 * @param {Array<{id: string, label: string|null, defaultScreen?: string, screenIds: string[]}>} options.areas
 *   In menu order. A null label takes the label of the area's only screen.
 * @param {Array<{id: string, label: string, href?: string, external?: boolean, hidden?: boolean}>} options.screens
 * @param {{get(areaId: string): string|null, set(areaId: string, screenId: string): void}} [options.memory]
 * @param {(screenId: string) => string} [options.hrefFor] Address of a screen (default `#<id>`).
 * @param {(screenId: string, event: Event) => void} [options.onSelect]
 * @param {(area: object) => Node|null} [options.iconFor] Icon in front of an area link.
 * @param {string} [options.linkClassName] Extra class for the area links (the host's look).
 */
export function createAreaNav({
  document: doc,
  areas: areaInput,
  screens: screenInput,
  memory = createAreaMemory(null),
  hrefFor = (screenId) => `#${screenId}`,
  onSelect,
  iconFor,
  linkClassName = '',
  label = '画面',
} = {}) {
  if (!doc || typeof doc.createElement !== 'function') throw new Error('document_unavailable');
  const screens = new Map((screenInput ?? []).map((screen) => [screen.id, {
    id: screen.id,
    label: screen.label,
    href: screen.href ?? null,
    external: screen.external === true,
    hidden: screen.hidden === true,
    count: null,
    waiting: false,
  }]));
  const areas = (areaInput ?? []).map((area) => ({
    id: area.id,
    label: area.label ?? null,
    defaultScreen: area.defaultScreen ?? null,
    screens: area.screenIds.map((id) => screens.get(id)).filter(Boolean),
  })).filter((area) => area.screens.length > 0);
  const areaByScreen = new Map();
  for (const area of areas) for (const screen of area.screens) areaByScreen.set(screen.id, area);

  let activeScreenId = null;
  const isShown = (screenId) => screens.get(screenId)?.hidden === false;
  const shownScreens = (area) => area.screens.filter((screen) => isShown(screen.id));
  const targetFor = (areaId) => {
    const area = areas.find((candidate) => candidate.id === areaId);
    return area ? resolveAreaTarget(area, { remembered: memory.get(area.id), isShown }) : null;
  };
  const screenHref = (screen) => screen.href ?? hrefFor(screen.id);
  const areaLabel = (area) => area.label ?? area.screens[0].label;

  const countBadge = (count, ariaLabel) => makeElement(doc, 'span', {
    className: 'bb-area-count',
    text: count,
    attrs: { 'aria-label': ariaLabel },
  });

  const nav = makeElement(doc, 'nav', { className: 'bb-area-nav', attrs: { 'aria-label': label, 'data-contract-version': AREA_NAV_CONTRACT_VERSION } });
  const tabs = makeElement(doc, 'nav', { className: 'bb-area-tabs' });
  tabs.hidden = true;
  const areaLinks = new Map();

  for (const area of areas) {
    const link = makeElement(doc, 'a', {
      className: ['bb-area-link', linkClassName].filter(Boolean).join(' '),
      attrs: { 'data-area': area.id },
    });
    link.addEventListener('click', (event) => {
      const target = targetFor(area.id);
      if (target) onSelect?.(target, event);
    });
    areaLinks.set(area.id, link);
    nav.append(link);
  }

  function renderAreaLink(area) {
    const link = areaLinks.get(area.id);
    const shown = shownScreens(area);
    link.hidden = !shown.some((screen) => !screen.external);
    const target = targetFor(area.id);
    if (target) link.setAttribute('href', screenHref(screens.get(target)));
    else link.removeAttribute('href');
    if (areaByScreen.get(activeScreenId) === area) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    const waiting = shown.reduce((sum, screen) => sum + (screen.waiting && Number.isInteger(screen.count) ? screen.count : 0), 0);
    const icon = iconFor?.(area) ?? null;
    link.replaceChildren(...[
      icon,
      makeElement(doc, 'span', { className: 'bb-area-link-label', text: areaLabel(area) }),
      waiting > 0 ? countBadge(waiting, `待っているもの${waiting}件`) : null,
    ].filter(Boolean));
  }

  function renderTabs() {
    const area = areaByScreen.get(activeScreenId) ?? null;
    const shown = area ? shownScreens(area) : [];
    if (!area || shown.length < 2) {
      tabs.hidden = true;
      tabs.replaceChildren();
      tabs.removeAttribute('aria-label');
      return;
    }
    tabs.hidden = false;
    tabs.setAttribute('aria-label', `${areaLabel(area)}の画面`);
    tabs.replaceChildren(...shown.map((screen) => {
      const tab = makeElement(doc, 'a', {
        className: 'bb-area-tab',
        attrs: {
          href: screenHref(screen),
          'data-screen-tab': screen.id,
          'aria-current': screen.id === activeScreenId ? 'page' : null,
          target: screen.external ? '_blank' : null,
          rel: screen.external ? 'noopener' : null,
        },
      });
      tab.append(makeElement(doc, 'span', { text: screen.label }));
      if (Number.isInteger(screen.count)) {
        tab.append(countBadge(screen.count, screen.waiting ? `待っているもの${screen.count}件` : `${screen.count}件`));
      }
      if (!screen.external) tab.addEventListener('click', (event) => onSelect?.(screen.id, event));
      return tab;
    }));
  }

  function render() {
    for (const area of areas) renderAreaLink(area);
    renderTabs();
  }

  const controller = {
    nav,
    tabs,
    get state() {
      const area = areaByScreen.get(activeScreenId) ?? null;
      return { activeScreenId, activeAreaId: area?.id ?? null };
    },
    areaOf(screenId) {
      return areaByScreen.get(screenId)?.id ?? null;
    },
    targetFor,
    /** Marks the shown screen; a screen in an area becomes that area's last screen. */
    show(screenId) {
      activeScreenId = screenId;
      const area = areaByScreen.get(screenId);
      const screen = screens.get(screenId);
      if (area && screen && !screen.external && isShown(screenId)) memory.set(area.id, screenId);
      render();
      return controller;
    },
    setHidden(screenId, hidden) {
      const screen = screens.get(screenId);
      if (!screen) return controller;
      screen.hidden = hidden === true;
      render();
      return controller;
    },
    /** `count` null removes it. `waiting` counts are added up on the area link too. */
    setCount(screenId, count, { waiting = false } = {}) {
      const screen = screens.get(screenId);
      if (!screen) return controller;
      screen.count = Number.isInteger(count) && count >= 0 ? count : null;
      screen.waiting = waiting === true;
      render();
      return controller;
    },
  };
  render();
  return controller;
}

export default createAreaNav;
