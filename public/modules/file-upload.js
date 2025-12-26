/**
 * file-upload.js - File upload and drag & drop handling
 *
 * Handles file uploads via drag & drop and clipboard paste.
 */

// --- Module State ---
let getSessionId = null; // Callback to get current session ID
let consoleArea = null;
let dropOverlay = null;
let dragCounter = 0;

// --- Core Functions ---

/**
 * Upload file and paste path to terminal
 * @param {FileList|File[]} files - Files to upload
 */
async function handleFiles(files) {
    const file = files[0]; // Handle single file for now
    const currentSessionId = getSessionId?.();
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
        await fetch(`/api/sessions/${currentSessionId}/input`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: path, type: 'text' })
        });

    } catch (error) {
        console.error('File upload failed:', error);
        alert('ファイルアップロードに失敗しました');
    }
}

// --- Event Handlers ---

function setupDragDropEvents() {
    // Prevent default drag behaviors on document level
    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        consoleArea?.classList.add('dragging');
    });

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Safari requires explicitly setting dropEffect to allow file drops
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.relatedTarget === null) {
            consoleArea?.classList.remove('dragging');
            dropOverlay?.classList.remove('active');
            dragCounter = 0;
        }
    });

    document.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        consoleArea?.classList.remove('dragging');
        dropOverlay?.classList.remove('active');
        dragCounter = 0;

        // Fallback: handle drops even if overlay didn't activate (Safari)
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            handleFiles(files);
        }
    });

    // Show overlay when dragging over console area
    consoleArea?.addEventListener('dragenter', (e) => {
        dragCounter++;
        dropOverlay?.classList.add('active');
        lucide.createIcons();
    });

    consoleArea?.addEventListener('dragleave', (e) => {
        dragCounter--;
        if (dragCounter === 0) {
            dropOverlay?.classList.remove('active');
        }
    });

    // Allow dropping directly on console area (Safari may skip overlay)
    consoleArea?.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    consoleArea?.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        consoleArea?.classList.remove('dragging');
        dropOverlay?.classList.remove('active');

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            await handleFiles(files);
        }
    });

    // Handle drop on overlay
    dropOverlay?.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    dropOverlay?.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        consoleArea?.classList.remove('dragging');
        dropOverlay?.classList.remove('active');

        const dt = e.dataTransfer;
        const files = dt.files;

        if (files.length > 0) {
            await handleFiles(files);
        }
    });
}

function setupClipboardPaste() {
    document.addEventListener('paste', async (e) => {
        // Skip if pasting into input fields - let browser handle it
        if (e.target.tagName === 'INPUT' ||
            e.target.tagName === 'TEXTAREA' ||
            e.target.isContentEditable) {
            return;
        }

        const currentSessionId = getSessionId?.();
        if (!currentSessionId) return;

        const items = e.clipboardData?.items;
        if (!items) return;

        // Phase 2.2: Handle both images and text
        for (const item of items) {
            // Handle images
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    await handleFiles([file]);
                }
                return;
            }

            // Handle text (Phase 2.2)
            if (item.type === 'text/plain') {
                e.preventDefault();
                item.getAsString(async (text) => {
                    await showPasteConfirmModal(text, currentSessionId);
                });
                return;
            }
        }
    });
}

/**
 * Show paste confirmation modal (Phase 2.2)
 * @param {string} text - Text to paste
 * @param {string} sessionId - Target session ID
 */
async function showPasteConfirmModal(text, sessionId) {
    const modal = document.getElementById('paste-confirm-modal');
    const preview = document.getElementById('paste-preview-text');
    const confirmBtn = document.getElementById('paste-confirm-btn');
    const cancelBtn = document.getElementById('paste-cancel-btn');
    const closeBtn = modal.querySelector('.close-modal-btn');

    if (!modal || !preview || !confirmBtn || !cancelBtn) return;

    // Show preview (limit to 500 chars for display)
    const displayText = text.length > 500 ? text.substring(0, 500) + '\n...(省略)...' : text;
    preview.textContent = displayText;

    // Show modal
    modal.classList.add('active');

    // Wait for user action
    const result = await new Promise((resolve) => {
        const confirm = () => {
            cleanup();
            resolve(true);
        };
        const cancel = () => {
            cleanup();
            resolve(false);
        };
        const cleanup = () => {
            confirmBtn.removeEventListener('click', confirm);
            cancelBtn.removeEventListener('click', cancel);
            closeBtn.removeEventListener('click', cancel);
            modal.removeEventListener('click', handleBackdrop);
        };
        const handleBackdrop = (e) => {
            if (e.target === modal) cancel();
        };

        confirmBtn.addEventListener('click', confirm);
        cancelBtn.addEventListener('click', cancel);
        closeBtn.addEventListener('click', cancel);
        modal.addEventListener('click', handleBackdrop);
    });

    modal.classList.remove('active');

    // Paste to terminal if confirmed
    if (result) {
        await pasteTextToTerminal(sessionId, text);
    }
}

/**
 * Paste text to terminal (Phase 2.2)
 * @param {string} sessionId - Session ID
 * @param {string} text - Text to paste
 */
async function pasteTextToTerminal(sessionId, text) {
    try {
        await fetch(`/api/sessions/${sessionId}/input`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: text, type: 'text' })
        });
    } catch (error) {
        console.error('Failed to paste text:', error);
        alert('テキストの貼り付けに失敗しました');
    }
}

function setupKeyHandling() {
    window.addEventListener('message', async (event) => {
        if (event.data && event.data.type === 'SHIFT_ENTER') {
            const currentSessionId = getSessionId?.();
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
}

// --- Public API ---

/**
 * Initialize file upload module
 * @param {function} sessionIdGetter - Function that returns current session ID
 */
export function initFileUpload(sessionIdGetter) {
    getSessionId = sessionIdGetter;
    consoleArea = document.querySelector('.console-area');
    dropOverlay = document.getElementById('drop-overlay');

    setupDragDropEvents();
    setupClipboardPaste();
    setupKeyHandling();
}
