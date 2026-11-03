/** Rows per page on the long lists. Keeps a page small enough to load quickly and hydrate cleanly (UAT-F14). */
export const PAGE_SIZE = 50;

export type Paging = { page: number; pages: number; size: number; offset: number; total: number; first: number; last: number };

/** Which rows to show for a `?page=` value. Anything invalid or past the end lands on a real page. */
export function paging(requested: string | undefined, total: number, size: number = PAGE_SIZE): Paging {
  const pages = Math.max(1, Math.ceil(total / size));
  const asked = /^\d+$/.test(requested ?? "") ? Number(requested) : 1;
  const page = Math.min(Math.max(1, asked), pages);
  const offset = (page - 1) * size;
  return { page, pages, size, offset, total, first: total ? offset + 1 : 0, last: Math.min(offset + size, total) };
}

/** The rows on this page, for lists a screen has to load whole anyway (for its totals, or a rule applied in code). */
export function pageOf<T>(rows: T[], at: Paging): T[] {
  return rows.slice(at.offset, at.offset + at.size);
}
