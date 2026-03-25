/**
 * iframe Contextmenu Handler
 * iframe内からのpostMessageを受信してカスタムコンテキストメニューを表示
 */

import {
    extractFilePathFromSelection,
    shouldShowContextMenu,
    convertIframeToParentCoordinates
} from './iframe-contextmenu-utils.js';

import { openFile, openInCursor } from './file-opener.js';
import { appStore } from './core/store.js';
import {
    buildFileLinksForWrappedLine,
    buildAdjacentContinuationSegments,
    expandWrappedLinkSegments,
    pickBestLinkAtPosition
} from './xterm-file-links.js';

function getCurrentSessionContext() {
    const { sessions, currentSessionId } = appStore.getState();
    const session = sessions.find(s => s.id === currentSessionId);
    return {
        sessionId: currentSessionId || null,
        cwd: session?.worktree?.path || session?.path || null
    };
}

function getWorkspaceRoot(sessionId = null) {
    const { sessions, currentSessionId } = appStore.getState();
    const targetSessionId = sessionId || currentSessionId;
    const session = sessions.find(s => s.id === targetSessionId);
    return session?.worktree?.path || session?.path || null;
}

let currentSelectedText = '';

function createContextMenu() {
    const menu = document.createElement('div');
    menu.id = 'terminal-context-menu';
    menu.style.cssText = `
        position: fixed;
        background: white;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        z-index: 10001;
        display: none;
        min-width: 200px;
        padding: 4px 0;
    `;

    const menuItems = [
        { label: 'デフォルトアプリで開く', mode: 'file', icon: '📄' },
        { label: 'Finderで表示', mode: 'reveal', icon: '📁' },
        { label: 'Cursorで開く', mode: 'cursor', icon: '✏️' }
    ];

    menuItems.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            color: #333;
            font-size: 14px;
        `;
        const iconSpan = document.createElement('span');
        iconSpan.textContent = item.icon;
        const labelSpan = document.createElement('span');
        labelSpan.textContent = item.label;
        menuItem.appendChild(iconSpan);
        menuItem.appendChild(labelSpan);

        menuItem.addEventListener('mouseenter', () => {
            menuItem.style.background = '#f0f0f0';
        });

        menuItem.addEventListener('mouseleave', () => {
            menuItem.style.background = 'white';
        });

        menuItem.addEventListener('click', async () => {
            hideContextMenu();
            const fileInfo = extractFilePathFromSelection(currentSelectedText);
            if (!fileInfo) return;
            try {
                const { sessionId, cwd } = getCurrentSessionContext();
                const options = {};
                if (cwd) options.cwd = cwd;
                if (sessionId) options.sessionId = sessionId;
                if (item.mode === 'cursor' && fileInfo.line) {
                    await openInCursor(fileInfo.path, fileInfo.line, options);
                } else {
                    await openFile(fileInfo.path, item.mode, options);
                }
                showNotification(`${item.label}しました`);
            } catch (error) {
                console.error('Failed to open file:', error);
                showNotification('ファイルを開けませんでした', 'error');
            }
        });

        menu.appendChild(menuItem);
    });

    document.body.appendChild(menu);
    return menu;
}

function showContextMenu(x, y, selectedText) {
    currentSelectedText = selectedText;
    let menu = document.getElementById('terminal-context-menu');
    if (!menu) {
        menu = createContextMenu();
    }
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = 'block';
}

function hideContextMenu() {
    const menu = document.getElementById('terminal-context-menu');
    if (menu) {
        menu.style.display = 'none';
    }
}

function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.textContent = message;

    const bgColor = type === 'error' ? '#f44336' : '#4caf50';
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${bgColor};
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 10000;
        animation: fadeInOut 2s ease-in-out;
    `;

    if (!document.getElementById('terminal-context-menu-animation')) {
        const style = document.createElement('style');
        style.id = 'terminal-context-menu-animation';
        style.textContent = `
            @keyframes fadeInOut {
                0% { opacity: 0; transform: translateY(10px); }
                10% { opacity: 1; transform: translateY(0); }
                90% { opacity: 1; transform: translateY(0); }
                100% { opacity: 0; transform: translateY(-10px); }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 2000);
}

function getTerminalLine(terminal, index) {
    return terminal?.buffer?.active?.getLine?.(index) || null;
}

function getWrappedBufferLineText(terminal, bufferLineNumber) {
    const line = getTerminalLine(terminal, bufferLineNumber);
    if (!line) return null;

    let start = bufferLineNumber;
    while (start > 0) {
        const current = getTerminalLine(terminal, start);
        if (!current?.isWrapped) break;
        start -= 1;
    }

    let end = bufferLineNumber;
    while (true) {
        const next = getTerminalLine(terminal, end + 1);
        if (!next?.isWrapped) break;
        end += 1;
    }

    const parts = [];
    for (let row = start; row <= end; row += 1) {
        const wrappedLine = getTerminalLine(terminal, row);
        parts.push(wrappedLine?.translateToString?.(true) || '');
    }

    return {
        startBufferLineNumber: start,
        text: parts.join('')
    };
}

function postOpenFile(link, sessionId = null) {
    const app = window.brainbaseApp;
    const activeSessionId = sessionId
        || appStore.getState().currentSessionId
        || app?.reconnectManager?.currentSessionId
        || app?.terminalTransportClient?.sessionId
        || null;
    console.log('[XtermFileLink] postOpenFile', {
        filePath: link?.rawPath || null,
        previewPath: link?.previewPath || null,
        previewable: Boolean(link?.previewable),
        line: link?.line || null,
        sessionId: activeSessionId
    });
    window.postMessage({
        type: 'OPEN_FILE',
        filePath: link.rawPath,
        previewPath: link.previewPath,
        previewable: link.previewable,
        line: link.line ? Number(link.line) : null,
        sessionId: activeSessionId,
        source: 'xterm'
    }, window.location.origin);
}

function buildLinksForProvider(terminal, bufferLineNumber) {
    const wrapped = getWrappedBufferLineText(terminal, bufferLineNumber);
    const sessionId = appStore.getState().currentSessionId || null;
    const workspaceRoot = getWorkspaceRoot(sessionId);
    const cols = terminal?.cols || Number.POSITIVE_INFINITY;
    const widthProvider = typeof terminal?.unicode?.getStringCellWidth === 'function'
        ? terminal.unicode.getStringCellWidth.bind(terminal.unicode)
        : null;
    const links = [];
    const seen = new Set();
    const pushLink = (link) => {
        const key = `${link.rawPath}|${link.range?.start?.x}|${link.range?.start?.y}|${link.range?.end?.x}|${link.range?.end?.y}`;
        if (seen.has(key)) return;
        seen.add(key);
        links.push(link);
    };

    if (wrapped?.text) {
        const logicalLinks = buildFileLinksForWrappedLine(
            wrapped.text,
            wrapped.startBufferLineNumber,
            cols,
            workspaceRoot,
            widthProvider
        );
        logicalLinks
            .flatMap(link => expandWrappedLinkSegments(link, cols, widthProvider))
            .forEach(pushLink);
    }

    const currentLineText = getTerminalLine(terminal, bufferLineNumber)?.translateToString?.(true) || '';
    const previousLineText = getTerminalLine(terminal, bufferLineNumber - 1)?.translateToString?.(true) || '';
    const nextLineText = getTerminalLine(terminal, bufferLineNumber + 1)?.translateToString?.(true) || '';

    buildAdjacentContinuationSegments(previousLineText, currentLineText, bufferLineNumber - 1, workspaceRoot, widthProvider)
        .forEach((link) => {
            if (link.range?.start?.y === bufferLineNumber) {
                pushLink(link);
            }
        });

    buildAdjacentContinuationSegments(currentLineText, nextLineText, bufferLineNumber, workspaceRoot, widthProvider)
        .forEach((link) => {
            if (link.range?.start?.y === bufferLineNumber) {
                pushLink(link);
            }
        });

    return links;
}

function resolveHoveredFileLink(terminal, event) {
    const buffer = terminal?.buffer?.active;
    if (!buffer) return null;

    const mouseCoords = terminal?._core?._mouseService?.getCoords?.(
        event,
        terminal.element,
        terminal.cols,
        terminal.rows,
        true
    );

    let col = null;
    let bufferLineNumber = null;
    if (Array.isArray(mouseCoords) && mouseCoords.length >= 2) {
        col = mouseCoords[0];
        bufferLineNumber = buffer.viewportY + mouseCoords[1] - 1;
    } else {
        const dims = terminal?._core?._renderService?.dimensions?.css?.cell;
        const rect = terminal?.element?.getBoundingClientRect?.();
        if (!dims || !rect) return null;
        const relativeX = event.clientX - rect.left;
        const relativeY = event.clientY - rect.top;
        if (relativeX < 0 || relativeY < 0) return null;
        col = Math.floor(relativeX / dims.width) + 1;
        const viewportRow = Math.floor(relativeY / dims.height);
        if (viewportRow < 0 || viewportRow >= terminal.rows) return null;
        bufferLineNumber = buffer.viewportY + viewportRow;
    }

    if (!col || !Number.isFinite(bufferLineNumber)) return null;
    const links = buildLinksForProvider(terminal, bufferLineNumber);
    return pickBestLinkAtPosition(links, bufferLineNumber, col);
}

function ensureHoverOverlay(terminal) {
    const terminalElement = terminal?.element;
    if (!terminalElement) return null;
    if (terminal.__bbHoverOverlay) return terminal.__bbHoverOverlay;

    if (!terminalElement.style.position) {
        terminalElement.style.position = 'relative';
    }

    const overlay = document.createElement('div');
    overlay.className = 'xterm-file-link-hover-overlay';
    overlay.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 5;
    `;
    terminalElement.appendChild(overlay);
    terminal.__bbHoverOverlay = overlay;
    return overlay;
}

function clearHoverOverlay(terminal) {
    const overlay = terminal?.__bbHoverOverlay;
    if (overlay) {
        overlay.innerHTML = '';
    }
}

function rememberHoveredLink(terminal, link) {
    if (!terminal) return;
    terminal.__bbHoveredFileLink = link || null;
    if (link) {
        terminal.__bbRecentHoveredFileLink = link;
        terminal.__bbRecentHoveredFileLinkAt = Date.now();
    }
}

function getRecentHoveredLink(terminal, maxAgeMs = 1000) {
    const link = terminal?.__bbRecentHoveredFileLink || null;
    const at = terminal?.__bbRecentHoveredFileLinkAt || 0;
    if (!link || !at) return null;
    return (Date.now() - at) <= maxAgeMs ? link : null;
}

function renderHoverOverlay(terminal, hoveredLink) {
    const overlay = ensureHoverOverlay(terminal);
    const dims = terminal?._core?._renderService?.dimensions?.css?.cell;
    const buffer = terminal?.buffer?.active;
    if (!overlay || !dims || !buffer || !hoveredLink?.range) return;

    const viewportRow = hoveredLink.range.start.y - buffer.viewportY;
    if (!Number.isFinite(viewportRow) || viewportRow < 0 || viewportRow >= terminal.rows) {
        clearHoverOverlay(terminal);
        return;
    }

    overlay.innerHTML = '';
    const underline = document.createElement('div');
    underline.style.cssText = `
        position: absolute;
        left: ${(hoveredLink.range.start.x - 1) * dims.width}px;
        top: ${((viewportRow + 1) * dims.height) - 2}px;
        width: ${Math.max((hoveredLink.range.end.x - hoveredLink.range.start.x + 1) * dims.width, 1)}px;
        height: 2px;
        background: rgba(96, 165, 250, 0.95);
        border-radius: 999px;
        box-shadow: 0 0 0 1px rgba(30, 41, 59, 0.15);
    `;
    overlay.appendChild(underline);
}

function installManualXtermFileLinkHandlers(terminal) {
    const terminalElement = terminal?.element;
    if (!terminalElement || terminal.__bbManualFileLinkHandlersInstalled) return;

    const activateHoveredLink = (event) => {
        if (event.button !== 0) return;
        const now = Date.now();
        if (terminal.__bbLastFileLinkActivationAt && (now - terminal.__bbLastFileLinkActivationAt) < 250) {
            console.log('[XtermFileLink] activation deduped', { type: event.type });
            return;
        }
        const directHoveredLink = terminal.__bbHoveredFileLink || resolveHoveredFileLink(terminal, event);
        const recentHoveredLink = directHoveredLink ? null : getRecentHoveredLink(terminal);
        const hoveredLink = directHoveredLink || recentHoveredLink;
        console.log('[XtermFileLink] activation event', {
            type: event.type,
            hasHoveredLink: Boolean(hoveredLink),
            hoveredText: hoveredLink?.text || null,
            usedRecentHover: Boolean(recentHoveredLink),
            sessionId: appStore.getState().currentSessionId || null
        });
        if (!hoveredLink) return;
        terminal.__bbLastFileLinkActivationAt = now;
        event.preventDefault();
        event.stopPropagation();
        postOpenFile(hoveredLink);
    };

    const resetHoverState = () => {
        terminal.__bbHoveredFileLink = null;
        terminalElement.classList.remove('xterm-cursor-pointer');
        terminalElement.style.cursor = '';
        clearHoverOverlay(terminal);
    };

    terminalElement.addEventListener('mousemove', (event) => {
        const hoveredLink = resolveHoveredFileLink(terminal, event);
        rememberHoveredLink(terminal, hoveredLink);
        if (hoveredLink) {
            console.log('[XtermFileLink] hover', {
                text: hoveredLink.text,
                sessionId: appStore.getState().currentSessionId || null
            });
            terminalElement.classList.add('xterm-cursor-pointer');
            terminalElement.style.cursor = 'pointer';
            renderHoverOverlay(terminal, hoveredLink);
            return;
        }
        resetHoverState();
    });

    terminalElement.addEventListener('mouseleave', () => {
        resetHoverState();
    });

    terminalElement.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        const hoveredLink = terminal.__bbHoveredFileLink || resolveHoveredFileLink(terminal, event) || getRecentHoveredLink(terminal);
        if (!hoveredLink) return;
        rememberHoveredLink(terminal, hoveredLink);
        event.preventDefault();
        event.stopPropagation();
    }, true);

    terminalElement.addEventListener('mouseup', activateHoveredLink, true);
    terminalElement.addEventListener('click', activateHoveredLink, true);

    terminal.__bbManualFileLinkHandlersInstalled = true;
}

function installXtermFileLinks(terminal) {
    if (!terminal || typeof terminal.registerLinkProvider !== 'function') {
        console.warn('[XtermLinkProvider] registerLinkProvider unavailable');
        return false;
    }
    if (terminal.__bbFileLinkProviderInstalled) {
        installManualXtermFileLinkHandlers(terminal);
        return true;
    }

    terminal.registerLinkProvider({
        provideLinks(bufferLineNumber, callback) {
            const links = buildLinksForProvider(terminal, bufferLineNumber)
                .filter(link => link.range?.start?.y === bufferLineNumber)
                .map(link => ({
                    range: link.range,
                    text: link.text,
                    activate: () => postOpenFile(link),
                    hover: () => {
                        rememberHoveredLink(terminal, link);
                        terminal.element?.classList?.add('xterm-cursor-pointer');
                        if (terminal.element?.style) {
                            terminal.element.style.cursor = 'pointer';
                        }
                        renderHoverOverlay(terminal, link);
                    },
                    leave: () => {
                        if (terminal.__bbHoveredFileLink === link) {
                            terminal.__bbHoveredFileLink = null;
                        }
                        terminal.element?.classList?.remove('xterm-cursor-pointer');
                        if (terminal.element?.style) {
                            terminal.element.style.cursor = '';
                        }
                        clearHoverOverlay(terminal);
                    },
                    decorations: {
                        underline: true,
                        pointerCursor: true
                    }
                }));
            callback(links);
        }
    });

    terminal.__bbFileLinkProviderInstalled = true;
    installManualXtermFileLinkHandlers(terminal);
    console.log('[XtermLinkProvider] Registered file link provider');
    return true;
}

export function setupXtermContextMenu(terminal) {
    if (!terminal?.element) {
        console.warn('[XtermContextMenu] Terminal element not available');
        return;
    }

    if (!terminal.__bbContextMenuInstalled) {
        terminal.element.addEventListener('contextmenu', (e) => {
            const selectedText = terminal.getSelection();
            if (!shouldShowContextMenu(selectedText)) return;
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e.clientX, e.clientY, selectedText);
        });
        terminal.__bbContextMenuInstalled = true;
        console.log('[XtermContextMenu] Attached contextmenu listener to xterm element');
    }

    installXtermFileLinks(terminal);
}

export function handleTerminalContextMenu(event) {
    if (!event.data || event.data.type !== 'terminal-contextmenu') {
        return;
    }

    const { selectedText, x, y } = event.data;

    if (!shouldShowContextMenu(selectedText)) {
        return;
    }

    const iframe = document.querySelector('iframe[src*="console"]');
    if (!iframe) {
        return;
    }

    const iframeRect = iframe.getBoundingClientRect();
    const scrollOffset = {
        x: window.scrollX || 0,
        y: window.scrollY || 0
    };

    const parentCoords = convertIframeToParentCoordinates({ x, y }, iframeRect, scrollOffset);
    showContextMenu(parentCoords.x, parentCoords.y, selectedText);
}

export function setupTerminalContextMenuListener() {
    window.addEventListener('message', handleTerminalContextMenu);

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('terminal-context-menu');
        if (menu && menu.style.display === 'block' && !menu.contains(e.target)) {
            hideContextMenu();
        }
    }, true);

    document.addEventListener('contextmenu', () => {
        const menu = document.getElementById('terminal-context-menu');
        if (menu && menu.style.display === 'block') {
            hideContextMenu();
        }
    }, true);

    document.addEventListener('scroll', hideContextMenu, true);
}
