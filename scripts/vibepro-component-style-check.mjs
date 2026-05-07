import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium, devices } from 'playwright';

const DEFAULT_URL = 'http://localhost:31014';
const DEFAULT_RUN_DIR = 'docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260507-101513-command-center-redesign';
const EXPECTED_CSS_VERSION = '202605071930';

function includesAll(value, needles) {
  const text = String(value || '');
  return needles.every((needle) => text.includes(needle));
}

function pxNumber(value) {
  const match = String(value || '').match(/-?\d+(\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : 0;
}

function createCheck(id, passed, actual, expected) {
  return {
    id,
    status: passed ? 'passed' : 'failed',
    actual,
    expected,
  };
}

async function collectDesktopEvidence(page) {
  await page.goto(process.env.VIBEPRO_COMPONENT_URL || DEFAULT_URL, {
    waitUntil: 'networkidle',
    timeout: 20000,
  }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.waitForSelector('.session-child-row', { timeout: 15000 }).catch(() => {});
  await page.locator('#ab-tasks-btn').click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.waitForSelector('#tasks-tab-content .timeline-item', { timeout: 15000 }).catch(() => {});

  await page.evaluate(() => {
    const firstSession = document.querySelector('.session-child-row');
    firstSession?.classList.add('active');

    const drawer = document.querySelector('#info-drawer');
    drawer?.classList.add('open');

    document.querySelectorAll('.info-drawer-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === 'tasks');
    });
    document.querySelectorAll('.info-tab-content').forEach((content) => {
      content.classList.toggle('active', content.dataset.tab === 'tasks');
    });
    document.querySelector('#ab-tasks-btn')?.classList.add('active');

    const tab = document.querySelector('button.task-tab[data-tab="nocodb"]');
    tab?.click();
    document.querySelectorAll('.task-tab').forEach((taskTab) => {
      taskTab.classList.toggle('active', taskTab.dataset.tab === 'nocodb');
    });
    document.querySelector('#local-tasks-panel')?.classList.remove('active');
    document.querySelector('#nocodb-tasks-panel')?.classList.add('active');

    const assigneeFilter = document.querySelector('#nocodb-assignee-filter');
    if (assigneeFilter) {
      assigneeFilter.value = '';
      assigneeFilter.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const list = document.querySelector('#nocodb-tasks-list');
    if (!list) return;
    list.innerHTML = `
      <div class="nocodb-task-item overdue" data-task-id="vibepro-style-sample">
        <div class="task-header">
          <span class="project-badge">Brainbase</span>
          <span class="priority-indicator high" aria-label="priority high"></span>
          <div class="nocodb-task-actions">
            <button class="nocodb-task-action-btn nocodb-task-start-btn"><i data-lucide="play"></i></button>
            <button class="nocodb-task-action-btn"><i data-lucide="edit-2"></i></button>
            <button class="nocodb-task-action-btn"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
        <div class="task-title">VibePro component replacement sample</div>
        <div class="task-meta">
          <span class="deadline urgent"><i data-lucide="calendar"></i> 期限切れ</span>
          <select class="task-status-select"><option>未着手</option></select>
          <div class="assignee-combobox">
            <button class="assignee-trigger">
              <i data-lucide="user" class="assignee-icon"></i>
              <span class="assignee-value">Operator</span>
              <i data-lucide="chevron-down" class="chevron-icon"></i>
            </button>
          </div>
        </div>
      </div>
    `;
    window.lucide?.createIcons?.();
  });
  await page.waitForSelector('#tasks-tab-content .nocodb-task-item.overdue', { timeout: 5000 }).catch(() => {});

  return page.evaluate(() => {
    function style(selector, property) {
      const element = document.querySelector(selector);
      if (!element) return null;
      return getComputedStyle(element).getPropertyValue(property);
    }

    function elementStyle(element, property) {
      if (!element) return null;
      return getComputedStyle(element).getPropertyValue(property);
    }

    function ensureSampleTask() {
      const list = document.querySelector('#nocodb-tasks-list');
      if (!list || document.querySelector('#tasks-tab-content .nocodb-task-item.overdue')) return;
      list.innerHTML = `
        <div class="nocodb-task-item overdue" data-task-id="vibepro-style-sample">
          <div class="task-header">
            <span class="project-badge">Brainbase</span>
            <span class="priority-indicator high" aria-label="priority high"></span>
            <div class="nocodb-task-actions">
              <button class="nocodb-task-action-btn nocodb-task-start-btn"><i data-lucide="play"></i></button>
              <button class="nocodb-task-action-btn"><i data-lucide="edit-2"></i></button>
              <button class="nocodb-task-action-btn"><i data-lucide="trash-2"></i></button>
            </div>
          </div>
          <div class="task-title">VibePro component replacement sample</div>
          <div class="task-meta">
            <span class="deadline urgent"><i data-lucide="calendar"></i> 期限切れ</span>
            <select class="task-status-select"><option>未着手</option></select>
            <div class="assignee-combobox">
              <button class="assignee-trigger">
                <i data-lucide="user" class="assignee-icon"></i>
                <span class="assignee-value">Operator</span>
                <i data-lucide="chevron-down" class="chevron-icon"></i>
              </button>
            </div>
          </div>
        </div>
      `;
      window.lucide?.createIcons?.();
    }

    ensureSampleTask();

    const activeSession = document.querySelector('.session-child-row.active');
    const firstSession = document.querySelector('.session-child-row:not(.active)') || activeSession || document.querySelector('.session-child-row');
    const firstSessionWasActive = firstSession?.classList.contains('active') ?? false;
    firstSession?.classList.remove('active');
    const styleHref = document.querySelector('link[rel="stylesheet"]')?.href || '';

    const evidence = {
      styleHref,
      commandCenterWorkspaceExists: Boolean(document.querySelector('.command-center-workspace')),
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      activeSession: {
        backgroundImage: activeSession ? getComputedStyle(activeSession).backgroundImage : null,
        backgroundColor: activeSession ? getComputedStyle(activeSession).backgroundColor : null,
        borderLeftWidth: activeSession ? getComputedStyle(activeSession).borderLeftWidth : null,
        borderLeftColor: activeSession ? getComputedStyle(activeSession).borderLeftColor : null,
        borderRadius: activeSession ? getComputedStyle(activeSession).borderRadius : null,
        height: activeSession ? activeSession.getBoundingClientRect().height : null,
      },
      sessionRow: {
        height: firstSession ? firstSession.getBoundingClientRect().height : null,
        paddingTop: elementStyle(firstSession, 'padding-top'),
        backgroundColor: elementStyle(firstSession, 'background-color'),
        borderRadius: elementStyle(firstSession, 'border-radius'),
        borderBottomWidth: elementStyle(firstSession, 'border-bottom-width'),
        backgroundImage: elementStyle(firstSession, 'background-image'),
        boxShadow: elementStyle(firstSession, 'box-shadow'),
        projectEmojiDisplay: style('.session-child-row .session-project-emoji', 'display'),
        summaryChipHeight: document.querySelector('.session-summary-chip')?.getBoundingClientRect().height ?? null,
      },
      sessionIcon: {
        display: style('.session-child-row .session-name-container > .session-meta:first-child', 'display'),
        width: document.querySelector('.session-child-row .session-icon')?.getBoundingClientRect().width ?? null,
        height: document.querySelector('.session-child-row .session-icon')?.getBoundingClientRect().height ?? null,
        borderRadius: style('.session-child-row .session-icon', 'border-radius'),
        names: Array.from(new Set(
          Array.from(document.querySelectorAll('.session-child-row .session-icon [data-lucide]'))
            .map((icon) => icon.getAttribute('data-lucide'))
            .filter(Boolean),
        )).slice(0, 8),
        labels: Array.from(new Set(
          Array.from(document.querySelectorAll('.session-child-row .session-icon'))
            .map((icon) => icon.textContent?.trim())
            .filter(Boolean),
        )).slice(0, 8),
      },
      activityBarActive: {
        backgroundImage: style('.activity-bar-item.active', 'background-image'),
        backgroundColor: style('.activity-bar-item.active', 'background-color'),
        borderColor: style('.activity-bar-item.active', 'border-color'),
        borderRadius: style('.activity-bar-item.active', 'border-radius'),
      },
      addSessionButton: {
        backgroundImage: style('.add-session-btn', 'background-image'),
        backgroundColor: style('.add-session-btn', 'background-color'),
        borderRadius: style('.add-session-btn', 'border-radius'),
        height: document.querySelector('.add-session-btn')?.getBoundingClientRect().height ?? null,
      },
      terminalButton: {
        borderRadius: style('.console-btn, .icon-btn', 'border-radius'),
        borderColor: style('.console-btn, .icon-btn', 'border-color'),
      },
      drawer: {
        width: style('.info-drawer.open', 'width'),
        headerHeight: document.querySelector('.info-drawer-header')?.getBoundingClientRect().height ?? null,
        headerBeforeContent: getComputedStyle(document.querySelector('.info-drawer-header'), '::before').getPropertyValue('content'),
        tabBackground: style('.info-drawer-tabs', 'background-color'),
        tabBorderRadius: style('.info-drawer-tabs', 'border-radius'),
        activeTabBackground: style('.info-drawer-tab.active', 'background-image') || style('.info-drawer-tab.active', 'background-color'),
        activeTabBoxShadow: style('.info-drawer-tab.active', 'box-shadow'),
        activeTabBorderBottomWidth: style('.info-drawer-tab.active', 'border-bottom-width'),
        tabHeight: document.querySelector('.info-drawer-tab')?.getBoundingClientRect().height ?? null,
        activeTab: document.querySelector('.info-drawer-tab.active')?.dataset.tab ?? null,
      },
      tasks: {
        active: document.querySelector('#tasks-tab-content')?.classList.contains('active') ?? false,
        timelineVisible: (document.querySelector('#tasks-tab-content .timeline-section')?.getBoundingClientRect().height ?? 0) > 0,
        nextTasksVisible: (document.querySelector('#tasks-tab-content .next-tasks-section')?.getBoundingClientRect().height ?? 0) > 0,
        timelineTop: document.querySelector('#tasks-tab-content .timeline-section')?.getBoundingClientRect().top ?? null,
        nextTasksTop: document.querySelector('#tasks-tab-content .next-tasks-section')?.getBoundingClientRect().top ?? null,
        timelineBackground: style('#tasks-tab-content .timeline-section', 'background-image'),
        timelineBackgroundColor: style('#tasks-tab-content .timeline-section', 'background-color'),
        timelineBorderRadius: style('#tasks-tab-content .timeline-section', 'border-radius'),
        timelineBoxShadow: style('#tasks-tab-content .timeline-section', 'box-shadow'),
        timelineItemDisplay: style('#tasks-tab-content .timeline-item', 'display'),
        taskSectionBackground: style('#tasks-tab-content .next-tasks-section', 'background-image'),
        taskSectionBackgroundColor: style('#tasks-tab-content .next-tasks-section', 'background-color'),
        taskSectionBorderRadius: style('#tasks-tab-content .next-tasks-section', 'border-radius'),
        taskSectionBoxShadow: style('#tasks-tab-content .next-tasks-section', 'box-shadow'),
        sectionHeaderBackground: style('#tasks-tab-content .next-tasks-section .section-header', 'background-color'),
        sectionHeaderBorderRadius: style('#tasks-tab-content .next-tasks-section .section-header', 'border-radius'),
        taskTabsBackground: style('#tasks-tab-content .task-tabs', 'background-color'),
        taskTabsBorderRadius: style('#tasks-tab-content .task-tabs', 'border-radius'),
        taskTabActiveBackground: style('#tasks-tab-content .task-tab.active', 'background-image') || style('#tasks-tab-content .task-tab.active', 'background-color'),
        taskTabActiveBorderBottomWidth: style('#tasks-tab-content .task-tab.active', 'border-bottom-width'),
        taskFilterBackground: style('#tasks-tab-content .task-filter', 'background-color'),
        taskFilterBorderRadius: style('#tasks-tab-content .task-filter', 'border-radius'),
        taskListBorderRadius: style('#tasks-tab-content #nocodb-tasks-list', 'border-radius'),
        taskListBackground: style('#tasks-tab-content #nocodb-tasks-list', 'background-color'),
        filterBackground: style('#tasks-tab-content .task-filter input', 'background-color'),
        filterBorderRadius: style('#tasks-tab-content .task-filter input', 'border-radius'),
      },
      sampleTask: {
        backgroundImage: style('#tasks-tab-content .nocodb-task-item.overdue', 'background-image'),
        backgroundColor: style('#tasks-tab-content .nocodb-task-item.overdue', 'background-color'),
        borderLeftWidth: style('#tasks-tab-content .nocodb-task-item.overdue', 'border-left-width'),
        borderLeftColor: style('#tasks-tab-content .nocodb-task-item.overdue', 'border-left-color'),
        borderBottomWidth: style('#tasks-tab-content .nocodb-task-item.overdue', 'border-bottom-width'),
        borderRadius: style('#tasks-tab-content .nocodb-task-item.overdue', 'border-radius'),
        boxShadow: style('#tasks-tab-content .nocodb-task-item.overdue', 'box-shadow'),
        marginBottom: style('#tasks-tab-content .nocodb-task-item.overdue', 'margin-bottom'),
        height: document.querySelector('#tasks-tab-content .nocodb-task-item.overdue')?.getBoundingClientRect().height ?? null,
        projectBadgeBackground: style('#tasks-tab-content .project-badge', 'background-color'),
        priorityWidth: style('#tasks-tab-content .priority-indicator.high', 'width'),
        actionButtonBackground: style('#tasks-tab-content .nocodb-task-action-btn', 'background-color'),
      },
      fileViewerReplacement: (() => {
        const main = document.querySelector('.main-content');
        const consoleArea = document.querySelector('#console-area');
        const panel = document.querySelector('#file-viewer-panel');
        if (!main || !consoleArea || !panel) return null;

        const previousBodyActive = document.body.classList.contains('file-viewer-active');
        const previousConsoleDisplay = consoleArea.style.display;
        const previousPanelDisplay = panel.style.display;
        const previousPanelHtml = panel.innerHTML;

        panel.innerHTML = `
          <div class="file-viewer">
            <div class="file-viewer-header">VibePro preview.md</div>
            <div class="file-viewer-content">File viewer replacement check</div>
          </div>
        `;
        document.body.classList.add('file-viewer-active');
        consoleArea.style.display = 'none';
        panel.style.display = 'flex';

        const mainRect = main.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const availableHeight = mainRect.bottom - panelRect.top;
        const result = {
          bodyActive: document.body.classList.contains('file-viewer-active'),
          consoleDisplay: getComputedStyle(consoleArea).display,
          panelDisplay: getComputedStyle(panel).display,
          panelHeight: panelRect.height,
          availableHeight,
        };

        if (!previousBodyActive) document.body.classList.remove('file-viewer-active');
        consoleArea.style.display = previousConsoleDisplay;
        panel.style.display = previousPanelDisplay;
        panel.innerHTML = previousPanelHtml;

        return result;
      })(),
      localTaskEmpty: (() => {
        const list = document.querySelector('#next-tasks-list');
        if (!list) return null;

        const previousHtml = list.innerHTML;
        list.innerHTML = `
          <div class="next-task-empty">
            <i data-lucide="list-checks"></i>
            <div class="next-task-empty-title">次に動かすローカルタスクはありません</div>
            <div class="next-task-empty-copy">新しいタスクや保留中の作業が入るとここに並びます。</div>
          </div>
        `;
        window.lucide?.createIcons?.();

        const empty = list.querySelector('.next-task-empty');
        const title = list.querySelector('.next-task-empty-title');
        const copy = list.querySelector('.next-task-empty-copy');
        const icon = list.querySelector('.next-task-empty svg, .next-task-empty i');
        const result = {
          exists: Boolean(empty),
          titleText: title?.textContent?.trim() || '',
          copyText: copy?.textContent?.trim() || '',
          minHeight: elementStyle(empty, 'min-height'),
          borderTopWidth: elementStyle(empty, 'border-top-width'),
          iconWidth: icon?.getBoundingClientRect().width ?? null,
        };

        list.innerHTML = previousHtml;
        window.lucide?.createIcons?.();

        return result;
      })(),
    };

    if (firstSessionWasActive) firstSession?.classList.add('active');
    return evidence;
  });
}

async function collectMobileEvidence(browser) {
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  await page.goto(process.env.VIBEPRO_COMPONENT_URL || DEFAULT_URL, {
    waitUntil: 'networkidle',
    timeout: 20000,
  }).catch(() => {});
  await page.waitForTimeout(3000);

  const evidence = await page.evaluate(() => {
    function style(selector, property) {
      const element = document.querySelector(selector);
      if (!element) return null;
      return getComputedStyle(element).getPropertyValue(property);
    }

    function rect(selector, property) {
      const element = document.querySelector(selector);
      if (!element) return null;
      return element.getBoundingClientRect()[property];
    }

    const mobileTabBottoms = Array.from(document.querySelectorAll('.mobile-tab'))
      .map((tab) => tab.getBoundingClientRect().bottom);

    return {
      styleHref: document.querySelector('link[rel="stylesheet"]')?.href || '',
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      sessionContextDisplay: style('.session-context-bar', 'display'),
      mobileTabBarHeight: rect('.mobile-tab-bar', 'height'),
      mobileTabMaxBottom: mobileTabBottoms.length > 0 ? Math.max(...mobileTabBottoms) : null,
      terminalHeaderTop: rect('.terminal-header', 'top'),
      mobileTabBorderRadius: style('.mobile-tab', 'border-radius'),
    };
  });

  return { page, evidence };
}

function buildChecks(desktop, mobile) {
  return [
    createCheck(
      'css_cache_buster_updated',
      desktop.styleHref.includes(`style.css?v=${EXPECTED_CSS_VERSION}`),
      desktop.styleHref,
      `style.css?v=${EXPECTED_CSS_VERSION}`,
    ),
    createCheck(
      'layout_not_replaced_by_component_sheet',
      desktop.commandCenterWorkspaceExists === false,
      { commandCenterWorkspaceExists: desktop.commandCenterWorkspaceExists },
      'component sheet workspace must not exist in app DOM',
    ),
    createCheck(
      'active_session_component_replaced',
      includesAll(desktop.activeSession.backgroundColor, ['47', '128', '255'])
        && desktop.activeSession.borderLeftWidth === '2px'
        && pxNumber(desktop.activeSession.borderRadius) <= 4
        && pxNumber(desktop.activeSession.height) <= 56,
      desktop.activeSession,
      'dense flat row with blue rail and minimal selected radius',
    ),
    createCheck(
      'session_rows_are_list_rows_not_cards',
      pxNumber(desktop.sessionRow.height) <= 56
        && pxNumber(desktop.sessionRow.paddingTop) <= 8
        && pxNumber(desktop.sessionRow.borderRadius) === 0
        && desktop.sessionRow.borderBottomWidth === '1px'
        && includesAll(desktop.sessionRow.backgroundColor, ['0, 0, 0, 0'])
        && (desktop.sessionRow.projectEmojiDisplay === 'none' || desktop.sessionRow.projectEmojiDisplay === null)
        && desktop.sessionRow.boxShadow === 'none'
        && pxNumber(desktop.sessionRow.summaryChipHeight) <= 17,
      desktop.sessionRow,
      'session rows must be compact list rows with no emoji tile or card shadow',
    ),
    createCheck(
      'activity_bar_active_component_replaced',
      includesAll(desktop.activityBarActive.backgroundColor, ['47', '128', '255'])
        && pxNumber(desktop.activityBarActive.borderRadius) === 0,
      desktop.activityBarActive,
      'quiet rail active state with blue tint and no rounded card',
    ),
    createCheck(
      'primary_button_component_replaced',
      includesAll(desktop.addSessionButton.backgroundImage, ['47, 128, 255'])
        && pxNumber(desktop.addSessionButton.borderRadius) <= 5
        && pxNumber(desktop.addSessionButton.height) <= 38,
      desktop.addSessionButton,
      'compact primary blue session command matching approved sidebar',
    ),
    createCheck(
      'session_rows_include_meaningful_icons',
      ['flex', 'inline-flex'].includes(desktop.sessionIcon.display)
        && pxNumber(desktop.sessionIcon.width) >= 22
        && pxNumber(desktop.sessionIcon.height) >= 22
        && pxNumber(desktop.sessionIcon.borderRadius) <= 4
        && (desktop.sessionIcon.names.length + desktop.sessionIcon.labels.length) >= 3,
      desktop.sessionIcon,
      'session rows must show a compact leading configured or lucide icon',
    ),
    createCheck(
      'terminal_action_buttons_component_replaced',
      pxNumber(desktop.terminalButton.borderRadius) >= 7
        && includesAll(desktop.terminalButton.borderColor, ['191', '201', '214']),
      desktop.terminalButton,
      'hairline bordered icon buttons',
    ),
    createCheck(
      'file_viewer_replaces_full_terminal_area',
      desktop.fileViewerReplacement?.bodyActive === true
        && desktop.fileViewerReplacement?.consoleDisplay === 'none'
        && desktop.fileViewerReplacement?.panelDisplay === 'flex'
        && desktop.fileViewerReplacement?.panelHeight >= desktop.fileViewerReplacement?.availableHeight * 0.98,
      desktop.fileViewerReplacement,
      'file viewer must hide the terminal and fill the available terminal area',
    ),
    createCheck(
      'drawer_tabs_component_replaced',
      pxNumber(desktop.drawer.width) > 0
        && pxNumber(desktop.drawer.width) <= 540
        && pxNumber(desktop.drawer.headerHeight) <= 56
        && desktop.drawer.headerBeforeContent === 'none'
        && pxNumber(desktop.drawer.tabHeight) <= 58
        && pxNumber(desktop.drawer.tabBorderRadius) === 0
        && desktop.drawer.activeTabBoxShadow === 'none'
        && desktop.drawer.activeTabBorderBottomWidth === '2px',
      desktop.drawer,
      'flat drawer tab strip with no duplicate title row',
    ),
    createCheck(
      'local_task_empty_state_is_refined',
      desktop.localTaskEmpty?.exists === true
        && desktop.localTaskEmpty?.titleText.includes('ローカルタスク')
        && desktop.localTaskEmpty?.copyText.length > 0
        && pxNumber(desktop.localTaskEmpty?.minHeight) >= 160
        && desktop.localTaskEmpty?.borderTopWidth === '1px'
        && pxNumber(desktop.localTaskEmpty?.iconWidth) <= 20,
      desktop.localTaskEmpty,
      'local task empty state must be a designed quiet state, not a raw one-line label',
    ),
    createCheck(
      'task_panel_shows_timeline_and_next_tasks_together',
      desktop.drawer.activeTab === 'tasks'
        && desktop.tasks.active === true
        && desktop.tasks.timelineVisible === true
        && desktop.tasks.nextTasksVisible === true
        && desktop.tasks.nextTasksTop > desktop.tasks.timelineTop,
      {
        activeTab: desktop.drawer.activeTab,
        tasksActive: desktop.tasks.active,
        timelineVisible: desktop.tasks.timelineVisible,
        nextTasksVisible: desktop.tasks.nextTasksVisible,
        timelineTop: desktop.tasks.timelineTop,
        nextTasksTop: desktop.tasks.nextTasksTop,
      },
      'right task panel must show timeline above next tasks simultaneously',
    ),
    createCheck(
      'timeline_component_replaced',
      desktop.tasks.timelineBackground === 'none'
        && includesAll(desktop.tasks.timelineBackgroundColor, ['0, 0, 0, 0'])
        && pxNumber(desktop.tasks.timelineBorderRadius) === 0
        && desktop.tasks.timelineBoxShadow === 'none'
        && desktop.tasks.timelineItemDisplay === 'grid',
      desktop.tasks,
      'flat timeline rows with no section card surface',
    ),
    createCheck(
      'task_queue_is_table_not_nested_cards',
      desktop.tasks.taskSectionBackground === 'none'
        && includesAll(desktop.tasks.taskSectionBackgroundColor, ['0, 0, 0, 0'])
        && pxNumber(desktop.tasks.taskSectionBorderRadius) === 0
        && desktop.tasks.taskSectionBoxShadow === 'none'
        && pxNumber(desktop.tasks.sectionHeaderBorderRadius) === 0
        && pxNumber(desktop.tasks.taskTabsBorderRadius) === 0
        && includesAll(desktop.tasks.taskTabsBackground, ['0, 0, 0, 0'])
        && pxNumber(desktop.tasks.taskFilterBorderRadius) === 0
        && includesAll(desktop.tasks.taskFilterBackground, ['0, 0, 0, 0'])
        && pxNumber(desktop.tasks.taskListBorderRadius) === 0
        && includesAll(desktop.tasks.taskListBackground, ['0, 0, 0, 0'])
        && desktop.tasks.taskTabActiveBorderBottomWidth === '2px',
      desktop.tasks,
      'task queue must be a line/table composition with no nested card wrappers',
    ),
    createCheck(
      'task_filters_component_replaced',
      includesAll(desktop.tasks.filterBackground, ['7', '9', '11'])
        && pxNumber(desktop.tasks.filterBorderRadius) <= 4,
      {
        filterBackground: desktop.tasks.filterBackground,
        filterBorderRadius: desktop.tasks.filterBorderRadius,
      },
      'dark structured filter inputs',
    ),
    createCheck(
      'overdue_task_card_component_replaced',
      desktop.sampleTask.backgroundImage === 'none'
        && includesAll(desktop.sampleTask.backgroundColor, ['0, 0, 0, 0'])
        && desktop.sampleTask.borderLeftWidth === '2px'
        && desktop.sampleTask.borderBottomWidth === '1px'
        && includesAll(desktop.sampleTask.borderLeftColor, ['243', '93', '93'])
        && pxNumber(desktop.sampleTask.borderRadius) === 0
        && desktop.sampleTask.boxShadow === 'none'
        && pxNumber(desktop.sampleTask.marginBottom) <= 1,
      desktop.sampleTask,
      'transparent table row with thin red status rail, not a filled card',
    ),
    createCheck(
      'mobile_no_horizontal_overflow',
      mobile.bodyScrollWidth === mobile.bodyClientWidth,
      {
        bodyScrollWidth: mobile.bodyScrollWidth,
        bodyClientWidth: mobile.bodyClientWidth,
      },
      'mobile body width must not overflow',
    ),
    createCheck(
      'mobile_uses_updated_css',
      mobile.styleHref.includes(`style.css?v=${EXPECTED_CSS_VERSION}`)
        && pxNumber(mobile.mobileTabBorderRadius) >= 6,
      {
        styleHref: mobile.styleHref,
        mobileTabBorderRadius: mobile.mobileTabBorderRadius,
      },
      'mobile loads current component stylesheet',
    ),
    createCheck(
      'mobile_tab_bar_not_overlapped',
      mobile.sessionContextDisplay === 'none'
        && mobile.mobileTabBarHeight <= 64
        && mobile.mobileTabMaxBottom <= 72
        && mobile.terminalHeaderTop >= mobile.mobileTabMaxBottom,
      {
        sessionContextDisplay: mobile.sessionContextDisplay,
        mobileTabBarHeight: mobile.mobileTabBarHeight,
        mobileTabMaxBottom: mobile.mobileTabMaxBottom,
        terminalHeaderTop: mobile.terminalHeaderTop,
      },
      'mobile session context must stay hidden and tab bar must remain compact',
    ),
  ];
}

async function main() {
  const runDir = process.env.VIBEPRO_COMPONENT_RUN_DIR || DEFAULT_RUN_DIR;
  await fs.mkdir(runDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const desktopPage = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });

  const desktop = await collectDesktopEvidence(desktopPage);
  const desktopScreenshot = path.join(runDir, 'component-style-desktop.png');
  await desktopPage.screenshot({ path: desktopScreenshot, fullPage: true });

  const mobileResult = await collectMobileEvidence(browser);
  const mobile = mobileResult.evidence;
  const mobileScreenshot = path.join(runDir, 'component-style-mobile.png');
  await mobileResult.page.screenshot({ path: mobileScreenshot, fullPage: true });

  await browser.close();

  const checks = buildChecks(desktop, mobile);
  const failures = checks.filter((check) => check.status !== 'passed');
  const result = {
    status: failures.length === 0 ? 'passed' : 'failed',
    generated_at: new Date().toISOString(),
    url: process.env.VIBEPRO_COMPONENT_URL || DEFAULT_URL,
    screenshots: {
      desktop: desktopScreenshot,
      mobile: mobileScreenshot,
    },
    component_coverage: {
      checked_count: checks.length,
      passed_count: checks.length - failures.length,
      failed_count: failures.length,
    },
    checks,
  };

  const resultPath = path.join(runDir, 'component-style-check.json');
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

await main();
