import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium, devices } from 'playwright';

const DEFAULT_URL = 'http://localhost:31014';
const DEFAULT_RUN_DIR = 'docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260507-101513-command-center-redesign';
const EXPECTED_CSS_VERSION = '202605071430';

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
  await page.locator('#ab-tasks-btn').click().catch(() => {});
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
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
  });
  await page.waitForTimeout(500);

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
  await page.waitForTimeout(500);

  return page.evaluate(() => {
    function style(selector, property) {
      const element = document.querySelector(selector);
      if (!element) return null;
      return getComputedStyle(element).getPropertyValue(property);
    }

    const activeSession = document.querySelector('.session-child-row.active');
    const firstSession = document.querySelector('.session-child-row');
    const styleHref = document.querySelector('link[rel="stylesheet"]')?.href || '';

    return {
      styleHref,
      commandCenterWorkspaceExists: Boolean(document.querySelector('.command-center-workspace')),
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      activeSession: {
        backgroundImage: activeSession ? getComputedStyle(activeSession).backgroundImage : null,
        borderLeftWidth: activeSession ? getComputedStyle(activeSession).borderLeftWidth : null,
        borderLeftColor: activeSession ? getComputedStyle(activeSession).borderLeftColor : null,
        borderRadius: activeSession ? getComputedStyle(activeSession).borderRadius : null,
        height: activeSession ? activeSession.getBoundingClientRect().height : null,
      },
      sessionRow: {
        height: firstSession ? firstSession.getBoundingClientRect().height : null,
        paddingTop: style('.session-child-row', 'padding-top'),
        backgroundImage: style('.session-child-row', 'background-image'),
        boxShadow: style('.session-child-row', 'box-shadow'),
        projectEmojiDisplay: style('.session-child-row .session-project-emoji', 'display'),
        summaryChipHeight: document.querySelector('.session-summary-chip')?.getBoundingClientRect().height ?? null,
      },
      activityBarActive: {
        backgroundImage: style('.activity-bar-item.active', 'background-image'),
        borderColor: style('.activity-bar-item.active', 'border-color'),
        borderRadius: style('.activity-bar-item.active', 'border-radius'),
      },
      addSessionButton: {
        backgroundImage: style('.add-session-btn', 'background-image'),
        borderRadius: style('.add-session-btn', 'border-radius'),
        height: document.querySelector('.add-session-btn')?.getBoundingClientRect().height ?? null,
      },
      terminalButton: {
        borderRadius: style('.console-btn, .icon-btn', 'border-radius'),
        borderColor: style('.console-btn, .icon-btn', 'border-color'),
      },
      drawer: {
        width: style('.info-drawer.open', 'width'),
        tabBackground: style('.info-drawer-tabs', 'background-color'),
        activeTabBackground: style('.info-drawer-tab.active', 'background-image') || style('.info-drawer-tab.active', 'background-color'),
        tabHeight: document.querySelector('.info-drawer-tab')?.getBoundingClientRect().height ?? null,
      },
      tasks: {
        timelineBackground: style('#tasks-tab-content .timeline-section', 'background-image'),
        timelineItemDisplay: style('#tasks-tab-content .timeline-item', 'display'),
        taskSectionBackground: style('#tasks-tab-content .next-tasks-section', 'background-image'),
        taskTabActiveBackground: style('#tasks-tab-content .task-tab.active', 'background-image') || style('#tasks-tab-content .task-tab.active', 'background-color'),
        filterBackground: style('#tasks-tab-content .task-filter input', 'background-color'),
        filterBorderRadius: style('#tasks-tab-content .task-filter input', 'border-radius'),
      },
      sampleTask: {
        backgroundImage: style('#tasks-tab-content .nocodb-task-item.overdue', 'background-image'),
        borderLeftWidth: style('#tasks-tab-content .nocodb-task-item.overdue', 'border-left-width'),
        borderLeftColor: style('#tasks-tab-content .nocodb-task-item.overdue', 'border-left-color'),
        borderRadius: style('#tasks-tab-content .nocodb-task-item.overdue', 'border-radius'),
        boxShadow: style('#tasks-tab-content .nocodb-task-item.overdue', 'box-shadow'),
        marginBottom: style('#tasks-tab-content .nocodb-task-item.overdue', 'margin-bottom'),
        height: document.querySelector('#tasks-tab-content .nocodb-task-item.overdue')?.getBoundingClientRect().height ?? null,
        projectBadgeBackground: style('#tasks-tab-content .project-badge', 'background-color'),
        priorityWidth: style('#tasks-tab-content .priority-indicator.high', 'width'),
        actionButtonBackground: style('#tasks-tab-content .nocodb-task-action-btn', 'background-color'),
      },
    };
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
      includesAll(desktop.activeSession.backgroundImage, ['47, 128, 255', '18, 21, 25'])
        && desktop.activeSession.borderLeftWidth === '2px'
        && pxNumber(desktop.activeSession.borderRadius) <= 6
        && pxNumber(desktop.activeSession.height) <= 46,
      desktop.activeSession,
      'dense row with blue rail, graphite surface, and small radius',
    ),
    createCheck(
      'session_rows_are_list_rows_not_cards',
      pxNumber(desktop.sessionRow.height) <= 46
        && pxNumber(desktop.sessionRow.paddingTop) <= 6
        && desktop.sessionRow.projectEmojiDisplay === 'none'
        && desktop.sessionRow.boxShadow === 'none'
        && pxNumber(desktop.sessionRow.summaryChipHeight) <= 17,
      desktop.sessionRow,
      'session rows must be compact list rows with no emoji tile or card shadow',
    ),
    createCheck(
      'activity_bar_active_component_replaced',
      includesAll(desktop.activityBarActive.backgroundImage, ['47, 128, 255'])
        && pxNumber(desktop.activityBarActive.borderRadius) >= 6,
      desktop.activityBarActive,
      'cobalt active state with compact radius',
    ),
    createCheck(
      'primary_button_component_replaced',
      includesAll(desktop.addSessionButton.backgroundImage, ['57, 138, 255'])
        && pxNumber(desktop.addSessionButton.borderRadius) <= 6
        && pxNumber(desktop.addSessionButton.height) <= 38,
      desktop.addSessionButton,
      'compact cobalt primary command button',
    ),
    createCheck(
      'terminal_action_buttons_component_replaced',
      pxNumber(desktop.terminalButton.borderRadius) >= 7
        && includesAll(desktop.terminalButton.borderColor, ['191', '201', '214']),
      desktop.terminalButton,
      'hairline bordered icon buttons',
    ),
    createCheck(
      'drawer_tabs_component_replaced',
      pxNumber(desktop.drawer.width) > 0
        && includesAll(desktop.drawer.activeTabBackground, ['47, 128, 255'])
        && pxNumber(desktop.drawer.tabHeight) <= 52,
      desktop.drawer,
      'compact drawer tab strip with cobalt active tab',
    ),
    createCheck(
      'timeline_component_replaced',
      includesAll(desktop.tasks.timelineBackground, ['18, 21, 25'])
        && desktop.tasks.timelineItemDisplay === 'grid',
      desktop.tasks,
      'graphite timeline section with grid rows',
    ),
    createCheck(
      'task_filters_component_replaced',
      includesAll(desktop.tasks.filterBackground, ['7', '9', '11'])
        && pxNumber(desktop.tasks.filterBorderRadius) >= 6,
      {
        filterBackground: desktop.tasks.filterBackground,
        filterBorderRadius: desktop.tasks.filterBorderRadius,
      },
      'dark structured filter inputs',
    ),
    createCheck(
      'overdue_task_card_component_replaced',
      includesAll(desktop.sampleTask.backgroundImage, ['18, 21, 25'])
        && desktop.sampleTask.borderLeftWidth === '2px'
        && includesAll(desktop.sampleTask.borderLeftColor, ['243', '93', '93'])
        && pxNumber(desktop.sampleTask.borderRadius) <= 6
        && desktop.sampleTask.boxShadow === 'none'
        && pxNumber(desktop.sampleTask.marginBottom) <= 1,
      desktop.sampleTask,
      'table-like graphite row with thin red status rail, not a rounded card stack',
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
