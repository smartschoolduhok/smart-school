import React from 'react';

export interface DocumentHeaderProps {
  schoolName?: string;
  principalName?: string;
  logoUrl?: string | null;
  headerText?: string | null;
  title?: string;
  subtitle?: string;
}

const DocumentHeader: React.FC<DocumentHeaderProps> = ({
  schoolName,
  principalName,
  logoUrl,
  headerText,
  title,
  subtitle,
}) => {
  return (
    <div className="print-header">
      {logoUrl && (
        <div>
          <img src={logoUrl} alt="شعار المدرسة" className="print-logo" />
        </div>
      )}
      <div className="font-bold text-lg" style={{ fontWeight: 700 }}>
        {schoolName || 'المدرسة'}
      </div>
      {headerText && (
        <div className="text-sm text-gray-700 mt-1">{headerText}</div>
      )}
      {principalName && (
        <div className="text-sm mt-1">
          <span className="font-semibold">المدير:</span>{' '}
          {principalName}
        </div>
      )}
      {title && (
        <div className="font-bold text-base mt-2" style={{ fontWeight: 700 }}>
          {title}
        </div>
      )}
      {subtitle && (
        <div className="text-sm text-gray-600 mt-1">{subtitle}</div>
      )}
    </div>
  );
};

export default DocumentHeader;
