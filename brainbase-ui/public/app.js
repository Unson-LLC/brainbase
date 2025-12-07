document.addEventListener('DOMContentLoaded', () => {
    // --- State & Elements ---
    let sessions = [];
    let currentSessionId = null;
    let tasks = [];
    let schedule = null;
    let currentFilter = 'focus';
    let searchQuery = '';

    const terminalFrame = document.getElementById('terminal-frame');
    const sessionList = document.getElementById('session-list');
    const taskList = document.getElementById('task-list');
    const scheduleList = document.getElementById('schedule-list');
    const addSessionBtn = document.getElementById('add-session-btn');
    const searchInput = document.getElementById('search-input');
    const tabs = document.querySelectorAll('.tab');
    
    // Modal Elements
    const editModal = document.getElementById('edit-task-modal');
    const editTaskId = document.getElementById('edit-task-id');
    const editTaskTitle = document.getElementById('edit-task-title');
    const editTaskProject = document.getElementById('edit-task-project');
    const editTaskPriority = document.getElementById('edit-task-priority');
    const editTaskDue = document.getElementById('edit-task-due');
    const closeModalBtns = document.querySelectorAll('.close-modal-btn');
    const saveTaskBtn = document.getElementById('save-task-btn');

    // Archive Toggle
    const showArchivedToggle = document.createElement('div');
    showArchivedToggle.className = 'session-controls';
    showArchivedToggle.innerHTML = `
        <div class="toggle-wrapper">
             <label class="toggle-switch">
                <input type="checkbox" id="show-archived-checkbox">
                <span class="slider round"></span>
                <span class="label-text">Show Archived</span>
            </label>
        </div>
    `;
    // Insert before session list
    document.getElementById('sidebar').insertBefore(showArchivedToggle, sessionList);
    
    let showArchived = false;
    const showArchivedCheckbox = document.getElementById('show-archived-checkbox');
    showArchivedCheckbox.addEventListener('change', (e) => {
        showArchived = e.target.checked;
        renderSessionList();
    });

    const CORE_PROJECTS = ['brainbase', 'unson', 'tech-knight', 'salestailor', 'zeims', 'baao', 'ncom', 'senrigan'];

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
            // Add cache-busting timestamp
            const res = await fetch(`/api/tasks?t=${Date.now()}`);
            if (res.ok) {
                const text = await res.text();
                // Ensure we parse standard JSON array
                tasks = JSON.parse(text); 
                renderTasks();
            } else {
                console.error("Failed to fetch tasks:", res.status);
            }
        } catch (error) {
            console.error('Failed to load tasks:', error);
            taskList.innerHTML = '<div class="error">Failed to load tasks</div>';
        }
    }

    async function loadSchedule() {
        try {
            const res = await fetch('/api/schedule/today');
            schedule = await res.json();
            renderSchedule();
        } catch (error) {
            console.error('Failed to load schedule:', error);
            scheduleList.innerHTML = '<div class="error">Failed to load schedule</div>';
        }
    }

    // --- Rendering ---
    function renderSessionList() {
        sessionList.innerHTML = '';

        // Group sessions by project path
        const output = {}; // ProjectName -> [Sessions]
        
        // Filter sessions based on archived state
        const filteredSessions = sessions.filter(s => showArchived ? true : !s.archived);

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

                const displayName = session.name || session.id;
                
                childRow.innerHTML = `
                    <div class="session-name-container">
                        <span class="session-icon"><i data-lucide="terminal-square"></i></span>
                        <span class="session-name">${displayName}</span> ${session.archived ? '(Archived)' : ''}
                    </div>
                    <div class="child-actions">
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
                    if (confirm(`Are you sure you want to delete session "${displayName}"?`)) {
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

                // Archive Logic
                const archiveBtn = childRow.querySelector('.archive-session-btn');
                archiveBtn.onclick = async (e) => {
                    e.stopPropagation();
                    const newArchivedState = !session.archived;
                    const actionName = newArchivedState ? 'archive' : 'unarchive';
                    
                    if (newArchivedState && !confirm(`Are you sure you want to archive session "${displayName}"?`)) {
                        return; 
                    }

                    try {
                        const res = await fetch('/api/state');
                        const currentState = await res.json();
                        const updatedSessions = currentState.sessions.map(s => 
                            s.id === session.id ? { ...s, archived: newArchivedState } : s
                        );
                        await fetch('/api/state', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sessions: updatedSessions })
                        });
                        loadSessions(); // Reload list
                    } catch (err) {
                        console.error('Failed to update archive state', err);
                    }
                };

                childrenDiv.appendChild(childRow);
            });

            groupDiv.appendChild(header);
            groupDiv.appendChild(childrenDiv);
            sessionList.appendChild(groupDiv);
        }
        
        lucide.createIcons();
        updateSessionIndicators(); // Restore indicators
    }

    function renderTasks() {
        taskList.innerHTML = '';
        const filteredTasks = tasks.filter(task => {
            // Apply status filter
            if (currentFilter === 'focus') return task.status === 'in-progress' || task.status === 'todo'; // or based on urgency
            if (currentFilter === 'backlog') return task.status === 'todo' || !task.status;
            if (currentFilter === 'done') return task.status === 'done';
            return true;
        }).filter(task => {
            // Apply search filter
            if (!searchQuery) return true;
            return task.name.toLowerCase().includes(searchQuery.toLowerCase());
        });

        filteredTasks.forEach(task => {
            const el = document.createElement('div');
            el.className = 'task-card';
            // Determine project color class? (CSS variables usually)
            
            el.innerHTML = `
                <div class="task-header">
                    <button class="task-checkbox ${task.status === 'done' ? 'checked' : ''}"><i data-lucide="check"></i></button>
                    <span class="task-title">${task.name}</span>
                    <div class="task-actions">
                         <button class="task-action-btn edit" title="Edit"><i data-lucide="edit-2"></i></button>
                         <button class="task-action-btn delete" title="Delete"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
                <div class="task-meta">
                    <span class="task-project">${task.project || 'General'}</span>
                    <span class="task-priority ${task.priority}">${task.priority || 'Medium'}</span>
                    ${task.due ? `<span class="task-due">${task.due}</span>` : ''}
                </div>
                ${task.status !== 'done' ? `<button class="start-task-btn" title="Start Working (Open Terminal)"><i data-lucide="terminal-square"></i></button>` : ''}
                ${(currentSessionId && task.status === 'in-progress') ? `<button class="complete-task-btn" title="Complete Task"><i data-lucide="check-circle-2"></i> Complete</button>` : ''}
            `;

            // Checkbox logic
            const checkbox = el.querySelector('.task-checkbox');
            checkbox.onclick = (e) => {
                e.stopPropagation();
                // Toggle status (simple optimistic UI)
                const newStatus = task.status === 'done' ? 'todo' : 'done';
                updateTaskStatus(task.id, newStatus);
            };

            // Start Session Logic
            const startBtn = el.querySelector('.start-task-btn');
            if (startBtn) {
                startBtn.onclick = (e) => {
                    e.stopPropagation();
                    startTaskSession(task);
                };
            }
            
            // Edit / Delete logic
            el.querySelector('.edit').onclick = (e) => {
                e.stopPropagation();
                openEditModal(task);
            };
            el.querySelector('.delete').onclick = (e) => {
                e.stopPropagation();
                if(confirm('Delete task?')) deleteTask(task.id);
            };

            taskList.appendChild(el);
        });
        
        lucide.createIcons();
    }

    function renderSchedule() {
        scheduleList.innerHTML = '';
        if (!schedule) {
             scheduleList.innerHTML = 'No schedule';
             return;
        }

        const events = schedule.timeline || []; // Assuming parser returns timeline array
        
        const timelineDiv = document.createElement('div');
        timelineDiv.className = 'timeline';

        events.forEach(item => {
            const el = document.createElement('div');
            el.className = 'timeline-item';
            if (item.task && item.task.includes('OHAYO')) el.classList.add('ohayo-item');

            el.innerHTML = `
                <div class="timeline-marker"></div>
                <div class="timeline-content">
                    <div class="timeline-time">${item.time}</div>
                    <div class="timeline-task">${item.task}</div>
                </div>
            `;
            timelineDiv.appendChild(el);
        });
        
        scheduleList.appendChild(timelineDiv);
    }

    // --- Actions ---

    async function createNewSession(project = 'general') {
        console.log('createNewSession called for project:', project);

        // Find path for project
        // This is a simplification. Ideally backend provides project paths.
        // We will assume a standard workspace structure or prompt?
        
        let cwd = null;
        if (project !== 'General' && project !== 'general') {
             // Hardcoded common paths for now based on user context
             const mapping = {
                 'unson': '/Users/ksato/workspace/unson/web',
                 'tech-knight': '/Users/ksato/workspace/tech-knight/app/hp-site',
                 'brainbase': '/Users/ksato/workspace/brainbase-ui',
                 // Add others as needed or default to workspace root + project name
             };
             cwd = mapping[project] || `/Users/ksato/workspace/${project}`; 
        }

        const name = prompt('Enter session name:', `New ${project} Session`);
        if (!name) return;

        const initialCommand = prompt('Initial command (optional):', '');
        
        const sessionId = `session-${Date.now()}`; // Generate ID

        try {
            // Start backend process
            const res = await fetch('/api/sessions/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, initialCommand, cwd })
            });

            if (res.ok) {
                const { port } = await res.json();
                
                // Save to state
                const resState = await fetch('/api/state');
                const currentState = await resState.json();
                const newSessions = [...(currentState.sessions || []), {
                    id: sessionId,
                    name: name,
                    path: cwd || '/Users/ksato/workspace', // Default
                    initialCommand,
                    archived: false
                }];
                
                await fetch('/api/state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessions: newSessions })
                });

                // Reload and switch
                await loadSessions();
                switchSession(sessionId, cwd, initialCommand);
            } else {
                alert('Failed to start session backend');
            }
        } catch (error) {
            console.error('Error creating session:', error);
            alert('Error creating session');
        }
    }

    async function startTaskSession(task) {
        // Map task project to CWD
        let cwd = null;
         if (task.project) {
             const mapping = {
                 'unson': '/Users/ksato/workspace/unson/web',
                 'tech-knight': '/Users/ksato/workspace/tech-knight/app/hp-site',
                 'brainbase': '/Users/ksato/workspace/brainbase-ui',
             };
             cwd = mapping[task.project] || `/Users/ksato/workspace/${task.project}`; 
        }

        const sessionId = `task-${task.id}-${Date.now()}`;
        const name = `Task: ${task.name}`;
        
        try {
             // Start backend process
            const res = await fetch('/api/sessions/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, cwd })
            });

             if (res.ok) {
                // Update state
                const resState = await fetch('/api/state');
                const currentState = await resState.json();
                const newSessions = [...(currentState.sessions || []), {
                    id: sessionId,
                    name: name,
                    path: cwd,
                    taskId: task.id,
                    archived: false
                }];
                // Also update task status to in-progress?
                
                 await fetch('/api/state', {
                    method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessions: newSessions })
                });
                
                await updateTaskStatus(task.id, 'in-progress');

                await loadSessions();
                switchSession(sessionId, cwd);
             }
        } catch (error) {
            console.error('Error starting task session:', error);
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
            const { port } = await res.json();
            
            // Update iframe
            terminalFrame.src = `http://localhost:${port}`;
            
            // Clear unread
            if (sessionUnreadMap.get(id)) {
                sessionUnreadMap.set(id, false);
                updateSessionIndicators();
            }

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

    addSessionBtn.addEventListener('click', () => createNewSession());

    // Schedule Trigger
    document.getElementById('update-schedule-btn').addEventListener('click', async () => {
         // Copy command to clipboard
         const command = 'gs_schedule_update';
         await navigator.clipboard.writeText(command);
         alert('Copied schedule update command to clipboard!');
         // In future, trigger via API if meaningful
    });


    // --- Session Status Polling ---
    const sessionStatusMap = new Map(); // sessionId -> { isRunning, isWorking }
    const sessionUnreadMap = new Map(); // sessionId -> boolean (true if finished working but not viewed)

    async function pollSessionStatus() {
        try {
            const res = await fetch('/api/sessions/status');
            const status = await res.json();
            
            // Debug Log
            console.log('Poll Status Result:', status);

            // Update map and handle transitions
            for (const [sessionId, newStatus] of Object.entries(status)) {
                const oldStatus = sessionStatusMap.get(sessionId);
                
                // Transition: Working -> Idle (Done)
                // Only if NOT the current session
                if (oldStatus?.isWorking && !newStatus.isWorking && currentSessionId !== sessionId) {
                    sessionUnreadMap.set(sessionId, true);
                }
                
                // If currently working, it's not unread (it's active)
                if (newStatus.isWorking) {
                    sessionUnreadMap.set(sessionId, false);
                }

                sessionStatusMap.set(sessionId, newStatus);
            }

            updateSessionIndicators();
        } catch (error) {
            console.error('Failed to poll session status:', error);
        }
    }

    function updateSessionIndicators() {
        const sessionItems = document.querySelectorAll('.session-child-row');
        sessionItems.forEach(item => {
            const sessionId = item.dataset.id;
            const status = sessionStatusMap.get(sessionId);
            const isUnread = sessionUnreadMap.get(sessionId);
            
            console.log(`Updating indicator for ${sessionId}: current=${currentSessionId}, isWorking=${status?.isWorking}, isUnread=${isUnread}`);

            // Remove existing indicator
            const existingIndicator = item.querySelector('.session-activity-indicator');
            if (existingIndicator) {
                existingIndicator.remove();
            }

            // Determine if we should show indicator
            // 1. Working: Always show (Green Pulse) - EVEN IF CURRENT SESSION
            // 2. Unread: Show (Green Static) - ONLY IF NOT CURRENT SESSION (handled by map logic but safe to check)
            
            if (currentSessionId === sessionId) {
                // If looking at it, clear unread
                if (sessionUnreadMap.get(sessionId)) {
                    sessionUnreadMap.set(sessionId, false);
                    // No return here, proceed to check isWorking
                }
            }

            if (status?.isWorking) {
                const indicator = document.createElement('div');
                indicator.className = 'session-activity-indicator working';
                item.appendChild(indicator);
                console.log(`Added WORKING indicator to ${sessionId}`);
            } else if (isUnread && currentSessionId !== sessionId) {
                const indicator = document.createElement('div');
                indicator.className = 'session-activity-indicator done';
                item.appendChild(indicator);
                console.log(`Added DONE indicator to ${sessionId}`);
            }
        });
    }

    // --- Drag & Drop File Upload ---
    const consoleArea = document.querySelector('.console-area');
    
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        consoleArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // Highlight drop zone
    ['dragenter', 'dragover'].forEach(eventName => {
        consoleArea.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        consoleArea.addEventListener(eventName, unhighlight, false);
    });

    function highlight(e) {
        consoleArea.classList.add('highlight');
    }

    function unhighlight(e) {
        consoleArea.classList.remove('highlight');
    }

    // Handle Drop
    consoleArea.addEventListener('drop', handleDrop, false);

    async function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files.length > 0) {
            await handleFiles(files);
        }
    }

    async function handleFiles(files) {
        const file = files[0]; // Handle single file for now
        if (!currentSessionId) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            // 1. Upload File
            const uploadRes = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            if (!uploadRes.ok) throw new Error('Upload failed');
            
            const { path } = await uploadRes.json();
            
            // 2. Paste path into terminal
            // We need to send this input to the session
            await fetch(`/api/sessions/${currentSessionId}/input`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: path }) // Just paste the path
            });

        } catch (error) {
            console.error('File upload failed:', error);
            alert('File upload failed');
        }
    }

    // --- Custom Key Handling (Shift+Enter) ---
    window.addEventListener('message', async (event) => {
        if (event.data && event.data.type === 'SHIFT_ENTER') {
            if (currentSessionId) {
                console.log('Received SHIFT_ENTER from iframe, sending M-Enter to session');
                try {
                    await fetch(`/api/sessions/${currentSessionId}/input`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            input: 'M-Enter', 
                            type: 'key' 
                        })
                    });
                } catch (error) {
                    console.error('Failed to send key command:', error);
                }
            }
        }
    });

    // Initial Load
    loadSessions();
    loadSchedule();
    loadTasks();
    
    // Periodic Refresh (every 5 minutes)
    setInterval(() => {
        loadSchedule();
        loadTasks();
    }, 5 * 60 * 1000);

    // Status Polling (every 3 seconds)
    setInterval(pollSessionStatus, 3000);
    // Initial poll
    pollSessionStatus();
});
