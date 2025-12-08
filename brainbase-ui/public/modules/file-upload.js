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

    // Handle drop on overlay
    dropOverlay?.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
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
        const currentSessionId = getSessionId?.();
        if (!currentSessionId) return;

        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    await handleFiles([file]);
                }
                return;
            }
        }
    });
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
