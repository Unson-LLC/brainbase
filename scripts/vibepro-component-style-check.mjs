import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium, devices } from 'playwright';

const DEFAULT_URL = 'http://localhost:31014';
const DEFAULT_RUN_DIR = 'docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260507-101513-command-center-redesign';
const EXPECTED_CSS_VERSION = '202605072345';

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
          <select class="task-status-select status-pending"><option>未着手</option></select>
          <div class="assignee-combobox">
            <button class="assignee-trigger">
              <span class="assignee-avatar" aria-hidden="true">OP</span>
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

    function pseudoStyle(selector, pseudo, property) {
      const element = document.querySelector(selector);
      if (!element) return null;
      return getComputedStyle(element, pseudo).getPropertyValue(property);
    }

    function activateInfoTab(tabName) {
      document.querySelectorAll('.info-drawer-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
      });
      document.querySelectorAll('.info-tab-content').forEach((content) => {
        content.classList.toggle('active', content.dataset.tab === tabName);
      });
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
            <select class="task-status-select status-pending"><option>未着手</option></select>
            <div class="assignee-combobox">
              <button class="assignee-trigger">
                <span class="assignee-avatar" aria-hidden="true">OP</span>
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

    function ensureSampleWiki() {
      const panel = document.querySelector('#wiki-panel');
      if (!panel || panel.querySelector('.wiki-idx-item')) return;
      panel.innerHTML = `
        <div class="wiki-idx">
          <div class="wiki-idx-header">
            <label class="wiki-idx-search-wrap">
              <i data-lucide="search"></i>
              <input type="text" class="wiki-idx-search" placeholder="Wiki を検索..." value="">
            </label>
            <button class="wiki-idx-scope" type="button"><span>スコープ: プロジェクト</span><i data-lucide="chevron-down"></i></button>
            <button class="wiki-idx-refresh" title="更新"><i data-lucide="refresh-cw"></i></button>
          </div>
          <div class="wiki-idx-table-head" aria-hidden="true"><span>名前</span><span>更新日時</span><span>アクセス</span></div>
          <div class="wiki-idx-list">
            <div class="wiki-idx-folder">
              <div class="wiki-idx-folder-header" data-folder="docs/dev" style="padding-left:4px">
                <i data-lucide="folder-open"></i><i data-lucide="chevron-down" class="wiki-idx-chevron"></i>
                <span class="wiki-idx-folder-label">開発ガイド</span><span class="wiki-idx-folder-count">5</span><span class="wiki-idx-status-dot warning"></span>
              </div>
              <div class="wiki-idx-item" data-path="docs/dev/setup" style="padding-left:20px">
                <i data-lucide="file-text" class="wiki-idx-item-icon"></i>
                <span class="wiki-idx-item-main"><span class="wiki-idx-item-title">開発環境セットアップ</span><span class="wiki-idx-item-path">/docs/dev/setup</span></span>
                <span class="wiki-idx-item-updated">05/07 20:12</span><span class="wiki-idx-item-access success">チーム</span>
              </div>
            </div>
          </div>
          <button class="wiki-idx-preview" type="button" data-path="docs/dev/setup">
            <i data-lucide="file-text"></i><span class="wiki-idx-preview-main"><span>開発環境セットアップ</span><small>/docs/dev/setup</small></span>
            <span class="wiki-idx-preview-meta">05/07 20:12</span><i data-lucide="external-link"></i>
          </button>
        </div>
      `;
      window.lucide?.createIcons?.();
    }

    function ensureSampleLiveFeed() {
      const panel = document.querySelector('#live-feed-panel');
      if (!panel) return;
      panel.innerHTML = `
        <div class="live-feed-container">
          <div class="live-feed-header">
            <div class="live-feed-status-wrap"><span class="live-feed-status active"><span class="live-feed-status-dot"></span>LIVE</span></div>
            <div class="live-feed-filter-group"><button class="feed-filter-btn active" data-filter="all" aria-pressed="true"><span>すべて</span><span class="feed-filter-count">3</span></button><button class="feed-filter-btn" data-filter="task" aria-pressed="false"><span>タスク</span><span class="feed-filter-count">1</span></button><button class="feed-filter-btn" data-filter="wiki" aria-pressed="false"><span>Wiki</span><span class="feed-filter-count">1</span></button><button class="feed-filter-btn" data-filter="session" aria-pressed="false"><span>セッション</span><span class="feed-filter-count">3</span></button><button class="feed-filter-btn" data-filter="system" aria-pressed="false"><span>システム</span><span class="feed-filter-count">1</span></button></div>
            <div class="live-feed-controls"><button class="feed-control-btn"><i data-lucide="pause"></i></button><button class="feed-control-btn"><i data-lucide="refresh-cw"></i></button><button class="feed-control-btn"><i data-lucide="sliders-horizontal"></i></button></div>
          </div>
          <div class="live-feed-list">
            <section class="feed-section">
              <div class="feed-section-label">NOW</div>
              <div class="feed-item" data-tone="working" data-category="task session">
                <div class="feed-item-time">11:34:52</div><div class="feed-item-rail"><span class="feed-item-dot working"></span></div>
                <div class="feed-item-icon feed-item-tone-working"><i data-lucide="terminal"></i></div>
                <div class="feed-item-content"><div class="feed-item-mainline"><span class="feed-item-label">ターミナル出力</span><span class="feed-item-status">stdout</span></div><div class="feed-item-meta-line"><span class="feed-item-task">#P1 VibePro component replacement</span><span class="feed-item-session">session-1</span></div><div class="feed-item-step">Wiki と Live Feed の見た目を合わせています</div></div>
                <div class="feed-item-actions"><button class="feed-item-action"><i data-lucide="external-link"></i></button><button class="feed-item-action"><i data-lucide="copy"></i></button></div>
              </div>
              <div class="feed-item" data-tone="done" data-category="wiki session">
                <div class="feed-item-time">11:33:47</div><div class="feed-item-rail"><span class="feed-item-dot done"></span></div>
                <div class="feed-item-icon feed-item-tone-done"><i data-lucide="file-text"></i></div>
                <div class="feed-item-content"><div class="feed-item-mainline"><span class="feed-item-label">Wiki 更新</span><span class="feed-item-status">完了</span></div><div class="feed-item-meta-line"><span class="feed-item-task">/docs/dev/setup</span><span class="feed-item-session">session-2</span></div></div>
                <div class="feed-item-actions"><button class="feed-item-action"><i data-lucide="external-link"></i></button><button class="feed-item-action"><i data-lucide="copy"></i></button></div>
              </div>
              <div class="feed-item" data-tone="blocked" data-category="system session">
                <div class="feed-item-time">11:12:33</div><div class="feed-item-rail"><span class="feed-item-dot blocked"></span></div>
                <div class="feed-item-icon feed-item-tone-blocked"><i data-lucide="square"></i></div>
                <div class="feed-item-content"><div class="feed-item-mainline"><span class="feed-item-label">システムイベント</span><span class="feed-item-status">停止中</span></div><div class="feed-item-meta-line"><span class="feed-item-session">session-3</span></div></div>
                <div class="feed-item-actions"><button class="feed-item-action"><i data-lucide="external-link"></i></button><button class="feed-item-action"><i data-lucide="copy"></i></button></div>
              </div>
            </section>
          </div>
          <div class="live-feed-footer"><span><span class="live-feed-footer-dot"></span>リアルタイム接続中</span><span>最終更新: 11:34:52</span><span>表示: すべて</span></div>
        </div>
      `;
      panel.querySelectorAll('.feed-filter-btn[data-filter]').forEach((button) => {
        button.addEventListener('click', () => {
          const filter = button.dataset.filter || 'all';
          panel.querySelectorAll('.feed-filter-btn[data-filter]').forEach((btn) => {
            const active = btn.dataset.filter === filter;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
          });
          panel.querySelectorAll('.feed-item').forEach((item) => {
            item.style.display = filter === 'all' || String(item.dataset.category || '').includes(filter) ? 'grid' : 'none';
          });
          const footerFilter = Array.from(panel.querySelectorAll('.live-feed-footer > span')).at(-1);
          const label = button.querySelector('span')?.textContent || 'すべて';
          if (footerFilter) footerFilter.textContent = `表示: ${label}`;
        });
      });
      window.lucide?.createIcons?.();
    }

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
      activityBarGlobalActions: {
        sidebarFooterExists: Boolean(document.querySelector('.sidebar .sidebar-footer')),
        inboxInActivityBar: Boolean(document.querySelector('.activity-bar-bottom #inbox-trigger-btn')),
        authInActivityBar: Boolean(document.querySelector('.activity-bar-bottom #auth-btn')),
        inboxInSidebar: Boolean(document.querySelector('.sidebar #inbox-trigger-btn')),
        authInSidebar: Boolean(document.querySelector('.sidebar #auth-btn')),
        inboxWidth: document.querySelector('.activity-bar-bottom #inbox-trigger-btn')?.getBoundingClientRect().width ?? null,
        authWidth: document.querySelector('.activity-bar-bottom #auth-btn')?.getBoundingClientRect().width ?? null,
        authBadgeClipPath: style('.activity-bar-bottom #auth-status-badge', 'clip-path'),
        inboxLabelClipPath: style('.activity-bar-bottom #inbox-trigger-btn .activity-bar-label', 'clip-path'),
        dropdownLeft: style('.activity-bar-bottom .inbox-dropdown', 'left'),
        inboxColor: style('.activity-bar-bottom #inbox-trigger-btn', 'color'),
        inboxBadgeBackground: style('.activity-bar-bottom #inbox-badge', 'background-color'),
        inboxBadgeBoxShadow: style('.activity-bar-bottom #inbox-badge', 'box-shadow'),
        authStatus: document.querySelector('.activity-bar-bottom #auth-btn')?.dataset.authStatus ?? null,
        authIconName: document.querySelector('.activity-bar-bottom #auth-btn [data-lucide]')?.getAttribute('data-lucide') ?? null,
        authIconClass: document.querySelector('.activity-bar-bottom #auth-btn svg, .activity-bar-bottom #auth-btn i')?.getAttribute('class') ?? null,
        authColor: style('.activity-bar-bottom #auth-btn', 'color'),
        authBackground: style('.activity-bar-bottom #auth-btn', 'background-color'),
        authBorderLeftColor: style('.activity-bar-bottom #auth-btn', 'border-left-color'),
        authStatusDotBackground: pseudoStyle('.activity-bar-bottom #auth-btn', '::after', 'background-color'),
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
        timelineMetaDisplay: style('#tasks-tab-content .timeline-meta', 'display'),
        timelineKindBadgeText: document.querySelector('#tasks-tab-content .timeline-kind-badge')?.textContent?.trim() ?? '',
        timelineAvatarCount: document.querySelectorAll('#tasks-tab-content .timeline-avatar').length,
        timelineStatusDotCount: document.querySelectorAll('#tasks-tab-content .timeline-status-dot').length,
        timelineNowLabelWidth: document.querySelector('#tasks-tab-content .timeline-now-label')?.getBoundingClientRect().width ?? null,
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
        taskHeaderToggleDisplay: style('#tasks-tab-content #toggle-all-tasks', 'display'),
        taskHeaderIconDisplay: style('#tasks-tab-content .next-tasks-section .section-header h3 svg, #tasks-tab-content .next-tasks-section .section-header h3 i', 'display'),
        taskFilterHeight: document.querySelector('#tasks-tab-content #nocodb-tasks-panel .task-filter')?.getBoundingClientRect().height ?? null,
        taskFilterGridColumns: style('#tasks-tab-content #nocodb-tasks-panel .task-filter', 'grid-template-columns'),
        taskFilterSearchTop: document.querySelector('#tasks-tab-content #nocodb-task-search')?.getBoundingClientRect().top ?? null,
        taskFilterAssigneeTop: document.querySelector('#tasks-tab-content #nocodb-assignee-filter')?.getBoundingClientRect().top ?? null,
        taskFilterProjectTop: document.querySelector('#tasks-tab-content #nocodb-project-filter')?.getBoundingClientRect().top ?? null,
        taskFilterSyncTop: document.querySelector('#tasks-tab-content #nocodb-sync-btn')?.getBoundingClientRect().top ?? null,
        taskFilterAssigneeLeft: document.querySelector('#tasks-tab-content #nocodb-assignee-filter')?.getBoundingClientRect().left ?? null,
        taskFilterSearchLeft: document.querySelector('#tasks-tab-content #nocodb-task-search')?.getBoundingClientRect().left ?? null,
        taskFilterProjectLeft: document.querySelector('#tasks-tab-content #nocodb-project-filter')?.getBoundingClientRect().left ?? null,
        taskFilterSyncLeft: document.querySelector('#tasks-tab-content #nocodb-sync-btn')?.getBoundingClientRect().left ?? null,
        taskFooterTop: document.querySelector('#tasks-tab-content #nocodb-tasks-panel .task-table-footer')?.getBoundingClientRect().top ?? null,
        taskListTop: document.querySelector('#tasks-tab-content #nocodb-tasks-list')?.getBoundingClientRect().top ?? null,
        taskFooterButtonText: document.querySelector('#tasks-tab-content #add-nocodb-task-btn')?.textContent?.trim() ?? '',
        taskFooterButtonBorder: style('#tasks-tab-content #add-nocodb-task-btn', 'border-top-width'),
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
        statusBackground: style('#tasks-tab-content .nocodb-task-item.overdue .task-status-select', 'background-color'),
        statusBorderRadius: style('#tasks-tab-content .nocodb-task-item.overdue .task-status-select', 'border-radius'),
        statusAppearance: style('#tasks-tab-content .nocodb-task-item.overdue .task-status-select', 'appearance'),
        assigneeAvatarWidth: document.querySelector('#tasks-tab-content .nocodb-task-item.overdue .assignee-avatar')?.getBoundingClientRect().width ?? null,
        assigneeAvatarText: document.querySelector('#tasks-tab-content .nocodb-task-item.overdue .assignee-avatar')?.textContent?.trim() ?? '',
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
      wiki: (() => {
        activateInfoTab('wiki');
        ensureSampleWiki();
        return {
          active: document.querySelector('#wiki-panel')?.classList.contains('active') ?? false,
          searchWrapDisplay: style('#wiki-panel .wiki-idx-search-wrap', 'display'),
          headerGridColumns: style('#wiki-panel .wiki-idx-table-head', 'grid-template-columns'),
          headerBorderBottomWidth: style('#wiki-panel .wiki-idx-table-head', 'border-bottom-width'),
          folderHeaderBorderBottomWidth: style('#wiki-panel .wiki-idx-folder-header', 'border-bottom-width'),
          folderHeaderBorderRadius: style('#wiki-panel .wiki-idx-folder-header', 'border-radius'),
          folderCountBackground: style('#wiki-panel .wiki-idx-folder-count', 'background-color'),
          statusDotCount: document.querySelectorAll('#wiki-panel .wiki-idx-status-dot').length,
          itemGridColumns: style('#wiki-panel .wiki-idx-item', 'grid-template-columns'),
          itemBorderBottomWidth: style('#wiki-panel .wiki-idx-item', 'border-bottom-width'),
          itemBorderRadius: style('#wiki-panel .wiki-idx-item', 'border-radius'),
          itemPathDisplay: style('#wiki-panel .wiki-idx-item-path', 'display'),
          itemUpdatedText: document.querySelector('#wiki-panel .wiki-idx-item-updated')?.textContent?.trim() ?? '',
          itemAccessText: document.querySelector('#wiki-panel .wiki-idx-item-access')?.textContent?.trim() ?? '',
          previewDisplay: style('#wiki-panel .wiki-idx-preview', 'display'),
          previewBorderTopWidth: style('#wiki-panel .wiki-idx-preview', 'border-top-width'),
        };
      })(),
      liveFeed: (() => {
        activateInfoTab('live-feed');
        ensureSampleLiveFeed();
        return {
          active: document.querySelector('#live-feed-panel')?.classList.contains('active') ?? false,
          headerDisplay: style('#live-feed-panel .live-feed-header', 'display'),
          headerGridColumns: style('#live-feed-panel .live-feed-header', 'grid-template-columns'),
          statusText: document.querySelector('#live-feed-panel .live-feed-status')?.textContent?.trim() ?? '',
          filterButtonCount: document.querySelectorAll('#live-feed-panel .feed-filter-btn').length,
          filterCountBadges: document.querySelectorAll('#live-feed-panel .feed-filter-count').length,
          taskFilterCountText: document.querySelector('#live-feed-panel .feed-filter-btn[data-filter="task"] .feed-filter-count')?.textContent?.trim() ?? '',
          activeFilterBackground: style('#live-feed-panel .feed-filter-btn.active', 'background-color'),
          controlButtonWidth: document.querySelector('#live-feed-panel .feed-control-btn')?.getBoundingClientRect().width ?? null,
          sectionLabelText: document.querySelector('#live-feed-panel .feed-section-label')?.textContent?.trim() ?? '',
          itemGridColumns: style('#live-feed-panel .feed-item', 'grid-template-columns'),
          itemBorderBottomWidth: style('#live-feed-panel .feed-item', 'border-bottom-width'),
          railBeforeBackground: pseudoStyle('#live-feed-panel .feed-item-rail', '::before', 'background-color'),
          dotCount: document.querySelectorAll('#live-feed-panel .feed-item-dot').length,
          actionCount: document.querySelectorAll('#live-feed-panel .feed-item-action').length,
          footerDisplay: style('#live-feed-panel .live-feed-footer', 'display'),
          footerText: document.querySelector('#live-feed-panel .live-feed-footer')?.textContent?.trim() ?? '',
          filterClick: (() => {
            const systemButton = document.querySelector('#live-feed-panel .feed-filter-btn[data-filter="system"]');
            systemButton?.click();
            const visibleItems = Array.from(document.querySelectorAll('#live-feed-panel .feed-item'))
              .filter((item) => getComputedStyle(item).display !== 'none');
            return {
              systemPressed: systemButton?.getAttribute('aria-pressed') ?? null,
              activeFilterText: document.querySelector('#live-feed-panel .feed-filter-btn.active')?.textContent?.trim() ?? '',
              visibleCount: visibleItems.length,
              firstVisibleLabel: visibleItems[0]?.querySelector('.feed-item-label')?.textContent?.trim() ?? '',
              footerText: document.querySelector('#live-feed-panel .live-feed-footer')?.textContent?.trim() ?? '',
            };
          })(),
        };
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
        && (includesAll(desktop.sessionRow.backgroundColor, ['0, 0, 0, 0'])
          || includesAll(desktop.sessionRow.backgroundColor, ['47', '128', '255']))
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
      'global_actions_moved_to_activity_bar',
      desktop.activityBarGlobalActions.sidebarFooterExists === false
        && desktop.activityBarGlobalActions.inboxInActivityBar === true
        && desktop.activityBarGlobalActions.authInActivityBar === true
        && desktop.activityBarGlobalActions.inboxInSidebar === false
        && desktop.activityBarGlobalActions.authInSidebar === false
        && pxNumber(desktop.activityBarGlobalActions.inboxWidth) === 42
        && pxNumber(desktop.activityBarGlobalActions.authWidth) === 42
        && desktop.activityBarGlobalActions.authBadgeClipPath.includes('inset')
        && desktop.activityBarGlobalActions.inboxLabelClipPath.includes('inset'),
      desktop.activityBarGlobalActions,
      'notification and auth controls must be icon actions in the global activity bar, not rows in the session list',
    ),
    createCheck(
      'global_action_status_components_are_legible',
      includesAll(desktop.activityBarGlobalActions.inboxColor, ['103', '179', '255'])
        && includesAll(desktop.activityBarGlobalActions.inboxBadgeBackground, ['243', '93', '93'])
        && includesAll(desktop.activityBarGlobalActions.inboxBadgeBoxShadow, ['243', '93', '93'])
        && ['anonymous', 'authenticated', 'checking', 'expired', 'unavailable'].includes(desktop.activityBarGlobalActions.authStatus)
        && (desktop.activityBarGlobalActions.authIconName === 'circle-user-round'
          || String(desktop.activityBarGlobalActions.authIconClass || '').includes('circle-user-round'))
        && (
          includesAll(desktop.activityBarGlobalActions.authStatusDotBackground, ['240', '180', '67'])
          || includesAll(desktop.activityBarGlobalActions.authStatusDotBackground, ['37', '194', '110'])
          || includesAll(desktop.activityBarGlobalActions.authStatusDotBackground, ['86', '160', '255'])
          || includesAll(desktop.activityBarGlobalActions.authStatusDotBackground, ['243', '93', '93'])
        )
        && !includesAll(desktop.activityBarGlobalActions.authColor, ['174', '184', '197']),
      desktop.activityBarGlobalActions,
      'notification must use a visible blue/red status treatment and auth must use a my-page icon with a colored login-state dot',
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
        && (desktop.sessionIcon.names.length + desktop.sessionIcon.labels.length) >= 1,
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
        && desktop.tasks.timelineItemDisplay === 'grid'
        && ['flex', 'inline-flex'].includes(desktop.tasks.timelineMetaDisplay)
        && ['会議', 'レビュー', 'タスク'].includes(desktop.tasks.timelineKindBadgeText)
        && (desktop.tasks.timelineAvatarCount + desktop.tasks.timelineStatusDotCount) > 0
        && pxNumber(desktop.tasks.timelineNowLabelWidth) <= 62,
      desktop.tasks,
      'flat timeline rows with approved badge, participant/status meta, and compact now marker',
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
      'next_task_toolbar_matches_approved_reference',
      desktop.tasks.taskHeaderToggleDisplay === 'none'
        && (desktop.tasks.taskHeaderIconDisplay === 'none' || desktop.tasks.taskHeaderIconDisplay === null)
        && pxNumber(desktop.tasks.taskFilterHeight) <= 52
        && Math.abs(desktop.tasks.taskFilterSearchTop - desktop.tasks.taskFilterAssigneeTop) <= 1
        && Math.abs(desktop.tasks.taskFilterAssigneeTop - desktop.tasks.taskFilterProjectTop) <= 1
        && Math.abs(desktop.tasks.taskFilterProjectTop - desktop.tasks.taskFilterSyncTop) <= 1
        && desktop.tasks.taskFilterAssigneeLeft < desktop.tasks.taskFilterSearchLeft
        && desktop.tasks.taskFilterSearchLeft < desktop.tasks.taskFilterProjectLeft
        && desktop.tasks.taskFilterProjectLeft < desktop.tasks.taskFilterSyncLeft
        && desktop.tasks.taskFooterTop > desktop.tasks.taskListTop
        && desktop.tasks.taskFooterButtonText.includes('タスクを追加')
        && desktop.tasks.taskFooterButtonBorder === '0px',
      {
        taskHeaderToggleDisplay: desktop.tasks.taskHeaderToggleDisplay,
        taskHeaderIconDisplay: desktop.tasks.taskHeaderIconDisplay,
        taskFilterHeight: desktop.tasks.taskFilterHeight,
        taskFilterGridColumns: desktop.tasks.taskFilterGridColumns,
        taskFilterSearchTop: desktop.tasks.taskFilterSearchTop,
        taskFilterAssigneeTop: desktop.tasks.taskFilterAssigneeTop,
        taskFilterProjectTop: desktop.tasks.taskFilterProjectTop,
        taskFilterSyncTop: desktop.tasks.taskFilterSyncTop,
        taskFilterAssigneeLeft: desktop.tasks.taskFilterAssigneeLeft,
        taskFilterSearchLeft: desktop.tasks.taskFilterSearchLeft,
        taskFilterProjectLeft: desktop.tasks.taskFilterProjectLeft,
        taskFilterSyncLeft: desktop.tasks.taskFilterSyncLeft,
        taskFooterTop: desktop.tasks.taskFooterTop,
        taskListTop: desktop.tasks.taskListTop,
        taskFooterButtonText: desktop.tasks.taskFooterButtonText,
        taskFooterButtonBorder: desktop.tasks.taskFooterButtonBorder,
      },
      'next-task header must be clean, filters must sit on one approved toolbar row, and add action must be in the footer row',
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
      'task_queue_cells_match_approved_components',
      pxNumber(desktop.sampleTask.statusBorderRadius) <= 4
        && pxNumber(desktop.sampleTask.assigneeAvatarWidth) >= 26
        && desktop.sampleTask.assigneeAvatarText.length > 0
        && includesAll(desktop.sampleTask.statusBackground, ['191', '201', '214']),
      {
        statusBackground: desktop.sampleTask.statusBackground,
        statusBorderRadius: desktop.sampleTask.statusBorderRadius,
        statusAppearance: desktop.sampleTask.statusAppearance,
        assigneeAvatarWidth: desktop.sampleTask.assigneeAvatarWidth,
        assigneeAvatarText: desktop.sampleTask.assigneeAvatarText,
      },
      'task queue status must read as a badge and assignee must be an avatar, not a generic icon control',
    ),
    createCheck(
      'wiki_tab_matches_generated_component',
      desktop.wiki.active === true
        && ['flex', 'inline-flex'].includes(desktop.wiki.searchWrapDisplay)
        && includesAll(desktop.wiki.headerGridColumns, ['112', '86'])
        && desktop.wiki.headerBorderBottomWidth === '1px'
        && desktop.wiki.folderHeaderBorderBottomWidth === '1px'
        && pxNumber(desktop.wiki.folderHeaderBorderRadius) === 0
        && includesAll(desktop.wiki.folderCountBackground, ['191', '201', '214'])
        && desktop.wiki.statusDotCount > 0
        && includesAll(desktop.wiki.itemGridColumns, ['18', '104', '72'])
        && desktop.wiki.itemBorderBottomWidth === '1px'
        && pxNumber(desktop.wiki.itemBorderRadius) === 0
        && desktop.wiki.itemPathDisplay !== 'none'
        && desktop.wiki.itemUpdatedText.length > 0
        && desktop.wiki.itemAccessText.length > 0
        && desktop.wiki.previewDisplay === 'grid'
        && desktop.wiki.previewBorderTopWidth === '1px',
      desktop.wiki,
      'Wiki tab must use the generated flat document index with toolbar, metadata columns, status dots, and preview strip',
    ),
    createCheck(
      'live_feed_tab_matches_generated_component',
      desktop.liveFeed.active === true
        && desktop.liveFeed.headerDisplay === 'grid'
        && desktop.liveFeed.statusText.includes('LIVE')
        && desktop.liveFeed.filterButtonCount >= 5
        && desktop.liveFeed.filterCountBadges >= 5
        && desktop.liveFeed.taskFilterCountText.length > 0
        && includesAll(desktop.liveFeed.activeFilterBackground, ['47', '128', '255'])
        && pxNumber(desktop.liveFeed.controlButtonWidth) === 32
        && desktop.liveFeed.sectionLabelText === 'NOW'
        && includesAll(desktop.liveFeed.itemGridColumns, ['70', '18', '24'])
        && desktop.liveFeed.itemBorderBottomWidth === '1px'
        && includesAll(desktop.liveFeed.railBeforeBackground, ['191', '201', '214'])
        && desktop.liveFeed.dotCount > 0
        && desktop.liveFeed.actionCount >= 2
        && desktop.liveFeed.footerDisplay === 'flex'
        && desktop.liveFeed.footerText.includes('表示:')
        && desktop.liveFeed.filterClick.systemPressed === 'true'
        && desktop.liveFeed.filterClick.visibleCount >= 1
        && desktop.liveFeed.filterClick.firstVisibleLabel.includes('システム')
        && desktop.liveFeed.filterClick.footerText.includes('表示: システム'),
      desktop.liveFeed,
      'Live Feed tab must use the generated timeline stream with live controls, segmented filters, rail dots, row actions, and footer status',
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
