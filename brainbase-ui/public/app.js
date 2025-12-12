// ES Modules imports
import { MAX_VISIBLE_TASKS } from './modules/state.js';
import { formatDueDate } from './modules/ui-helpers.js';
import { initSettings } from './modules/settings.js';
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
import { archiveSessionAPI, mergeSession } from './modules/session-controller.js';
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
                if (task) startTaskSession(task);
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
        const activeTasks = tasks.filter(t => t.status !== 'done' && (!focusTask || t.id !== focusTask.id));
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
                if (task) startTaskSession(task);
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
                        if (ev.key === 'Enter') saveName();
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

    // Enter key to submit
    sessionNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createSessionBtn.click();
    });
    sessionCommandInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createSessionBtn.click();
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

    async function startTaskSession(task) {
        // Use imported getProjectPath and createSessionId
        const repoPath = getProjectPath(task.project);
        const sessionId = createSessionId('task', task.id);
        const name = `Task: ${task.name}`;
        const initialCommand = `/task ${task.id}`;

        try {
            // Try to create session with worktree first
            const res = await fetch('/api/sessions/create-with-worktree', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, repoPath, name, initialCommand })
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
                    body: JSON.stringify({ sessionId, initialCommand, cwd: fallbackCwd })
                });

                if (fallbackRes.ok) {
                    const { proxyPath } = await fallbackRes.json();

                    // Use imported buildSessionObject and addSession
                    const newSession = buildSessionObject({
                        id: sessionId,
                        name,
                        path: repoPath,
                        taskId: task.id,
                        initialCommand
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

    // Archive Modal Handler
    if (toggleArchivedBtn) {
        toggleArchivedBtn.onclick = () => {
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
                archiveModal.style.display = 'none';
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

    // --- Terminal Copy Functionality ---
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
});
