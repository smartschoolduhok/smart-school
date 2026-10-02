import { useEffect, useRef } from 'react';
import { usePrintExport } from '../print';

export function useStaffPrint<T>(snapshot: T | null, selector: string, title: string) {
  const printable = useRef(snapshot); printable.current = snapshot;
  useEffect(() => () => { printable.current = null; }, []);
  return usePrintExport({documentTitle: title, onBeforePrint: async () => {
    const captured = snapshot;
    if (!captured || printable.current !== captured) throw new Error('أكمل تحميل المعاينة الحالية قبل الطباعة.');
    if (document.fonts) await document.fonts.ready;
    await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>(`${selector} img`)).map(async image => {
      if (image.decode) await image.decode().catch(() => undefined);
      else if (!image.complete) await new Promise<void>(resolve => {
        image.addEventListener('load', () => resolve(), {once: true});
        image.addEventListener('error', () => resolve(), {once: true});
      });
    }));
    // Let measured pagination commit after fonts/images finish before opening the dialog.
    await new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
    if (printable.current !== captured) throw new Error('تغيرت المدرسة أو بيانات الكشف أثناء تجهيز الطباعة؛ راجع المعاينة الحالية.');
    const pageLimit = selector.includes('salary') ? 180 : 267;
    if (Array.from(document.querySelectorAll<HTMLElement>(`${selector} .staff-document-page`)).some(page => page.getBoundingClientRect().height > pageLimit * 96 / 25.4 + 1)) {
      throw new Error('بعض بيانات السجل أطول من الصفحة. راجع المعاينة قبل الطباعة.');
    }
  }});
}
