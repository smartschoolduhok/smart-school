import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import { calculateSinglePagePrintScale } from '../../lib/printFit';

export interface ResultCardPrintFitHandle {
  fit: () => number;
}

interface ResultCardPrintFitProps {
  children: React.ReactNode;
}

export const ResultCardPrintFit = forwardRef<
  ResultCardPrintFitHandle,
  ResultCardPrintFitProps
>(function ResultCardPrintFit({ children }, ref) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return 1;

    const scale = calculateSinglePagePrintScale({
      availableWidth: viewport.clientWidth,
      availableHeight: viewport.clientHeight,
      contentWidth: Math.max(content.scrollWidth, content.offsetWidth),
      contentHeight: Math.max(content.scrollHeight, content.offsetHeight),
    });
    viewport.style.setProperty('--result-card-print-scale', String(scale));
    viewport.dataset.printFitScale = String(scale);
    return scale;
  }, []);

  useImperativeHandle(ref, () => ({ fit }), [fit]);

  useLayoutEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(fit);
    const handleBeforePrint = () => fit();
    window.addEventListener('beforeprint', handleBeforePrint);

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => fit());
    if (viewportRef.current) resizeObserver?.observe(viewportRef.current);
    if (contentRef.current) resizeObserver?.observe(contentRef.current);

    const images = contentRef.current
      ? Array.from(contentRef.current.querySelectorAll('img'))
      : [];
    for (const image of images) {
      if (!image.complete) {
        image.addEventListener('load', fit);
        image.addEventListener('error', fit);
      }
    }

    void document.fonts?.ready.then(() => {
      if (active) fit();
    });

    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      window.removeEventListener('beforeprint', handleBeforePrint);
      resizeObserver?.disconnect();
      for (const image of images) {
        image.removeEventListener('load', fit);
        image.removeEventListener('error', fit);
      }
    };
  }, [fit]);

  return (
    <div ref={viewportRef} className="result-card-print-viewport">
      <div ref={contentRef} className="result-card-print-fit">
        {children}
      </div>
    </div>
  );
});

export default ResultCardPrintFit;
