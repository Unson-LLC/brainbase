/**
 * Wiki search filter logic
 * Extracted for testability (STR-001)
 */

export interface WikiPage {
  path: string;
  title: string;
  project_id: string | null;
}

/**
 * Filter wiki pages by query keyword and optional project_id.
 */
export function filterWikiPages(
  pages: WikiPage[],
  query: string,
  projectId?: string,
): WikiPage[] {
  const q = query.toLowerCase();
  return pages.filter((p) => {
    const matchesQuery =
      p.path.toLowerCase().includes(q) ||
      p.title.toLowerCase().includes(q);
    if (!matchesQuery) return false;
    if (projectId !== undefined) {
      return p.project_id === projectId;
    }
    return true;
  });
}
