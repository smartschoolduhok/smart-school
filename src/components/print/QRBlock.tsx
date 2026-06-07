import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

export interface QRBlockProps {
  url: string;
  label?: string;
  size?: number;
}

const QRBlock: React.FC<QRBlockProps> = ({ url, label, size = 100 }) => {
  if (!url) return null;

  return (
    <div className="print-qr text-center">
      <QRCodeSVG value={url} size={size} level="M" />
      {label && (
        <div className="text-xs text-gray-600 mt-1">{label}</div>
      )}
      <div className="text-[10px] text-gray-400 mt-1 break-all max-w-[140px] mx-auto">
        {url}
      </div>
    </div>
  );
};

export default QRBlock;
