import React from 'react';
import { Printer } from 'lucide-react';

export interface PrintButtonProps {
  onPrint: () => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

const PrintButton: React.FC<PrintButtonProps> = ({
  onPrint,
  disabled,
  label = 'طباعة / حفظ PDF',
  className = '',
}) => {
  return (
    <button
      onClick={onPrint}
      disabled={disabled}
      type="button"
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors
        ${disabled
          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
          : 'bg-indigo-600 hover:bg-indigo-700 text-white'
        }
        ${className}`}
    >
      <Printer className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
};

export default PrintButton;
