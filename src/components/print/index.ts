export { default as PrintLayout } from './PrintLayout';
export type { PrintLayoutProps } from './PrintLayout';

export { default as DocumentHeader } from './DocumentHeader';
export type { DocumentHeaderProps } from './DocumentHeader';

export { default as DocumentFooter } from './DocumentFooter';
export type { DocumentFooterProps } from './DocumentFooter';

export { default as QRBlock } from './QRBlock';
export type { QRBlockProps } from './QRBlock';

export { default as PrintableTable } from './PrintableTable';
export type { PrintableTableColumn, PrintableTableProps } from './PrintableTable';

export { default as PrintButton } from './PrintButton';
export type { PrintButtonProps } from './PrintButton';

export { usePrintExport, default as usePrintExportDefault } from './usePrintExport';
export type { PrintExportOptions } from './usePrintExport';
export { ResultCardPrintFit } from './ResultCardPrintFit';
export type { ResultCardPrintFitHandle } from './ResultCardPrintFit';

export { ARABIC_FONT_STACK, PRINT_CSS, injectPrintStyles, removePrintStyles } from './printStyles';
