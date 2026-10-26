import { workspaceTabList } from './workspace-kit.js';
/*
 * Area navigation shared by OSS Personal and the organization edition
 * (brainbase-project ledger D10).
 *
 * Each line on the left is an area: usually one screen (a destination itself,
 * 2026-10-17 revision), or several screens shown as tabs above the page (設定).
 * An area link opens the screen last used in that area, which is remembered in
 * the viewer's browser only (a display preference, not a fact of the
 * organization).  Optional `sections` group the lines under small headings and
 * put some at the bottom; a heading can open a screen of its own, and the
 * caller can put links at the top of a section (starred projects).  Without
 * `sections` the lines sit directly in the nav, as in stage 2.  Every link is a
 * link to a screen, so screen addresses never change.  The part draws links
 * only: showing and loading screens stays with the caller (`show` in,
 * `onSelect` / `onSelectLink` out).
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
 * @param {Array<{id: string, label: string|null, defaultScreen?: string, screenIds: string[], section?: string}>} options.areas
 *   In menu order. A null label takes the label of the area's only screen.
 * @param {Array<{id: string, label: string, href?: string, external?: boolean, hidden?: boolean}>} options.screens
 * @param {Array<{id: string, label: string|null, placement?: 'main'|'footer', screenId?: string}>} [options.sections]
 *   Groups of lines. A section sits where its first area is (a section without
 *   areas after the other main ones); `footer` sections come last. `screenId`
 *   makes the heading a link to that screen. Areas without a section are grouped
 *   with their neighbours, without a heading.
 * @param {{get(areaId: string): string|null, set(areaId: string, screenId: string): void}} [options.memory]
 * @param {(screenId: string) => string} [options.hrefFor] Address of a screen (default `#<id>`).
 * @param {(screenId: string, event: Event) => void} [options.onSelect]
 * @param {(linkId: string, event: Event) => void} [options.onSelectLink] A link given by `setLinks`.
 * @param {(area: object) => Node|null} [options.iconFor] Icon in front of an area link.
 * @param {string} [options.linkClassName] Extra class for the area links (the host's look).
 */
export function createAreaNav({
  document: doc,
  areas: areaInput,
  screens: screenInput,
  sections: sectionInput,
  memory = createAreaMemory(null),
  hrefFor = (screenId) => `#${screenId}`,
  onSelect,
  onSelectLink,
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
  const sections = new Map((sectionInput ?? []).map((section) => [section.id, {
    id: section.id,
    label: section.label ?? null,
    footer: section.placement === 'footer',
    screenId: section.screenId ?? null,
    links: [],
  }]));
  const areas = (areaInput ?? []).map((area) => ({
    id: area.id,
    label: area.label ?? null,
    defaultScreen: area.defaultScreen ?? null,
    section: sections.has(area.section) ? area.section : null,
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

  const countBadge = (count, ariaLabel, tab = false) => makeElement(doc, 'span', {
    className: tab ? 'bb-area-count bb-ws-tab-count' : 'bb-area-count',
    text: count,
    attrs: { 'aria-label': ariaLabel },
  });

  const nav = makeElement(doc, 'nav', { className: 'bb-area-nav', attrs: { 'aria-label': label, 'data-contract-version': AREA_NAV_CONTRACT_VERSION } });
  const tabs = makeElement(doc, 'nav', { className: 'bb-area-tabs' });
  workspaceTabList(tabs);
  tabs.hidden = true;
  const areaLinks = new Map();
  const linkClass = ['bb-area-link', linkClassName].filter(Boolean).join(' ');

  for (const area of areas) {
    const link = makeElement(doc, 'a', {
      className: linkClass,
      attrs: { 'data-area': area.id },
    });
    link.addEventListener('click', (event) => {
      const target = targetFor(area.id);
      if (target) onSelect?.(target, event);
    });
    areaLinks.set(area.id, link);
  }

  // Groups of lines: one per section, plus runs of areas without a section.
  const groups = [];
  if (sections.size === 0) {
    nav.append(...areas.map((area) => areaLinks.get(area.id)));
  } else {
    const groupOf = new Map();
    const makeGroup = (section) => {
      const element = makeElement(doc, 'div', {
        className: section?.footer ? 'bb-area-section is-footer' : 'bb-area-section',
        attrs: {
          role: 'group',
          'aria-label': section?.label ?? null,
          'data-section': section?.id ?? null,
          'data-placement': section?.footer ? 'footer' : null,
        },
      });
      const group = { section, element, headingText: null, headingLink: null, linkSlot: null, areas: [] };
      if (section) {
        // Both forms of the heading are made once; render shows one of them.
        group.headingText = makeElement(doc, 'div', { className: 'bb-area-section-label', text: section.label ?? '' });
        group.headingLink = makeElement(doc, 'a', { className: 'bb-area-section-label bb-area-section-link', text: section.label ?? '' });
        group.headingLink.addEventListener('click', (event) => {
          if (section.screenId) onSelect?.(section.screenId, event);
        });
        group.linkSlot = makeElement(doc, 'div', { className: 'bb-area-section-links' });
        groupOf.set(section.id, group);
      }
      groups.push(group);
      return group;
    };
    for (const area of areas) {
      const section = area.section ? sections.get(area.section) : null;
      const last = groups.at(-1);
      const group = section
        ? groupOf.get(section.id) ?? makeGroup(section)
        : last && !last.section ? last : makeGroup(null);
      group.areas.push(area);
    }
    for (const section of sections.values()) if (!groupOf.has(section.id)) makeGroup(section);
    const ordered = [...groups.filter((group) => !group.section?.footer), ...groups.filter((group) => group.section?.footer)];
    groups.splice(0, groups.length, ...ordered);
    for (const group of groups) {
      group.element.append(...[group.headingText, group.headingLink, group.linkSlot, ...group.areas.map((area) => areaLinks.get(area.id))].filter(Boolean));
      nav.append(group.element);
    }
  }

  function renderHeading(group) {
    const { section, headingText, headingLink } = group;
    const screen = section.screenId ? screens.get(section.screenId) : null;
    const opens = Boolean(screen && isShown(screen.id) && !screen.external);
    headingText.hidden = !section.label || opens;
    headingLink.hidden = !section.label || !opens;
    if (opens) headingLink.setAttribute('href', screenHref(screen));
    else headingLink.removeAttribute('href');
    if (opens && activeScreenId === screen.id) headingLink.setAttribute('aria-current', 'page');
    else headingLink.removeAttribute('aria-current');
    return opens;
  }

  function renderLinks(group) {
    group.linkSlot.replaceChildren(...group.section.links.map((entry) => {
      const link = makeElement(doc, 'a', {
        className: linkClass,
        attrs: { href: entry.href, 'data-link': entry.id, 'aria-current': entry.current ? 'page' : null },
      });
      link.append(makeElement(doc, 'span', { className: 'bb-area-link-label', text: entry.label }));
      if (entry.count > 0) link.append(countBadge(entry.count, `待っているもの${entry.count}件`));
      link.addEventListener('click', (event) => onSelectLink?.(entry.id, event));
      return link;
    }));
    group.linkSlot.hidden = group.section.links.length === 0;
  }

  function renderGroup(group) {
    const headingOpens = group.section ? renderHeading(group) : false;
    if (group.section) renderLinks(group);
    const anyArea = group.areas.some((area) => !areaLinks.get(area.id).hidden);
    group.element.hidden = !(anyArea || headingOpens || (group.section?.links.length ?? 0) > 0);
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
        tab.append(countBadge(screen.count, screen.waiting ? `待っているもの${screen.count}件` : `${screen.count}件`, true));
      }
      if (!screen.external) tab.addEventListener('click', (event) => onSelect?.(screen.id, event));
      return tab;
    }));
  }

  function render() {
    for (const area of areas) renderAreaLink(area);
    for (const group of groups) renderGroup(group);
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
    /**
     * Links at the top of a section, before its areas (for example starred
     * projects): `{id, label, href, count?, current?}`. An empty list removes them.
     */
    setLinks(sectionId, links) {
      const section = sections.get(sectionId);
      if (!section) return controller;
      section.links = (links ?? []).filter((entry) => entry && entry.id && entry.label && entry.href).map((entry) => ({
        id: String(entry.id),
        label: String(entry.label),
        href: String(entry.href),
        count: Number.isInteger(entry.count) && entry.count > 0 ? entry.count : 0,
        current: entry.current === true,
      }));
      render();
      return controller;
    },
  };
  render();
  return controller;
}

export default createAreaNav;
