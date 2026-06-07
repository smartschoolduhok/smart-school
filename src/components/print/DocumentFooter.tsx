import React from 'react';
import { toArabicDigits } from '../../lib/arabicDigits';

export interface DocumentFooterProps {
  footerText?: string | null;
  stampUrl?: string | null;
  printedAt?: string;
  printedBy?: string;
  verificationNote?: string;
}

const DocumentFooter: React.FC<DocumentFooterProps> = ({
  footerText,
  stampUrl,
  printedAt,
  printedBy,
  verificationNote,
}) => {
  const today = new Date().toLocaleDateString('ar-SA');

  return (
    <div className="print-footer">
      {stampUrl && (
        <div>
          <img src={stampUrl} alt="الختم" className="print-stamp" />
        </div>
      )}
      {footerText && (
        <div className="mb-1">{footerText}</div>
      )}
      {verificationNote && (
        <div className="text-xs text-gray-500 mb-1">{verificationNote}</div>
      )}
      <div className="flex justify-between items-center text-xs text-gray-500 mt-2">
        <div>
          {printedAt && (
            <span>تاريخ الطباعة: {toArabicDigits(printedAt)}</span>
          )}
          {!printedAt && (
            <span>تاريخ الطباعة: {toArabicDigits(today)}</span>
          )}
        </div>
        {printedBy && (
          <div>طبع بواسطة: {printedBy}</div>
        )}
      </div>
    </div>
  );
};

export default DocumentFooter;
