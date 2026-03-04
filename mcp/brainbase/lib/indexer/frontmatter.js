/**
 * YAML Frontmatter Parser
 * Parses markdown files with YAML frontmatter (---...---)
 */
import matter from 'gray-matter';
import { readFile } from 'fs/promises';
/**
 * Parse a markdown file with YAML frontmatter
 */
export async function parseMarkdownFile(filePath) {
    const fileContent = await readFile(filePath, 'utf-8');
    return parseMarkdownString(fileContent);
}
/**
 * Parse markdown string with YAML frontmatter
 */
export function parseMarkdownString(content) {
    const { data, content: body } = matter(content);
    return {
        data: data,
        content: body.trim(),
    };
}
/**
 * Ensure a value is an array
 */
export function ensureArray(value) {
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
export function extractIdFromPath(filePath) {
    const fileName = filePath.split('/').pop() || '';
    return fileName.replace(/\.md$/, '');
}
