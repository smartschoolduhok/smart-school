import React from 'react';
import { injectPrintStyles } from './printStyles';

export interface PrintLayoutProps {
  children: React.ReactNode;
  size?: 'A4' | 'A5';
  className?: string;
  onPrint?: () => void;
  backButton?: React.ReactNode;
}

const PrintLayout: React.FC<PrintLayoutProps> = ({
  children,
  size = 'A4',
  className = '',
  onPrint,
  backButton,
}) => {
  React.useEffect(() => {
    injectPrintStyles();
    return () => {
      // Keep styles for print dialog; they are harmless on screen
    };
  }, []);

  const sizeClass = size === 'A5' ? 'print-a5' : 'print-a4';

  return (
    <div className="print-preview-bg">
      <div className="print-controls flex items-center justify-between max-w-4xl mx-auto mb-4">
        <div className="flex items-center gap-2">
          {backButton}
          <button
            onClick={onPrint}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium transition-colors"
            type="button"
          >
            <span>🖨️</span>
            <span>طباعة / حفظ PDF</span>
          </button>
        </div>
        <div className="text-xs text-gray-500">
          استخدم Ctrl+P (أو Cmd+P) للطباعة
        </div>
      </div>
      <div className={`${sizeClass} ${className}`} dir="rtl" lang="ar">
        {children}
      </div>
    </div>
  );
};

export default PrintLayout;
