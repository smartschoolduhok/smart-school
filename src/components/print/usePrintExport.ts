import { useCallback, useState } from 'react';

export interface PrintExportOptions {
  onBeforePrint?: () => Promise<void> | void;
  onAfterPrint?: () => void;
  documentTitle?: string;
}

export function usePrintExport(options?: PrintExportOptions) {
  const [isPrinting, setIsPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePrint = useCallback(async () => {
    setError(null);
    setIsPrinting(true);
    try {
      if (options?.onBeforePrint) {
        await options.onBeforePrint();
      }

      const originalTitle = document.title;
      if (options?.documentTitle) {
        document.title = options.documentTitle;
      }

      window.print();

      if (options?.documentTitle) {
        document.title = originalTitle;
      }

      if (options?.onAfterPrint) {
        // Small delay to let the print dialog close
        setTimeout(() => options.onAfterPrint?.(), 300);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل في الطباعة';
      setError(msg);
      console.error('Print error:', err);
    } finally {
      setIsPrinting(false);
    }
  }, [options]);

  return { handlePrint, isPrinting, error };
}

export default usePrintExport;
