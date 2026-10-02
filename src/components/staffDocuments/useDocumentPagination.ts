import { useLayoutEffect, useRef, useState } from 'react';
import { documentPages } from './documentHelpers';

const MILLIMETRE = 96 / 25.4;
/** Paginate using the actual Arabic text after fonts settle; screen and print widths are equal. */
export function useDocumentPagination<T extends {id: number}>(rows: T[], maxRows: number, pageMm: number, rowSelector: string, extraMm: number) {
  const container = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{rows: T[]; pages: T[][]} | null>(null);
  useLayoutEffect(() => {
    let active = true;
    const measure = () => {
      const element = container.current;
      if (!active || !element) return;
      const header = element.querySelector('.staff-document-header')?.getBoundingClientRect().height || 0;
      if (!header) return; // SSR and DOM-only tests use deterministic default pagination.
      const footer = element.querySelector('.staff-document-footer')?.getBoundingClientRect().height || 0;
      const tableHeader = element.querySelector('thead')?.getBoundingClientRect().height || 0;
      const available = pageMm * MILLIMETRE - header - footer - tableHeader - extraMm * MILLIMETRE;
      const heights = new Map(Array.from(element.querySelectorAll<HTMLElement>(rowSelector)).map(row => [Number(row.dataset.recordId), row.getBoundingClientRect().height]));
      const pages: T[][] = []; let page: T[] = [], used = 0;
      for (const row of rows) {
        const height = (heights.get(row.id) || 0) + (rowSelector.includes('staff-register-card') ? 5 * MILLIMETRE : 0);
        if (page.length && (page.length >= maxRows || used + height > available)) { pages.push(page); page = []; used = 0; }
        page.push(row); used += height;
      }
      if (page.length || !pages.length) pages.push(page);
      setMeasured(previous => previous?.rows === rows && JSON.stringify(previous.pages.map(group => group.map(row => row.id))) === JSON.stringify(pages.map(group => group.map(row => row.id))) ? previous : {rows, pages});
    };
    measure();
    void document.fonts?.ready.then(measure);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (container.current) observer?.observe(container.current);
    return () => { active = false; observer?.disconnect(); };
  }, [rows, maxRows, pageMm, rowSelector, extraMm]);
  return {container, pages: measured?.rows === rows ? measured.pages : documentPages(rows, maxRows)};
}
