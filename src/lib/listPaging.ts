// Opt-in server-side paging for list endpoints that grow without bound
// (payments, receipts, print history). Without `page` the endpoint keeps its
// previous unpaged response, so existing callers are unchanged.

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const PAGING_ERROR = 'حدود الصفحات غير صالحة';

export interface Paging { page: number; pageSize: number; offset: number; }
export interface PageMeta { total: number; page: number; page_size: number; }

const positiveInt = (value: string | undefined) => (value != null && /^[1-9]\d{0,6}$/.test(value) ? Number(value) : null);

/** null = no paging requested; 'invalid' = malformed paging parameters. */
export function parsePaging(query: Record<string, string | undefined>): Paging | null | 'invalid' {
  if (query.page === undefined && query.page_size === undefined) return null;
  const page = query.page === undefined ? 1 : positiveInt(query.page);
  const pageSize = query.page_size === undefined ? DEFAULT_PAGE_SIZE : positiveInt(query.page_size);
  if (page == null || pageSize == null || pageSize > MAX_PAGE_SIZE) return 'invalid';
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pageMeta(paging: Paging, total: number): PageMeta {
  return { total, page: paging.page, page_size: paging.pageSize };
}

/** Client-side slice for bounded lists (students, staff) that are filtered in the browser. */
export function pageSlice<T>(rows: T[], page: number, pageSize: number): { rows: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  return { rows: rows.slice((current - 1) * pageSize, current * pageSize), page: current, pageCount };
}
