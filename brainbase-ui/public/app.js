// ES Modules imports
import { MAX_VISIBLE_TASKS, CORE_PROJECTS } from './modules/state.js';
import { formatDueDate } from './modules/ui-helpers.js';
import { initSettings } from './modules/settings.js';
import { pollSessionStatus, updateSessionIndicators, clearUnread, startPolling } from './modules/session-indicators.js';
import { initFileUpload } from './modules/file-upload.js';

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
    // CORE_PROJECTS moved to modules/state.js

    // Session Drag & Drop State
    let draggedSessionId = null;
    let draggedSessionProject = null;

    // --- Data Loading ---
    async function loadSessions() {
        try {
            const res = await fetch('/api/state');
            const state = await res.json();
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
            console.log('### FOCUS: setupFocusTaskEvents - setting onclick');
            startBtn.onclick = (e) => {
                console.log('### FOCUS: CLICK DETECTED (after lucide)');
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
        console.log('### DEFER: deferBtn found:', deferBtn);
        if (deferBtn) {
            deferBtn.onclick = (e) => {
                console.log('### DEFER: CLICK DETECTED');
                e.stopPropagation();
                const taskId = deferBtn.dataset.id;
                console.log('### DEFER: taskId:', taskId);
                deferTask(taskId);
            };
        }
    }

    function getFocusTask() {
        // Priority: in-progress > high priority with due date > high priority > medium/normal > exclude low
        const activeTasks = tasks.filter(t => t.status !== 'done');

        // 1. in-progress tasks first
        const inProgress = activeTasks.find(t => t.status === 'in-progress');
        if (inProgress) return inProgress;

        // 2. High priority with nearest due date
        const highWithDue = activeTasks
            .filter(t => t.priority === 'high' && t.due)
            .sort((a, b) => new Date(a.due) - new Date(b.due));
        if (highWithDue.length > 0) return highWithDue[0];

        // 3. Any high priority
        const high = activeTasks.find(t => t.priority === 'high');
        if (high) return high;

        // 4. First non-low priority todo (low = deferred/backlog)
        const nonLow = activeTasks.filter(t => t.priority !== 'low');
        return nonLow[0] || null;
    }

    function renderFocusTask() {
        const focusTask = getFocusTask();

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
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

        if (events.length === 0) {
            timelineListEl.innerHTML = '<div class="timeline-empty">予定なし</div>';
            return;
        }

        // Sort events by start time
        const sortedEvents = [...events].sort((a, b) => {
            const timeA = a.start || '00:00';
            const timeB = b.start || '00:00';
            return timeA.localeCompare(timeB);
        });

        let html = '<div class="timeline">';
        let nowInserted = false;

        sortedEvents.forEach((event, idx) => {
            const eventTime = event.start || '00:00';

            // Insert "now" marker at appropriate position
            if (!nowInserted && eventTime > currentTimeStr) {
                html += `
                    <div class="timeline-now">
                        <span class="timeline-now-label">現在 ${currentTimeStr}</span>
                    </div>
                `;
                nowInserted = true;
            }

            const timeStr = event.start + (event.end ? '-' + event.end : '');
            const isCurrent = eventTime <= currentTimeStr && (!event.end || event.end > currentTimeStr);

            html += `
                <div class="timeline-item is-event ${isCurrent ? 'is-current' : ''}">
                    <div class="timeline-marker"></div>
                    <span class="timeline-time">${timeStr}</span>
                    <span class="timeline-content">${event.task}</span>
                </div>
            `;
        });

        // If now marker not yet inserted (all events are past)
        if (!nowInserted) {
            html += `
                <div class="timeline-now">
                    <span class="timeline-now-label">現在 ${currentTimeStr}</span>
                </div>
            `;
        }

        html += '</div>';
        timelineListEl.innerHTML = html;
    }

    function renderNextTasks() {
        const focusTask = getFocusTask();
        const filterLower = taskFilter.toLowerCase();
        const otherTasks = tasks
            .filter(t => t.status !== 'done' && (!focusTask || t.id !== focusTask.id))
            .filter(t => !filterLower ||
                t.name?.toLowerCase().includes(filterLower) ||
                t.project?.toLowerCase().includes(filterLower))
            .sort((a, b) => {
                // Sort by priority then due date
                const priorityOrder = { high: 0, medium: 1, low: 2 };
                const pA = priorityOrder[a.priority] ?? 1;
                const pB = priorityOrder[b.priority] ?? 1;
                if (pA !== pB) return pA - pB;
                if (a.due && b.due) return new Date(a.due) - new Date(b.due);
                if (a.due) return -1;
                if (b.due) return 1;
                return 0;
            });

        const visibleTasks = showAllTasks ? otherTasks : otherTasks.slice(0, MAX_VISIBLE_TASKS);
        const remainingCount = otherTasks.length - MAX_VISIBLE_TASKS;

        if (otherTasks.length === 0) {
            nextTasksListEl.innerHTML = '<div class="timeline-empty">他のタスクなし</div>';
            remainingToggleEl.style.display = 'none';
            return;
        }

        let html = '';
        visibleTasks.forEach(task => {
            html += `
                <div class="next-task-item" data-task-id="${task.id}">
                    <div class="next-task-checkbox" data-id="${task.id}">
                        <i data-lucide="check"></i>
                    </div>
                    <div class="next-task-content">
                        <div class="next-task-title">${task.name}</div>
                        <div class="next-task-meta">
                            <span class="next-task-project">${task.project || 'general'}</span>
                            ${task.priority ? `<span class="next-task-priority ${task.priority}">${task.priority}</span>` : ''}
                        </div>
                    </div>
                    <div class="next-task-actions">
                        <button class="next-task-action start-task-btn" data-id="${task.id}" title="Start Session">
                            <i data-lucide="terminal-square"></i>
                        </button>
                        <button class="next-task-action edit-task-btn" data-id="${task.id}" title="Edit">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button class="next-task-action delete-task-btn" data-id="${task.id}" title="Delete">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
            `;
        });

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
            btn.onclick = (e) => {
                e.stopPropagation();
                const taskId = btn.dataset.id;
                if (confirm('タスクを削除しますか？')) deleteTask(taskId);
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
        console.log('### DEFER: deferTask called with taskId:', taskId);
        // Lower priority by one level and set status back to todo
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        const priorityOrder = ['high', 'medium', 'low'];
        const currentIndex = priorityOrder.indexOf(task.priority || 'medium');
        const newPriority = priorityOrder[Math.min(currentIndex + 1, priorityOrder.length - 1)];

        try {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ priority: newPriority, status: 'todo' })
            });
            console.log('### DEFER: API response status:', res.status, 'new priority:', newPriority);
            if (!res.ok) {
                console.error('### DEFER: API error:', await res.text());
            }
            loadTasks();
        } catch (err) {
            console.error('### DEFER: Error:', err);
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

        // Group sessions by project path
        const output = {}; // ProjectName -> [Sessions]

        // Filter: show only active sessions (not archived)
        const filteredSessions = sessions.filter(s => !s.archived);

        filteredSessions.forEach(session => {
            let projectName = 'General';
            // Try to match path with CORE_PROJECTS
            if (session.path) {
                for (const proj of CORE_PROJECTS) {
                    if (session.path.includes(proj)) {
                        projectName = proj;
                        break;
                    }
                }
            }
            if (!output[projectName]) output[projectName] = [];
            output[projectName].push(session);
        });

        // Add empty core projects if not present (to show "add" button)
        CORE_PROJECTS.forEach(proj => {
            if (!output[proj]) output[proj] = [];
        });

        for (const [project, projectSessions] of Object.entries(output)) {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'session-group';

            // Collapse state logic could go here
            const isExpanded = true; // Default expanded

            const header = document.createElement('div');
            header.className = 'session-group-header';
            header.innerHTML = `
                <span class="folder-icon"><i data-lucide="${isExpanded ? 'folder-open' : 'folder'}"></i></span>
                <span class="group-title">${project}</span>
                <button class="add-project-session-btn" title="New Session in ${project}"><i data-lucide="plus"></i></button>
            `;

            // Toggle expand
            header.addEventListener('click', (e) => {
                if (!e.target.closest('.add-project-session-btn')) {
                    // Toggle visibility of children container
                    const container = groupDiv.querySelector('.session-group-children');
                    container.style.display = container.style.display === 'none' ? 'block' : 'none';
                    // Update icon
                    const icon = header.querySelector('.folder-icon i');
                    if (container.style.display === 'none') {
                        icon.setAttribute('data-lucide', 'folder');
                    } else {
                        icon.setAttribute('data-lucide', 'folder-open');
                    }
                    lucide.createIcons();
                }
            });

            // Add new session to project
            const addBtn = header.querySelector('.add-project-session-btn');
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                createNewSession(project);
            });

            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'session-group-children';

            projectSessions.forEach(session => {
                const childRow = document.createElement('div');
                childRow.className = `session-child-row ${currentSessionId === session.id ? 'active' : ''}`;
                if (session.archived) childRow.classList.add('archived');
                childRow.dataset.id = session.id;
                childRow.dataset.project = project;
                childRow.setAttribute('draggable', 'true');

                const displayName = session.name || session.id;
                const hasWorktree = !!session.worktree;
                const isMerged = session.worktree?.merged;

                // Build worktree badge
                let worktreeBadge = '';
                if (hasWorktree) {
                    if (isMerged) {
                        worktreeBadge = '<span class="worktree-badge merged" title="Merged"><i data-lucide="git-merge"></i></span>';
                    } else {
                        worktreeBadge = '<span class="worktree-badge" title="Has worktree"><i data-lucide="git-branch"></i></span>';
                    }
                }

                childRow.innerHTML = `
                    <span class="drag-handle" title="Drag to reorder"><i data-lucide="grip-vertical"></i></span>
                    <div class="session-name-container">
                        <span class="session-icon"><i data-lucide="terminal-square"></i></span>
                        <span class="session-name">${displayName}</span>
                        ${worktreeBadge}
                        ${session.archived ? '<span class="archived-label">(Archived)</span>' : ''}
                    </div>
                    <div class="child-actions">
                        ${hasWorktree && !isMerged ? '<button class="merge-session-btn" title="Merge to main"><i data-lucide="git-merge"></i></button>' : ''}
                        <button class="rename-session-btn" title="Rename"><i data-lucide="edit-2"></i></button>
                        <button class="delete-session-btn" title="Delete"><i data-lucide="trash-2"></i></button>
                        <button class="archive-session-btn" title="${session.archived ? 'Unarchive' : 'Archive'}">
                            <i data-lucide="${session.archived ? 'archive-restore' : 'archive'}"></i>
                        </button>
                    </div>
                `;

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
                            // Update state
                            try {
                                const res = await fetch('/api/state');
                                const currentState = await res.json();
                                const updatedSessions = currentState.sessions.map(s =>
                                    s.id === session.id ? { ...s, name: newName } : s
                                );
                                await fetch('/api/state', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ sessions: updatedSessions })
                                });
                                loadSessions(); // Reload list
                            } catch (err) {
                                console.error('Failed to rename', err);
                            }
                        } else {
                            loadSessions(); // Revert
                        }
                    };

                    input.addEventListener('blur', saveName);
                    input.addEventListener('keydown', (ev) => {
                        if (ev.key === 'Enter') saveName();
                    });
                };

                // Delete Logic
                const deleteBtn = childRow.querySelector('.delete-session-btn');
                deleteBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (confirm(`セッション「${displayName}」を削除しますか？`)) {
                        try {
                            const res = await fetch('/api/state');
                            const currentState = await res.json();
                            const updatedSessions = currentState.sessions.filter(s => s.id !== session.id);

                            await fetch('/api/state', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ sessions: updatedSessions })
                            });

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

                // Merge Logic (for worktree sessions) - Send /merge command to Claude Code
                const mergeBtn = childRow.querySelector('.merge-session-btn');
                if (mergeBtn) {
                    mergeBtn.onclick = async (e) => {
                        e.stopPropagation();
                        if (!confirm(`「${displayName}」の変更をmainブランチにマージしますか？\n\nClaude Codeで /merge コマンドを実行します。`)) {
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

                            alert('Claude Codeに /merge コマンドを送信しました。\nターミナルで進捗を確認してください。');
                        } catch (err) {
                            console.error('Failed to send merge command', err);
                            alert('/merge コマンドの送信に失敗しました');
                        }
                    };
                }

                // Archive Logic (with worktree merge check)
                const archiveBtn = childRow.querySelector('.archive-session-btn');
                archiveBtn.onclick = async (e) => {
                    e.stopPropagation();
                    const newArchivedState = !session.archived;

                    if (newArchivedState) {
                        // Archiving - use new API with merge check
                        try {
                            const res = await fetch(`/api/sessions/${session.id}/archive`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ skipMergeCheck: false })
                            });
                            const result = await res.json();

                            if (result.needsConfirmation) {
                                // Show merge confirmation dialog
                                const mergeChoice = confirm(
                                    `「${displayName}」に未マージの変更があります:\n` +
                                    `・${result.status.commitsAhead || 0} コミット先行\n` +
                                    `・${result.status.hasUncommittedChanges ? '未コミットの変更あり' : '未コミットの変更なし'}\n\n` +
                                    `マージしてからアーカイブしますか？\n\n` +
                                    `OK = マージしてアーカイブ\nキャンセル = 何もしない`
                                );

                                if (!mergeChoice) {
                                    // User cancelled - do nothing
                                    return;
                                }

                                // Merge first
                                const mergeRes = await fetch(`/api/sessions/${session.id}/merge`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' }
                                });
                                const mergeResult = await mergeRes.json();

                                if (!mergeResult.success) {
                                    // Merge failed - ask if they want to discard
                                    const discardChoice = confirm(
                                        `マージに失敗しました: ${mergeResult.error}\n\n` +
                                        `変更を破棄してアーカイブしますか？\n\n` +
                                        `OK = 破棄してアーカイブ\nキャンセル = 何もしない`
                                    );
                                    if (!discardChoice) {
                                        return;
                                    }
                                }

                                // Archive with skip merge check
                                await fetch(`/api/sessions/${session.id}/archive`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ skipMergeCheck: true })
                                });
                            }

                            loadSessions();
                        } catch (err) {
                            console.error('Failed to archive session', err);
                        }
                    } else {
                        // Unarchiving - simple state update
                        try {
                            const res = await fetch('/api/state');
                            const currentState = await res.json();
                            const updatedSessions = currentState.sessions.map(s =>
                                s.id === session.id ? { ...s, archived: false } : s
                            );
                            await fetch('/api/state', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ sessions: updatedSessions })
                            });
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
                    e.preventDefault();
                    e.stopPropagation();
                    childRow.classList.remove('drag-over');

                    if (!draggedSessionId || draggedSessionProject !== project || draggedSessionId === session.id) {
                        return;
                    }

                    try {
                        const res = await fetch('/api/state');
                        const currentState = await res.json();
                        const sessionList = currentState.sessions || [];

                        const draggedIndex = sessionList.findIndex(s => s.id === draggedSessionId);
                        const targetIndex = sessionList.findIndex(s => s.id === session.id);

                        if (draggedIndex === -1 || targetIndex === -1) return;

                        const [draggedSession] = sessionList.splice(draggedIndex, 1);
                        const newTargetIndex = sessionList.findIndex(s => s.id === session.id);
                        sessionList.splice(newTargetIndex, 0, draggedSession);

                        await fetch('/api/state', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sessions: sessionList })
                        });

                        loadSessions();
                    } catch (err) {
                        console.error('Failed to reorder sessions', err);
                    }
                });

                childrenDiv.appendChild(childRow);
            });

            groupDiv.appendChild(header);
            groupDiv.appendChild(childrenDiv);
            sessionList.appendChild(groupDiv);
        }

        lucide.createIcons();
        updateSessionIndicators(); // Restore indicators
    }

    // --- Actions ---

    async function createNewSession(project = 'general') {
        console.log('createNewSession called for project:', project);

        // Find repo path for project
        const mapping = {
            'unson': '/Users/ksato/workspace/unson',
            'tech-knight': '/Users/ksato/workspace/tech-knight',
            'brainbase': '/Users/ksato/workspace/brainbase-ui',
            'salestailor': '/Users/ksato/workspace/salestailor',
            'zeims': '/Users/ksato/workspace/zeims',
            'baao': '/Users/ksato/workspace/baao',
            'ncom': '/Users/ksato/workspace/ncom-catalyst',
            'senrigan': '/Users/ksato/workspace/senrigan',
        };

        let repoPath = null;
        if (project !== 'General' && project !== 'general') {
            repoPath = mapping[project] || `/Users/ksato/workspace/${project}`;
        } else {
            repoPath = '/Users/ksato/workspace';
        }

        const name = prompt('Enter session name:', `New ${project} Session`);
        if (!name) return;

        const initialCommand = prompt('Initial command (optional):', '');

        const sessionId = `session-${Date.now()}`; // Generate ID

        try {
            // Try to create session with worktree first
            const res = await fetch('/api/sessions/create-with-worktree', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, repoPath, name, initialCommand })
            });

            if (res.ok) {
                const { proxyPath, session } = await res.json();
                console.log('Created session with worktree:', session);

                // Reload and switch
                await loadSessions();
                switchSession(sessionId, session.path, initialCommand);
            } else {
                // Fallback to regular session (non-git repo)
                console.log('Worktree creation failed, falling back to regular session');
                const fallbackRes = await fetch('/api/sessions/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, initialCommand, cwd: repoPath })
                });

                if (fallbackRes.ok) {
                    const { proxyPath } = await fallbackRes.json();

                    // Save to state manually
                    const resState = await fetch('/api/state');
                    const currentState = await resState.json();
                    const newSessions = [...(currentState.sessions || []), {
                        id: sessionId,
                        name: name,
                        path: repoPath,
                        initialCommand,
                        archived: false,
                        created: new Date().toISOString()
                    }];

                    await fetch('/api/state', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sessions: newSessions })
                    });

                    await loadSessions();
                    switchSession(sessionId, repoPath, initialCommand);
                } else {
                    alert('セッションの開始に失敗しました');
                }
            }
        } catch (error) {
            console.error('Error creating session:', error);
            alert('セッション作成エラー');
        }
    }

    async function startTaskSession(task) {
        console.log('### startTaskSession called with task:', task);
        // Map task project to repo path (for worktree)
        const mapping = {
            'unson': '/Users/ksato/workspace/unson',
            'tech-knight': '/Users/ksato/workspace/tech-knight',
            'brainbase': '/Users/ksato/workspace/brainbase-ui',
            'salestailor': '/Users/ksato/workspace/salestailor',
            'zeims': '/Users/ksato/workspace/zeims',
            'baao': '/Users/ksato/workspace/baao',
            'ncom': '/Users/ksato/workspace/ncom-catalyst',
            'senrigan': '/Users/ksato/workspace/senrigan',
        };

        let repoPath = mapping[task.project] || `/Users/ksato/workspace/${task.project}`;
        if (!task.project) {
            repoPath = '/Users/ksato/workspace';
        }

        const sessionId = `task-${task.id}-${Date.now()}`;
        const name = `Task: ${task.name}`;
        const initialCommand = `/task ${task.id}`;

        try {
            // Try to create session with worktree first
            console.log('### Calling /api/sessions/create-with-worktree');
            console.log('### sessionId:', sessionId, 'repoPath:', repoPath);
            const res = await fetch('/api/sessions/create-with-worktree', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, repoPath, name, initialCommand })
            });
            console.log('### API response status:', res.status, res.ok);

            if (res.ok) {
                const { proxyPath, session } = await res.json();
                console.log('### Created task session with worktree:', session);
                console.log('### proxyPath:', proxyPath);

                await updateTaskStatus(task.id, 'in-progress');
                await loadSessions();

                // Use proxyPath directly instead of calling switchSession
                currentSessionId = sessionId;
                document.querySelectorAll('.session-child-row').forEach(row => {
                    row.classList.remove('active');
                    if (row.dataset.id === sessionId) row.classList.add('active');
                });
                console.log('Setting terminalFrame.src to:', proxyPath);
                terminalFrame.src = proxyPath;
            } else {
                // Fallback to regular session (non-git repo)
                // Use workspace root if specific repo doesn't exist
                const fallbackCwd = '/Users/ksato/workspace';
                console.log('### Worktree failed, using fallback with cwd:', fallbackCwd);
                const fallbackRes = await fetch('/api/sessions/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, initialCommand, cwd: fallbackCwd })
                });
                console.log('### Fallback response:', fallbackRes.status, fallbackRes.ok);

                if (fallbackRes.ok) {
                    const { proxyPath } = await fallbackRes.json();
                    console.log('### Fallback proxyPath:', proxyPath);

                    // Save to state manually
                    const resState = await fetch('/api/state');
                    const currentState = await resState.json();
                    const newSessions = [...(currentState.sessions || []), {
                        id: sessionId,
                        name: name,
                        path: repoPath,
                        taskId: task.id,
                        initialCommand,
                        archived: false,
                        created: new Date().toISOString()
                    }];

                    await fetch('/api/state', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sessions: newSessions })
                    });

                    await updateTaskStatus(task.id, 'in-progress');
                    await loadSessions();

                    // Use proxyPath directly
                    currentSessionId = sessionId;
                    console.log('### Setting terminalFrame.src (fallback):', proxyPath);
                    terminalFrame.src = proxyPath;
                } else {
                    alert('セッションの開始に失敗しました');
                }
            }
        } catch (error) {
            console.error('Error starting task session:', error);
            alert('セッション作成エラー');
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

            // Clear unread (using imported module)
            clearUnread(id);
            updateSessionIndicators(currentSessionId);

        } catch (error) {
            console.error('Failed to switch session:', error);
            terminalFrame.src = 'about:blank';
        }
    }

    async function updateTaskStatus(id, status) {
        await fetch(`/api/tasks/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        loadTasks();
    }

    async function deleteTask(id) {
        await fetch(`/api/tasks/${id}`, {
            method: 'DELETE'
        });
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

        // Populate project filter options
        const projects = [...new Set(sessions.filter(s => s.archived).map(s => {
            if (s.path) {
                for (const proj of CORE_PROJECTS) {
                    if (s.path.includes(proj)) return proj;
                }
            }
            return 'General';
        }))].sort();

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
        const searchTerm = archiveSearchInput?.value.toLowerCase() || '';
        const projectFilter = archiveProjectFilter?.value || '';

        let archivedSessions = sessions.filter(s => s.archived);

        // Apply search filter
        if (searchTerm) {
            archivedSessions = archivedSessions.filter(s =>
                (s.name || s.id).toLowerCase().includes(searchTerm)
            );
        }

        // Apply project filter
        if (projectFilter) {
            archivedSessions = archivedSessions.filter(s => {
                if (!s.path) return projectFilter === 'General';
                return s.path.includes(projectFilter);
            });
        }

        // Sort by created date (newest first)
        archivedSessions.sort((a, b) => {
            const dateA = new Date(a.created || 0);
            const dateB = new Date(b.created || 0);
            return dateB - dateA;
        });

        if (archivedSessions.length === 0) {
            archiveListEl.innerHTML = '';
            archiveEmptyEl.style.display = 'block';
            return;
        }

        archiveEmptyEl.style.display = 'none';

        archiveListEl.innerHTML = archivedSessions.map(session => {
            const name = session.name || session.id;
            let project = 'General';
            if (session.path) {
                for (const proj of CORE_PROJECTS) {
                    if (session.path.includes(proj)) {
                        project = proj;
                        break;
                    }
                }
            }
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
                if (confirm(`「${session?.name || sessionId}」を完全に削除しますか？`)) {
                    await deleteSession(sessionId);
                }
            };
        });

        lucide.createIcons();
    }

    async function restoreSession(sessionId) {
        try {
            const res = await fetch('/api/state');
            const currentState = await res.json();
            const updatedSessions = currentState.sessions.map(s =>
                s.id === sessionId ? { ...s, archived: false } : s
            );
            await fetch('/api/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessions: updatedSessions })
            });
            await loadSessions();
            renderArchiveList();
        } catch (err) {
            console.error('Failed to restore session', err);
        }
    }

    async function deleteSession(sessionId) {
        try {
            const res = await fetch('/api/state');
            const currentState = await res.json();
            const updatedSessions = currentState.sessions.filter(s => s.id !== sessionId);
            await fetch('/api/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessions: updatedSessions })
            });
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

    // Initialize Settings Module
    initSettings();

    // Initialize File Upload (Drag & Drop, Clipboard)
    initFileUpload(() => currentSessionId);

    // Periodic Refresh (every 5 minutes)
    setInterval(() => {
        loadSchedule();
        loadTasks();
    }, 5 * 60 * 1000);

    // Status Polling (every 3 seconds) - using imported module
    startPolling(() => currentSessionId, 3000);

    // --- Terminal Copy Functionality ---
    if (copyTerminalBtn) {
        copyTerminalBtn.onclick = async () => {
            if (!currentSessionId) {
                alert('セッションを選択してください');
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
                alert('ターミナル内容の取得に失敗しました');
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
