// ES Modules imports
import { MAX_VISIBLE_TASKS } from './modules/state.js';
import { formatDueDate } from './modules/ui-helpers.js';
import { initSettings, openSettings } from './modules/settings.js';
import { pollSessionStatus, updateSessionIndicators, clearDone, startPolling } from './modules/session-indicators.js';
import { initFileUpload } from './modules/file-upload.js';
// New refactored modules
import { getProjectPath, getProjectFromPath } from './modules/project-mapping.js';
import { fetchState, saveState, updateSession, removeSession, addSession } from './modules/state-api.js';
import { getFocusTask, sortTasksByPriority, filterTasks, getNextPriority } from './modules/task-manager.js';
import { groupSessionsByProject, createSessionId, buildSessionObject } from './modules/session-manager.js';
import { renderSessionRowHTML, renderSessionGroupHeaderHTML } from './modules/session-list-renderer.js';
import { renderFocusTaskHTML, renderNextTaskItemHTML, renderTimelineEventHTML } from './modules/right-panel-renderer.js';
import { renderArchiveListHTML } from './modules/archive-modal-renderer.js';
import { formatTimelineHTML, getCurrentTimeStr } from './modules/timeline-controller.js';
import { loadTasksFromAPI, completeTask, deferTaskPriority, updateTask, deleteTaskById } from './modules/task-controller.js';
import { filterArchivedSessions, sortByCreatedDate, getUniqueProjects } from './modules/archive-modal-controller.js';
import { archiveSessionAPI, mergeSession, restoreSessionAPI } from './modules/session-controller.js';
import { showToast, showSuccess, showError, showInfo } from './modules/toast.js';
import { showConfirm } from './modules/confirm-modal.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- State & Elements ---
    let sessions = [];
    let currentSessionId = null;
    let tasks = [];
    let schedule = null;
    let showAllTasks = false;
    // MAX_VISIBLE_TASKS moved to modules/state.js

    const terminalFrame = document.getElementById('terminal-frame');
    const sessionList = document.getElementById('session-list');
    const addSessionBtn = document.getElementById('add-session-btn');

    // New UI Elements
    const focusTaskEl = document.getElementById('focus-task');
    const timelineListEl = document.getElementById('timeline-list');
    const nextTasksListEl = document.getElementById('next-tasks-list');
    const remainingToggleEl = document.getElementById('remaining-tasks-toggle');
    const remainingCountEl = document.getElementById('remaining-count');
    const showMoreBtn = document.getElementById('show-more-tasks');
    const taskFilterInput = document.getElementById('task-filter-input');
    let taskFilter = '';

    // Modal Elements
    const editModal = document.getElementById('edit-task-modal');
    const editTaskId = document.getElementById('edit-task-id');
    const editTaskTitle = document.getElementById('edit-task-title');
    const editTaskProject = document.getElementById('edit-task-project');
    const editTaskPriority = document.getElementById('edit-task-priority');
    const editTaskDue = document.getElementById('edit-task-due');
    const closeModalBtns = document.querySelectorAll('.close-modal-btn');
    const saveTaskBtn = document.getElementById('save-task-btn');

    // Terminal Copy Modal Elements
    const copyTerminalBtn = document.getElementById('copy-terminal-btn');
    const copyTerminalModal = document.getElementById('copy-terminal-modal');
    const terminalContentDisplay = document.getElementById('terminal-content-display');
    const copyContentBtn = document.getElementById('copy-content-btn');
    // Focus Engine Modal Elements
    const focusEngineModal = document.getElementById('focus-engine-modal');
    const focusEngineButtons = focusEngineModal?.querySelectorAll('.engine-select-btn');
    const focusBtn = document.getElementById('focus-btn');
    let pendingFocusTask = null;

    // Archive Modal
    const archiveModal = document.getElementById('archive-modal');
    const archiveSearchInput = document.getElementById('archive-search');
    const archiveProjectFilter = document.getElementById('archive-project-filter');
    const archiveListEl = document.getElementById('archive-list');
    const archiveEmptyEl = document.getElementById('archive-empty');
    const toggleArchivedBtn = document.getElementById('toggle-archived-btn');

    // Inbox Elements
    const inboxTriggerBtn = document.getElementById('inbox-trigger-btn');
    const inboxDropdown = document.getElementById('inbox-dropdown');
    const inboxListEl = document.getElementById('inbox-list');
    const inboxBadge = document.getElementById('inbox-badge');
    const markAllDoneBtn = document.getElementById('mark-all-done-btn');
    let inboxItems = [];
    let inboxOpen = false;

    // Session Drag & Drop State
    let draggedSessionId = null;
    let draggedSessionProject = null;

    // --- Data Loading ---
    async function loadVersion() {
        try {
            const response = await fetch('/api/version');
            const data = await response.json();
            const versionEl = document.getElementById('app-version');
            const mobileVersionEl = document.getElementById('mobile-app-version');
            if (versionEl) {
                versionEl.textContent = data.version;
            }
            if (mobileVersionEl) {
                mobileVersionEl.textContent = data.version;
            }
        } catch (err) {
            console.error('Failed to load version', err);
        }
    }

    async function loadSessions() {
        try {
            const state = await fetchState();
            sessions = state.sessions || [];

            // Check active session from URL or state
            if (!currentSessionId && sessions.length > 0) {
                // Optional: Auto-select first session
                // switchSession(sessions[0].id, sessions[0].path, sessions[0].initialCommand);
            }
            renderSessionList();
        } catch (error) {
            console.error('Failed to load sessions:', error);
        }
    }

    async function loadTasks() {
        try {
            const res = await fetch(`/api/tasks?t=${Date.now()}`);
            if (res.ok) {
                const text = await res.text();
                tasks = JSON.parse(text);
                renderRightPanel();
            } else {
                console.error("Failed to fetch tasks:", res.status);
            }
        } catch (error) {
            console.error('Failed to load tasks:', error);
            nextTasksListEl.innerHTML = '<div class="error">Failed to load tasks</div>';
        }
    }

    async function loadSchedule() {
        try {
            const res = await fetch('/api/schedule/today');
            schedule = await res.json();
            renderRightPanel();
        } catch (error) {
            console.error('Failed to load schedule:', error);
            timelineListEl.innerHTML = '<div class="error">Failed to load schedule</div>';
        }
    }

    // --- Inbox Loading & Rendering ---
    async function loadInbox() {
        try {
            const res = await fetch(`/api/inbox/pending?t=${Date.now()}`);
            if (res.ok) {
                inboxItems = await res.json();
                renderInbox();
            } else {
                console.error("Failed to fetch inbox:", res.status);
            }
        } catch (error) {
            console.error('Failed to load inbox:', error);
            inboxListEl.innerHTML = '<div class="error">Failed to load inbox</div>';
        }
    }

    function renderInbox() {
        // Show/hide trigger based on items
        if (inboxItems.length === 0) {
            inboxTriggerBtn.style.display = 'none';
            inboxDropdown.classList.remove('open');
            inboxOpen = false;
            return;
        }

        inboxTriggerBtn.style.display = 'flex';
        inboxBadge.textContent = inboxItems.length;

        inboxListEl.innerHTML = inboxItems.map(item => {
            const time = item.title ? item.title.split(' | ')[0] : '';
            const channel = item.channel || '';
            const sender = item.sender || '';
            const message = item.message || '';

            return `
                <div class="inbox-item" data-id="${item.id}">
                    <div class="inbox-item-message">${escapeHtml(message)}</div>
                    <div class="inbox-item-meta">
                        <span class="inbox-item-sender">${sender}</span>
                        <span class="inbox-item-channel">#${channel}</span>
                    </div>
                    <div class="inbox-item-footer">
                        ${item.slackUrl ? `<a href="${item.slackUrl}" target="_blank" class="inbox-slack-link">Slackで開く</a>` : ''}
                        <button class="inbox-done-btn" data-id="${item.id}">確認済み</button>
                    </div>
                </div>
            `;
        }).join('');

        // Add event listeners
        inboxListEl.querySelectorAll('.inbox-done-btn').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                await markInboxItemDone(btn.dataset.id);
            };
        });

        lucide.createIcons();
    }

    // Toggle inbox dropdown
    if (inboxTriggerBtn) {
        inboxTriggerBtn.onclick = (e) => {
            e.stopPropagation();
            inboxOpen = !inboxOpen;
            inboxDropdown.classList.toggle('open', inboxOpen);
        };
    }

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (inboxOpen && !inboxDropdown.contains(e.target) && !inboxTriggerBtn.contains(e.target)) {
            inboxOpen = false;
            inboxDropdown.classList.remove('open');
        }
    });

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async function markInboxItemDone(itemId) {
        try {
            const res = await fetch(`/api/inbox/${encodeURIComponent(itemId)}/done`, {
                method: 'POST'
            });
            if (res.ok) {
                // Animate removal
                const itemEl = inboxListEl.querySelector(`[data-id="${itemId}"]`);
                if (itemEl) {
                    itemEl.classList.add('fade-out');
                    setTimeout(() => {
                        loadInbox();
                    }, 300);
                } else {
                    loadInbox();
                }
            } else {
                showError('確認済みにできませんでした');
            }
        } catch (error) {
            console.error('Failed to mark inbox item done:', error);
            showError('確認済みにできませんでした');
        }
    }

    async function markAllInboxDone() {
        try {
            const res = await fetch('/api/inbox/mark-all-done', {
                method: 'POST'
            });
            if (res.ok) {
                showSuccess('すべて確認済みにしました');
                loadInbox();
            } else {
                showError('処理に失敗しました');
            }
        } catch (error) {
            console.error('Failed to mark all inbox done:', error);
            showError('処理に失敗しました');
        }
    }

    // Mark All Done button handler
    if (markAllDoneBtn) {
        markAllDoneBtn.onclick = async () => {
            if (inboxItems.length === 0) return;
            if (await showConfirm(`${inboxItems.length}件すべてを確認済みにしますか？`, { title: '一括確認', okText: '確認済みにする' })) {
                await markAllInboxDone();
            }
        };
    }

    // --- Right Panel Rendering (UX Redesign) ---
    function renderRightPanel() {
        renderFocusTask();
        renderTimeline();
        renderNextTasks();
        lucide.createIcons();
        // Set focus task events AFTER lucide replaces icons
        setupFocusTaskEvents();
    }

    function setupFocusTaskEvents() {
        const startBtn = focusTaskEl.querySelector('.focus-btn-start');
        if (startBtn) {
            startBtn.onclick = (e) => {
                e.stopPropagation();
                const taskId = startBtn.dataset.id;
                const task = tasks.find(t => t.id === taskId);
                if (task) openFocusEngineModal(task);
            };
        }
        const completeBtn = focusTaskEl.querySelector('.focus-btn-complete');
        if (completeBtn) {
            completeBtn.onclick = (e) => {
                e.stopPropagation();
                const taskId = completeBtn.dataset.id;
                completeTaskWithAnimation(taskId, '.focus-card');
            };
        }
        const deferBtn = focusTaskEl.querySelector('.focus-btn-defer');
        if (deferBtn) {
            deferBtn.onclick = (e) => {
                e.stopPropagation();
                const taskId = deferBtn.dataset.id;
                deferTask(taskId);
            };
        }
    }

    // getFocusTask moved to modules/task-manager.js

    function renderFocusTask() {
        const focusTask = getFocusTask(tasks);

        if (!focusTask) {
            focusTaskEl.innerHTML = `
                <div class="focus-empty">
                    <i data-lucide="check-circle-2"></i>
                    <div>タスクなし</div>
                </div>
            `;
            return;
        }

        const isUrgent = focusTask.due && new Date(focusTask.due) <= new Date(Date.now() + 24 * 60 * 60 * 1000);
        const dueText = focusTask.due ? formatDueDate(focusTask.due) : '';

        focusTaskEl.innerHTML = `
            <div class="focus-card" data-task-id="${focusTask.id}">
                <div class="focus-card-title">${focusTask.name}</div>
                <div class="focus-card-meta">
                    <span class="project-tag">${focusTask.project || 'general'}</span>
                    ${dueText ? `<span class="due-tag ${isUrgent ? 'urgent' : ''}"><i data-lucide="clock"></i>${dueText}</span>` : ''}
                </div>
                <div class="focus-card-actions">
                    <button class="focus-btn-start" data-id="${focusTask.id}">
                        <i data-lucide="terminal-square"></i> 開始
                    </button>
                    <button class="focus-btn-complete" data-id="${focusTask.id}">
                        <i data-lucide="check"></i> 完了
                    </button>
                    <button class="focus-btn-defer" data-id="${focusTask.id}">
                        <i data-lucide="arrow-right"></i> 後で
                    </button>
                </div>
            </div>
        `;
        // Event handlers are set in setupFocusTaskEvents() after lucide.createIcons()
    }

    function renderTimeline() {
        const events = schedule?.items || [];
        timelineListEl.innerHTML = formatTimelineHTML(events, getCurrentTimeStr());
    }

    function renderNextTasks() {
        const focusTask = getFocusTask(tasks);
        // Use imported filterTasks and sortTasksByPriority
        // Filter by owner: show only tasks assigned to 佐藤圭吾
        const activeTasks = tasks.filter(t =>
            t.status !== 'done' &&
            (!focusTask || t.id !== focusTask.id) &&
            t.owner === '佐藤圭吾'
        );
        const filteredTasks = filterTasks(activeTasks, taskFilter);
        const otherTasks = sortTasksByPriority(filteredTasks);

        const visibleTasks = showAllTasks ? otherTasks : otherTasks.slice(0, MAX_VISIBLE_TASKS);
        const remainingCount = otherTasks.length - MAX_VISIBLE_TASKS;

        if (otherTasks.length === 0) {
            nextTasksListEl.innerHTML = '<div class="timeline-empty">他のタスクなし</div>';
            remainingToggleEl.style.display = 'none';
            return;
        }

        // Use imported renderNextTaskItemHTML
        const html = visibleTasks.map(task => renderNextTaskItemHTML(task)).join('');

        nextTasksListEl.innerHTML = html;

        // Checkbox handlers
        nextTasksListEl.querySelectorAll('.next-task-checkbox').forEach(checkbox => {
            checkbox.onclick = (e) => {
                e.stopPropagation();
                const taskId = checkbox.dataset.id;
                completeTaskWithAnimation(taskId, `.next-task-item[data-task-id="${taskId}"]`);
            };
        });

        // Start session handlers
        nextTasksListEl.querySelectorAll('.start-task-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const taskId = btn.dataset.id;
                const task = tasks.find(t => t.id === taskId);
                if (task) openFocusEngineModal(task);
            };
        });

        // Edit handlers
        nextTasksListEl.querySelectorAll('.edit-task-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const taskId = btn.dataset.id;
                const task = tasks.find(t => t.id === taskId);
                if (task) openEditModal(task);
            };
        });

        // Delete handlers
        nextTasksListEl.querySelectorAll('.delete-task-btn').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const taskId = btn.dataset.id;
                if (await showConfirm('タスクを削除しますか？', { title: '削除確認', okText: '削除' })) {
                    deleteTaskLocal(taskId);
                }
            };
        });

        // Show/hide remaining toggle
        if (remainingCount > 0 && !showAllTasks) {
            remainingToggleEl.style.display = 'block';
            remainingCountEl.textContent = remainingCount;
        } else {
            remainingToggleEl.style.display = 'none';
        }
    }

    // --- Helper Functions ---
    // formatDueDate moved to modules/ui-helpers.js

    async function completeTaskWithAnimation(taskId, selector) {
        const el = document.querySelector(selector);
        if (el) {
            el.classList.add('completing');
            await new Promise(r => setTimeout(r, 400));
        }
        await updateTaskStatus(taskId, 'done');
    }

    async function deferTask(taskId) {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;
        try {
            await deferTaskPriority(taskId, task.priority);
            loadTasks();
        } catch (err) {
            console.error('Failed to defer task:', err);
        }
    }

    // Show more tasks toggle
    if (showMoreBtn) {
        showMoreBtn.onclick = () => {
            showAllTasks = !showAllTasks;
            renderNextTasks();
            lucide.createIcons();
        };
    }

    // Task filter input
    if (taskFilterInput) {
        taskFilterInput.oninput = () => {
            taskFilter = taskFilterInput.value;
            renderNextTasks();
            lucide.createIcons();
        };
    }

    // --- Rendering ---
    function renderSessionList() {
        sessionList.innerHTML = '';

        // Use imported groupSessionsByProject
        const output = groupSessionsByProject(sessions, {
            excludeArchived: true,
            includeEmptyProjects: true
        });

        for (const [project, projectSessions] of Object.entries(output)) {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'session-group';

            // Use imported renderSessionGroupHeaderHTML
            const isExpanded = true;
            const header = document.createElement('div');
            header.innerHTML = renderSessionGroupHeaderHTML(project, { isExpanded });
            const headerEl = header.firstElementChild;

            // Toggle expand
            headerEl.addEventListener('click', (e) => {
                if (!e.target.closest('.add-project-session-btn')) {
                    const container = groupDiv.querySelector('.session-group-children');
                    container.style.display = container.style.display === 'none' ? 'block' : 'none';
                    const icon = headerEl.querySelector('.folder-icon i');
                    icon.setAttribute('data-lucide', container.style.display === 'none' ? 'folder' : 'folder-open');
                    lucide.createIcons();
                }
            });

            // Add new session to project
            headerEl.querySelector('.add-project-session-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                createNewSession(project);
            });

            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'session-group-children';

            projectSessions.forEach(session => {
                // Use imported renderSessionRowHTML
                const wrapper = document.createElement('div');
                wrapper.innerHTML = renderSessionRowHTML(session, {
                    isActive: currentSessionId === session.id,
                    project
                });
                const childRow = wrapper.firstElementChild;

                childRow.addEventListener('click', (e) => {
                    if (!e.target.closest('button') && !e.target.closest('input')) {
                        switchSession(session.id, session.path, session.initialCommand);
                    }
                });

                // Mobile Menu Toggle Logic
                const menuToggle = childRow.querySelector('.session-menu-toggle');
                const childActions = childRow.querySelector('.child-actions');
                if (menuToggle && childActions) {
                    menuToggle.onclick = (e) => {
                        e.stopPropagation();
                        // Close all other open menus
                        document.querySelectorAll('.child-actions.active').forEach(actions => {
                            if (actions !== childActions) {
                                actions.classList.remove('active');
                            }
                        });
                        // Toggle this menu
                        childActions.classList.toggle('active');
                    };
                }

                // Close menu when clicking outside
                document.addEventListener('click', (e) => {
                    if (childActions && !childRow.contains(e.target)) {
                        childActions.classList.remove('active');
                    }
                });

                // Rename Logic
                const renameBtn = childRow.querySelector('.rename-session-btn');
                renameBtn.onclick = (e) => {
                    e.stopPropagation();
                    const nameSpan = childRow.querySelector('.session-name');
                    const currentName = session.name || session.id;

                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = currentName;
                    input.className = 'rename-input';
                    input.onclick = (ev) => ev.stopPropagation();

                    nameSpan.replaceWith(input);
                    input.focus();

                    const saveName = async () => {
                        const newName = input.value.trim();
                        if (newName && newName !== currentName) {
                            try {
                                await updateSession(session.id, { name: newName });
                                loadSessions();
                            } catch (err) {
                                console.error('Failed to rename', err);
                            }
                        } else {
                            loadSessions();
                        }
                    };

                    input.addEventListener('blur', saveName);
                    input.addEventListener('keydown', (ev) => {
                        if (ev.key === 'Enter' && !ev.isComposing) {
                            saveName();
                        }
                    });
                };

                // Delete Logic - use imported removeSession
                const deleteBtn = childRow.querySelector('.delete-session-btn');
                const displayName = session.name || session.id;
                deleteBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (await showConfirm(`セッション「${displayName}」を削除しますか？`, { title: '削除確認', okText: '削除' })) {
                        try {
                            await removeSession(session.id);
                            if (currentSessionId === session.id) {
                                terminalFrame.src = 'about:blank';
                                currentSessionId = null;
                            }
                            loadSessions();
                        } catch (err) {
                            console.error('Failed to delete session', err);
                        }
                    }
                };

                // Merge Logic - Send /merge command to Claude Code
                const mergeBtn = childRow.querySelector('.merge-session-btn');
                if (mergeBtn) {
                    mergeBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (!await showConfirm(
                            `「${displayName}」の変更をmainブランチにマージしますか？\n\nClaude Codeで /merge コマンドを実行します。`,
                            { title: 'マージ確認', okText: 'マージ', danger: false }
                        )) {
                            return;
                        }

                        try {
                            // Send /merge command to Claude Code via tmux
                            await fetch(`/api/sessions/${session.id}/input`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ input: '/merge', type: 'text' })
                            });
                            // Send Enter key to execute the command
                            await fetch(`/api/sessions/${session.id}/input`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ input: 'Enter', type: 'key' })
                            });

                            showSuccess('/merge コマンドを送信しました');
                        } catch (err) {
                            console.error('Failed to send merge command', err);
                            showError('/merge コマンドの送信に失敗しました');
                        }
                    };
                }

                // Restart Logic (ttyd未起動セッションの再起動)
                const restartBtn = childRow.querySelector('.restart-session-btn');
                if (restartBtn) {
                    restartBtn.onclick = async (e) => {
                        e.stopPropagation();
                        try {
                            showInfo(`「${displayName}」のターミナルを起動中...`);
                            const result = await restoreSessionAPI(session.id, session.engine || 'claude');
                            if (result.success || result.port) {
                                showSuccess(`「${displayName}」のターミナルを起動しました`);
                                await loadSessions();
                                switchSession(session.id, session.path, session.initialCommand);
                            } else if (result.error) {
                                showError(`起動失敗: ${result.error}`);
                            }
                        } catch (err) {
                            console.error('Failed to restart session', err);
                            showError('ターミナルの起動に失敗しました');
                        }
                    };
                }

                // Archive Logic (with worktree merge check)
                const archiveBtn = childRow.querySelector('.archive-session-btn');
                archiveBtn.onclick = async (e) => {
                    e.stopPropagation();
                    const newArchivedState = !session.archived;

                    if (newArchivedState) {
                        // Archiving - use imported archiveSessionAPI and mergeSession
                        try {
                            const result = await archiveSessionAPI(session.id);

                            if (result.needsConfirmation) {
                                const mergeChoice = await showConfirm(
                                    `「${displayName}」に未マージの変更があります:\n` +
                                    `・${result.status.commitsAhead || 0} コミット先行\n` +
                                    `・${result.status.hasUncommittedChanges ? '未コミットの変更あり' : '未コミットの変更なし'}\n\n` +
                                    `マージしてからアーカイブしますか？`,
                                    { title: '未マージの変更', okText: 'マージしてアーカイブ', danger: false }
                                );

                                if (!mergeChoice) return;

                                const mergeResult = await mergeSession(session.id);

                                if (!mergeResult.success) {
                                    const discardChoice = await showConfirm(
                                        `マージに失敗しました: ${mergeResult.error}\n\n` +
                                        `変更を破棄してアーカイブしますか？`,
                                        { title: 'マージ失敗', okText: '破棄してアーカイブ' }
                                    );
                                    if (!discardChoice) return;
                                }

                                await archiveSessionAPI(session.id);
                            }

                            loadSessions();
                        } catch (err) {
                            console.error('Failed to archive session', err);
                        }
                    } else {
                        // Unarchiving - use imported updateSession
                        try {
                            await updateSession(session.id, { archived: false });
                            loadSessions();
                        } catch (err) {
                            console.error('Failed to unarchive session', err);
                        }
                    }
                };

                // --- Session Drag & Drop ---
                childRow.addEventListener('dragstart', (e) => {
                    draggedSessionId = session.id;
                    draggedSessionProject = project;
                    childRow.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', session.id);
                });

                childRow.addEventListener('dragend', () => {
                    draggedSessionId = null;
                    draggedSessionProject = null;
                    childRow.classList.remove('dragging');
                    document.querySelectorAll('.session-child-row.drag-over').forEach(el => {
                        el.classList.remove('drag-over');
                    });
                });

                childRow.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (draggedSessionId && draggedSessionProject === project && draggedSessionId !== session.id) {
                        e.dataTransfer.dropEffect = 'move';
                        childRow.classList.add('drag-over');
                    }
                });

                childRow.addEventListener('dragleave', (e) => {
                    e.preventDefault();
                    childRow.classList.remove('drag-over');
                });

                childRow.addEventListener('drop', async (e) => {
                    // Capture values immediately before async operations (dragend may reset them)
                    const droppedSessionId = draggedSessionId;
                    const droppedSessionProject = draggedSessionProject;

                    e.preventDefault();
                    e.stopPropagation();
                    childRow.classList.remove('drag-over');

                    if (!droppedSessionId || droppedSessionProject !== project || droppedSessionId === session.id) {
                        return;
                    }

                    try {
                        const currentState = await fetchState();
                        const sessions = currentState.sessions || [];

                        const draggedIndex = sessions.findIndex(s => s.id === droppedSessionId);
                        const targetIndex = sessions.findIndex(s => s.id === session.id);
                        if (draggedIndex === -1 || targetIndex === -1) return;

                        // Remove dragged item from array
                        const [draggedSession] = sessions.splice(draggedIndex, 1);

                        // Calculate new target index after removal
                        const adjustedTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;

                        // Insert at the adjusted target position
                        sessions.splice(adjustedTargetIndex, 0, draggedSession);

                        await saveState({ ...currentState, sessions });

                        // Update DOM directly instead of full reload
                        const draggedEl = document.querySelector(`.session-child-row[data-id="${droppedSessionId}"]`);
                        const targetEl = document.querySelector(`.session-child-row[data-id="${session.id}"]`);
                        if (draggedEl && targetEl) {
                            targetEl.parentNode.insertBefore(draggedEl, targetEl);
                        }
                    } catch (err) {
                        console.error('Failed to reorder sessions', err);
                    }
                });

                childrenDiv.appendChild(childRow);
            });

            groupDiv.appendChild(headerEl);
            groupDiv.appendChild(childrenDiv);
            sessionList.appendChild(groupDiv);
        }

        lucide.createIcons();
        updateSessionIndicators(); // Restore indicators
    }

    // --- Actions ---

    // Projects that are .gitignored (no need for worktree)
    const GITIGNORED_PROJECTS = ['baao', 'salestailor', 'tech-knight', 'unson', 'zeims', 'ncom', 'senrigan'];

    // Create Session Modal elements
    const createSessionModal = document.getElementById('create-session-modal');
    const sessionNameInput = document.getElementById('session-name-input');
    const sessionCommandInput = document.getElementById('session-command-input');
    const useWorktreeCheckbox = document.getElementById('use-worktree-checkbox');
    const worktreeHint = document.getElementById('worktree-hint');
    const createSessionBtn = document.getElementById('create-session-btn');
    let pendingSessionProject = 'general';

    function openCreateSessionModal(project = 'general') {
        pendingSessionProject = project;
        const isGitignored = GITIGNORED_PROJECTS.includes(project.toLowerCase());

        // Set defaults
        sessionNameInput.value = `New ${project} Session`;
        sessionCommandInput.value = '';
        useWorktreeCheckbox.checked = !isGitignored;

        // Update hint based on project
        if (isGitignored) {
            worktreeHint.textContent = `${project}は.gitignore対象のため、通常セッションを推奨`;
        } else {
            worktreeHint.textContent = 'ブランチを分離して安全に作業できます';
        }

        createSessionModal.classList.add('active');
        sessionNameInput.focus();
        sessionNameInput.select();
    }

    function closeCreateSessionModal() {
        createSessionModal.classList.remove('active');
    }

    // Modal event listeners
    createSessionModal.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', closeCreateSessionModal);
    });
    createSessionModal.addEventListener('click', (e) => {
        if (e.target === createSessionModal) closeCreateSessionModal();
    });

    createSessionBtn.addEventListener('click', () => {
        const name = sessionNameInput.value.trim();
        if (!name) {
            sessionNameInput.focus();
            return;
        }
        const engine = document.querySelector('input[name="session-engine"]:checked')?.value || 'claude';
        closeCreateSessionModal();
        executeCreateSession(pendingSessionProject, name, sessionCommandInput.value, useWorktreeCheckbox.checked, engine);
    });

    // Enter key to submit (IME変換中は除外)
    sessionNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
            createSessionBtn.click();
        }
    });
    sessionCommandInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
            createSessionBtn.click();
        }
    });

    function createNewSession(project = 'general') {
        openCreateSessionModal(project);
    }

    async function executeCreateSession(project, name, initialCommand, useWorktree, engine = 'claude') {
        const repoPath = getProjectPath(project);
        const sessionId = createSessionId('session');

        try {
            if (useWorktree) {
                // Create session with worktree
                const res = await fetch('/api/sessions/create-with-worktree', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, repoPath, name, initialCommand, engine })
                });

                if (res.ok) {
                    const { proxyPath, session } = await res.json();
                    await loadSessions();
                    switchSession(sessionId, session.path, initialCommand);
                } else {
                    showError('Worktreeセッションの作成に失敗。通常セッションで作成します。');
                    await createRegularSession(sessionId, name, repoPath, initialCommand, engine);
                }
            } else {
                // Create regular session (no worktree)
                await createRegularSession(sessionId, name, repoPath, initialCommand, engine);
            }
        } catch (error) {
            console.error('Error creating session:', error);
            showError('セッション作成エラー');
        }
    }

    async function createRegularSession(sessionId, name, repoPath, initialCommand, engine = 'claude') {
        const res = await fetch('/api/sessions/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, initialCommand, cwd: repoPath, engine })
        });

        if (res.ok) {
            // Use imported buildSessionObject and addSession
            const newSession = buildSessionObject({
                id: sessionId,
                name,
                path: repoPath,
                initialCommand,
                engine
            });
            await addSession(newSession);

            await loadSessions();
            switchSession(sessionId, repoPath, initialCommand);
        } else {
            showError('セッションの開始に失敗しました');
        }
    }

    async function startTaskSession(task, engineOverride) {
        // Use imported getProjectPath and createSessionId
        const repoPath = getProjectPath(task.project);
        const sessionId = createSessionId('task', task.id);
        const name = `Task: ${task.name}`;
        const initialCommand = `/task ${task.id}`;
        const engine = engineOverride || 'claude';

        try {
            // Try to create session with worktree first
            const res = await fetch('/api/sessions/create-with-worktree', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, repoPath, name, initialCommand, engine })
            });

            if (res.ok) {
                const { proxyPath, session } = await res.json();

                await updateTaskStatus(task.id, 'in-progress');
                await loadSessions();

                // Use proxyPath directly instead of calling switchSession
                currentSessionId = sessionId;
                document.querySelectorAll('.session-child-row').forEach(row => {
                    row.classList.remove('active');
                    if (row.dataset.id === sessionId) row.classList.add('active');
                });
                terminalFrame.src = proxyPath;
            } else {
                // Fallback to regular session (non-git repo)
                // Use workspace root if specific repo doesn't exist
                const fallbackCwd = '/Users/ksato/workspace';
                const fallbackRes = await fetch('/api/sessions/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, initialCommand, cwd: fallbackCwd, engine })
                });

                if (fallbackRes.ok) {
                    const { proxyPath } = await fallbackRes.json();

                    // Use imported buildSessionObject and addSession
                    const newSession = buildSessionObject({
                        id: sessionId,
                        name,
                        path: repoPath,
                        taskId: task.id,
                        initialCommand,
                        engine
                    });
                    await addSession(newSession);

                    await updateTaskStatus(task.id, 'in-progress');
                    await loadSessions();

                    currentSessionId = sessionId;
                    terminalFrame.src = proxyPath;
                } else {
                    showError('セッションの開始に失敗しました');
                }
            }
        } catch (error) {
            console.error('Error starting task session:', error);
            showError('セッション作成エラー');
        }
    }

    async function switchSession(id, path, initialCommand) {
        currentSessionId = id;

        // Update UI active state
        document.querySelectorAll('.session-child-row').forEach(row => {
            row.classList.remove('active');
            if (row.dataset.id === id) row.classList.add('active');
        });

        // Ensure backend process is running and get port
        try {
            const res = await fetch('/api/sessions/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: id, initialCommand, cwd: path })
            });
            const { port, proxyPath } = await res.json();

            // Update iframe
            terminalFrame.src = proxyPath;

            // Clear done indicator when opening session
            clearDone(id);
            updateSessionIndicators(currentSessionId);

        } catch (error) {
            console.error('Failed to switch session:', error);
            terminalFrame.src = 'about:blank';
        }
    }

    async function updateTaskStatus(id, status) {
        await updateTask(id, { status });
        loadTasks();
    }

    async function deleteTaskLocal(id) {
        await deleteTaskById(id);
        loadTasks();
    }

    // --- Edit Modal Logic ---
    function openEditModal(task) {
        if (!editModal) return;
        editTaskId.value = task.id;
        editTaskTitle.value = task.name || '';
        editTaskProject.value = task.project || '';
        editTaskPriority.value = task.priority || 'medium';
        editTaskDue.value = task.due || '';
        editModal.classList.add('active');
    }

    function closeEditModal() {
        if (editModal) editModal.classList.remove('active');
    }

    if (closeModalBtns) {
        closeModalBtns.forEach(btn => {
            btn.onclick = closeEditModal;
        });
    }

    if (saveTaskBtn) {
        saveTaskBtn.onclick = async () => {
            const id = editTaskId.value;
            const updates = {
                name: editTaskTitle.value,
                project: editTaskProject.value,
                priority: editTaskPriority.value,
                due: editTaskDue.value || null
            };
            await fetch(`/api/tasks/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            closeEditModal();
            loadTasks();
        };
    }

    addSessionBtn.addEventListener('click', () => createNewSession());

    // Focus footer button -> open engine selector for current focus task
    if (focusBtn) {
        focusBtn.onclick = () => {
            const focusTask = getFocusTask(tasks);
            if (!focusTask) {
                showInfo('フォーカスタスクがありません');
                return;
            }
            openFocusEngineModal(focusTask);
        };
    }

    function openFocusEngineModal(task) {
        pendingFocusTask = task;
        if (!focusEngineModal) return startTaskSession(task);
        focusEngineModal.classList.add('active');
        lucide.createIcons();
    }

    // Engine selection buttons inside modal
    focusEngineButtons?.forEach(btn => {
        btn.onclick = () => {
            const engine = btn.dataset.engine || 'claude';
            if (pendingFocusTask) startTaskSession(pendingFocusTask, engine);
            focusEngineModal.classList.remove('active');
            pendingFocusTask = null;
        };
    });

    // Close modal via X or backdrop
    focusEngineModal?.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.onclick = () => {
            focusEngineModal.classList.remove('active');
            pendingFocusTask = null;
        };
    });
    focusEngineModal?.addEventListener('click', (e) => {
        if (e.target === focusEngineModal) {
            focusEngineModal.classList.remove('active');
            pendingFocusTask = null;
        }
    });

    // Archive Modal Handler
    if (toggleArchivedBtn) {
        toggleArchivedBtn.onclick = () => {
            openArchiveModal();
        };
    }

    // Mobile Archive Toggle Handler
    const mobileToggleArchivedBtn = document.getElementById('mobile-toggle-archived-btn');
    if (mobileToggleArchivedBtn) {
        mobileToggleArchivedBtn.onclick = () => {
            openArchiveModal();
        };
    }

    function openArchiveModal() {
        if (!archiveModal) return;

        // Use imported getUniqueProjects
        const projects = getUniqueProjects(sessions);

        archiveProjectFilter.innerHTML = '<option value="">すべてのプロジェクト</option>';
        projects.forEach(proj => {
            archiveProjectFilter.innerHTML += `<option value="${proj}">${proj}</option>`;
        });

        // Clear search
        archiveSearchInput.value = '';

        // Render archive list
        renderArchiveList();

        // Show modal
        archiveModal.classList.add('active');
        lucide.createIcons();

        // Focus search input
        archiveSearchInput.focus();
    }

    function renderArchiveList() {
        const searchTerm = archiveSearchInput?.value || '';
        const projectFilter = archiveProjectFilter?.value || '';

        // Use imported functions
        const filtered = filterArchivedSessions(sessions, searchTerm, projectFilter);
        const archivedSessions = sortByCreatedDate(filtered);

        if (archivedSessions.length === 0) {
            archiveListEl.innerHTML = '';
            archiveEmptyEl.style.display = 'block';
            return;
        }

        archiveEmptyEl.style.display = 'none';

        archiveListEl.innerHTML = archivedSessions.map(session => {
            const name = session.name || session.id;
            const project = getProjectFromPath(session.path) || 'General';
            const date = session.created ? new Date(session.created).toLocaleDateString('ja-JP') : '';

            return `
                <div class="archive-item" data-id="${session.id}">
                    <div class="archive-item-info">
                        <div class="archive-item-name">${name}</div>
                        <div class="archive-item-meta">
                            <span class="archive-item-project">${project}</span>
                            ${date ? `<span class="archive-item-date">${date}</span>` : ''}
                        </div>
                    </div>
                    <div class="archive-item-actions">
                        <button class="archive-restore-btn" data-id="${session.id}">
                            <i data-lucide="archive-restore"></i> 復元
                        </button>
                        <button class="archive-delete-btn" data-id="${session.id}">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Add event handlers
        archiveListEl.querySelectorAll('.archive-restore-btn').forEach(btn => {
            btn.onclick = async () => {
                const sessionId = btn.dataset.id;
                await restoreSession(sessionId);
            };
        });

        archiveListEl.querySelectorAll('.archive-delete-btn').forEach(btn => {
            btn.onclick = async () => {
                const sessionId = btn.dataset.id;
                const session = sessions.find(s => s.id === sessionId);
                if (await showConfirm(`「${session?.name || sessionId}」を完全に削除しますか？`, { title: '完全削除', okText: '削除' })) {
                    await deleteSession(sessionId);
                }
            };
        });

        lucide.createIcons();
    }

    async function restoreSession(sessionId) {
        try {
            const currentState = await fetchState();
            const restoredSession = currentState.sessions.find(s => s.id === sessionId);
            await updateSession(sessionId, { archived: false });
            await loadSessions();
            renderArchiveList();

            // 復元後、アーカイブモーダルを閉じてセッションを自動で開く
            if (restoredSession) {
                archiveModal.classList.remove('active');
                switchSession(sessionId, restoredSession.path, restoredSession.initialCommand);
            }
        } catch (err) {
            console.error('Failed to restore session', err);
        }
    }

    async function deleteSession(sessionId) {
        try {
            await removeSession(sessionId);
            await loadSessions();
            renderArchiveList();
        } catch (err) {
            console.error('Failed to delete session', err);
        }
    }

    // Archive search/filter handlers
    if (archiveSearchInput) {
        archiveSearchInput.oninput = () => renderArchiveList();
    }
    if (archiveProjectFilter) {
        archiveProjectFilter.onchange = () => renderArchiveList();
    }

    // Close archive modal
    archiveModal?.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.onclick = () => archiveModal.classList.remove('active');
    });
    archiveModal?.addEventListener('click', (e) => {
        if (e.target === archiveModal) archiveModal.classList.remove('active');
    });

    // --- Session Status Polling ---
    // Moved to modules/session-indicators.js

    // --- Drag & Drop, Clipboard, Key Handling ---
    // Moved to modules/file-upload.js

    // Initial Load
    loadSessions();
    loadSchedule();
    loadTasks();
    loadInbox();

    // Initialize Settings Module
    initSettings();

    // Initialize File Upload (Drag & Drop, Clipboard)
    initFileUpload(() => currentSessionId);

    // Periodic Refresh (every 5 minutes)
    setInterval(() => {
        loadSchedule();
        loadTasks();
        loadInbox();
    }, 5 * 60 * 1000);

    // Status Polling (every 3 seconds) - using imported module
    startPolling(() => currentSessionId, 3000);

    // Phase 3.2: Choice Detection (every 2 seconds)
    let choiceCheckInterval = null;
    let lastChoiceHash = null;

    function startChoiceDetection() {
        stopChoiceDetection();

        choiceCheckInterval = setInterval(async () => {
            if (!currentSessionId) return;

            try {
                const res = await fetch(`/api/sessions/${currentSessionId}/output`);
                const data = await res.json();

                if (data.hasChoices && data.choices.length > 0) {
                    // Check if choices changed (simple hash)
                    const choiceHash = JSON.stringify(data.choices);
                    if (choiceHash !== lastChoiceHash) {
                        lastChoiceHash = choiceHash;
                        showChoiceOverlay(data.choices);
                        stopChoiceDetection(); // Stop polling when overlay is shown
                    }
                }
            } catch (error) {
                console.error('Failed to check for choices:', error);
            }
        }, 2000); // Check every 2 seconds
    }

    function stopChoiceDetection() {
        if (choiceCheckInterval) {
            clearInterval(choiceCheckInterval);
            choiceCheckInterval = null;
        }
    }

    function showChoiceOverlay(choices) {
        const overlay = document.getElementById('choice-overlay');
        const container = document.getElementById('choice-buttons');
        const closeBtn = document.getElementById('close-choice-overlay');

        if (!overlay || !container) return;

        container.innerHTML = '';
        choices.forEach((choice) => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn';
            // Claude Codeの出力をそのまま表示
            btn.textContent = choice.originalText || `${choice.number}) ${choice.text}`;
            btn.onclick = () => selectChoice(choice.number);
            container.appendChild(btn);
        });

        overlay.classList.add('active');
        lucide.createIcons();

        // Close button
        closeBtn.onclick = () => closeChoiceOverlay();
    }

    function closeChoiceOverlay() {
        const overlay = document.getElementById('choice-overlay');
        overlay?.classList.remove('active');
        lastChoiceHash = null;
        startChoiceDetection(); // Resume polling
    }

    // Phase 3.3: Send choice selection
    async function selectChoice(number) {
        if (!currentSessionId) return;

        try {
            // Send number
            await fetch(`/api/sessions/${currentSessionId}/input`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: number, type: 'text' })
            });

            // Send Enter key
            await new Promise(resolve => setTimeout(resolve, 100));
            await fetch(`/api/sessions/${currentSessionId}/input`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: 'Enter', type: 'key' })
            });

            closeChoiceOverlay();
        } catch (error) {
            console.error('Failed to send choice:', error);
            showError('選択の送信に失敗しました');
        }
    }

    // Helper function to detect mobile devices
    function isMobile() {
        return window.innerWidth <= 768;
    }

    // Start choice detection only on mobile devices
    if (isMobile()) {
        startChoiceDetection();
    }

    // Responsive: Re-check on window resize
    window.addEventListener('resize', () => {
        if (isMobile() && !choiceCheckInterval) {
            startChoiceDetection();
        } else if (!isMobile() && choiceCheckInterval) {
            stopChoiceDetection();
            closeChoiceOverlay();
        }
    });

    // --- Image Compression Utility ---
    async function compressImage(blob, maxWidth = 1920, maxHeight = 1080, quality = 0.8) {
        return new Promise((resolve) => {
            const img = new Image();
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            img.onload = () => {
                let width = img.width;
                let height = img.height;

                // アスペクト比を維持しながらリサイズ
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width *= ratio;
                    height *= ratio;
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((compressedBlob) => {
                    resolve(compressedBlob || blob);
                }, 'image/jpeg', quality);
            };

            img.onerror = () => {
                resolve(blob); // エラー時は元のBlobを返す
            };

            img.src = URL.createObjectURL(blob);
        });
    }

    // --- Terminal Copy Functionality ---
    // Paste from clipboard to terminal (text and images)
    const pasteTerminalBtn = document.getElementById('paste-terminal-btn');
    if (pasteTerminalBtn) {
        pasteTerminalBtn.onclick = async () => {
            if (!currentSessionId) {
                showInfo('セッションを選択してください');
                return;
            }

            try {
                // Try to read clipboard items (supports both text and images)
                const clipboardItems = await navigator.clipboard.read();

                for (const item of clipboardItems) {
                    // Check for image
                    const imageType = item.types.find(type => type.startsWith('image/'));
                    if (imageType) {
                        try {
                            showInfo('画像を読み込み中...');

                            const blob = await item.getType(imageType);
                            console.log('Image blob retrieved:', blob.type, blob.size, 'bytes');

                            // 圧縮前のサイズ
                            const originalSize = (blob.size / 1024 / 1024).toFixed(2);
                            console.log('Original size:', originalSize, 'MB');

                            showInfo('画像を圧縮中...');

                            // 画像を圧縮
                            const compressedBlob = await compressImage(blob);
                            console.log('Image compressed:', compressedBlob.size, 'bytes');

                            // 圧縮後のサイズ
                            const compressedSize = (compressedBlob.size / 1024 / 1024).toFixed(2);
                            console.log('Compressed size:', compressedSize, 'MB');

                            showInfo(`アップロード中... (${originalSize}MB → ${compressedSize}MB)`);

                            // Upload compressed image to server
                            const formData = new FormData();
                            formData.append('file', compressedBlob, 'clipboard-image.jpg');

                            const uploadRes = await fetch('/api/upload', {
                                method: 'POST',
                                body: formData
                            });

                            if (!uploadRes.ok) {
                                const errorText = await uploadRes.text();
                                console.error('Upload failed:', uploadRes.status, errorText);
                                showError(`画像のアップロードに失敗しました (${uploadRes.status})`);
                                return;
                            }

                            const { path: imagePath } = await uploadRes.json();
                            console.log('Image uploaded:', imagePath);

                            // Send image path to terminal with Enter key
                            await fetch(`/api/sessions/${currentSessionId}/input`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ input: imagePath + '\n', type: 'text' })
                            });

                            showSuccess(`画像をペーストしました (圧縮率: ${((1 - compressedBlob.size / blob.size) * 100).toFixed(0)}%)`);
                            return;
                        } catch (imageError) {
                            console.error('Image processing failed:', imageError);
                            if (imageError.name === 'NotAllowedError') {
                                showError('画像の読み込みが拒否されました。クリップボードの権限を確認してください。');
                            } else if (imageError.name === 'NotSupportedError') {
                                showError('このブラウザでは画像形式がサポートされていません。');
                            } else if (imageError.message) {
                                showError(`画像処理エラー: ${imageError.message}`);
                            } else {
                                showError(`画像処理に失敗しました: ${imageError.name || 'Unknown error'}`);
                            }
                            return;
                        }
                    }

                    // Check for text
                    if (item.types.includes('text/plain')) {
                        const textBlob = await item.getType('text/plain');
                        const text = await textBlob.text();

                        if (!text) {
                            showInfo('クリップボードが空です');
                            return;
                        }

                        // Send text to terminal via tmux
                        await fetch(`/api/sessions/${currentSessionId}/input`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ input: text, type: 'text' })
                        });

                        showSuccess(`ペーストしました: ${text.length}文字`);
                        return;
                    }
                }

                showInfo('クリップボードが空です');
            } catch (error) {
                console.error('Failed to paste:', error);
                if (error.name === 'NotAllowedError') {
                    showError('クリップボードへのアクセスが拒否されました。ブラウザの設定を確認してください。');
                } else if (error.name === 'NotSupportedError') {
                    showError('このブラウザでは画像のクリップボード貼り付けがサポートされていません。');
                } else {
                    showError(`ペーストに失敗しました: ${error.message || error.name}`);
                }
            }
        };
    }

    // Upload image from file picker
    const uploadImageBtn = document.getElementById('upload-image-btn');
    const imageFileInput = document.getElementById('image-file-input');

    if (uploadImageBtn && imageFileInput) {
        uploadImageBtn.onclick = () => {
            if (!currentSessionId) {
                showInfo('セッションを選択してください');
                return;
            }
            imageFileInput.click();
        };

        imageFileInput.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                showError('画像ファイルを選択してください');
                return;
            }

            try {
                showInfo('画像を圧縮中...');
                console.log('Selected file:', file.type, file.size, 'bytes');

                // 圧縮前のサイズ
                const originalSize = (file.size / 1024 / 1024).toFixed(2);
                console.log('Original size:', originalSize, 'MB');

                // 画像を圧縮
                const compressedBlob = await compressImage(file);
                console.log('Image compressed:', compressedBlob.size, 'bytes');

                // 圧縮後のサイズ
                const compressedSize = (compressedBlob.size / 1024 / 1024).toFixed(2);
                console.log('Compressed size:', compressedSize, 'MB');

                showInfo(`アップロード中... (${originalSize}MB → ${compressedSize}MB)`);

                // Upload compressed image to server
                const formData = new FormData();
                formData.append('file', compressedBlob, file.name.replace(/\.[^.]+$/, '.jpg'));

                const uploadRes = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!uploadRes.ok) {
                    const errorText = await uploadRes.text();
                    console.error('Upload failed:', uploadRes.status, errorText);
                    showError(`画像のアップロードに失敗しました (${uploadRes.status})`);
                    return;
                }

                const { path: imagePath } = await uploadRes.json();
                console.log('Image uploaded:', imagePath);

                // Send image path to terminal with Enter key
                await fetch(`/api/sessions/${currentSessionId}/input`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ input: imagePath + '\n', type: 'text' })
                });

                showSuccess(`画像をアップロードしました (圧縮率: ${((1 - compressedBlob.size / file.size) * 100).toFixed(0)}%)`);

                // Reset file input
                imageFileInput.value = '';
            } catch (error) {
                console.error('Image upload failed:', error);
                showError(`画像のアップロードに失敗しました: ${error.message || error.name}`);
                imageFileInput.value = '';
            }
        };
    }

    if (copyTerminalBtn) {
        copyTerminalBtn.onclick = async () => {
            if (!currentSessionId) {
                showInfo('セッションを選択してください');
                return;
            }

            try {
                const res = await fetch(`/api/sessions/${currentSessionId}/content?lines=500`);
                if (!res.ok) throw new Error('Failed to fetch content');

                const { content } = await res.json();
                terminalContentDisplay.textContent = content;
                copyTerminalModal.classList.add('active');
                lucide.createIcons();
                // モーダル表示後にスクロールを最下段に設定
                setTimeout(() => {
                    terminalContentDisplay.scrollTop = terminalContentDisplay.scrollHeight;
                }, 50);
            } catch (error) {
                console.error('Failed to get terminal content:', error);
                showError('ターミナル内容の取得に失敗しました');
            }
        };
    }

    if (copyContentBtn) {
        copyContentBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(terminalContentDisplay.textContent);
                copyContentBtn.classList.add('copied');
                copyContentBtn.innerHTML = '<i data-lucide="check"></i> コピー完了';
                lucide.createIcons();

                setTimeout(() => {
                    copyContentBtn.classList.remove('copied');
                    copyContentBtn.innerHTML = '<i data-lucide="copy"></i> コピー';
                    lucide.createIcons();
                }, 2000);
            } catch (error) {
                console.error('Failed to copy:', error);
                // Fallback: select all text
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(terminalContentDisplay);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        };
    }

    // Close terminal copy modal
    copyTerminalModal?.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.onclick = () => copyTerminalModal.classList.remove('active');
    });

    // Close modal on backdrop click
    copyTerminalModal?.addEventListener('click', (e) => {
        if (e.target === copyTerminalModal) {
            copyTerminalModal.classList.remove('active');
        }
    });

    // Close modal on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && copyTerminalModal?.classList.contains('active')) {
            copyTerminalModal.classList.remove('active');
        }
    });

    // Settings View - moved to modules/settings.js

    // --- Mobile Bottom Sheet Logic ---
    const mobileSessionsBtn = document.getElementById('mobile-sessions-btn');
    const mobileTasksBtn = document.getElementById('mobile-tasks-btn');
    const mobileSettingsBtn = document.getElementById('mobile-settings-btn');
    const sessionsSheetOverlay = document.getElementById('sessions-sheet-overlay');
    const tasksSheetOverlay = document.getElementById('tasks-sheet-overlay');
    const sessionsBottomSheet = document.getElementById('sessions-bottom-sheet');
    const tasksBottomSheet = document.getElementById('tasks-bottom-sheet');
    const closeSessionsSheetBtn = document.getElementById('close-sessions-sheet');
    const closeTasksSheetBtn = document.getElementById('close-tasks-sheet');
    const mobileAddSessionBtn = document.getElementById('mobile-add-session-btn');
    const mobileFabBtn = document.getElementById('mobile-fab');
    const mobileSessionList = document.getElementById('mobile-session-list');
    const mobileTasksContent = document.getElementById('mobile-tasks-content');

    function openSessionsSheet() {
        // Clone session list content for mobile
        const sessionListContent = sessionList?.innerHTML || '';
        if (mobileSessionList) {
            mobileSessionList.innerHTML = sessionListContent;

            // Re-attach click handlers for mobile session items
            mobileSessionList.querySelectorAll('.session-child-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    const id = row.dataset.id;
                    const path = row.dataset.path;
                    const initialCommand = row.dataset.initialCommand;
                    switchSession(id, path, initialCommand);
                    closeSessionsSheet();
                });
            });

            // Re-attach click handlers for project group plus buttons
            mobileSessionList.querySelectorAll('.add-project-session-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const project = btn.dataset.project;
                    createNewSession(project);
                    closeSessionsSheet();
                });
            });

            // Re-attach click handlers for project group headers (expand/collapse)
            mobileSessionList.querySelectorAll('.session-group-header').forEach(header => {
                header.addEventListener('click', (e) => {
                    if (!e.target.closest('.add-project-session-btn')) {
                        const groupDiv = header.closest('.session-group');
                        const container = groupDiv.querySelector('.session-group-children');
                        container.style.display = container.style.display === 'none' ? 'block' : 'none';
                        const icon = header.querySelector('.folder-icon i');
                        icon.setAttribute('data-lucide', container.style.display === 'none' ? 'folder' : 'folder-open');
                        lucide.createIcons();
                    }
                });
            });

            // Re-attach click handlers for 3-dot menu toggles and action buttons
            mobileSessionList.querySelectorAll('.session-child-row').forEach(row => {
                const menuToggle = row.querySelector('.session-menu-toggle');
                const childActions = row.querySelector('.child-actions');

                // 3-dot menu toggle
                if (menuToggle && childActions) {
                    menuToggle.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // Close all other menus
                        mobileSessionList.querySelectorAll('.child-actions.active').forEach(actions => {
                            if (actions !== childActions) {
                                actions.classList.remove('active');
                            }
                        });
                        // Toggle this menu
                        childActions.classList.toggle('active');
                    });
                }

                // Action buttons
                const renameBtn = row.querySelector('.rename-session-btn');
                const deleteBtn = row.querySelector('.delete-session-btn');
                const archiveBtn = row.querySelector('.archive-session-btn');
                const mergeBtn = row.querySelector('.merge-session-btn');
                const restartBtn = row.querySelector('.restart-session-btn');

                if (renameBtn) {
                    renameBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const sessionId = row.dataset.id;
                        const currentName = row.querySelector('.session-name')?.textContent || sessionId;
                        const newName = prompt('新しいセッション名を入力してください:', currentName);
                        if (newName && newName !== currentName) {
                            try {
                                await updateSession(sessionId, { name: newName });
                                await loadSessions();
                                openSessionsSheet(); // Refresh the mobile list
                            } catch (err) {
                                console.error('Failed to rename', err);
                                showError('セッション名の変更に失敗しました');
                            }
                        }
                        childActions?.classList.remove('active');
                    });
                }

                if (deleteBtn) {
                    deleteBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const sessionId = row.dataset.id;
                        const sessionName = row.querySelector('.session-name')?.textContent || sessionId;
                        if (confirm(`セッション「${sessionName}」を削除しますか？`)) {
                            try {
                                await removeSession(sessionId);
                                await loadSessions();
                                openSessionsSheet(); // Refresh the mobile list
                            } catch (err) {
                                console.error('Failed to delete', err);
                                showError('セッションの削除に失敗しました');
                            }
                        }
                        childActions?.classList.remove('active');
                    });
                }

                if (archiveBtn) {
                    archiveBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const sessionId = row.dataset.id;
                        const isArchived = row.classList.contains('archived');
                        try {
                            if (isArchived) {
                                await restoreSessionAPI(sessionId);
                            } else {
                                await archiveSessionAPI(sessionId);
                            }
                            await loadSessions();
                            openSessionsSheet(); // Refresh the mobile list
                        } catch (err) {
                            console.error('Failed to archive/restore', err);
                            showError('アーカイブ操作に失敗しました');
                        }
                        childActions?.classList.remove('active');
                    });
                }

                if (mergeBtn) {
                    mergeBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const sessionId = row.dataset.id;
                        const sessionName = row.querySelector('.session-name')?.textContent || sessionId;
                        if (confirm(`セッション「${sessionName}」をmainにマージしますか？`)) {
                            try {
                                await mergeSession(sessionId);
                                await loadSessions();
                                openSessionsSheet(); // Refresh the mobile list
                            } catch (err) {
                                console.error('Failed to merge', err);
                                showError('マージに失敗しました');
                            }
                        }
                        childActions?.classList.remove('active');
                    });
                }

                if (restartBtn) {
                    restartBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const sessionId = row.dataset.id;
                        try {
                            await fetch(`/api/sessions/${sessionId}/restart`, { method: 'POST' });
                            await loadSessions();
                            openSessionsSheet(); // Refresh the mobile list
                        } catch (err) {
                            console.error('Failed to restart', err);
                            showError('セッションの再起動に失敗しました');
                        }
                        childActions?.classList.remove('active');
                    });
                }
            });
        }
        sessionsSheetOverlay?.classList.add('active');
        sessionsBottomSheet?.classList.add('active');
        lucide.createIcons();
        // Load version for mobile display
        loadVersion();
    }

    function closeSessionsSheet() {
        sessionsSheetOverlay?.classList.remove('active');
        sessionsBottomSheet?.classList.remove('active');
    }

    function openTasksSheet() {
        // Clone context sidebar content for mobile
        const contextSidebar = document.getElementById('context-sidebar');
        if (mobileTasksContent && contextSidebar) {
            mobileTasksContent.innerHTML = contextSidebar.innerHTML;
            // Re-attach click handlers for task items
            mobileTasksContent.querySelectorAll('.next-task-checkbox').forEach(checkbox => {
                checkbox.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const taskItem = checkbox.closest('.next-task-item');
                    const taskId = taskItem?.dataset.taskId;
                    if (taskId) {
                        await completeTask(taskId);
                        loadTasks();
                        closeTasksSheet();
                    }
                });
            });
        }
        tasksSheetOverlay?.classList.add('active');
        tasksBottomSheet?.classList.add('active');
        lucide.createIcons();
    }

    function closeTasksSheet() {
        tasksSheetOverlay?.classList.remove('active');
        tasksBottomSheet?.classList.remove('active');
    }

    // Event listeners for mobile navigation
    mobileSessionsBtn?.addEventListener('click', openSessionsSheet);
    mobileTasksBtn?.addEventListener('click', openTasksSheet);
    mobileSettingsBtn?.addEventListener('click', openSettings);
    mobileAddSessionBtn?.addEventListener('click', () => createNewSession());
    mobileFabBtn?.addEventListener('click', () => createNewSession());
    closeSessionsSheetBtn?.addEventListener('click', closeSessionsSheet);
    closeTasksSheetBtn?.addEventListener('click', closeTasksSheet);
    sessionsSheetOverlay?.addEventListener('click', closeSessionsSheet);
    tasksSheetOverlay?.addEventListener('click', closeTasksSheet);

    // Close sheets on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (sessionsBottomSheet?.classList.contains('active')) closeSessionsSheet();
            if (tasksBottomSheet?.classList.contains('active')) closeTasksSheet();
        }
    });

    // Swipe down to close bottom sheets (only on handle area)
    [sessionsBottomSheet, tasksBottomSheet].forEach(sheet => {
        const handle = sheet?.querySelector('.bottom-sheet-handle');
        const header = sheet?.querySelector('.bottom-sheet-header');

        if (!handle || !header) return;

        let touchStartY = 0;

        // Handle area swipe to close
        [handle, header].forEach(area => {
            area.addEventListener('touchstart', (e) => {
                touchStartY = e.touches[0].clientY;
            }, { passive: true });

            area.addEventListener('touchmove', (e) => {
                const touchY = e.touches[0].clientY;
                const diff = touchY - touchStartY;

                // Close sheet if swiping down with sufficient distance
                if (diff > 100) {
                    if (sheet === sessionsBottomSheet) closeSessionsSheet();
                    if (sheet === tasksBottomSheet) closeTasksSheet();
                }
            }, { passive: true });
        });
    });

    // Mobile keyboard detection and auto-scroll for terminal
    if ('visualViewport' in window) {
        let lastHeight = window.visualViewport.height;

        window.visualViewport.addEventListener('resize', () => {
            const currentHeight = window.visualViewport.height;
            const heightDiff = lastHeight - currentHeight;

            // Keyboard is showing (viewport height decreased by more than 150px)
            if (heightDiff > 150) {
                // Scroll terminal to bottom to keep input visible
                setTimeout(() => {
                    const iframe = document.getElementById('terminal-frame');
                    if (iframe && iframe.contentWindow) {
                        try {
                            // Try to scroll terminal content to bottom
                            const terminalDoc = iframe.contentWindow.document;
                            if (terminalDoc && terminalDoc.documentElement) {
                                terminalDoc.documentElement.scrollTop = terminalDoc.documentElement.scrollHeight;
                            }
                        } catch (e) {
                            // Cross-origin restrictions may prevent this
                            console.log('Cannot scroll terminal iframe:', e.message);
                        }
                    }

                    // Also ensure the console area is scrolled properly
                    const consoleArea = document.getElementById('console-area');
                    if (consoleArea) {
                        consoleArea.scrollTop = consoleArea.scrollHeight;
                    }
                }, 100);
            }

            lastHeight = currentHeight;
        });
    }

    // xterm-viewport（Claude Codeの出力領域）のスクロール処理
    // パフォーマンス最適化版
    (function initXtermScroll() {
        const consoleArea = document.querySelector('.console-area');
        if (!consoleArea) return;

        let touchStartY = 0;
        let isTouching = false;
        let cachedViewport = null;
        let rafId = null;
        let targetScrollTop = 0;

        // viewport要素をキャッシュして取得
        function getViewport() {
            if (cachedViewport) return cachedViewport;

            const iframe = document.getElementById('terminal-frame');
            if (!iframe) return null;

            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (!iframeDoc) return null;

                cachedViewport = iframeDoc.querySelector('.xterm-viewport');
                return cachedViewport;
            } catch (err) {
                return null;
            }
        }

        // requestAnimationFrameでスムーズにスクロール
        function updateScroll() {
            const viewport = getViewport();
            if (viewport) {
                viewport.scrollTop = targetScrollTop;
            }
            rafId = null;
        }

        consoleArea.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                isTouching = true;
                touchStartY = e.touches[0].clientY;
                cachedViewport = null; // リセットして再取得
                const viewport = getViewport();
                if (viewport) {
                    targetScrollTop = viewport.scrollTop;
                }
            }
        }, { passive: true });

        consoleArea.addEventListener('touchmove', (e) => {
            if (!isTouching || e.touches.length !== 1) return;

            const viewport = getViewport();
            if (!viewport) return;

            const touchY = e.touches[0].clientY;
            const deltaY = touchStartY - touchY;

            // スクロール量を調整（1倍速で自然な操作感）
            targetScrollTop += deltaY;
            touchStartY = touchY;

            // requestAnimationFrameで次のフレームで更新
            if (!rafId) {
                rafId = requestAnimationFrame(updateScroll);
            }
        }, { passive: true });

        consoleArea.addEventListener('touchend', () => {
            isTouching = false;
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
        }, { passive: true });

        consoleArea.addEventListener('touchcancel', () => {
            isTouching = false;
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
        }, { passive: true });

        console.log('Optimized xterm scroll initialized');
    })();

    // Load version on startup
    loadVersion();

    // Restart server button
    const restartServerBtn = document.getElementById('restart-server-btn');
    if (restartServerBtn) {
        restartServerBtn.onclick = async () => {
            if (!confirm('サーバーを再起動しますか？\n\n接続が一時的に切断されます。')) {
                return;
            }
            try {
                await fetch('/api/restart', { method: 'POST' });
                showSuccess('サーバーを再起動しています...\n\n5秒後にページをリロードします。');
                setTimeout(() => {
                    window.location.reload();
                }, 5000);
            } catch (err) {
                console.error('Failed to restart server', err);
                showError('サーバーの再起動に失敗しました');
            }
        };
    }
});
