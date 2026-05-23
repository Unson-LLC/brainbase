// @ts-check

/**
 * Shared terminal theme used by xterm.js and snapshot ANSI rendering.
 * Keep the 16 ANSI colors explicit so tmux snapshot HTML uses the same palette
 * as the interactive terminal instead of maintaining a separate color table.
 */
export const DEFAULT_TERMINAL_THEME = {
    background: '#000000',
    foreground: '#e2e8f0',
    cursor: '#f8fafc',
    selectionBackground: 'rgba(59, 130, 246, 0.35)',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#e5e5e5'
};

export const TERMINAL_ANSI_THEME_KEYS = [
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
    'white',
    'brightBlack',
    'brightRed',
    'brightGreen',
    'brightYellow',
    'brightBlue',
    'brightMagenta',
    'brightCyan',
    'brightWhite'
];

/**
 * @param {Partial<typeof DEFAULT_TERMINAL_THEME>} [theme]
 * @returns {string[]}
 */
export function buildTerminalAnsiPalette(theme = DEFAULT_TERMINAL_THEME) {
    return TERMINAL_ANSI_THEME_KEYS.map((key) => (
        typeof theme?.[key] === 'string' && theme[key]
            ? theme[key]
            : DEFAULT_TERMINAL_THEME[key]
    ));
}
