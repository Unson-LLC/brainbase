import { isBrowserPreviewablePath, resolvePreviewRelativePath } from './file-preview-config.js';

const XTERM_FILE_EXTS = 'markdown|mdx|tsx|jsx|json|yaml|yml|toml|html|css|txt|svg|xml|ini|cfg|env|sql|bash|md|mjs|cjs|js|ts|py|rb|go|rs|java|kt|swift|php|cpp|hpp|cc|sh|zsh|c|h|log';
const XTERM_FILE_TOKEN_REGEX = new RegExp(
    '((?:~\\/|\\.{1,2}\\/|\\/)?[a-zA-Z0-9_][a-zA-Z0-9_/.\\-]*\\.(?:' + XTERM_FILE_EXTS + '))(?::([0-9]+))?',
    'g'
);
const XTERM_WRAPPED_ABSOLUTE_FILE_TOKEN_REGEX = new RegExp(
    '((?:~\\/|\\.{1,2}\\/|\\/)[a-zA-Z0-9_][a-zA-Z0-9_/.\\-]*(?:\\s+[a-zA-Z0-9_/.\\-]+)+\\.(?:' + XTERM_FILE_EXTS + '))(?::([0-9]+))?',
    'g'
);
const XTERM_CONTINUATION_PREFIX_REGEX = /((?:~\/|\.{1,2}\/|\/)[a-zA-Z0-9_/.\\-]*)$/;
const XTERM_CONTINUATION_SUFFIX_REGEX = new RegExp(
    '^(\\s+)([a-zA-Z0-9_/.\\-]+\\.(?:' + XTERM_FILE_EXTS + '))(?::([0-9]+))?',
    ''
);

function isPathLikeChar(char) {
    return /[a-zA-Z0-9_/.~:-]/.test(char || '');
}

function isValidPathBoundary(char) {
    return !char || !isPathLikeChar(char);
}

function isValidPathTerminator(text, index) {
    const nextChar = text[index] || '';
    if (!nextChar) return true;
    if (nextChar === '-' && text[index + 1] === '>') return true;
    return !isPathLikeChar(nextChar);
}

function codePointWidth(codePoint) {
    if (codePoint === 0) return 0;
    if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
    if (
        codePoint >= 0x1100 && (
            codePoint <= 0x115f ||
            codePoint === 0x2329 ||
            codePoint === 0x232a ||
            (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
            (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
            (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
            (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
            (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
            (codePoint >= 0xff00 && codePoint <= 0xff60) ||
            (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
            (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
            (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
            (codePoint >= 0x20000 && codePoint <= 0x3fffd)
        )
    ) {
        return 2;
    }
    return 1;
}

export function getDisplayWidth(text) {
    let width = 0;
    for (const char of String(text || '')) {
        width += codePointWidth(char.codePointAt(0));
    }
    return width;
}

function getCellWidth(text, widthProvider = null) {
    if (typeof widthProvider === 'function') {
        try {
            return widthProvider(String(text || ''));
        } catch {
            return getDisplayWidth(text);
        }
    }
    return getDisplayWidth(text);
}

function sliceTextByDisplayColumns(text, startOffset, endOffsetExclusive, widthProvider = null) {
    let width = 0;
    let result = '';
    for (const char of String(text || '')) {
        const charWidth = getCellWidth(char, widthProvider);
        const charStart = width;
        const charEnd = width + charWidth;
        if (charEnd > startOffset && charStart < endOffsetExclusive) {
            result += char;
        }
        width = charEnd;
        if (width >= endOffsetExclusive) break;
    }
    return result;
}

export function extractFileMatches(lineText) {
    const matches = [];

    const pushMatch = (match, { normalizeWhitespace = false } = {}) => {
        const path = normalizeWhitespace ? match[1].replace(/\s+/g, '') : match[1];
        const line = match[2] || null;
        const start = match.index;
        const end = start + match[0].length;
        const previousChar = start > 0 ? lineText[start - 1] : '';
        if (!isValidPathBoundary(previousChar) || !isValidPathTerminator(lineText, end)) {
            return;
        }
        if (matches.some((existing) => !(end <= existing.start || start >= existing.end))) {
            return;
        }
        matches.push({ path, line, start, end });
    };

    XTERM_WRAPPED_ABSOLUTE_FILE_TOKEN_REGEX.lastIndex = 0;
    let match;
    while ((match = XTERM_WRAPPED_ABSOLUTE_FILE_TOKEN_REGEX.exec(lineText)) !== null) {
        pushMatch(match, { normalizeWhitespace: true });
    }

    XTERM_FILE_TOKEN_REGEX.lastIndex = 0;
    while ((match = XTERM_FILE_TOKEN_REGEX.exec(lineText)) !== null) {
        pushMatch(match);
    }

    return matches;
}

function toWrappedPoint(displayOffset, startBufferLineNumber, terminalCols) {
    if (!Number.isFinite(terminalCols) || terminalCols <= 0) {
        return { x: displayOffset + 1, y: startBufferLineNumber };
    }
    return {
        x: (displayOffset % terminalCols) + 1,
        y: startBufferLineNumber + Math.floor(displayOffset / terminalCols)
    };
}

export function buildFileLinkDefinition(match, bufferLineNumber, workspaceRoot = null, terminalCols = Number.POSITIVE_INFINITY, widthProvider = null) {
    const previewPath = resolvePreviewRelativePath(match.path, workspaceRoot);
    const previewTargetPath = previewPath || String(match.path || '').trim();
    const previewable = isBrowserPreviewablePath(previewTargetPath);
    const prefix = String(match.fullLineText || '').slice(0, match.start);
    const matchedText = String(match.fullLineText || '').slice(match.start, match.end);
    const startOffset = getCellWidth(prefix, widthProvider);
    const displayWidth = Math.max(getCellWidth(matchedText, widthProvider), 1);
    const start = toWrappedPoint(startOffset, bufferLineNumber, terminalCols);
    const end = toWrappedPoint(startOffset + displayWidth - 1, bufferLineNumber, terminalCols);
    return {
        rawPath: match.path,
        previewPath,
        previewTargetPath,
        previewable,
        line: match.line,
        _matchedText: matchedText,
        _startOffset: startOffset,
        _displayWidth: displayWidth,
        range: {
            start,
            end
        },
        text: match.line ? `${match.path}:${match.line}` : match.path
    };
}

export function buildFileLinksForBufferLine(lineText, bufferLineNumber, workspaceRoot = null) {
    return buildFileLinksForWrappedLine(lineText, bufferLineNumber, Number.POSITIVE_INFINITY, workspaceRoot);
}

export function buildFileLinksForWrappedLine(lineText, startBufferLineNumber, terminalCols, workspaceRoot = null, widthProvider = null) {
    return extractFileMatches(lineText).map((match) => buildFileLinkDefinition({
        ...match,
        fullLineText: lineText
    }, startBufferLineNumber, workspaceRoot, terminalCols, widthProvider));
}

export function expandWrappedLinkSegments(link, terminalCols, widthProvider = null) {
    if (!link?.range) return [];
    const { start, end } = link.range;
    if (start.y === end.y || !Number.isFinite(terminalCols) || terminalCols <= 0) {
        return [link];
    }

    const segments = [];
    for (let row = start.y; row <= end.y; row += 1) {
        const segmentStartX = row === start.y ? start.x : 1;
        const segmentEndX = row === end.y ? end.x : terminalCols;
        const segmentStartOffset = ((row - start.y) * terminalCols) + (segmentStartX - start.x);
        const segmentEndOffsetExclusive = segmentStartOffset + (segmentEndX - segmentStartX + 1);
        segments.push({
            ...link,
            text: sliceTextByDisplayColumns(link._matchedText || link.text, segmentStartOffset, segmentEndOffsetExclusive, widthProvider),
            range: {
                start: { x: segmentStartX, y: row },
                end: { x: segmentEndX, y: row }
            }
        });
    }
    return segments;
}

export function buildAdjacentContinuationSegments(
    previousLineText,
    currentLineText,
    previousLineNumber,
    workspaceRoot = null,
    widthProvider = null
) {
    if (typeof previousLineText !== 'string' || typeof currentLineText !== 'string') {
        return [];
    }

    const prefixMatch = XTERM_CONTINUATION_PREFIX_REGEX.exec(previousLineText);
    const suffixMatch = XTERM_CONTINUATION_SUFFIX_REGEX.exec(currentLineText);
    if (!prefixMatch || !suffixMatch) {
        return [];
    }

    const previousPathFragment = prefixMatch[1] || '';
    const currentIndent = suffixMatch[1] || '';
    const currentPathFragment = suffixMatch[2] || '';
    const line = suffixMatch[3] || null;
    if (!previousPathFragment || !currentPathFragment) {
        return [];
    }

    const prefixStart = prefixMatch.index;
    const previousChar = prefixStart > 0 ? previousLineText[prefixStart - 1] : '';
    const currentVisibleText = line ? `${currentPathFragment}:${line}` : currentPathFragment;
    const currentEndIndex = currentIndent.length + currentVisibleText.length;

    if (!isValidPathBoundary(previousChar) || !isValidPathTerminator(currentLineText, currentEndIndex)) {
        return [];
    }

    const rawPath = `${previousPathFragment}${currentPathFragment}`;
    const previewPath = resolvePreviewRelativePath(rawPath, workspaceRoot);
    const previewTargetPath = previewPath || rawPath;
    const previewable = isBrowserPreviewablePath(previewTargetPath);

    const previousPrefix = previousLineText.slice(0, prefixStart);
    const previousStartOffset = getCellWidth(previousPrefix, widthProvider);
    const previousWidth = getCellWidth(previousPathFragment, widthProvider);
    const currentIndentWidth = getCellWidth(currentIndent, widthProvider);
    const currentWidth = getCellWidth(currentVisibleText, widthProvider);
    const currentLineNumber = previousLineNumber + 1;

    return [
        {
            rawPath,
            previewPath,
            previewTargetPath,
            previewable,
            line,
            text: previousPathFragment,
            range: {
                start: { x: previousStartOffset + 1, y: previousLineNumber },
                end: { x: previousStartOffset + previousWidth, y: previousLineNumber }
            }
        },
        {
            rawPath,
            previewPath,
            previewTargetPath,
            previewable,
            line,
            text: currentVisibleText,
            range: {
                start: { x: currentIndentWidth + 1, y: currentLineNumber },
                end: { x: currentIndentWidth + currentWidth, y: currentLineNumber }
            }
        }
    ];
}

export function pickBestLinkAtPosition(links, bufferLineNumber, col) {
    if (!Array.isArray(links) || !Number.isFinite(bufferLineNumber) || !Number.isFinite(col)) {
        return null;
    }

    const matchingLinks = links.filter((link) => (
        link?.range?.start?.y === bufferLineNumber
        && col >= link.range.start.x
        && col <= link.range.end.x
    ));

    if (matchingLinks.length === 0) {
        return null;
    }

    matchingLinks.sort((a, b) => {
        const aPathLength = String(a?.rawPath || '').length;
        const bPathLength = String(b?.rawPath || '').length;
        if (aPathLength !== bPathLength) {
            return bPathLength - aPathLength;
        }

        const aWidth = (a?.range?.end?.x || 0) - (a?.range?.start?.x || 0);
        const bWidth = (b?.range?.end?.x || 0) - (b?.range?.start?.x || 0);
        if (aWidth !== bWidth) {
            return bWidth - aWidth;
        }

        return 0;
    });

    return matchingLinks[0];
}
