/**
 * YAML Frontmatter Parser
 * Parses markdown files with YAML frontmatter (---...---)
 */

import matter from 'gray-matter';
import { readFile } from 'fs/promises';
import type { ParsedFile } from './types.js';

/**
 * Parse a markdown file with YAML frontmatter
 */
export async function parseMarkdownFile<T>(filePath: string): Promise<ParsedFile<T>> {
  const fileContent = await readFile(filePath, 'utf-8');
  return parseMarkdownString<T>(fileContent);
}

/**
 * Parse markdown string with YAML frontmatter
 */
export function parseMarkdownString<T>(content: string): ParsedFile<T> {
  const { data, content: body } = matter(content);
  return {
    data: data as Partial<T>,
    content: body.trim(),
  };
}

/**
 * Ensure a value is an array
 */
export function ensureArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(v => String(v));
  }
  if (typeof value === 'string' && value.trim()) {
    return [value];
  }
  return [];
}

/**
 * Extract ID from file path
 * e.g., /path/to/sato_keigo.md -> sato_keigo
 */
export function extractIdFromPath(filePath: string): string {
  const fileName = filePath.split('/').pop() || '';
  return fileName.replace(/\.md$/, '');
}
