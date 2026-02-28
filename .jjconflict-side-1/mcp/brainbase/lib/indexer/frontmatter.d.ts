/**
 * YAML Frontmatter Parser
 * Parses markdown files with YAML frontmatter (---...---)
 */
import type { ParsedFile } from './types.js';
/**
 * Parse a markdown file with YAML frontmatter
 */
export declare function parseMarkdownFile<T>(filePath: string): Promise<ParsedFile<T>>;
/**
 * Parse markdown string with YAML frontmatter
 */
export declare function parseMarkdownString<T>(content: string): ParsedFile<T>;
/**
 * Ensure a value is an array
 */
export declare function ensureArray(value: unknown): string[];
/**
 * Extract ID from file path
 * e.g., /path/to/sato_keigo.md -> sato_keigo
 */
export declare function extractIdFromPath(filePath: string): string;
