/**
 * Reusable print styles for browser-based PDF export.
 * Arabic RTL, offline-safe font stack, no external dependencies.
 */

export const ARABIC_FONT_STACK =
  '"Cairo", "Tajawal", "Arial", "Tahoma", sans-serif';

export const PRINT_CSS = `
.result-card-print-sheet .result-card-print-viewport {
  --result-card-print-scale: 1;
  position: relative;
  width: 100%;
  height: 267mm;
  overflow: hidden;
}

.result-card-print-sheet .result-card-print-fit {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  width: 100%;
  transform: scale(var(--result-card-print-scale));
  transform-origin: top right;
}

.result-card-print-sheet .result-card-document {
  width: 100% !important;
  max-width: none !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  gap: 2.5mm !important;
  box-shadow: none !important;
}

@media print {
  @page { size: A4; margin: 1.5cm; }

  html, body {
    margin: 0 !important;
    padding: 0 !important;
    direction: rtl !important;
    font-family: ${ARABIC_FONT_STACK} !important;
    background: white !important;
    color: #000 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .print-only { display: block !important; }
  .no-print { display: none !important; }
  .print-controls { display: none !important; }

  .print-layout {
    width: 100% !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
    border: none !important;
  }

  .print-a4 {
    width: 210mm;
    min-height: 297mm;
    padding: 1.5cm;
    margin: 0 auto;
    background: white;
    box-sizing: border-box;
  }

  .print-a5 {
    width: 148mm;
    min-height: 210mm;
    padding: 1cm;
    margin: 0 auto;
    background: white;
    box-sizing: border-box;
  }

  table.print-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  table.print-table th,
  table.print-table td {
    border: 1px solid #333;
    padding: 6px 8px;
    text-align: center;
  }

  table.print-table th {
    background: #f5f5f5 !important;
    font-weight: 700;
  }

  .print-header {
    text-align: center;
    margin-bottom: 1rem;
    border-bottom: 2px solid #000;
    padding-bottom: 0.5rem;
  }

  .print-logo {
    max-height: 60px;
    margin-bottom: 0.25rem;
  }

  .print-stamp {
    max-height: 50px;
    opacity: 0.9;
  }

  .print-footer {
    margin-top: 1.5rem;
    border-top: 1px solid #ccc;
    padding-top: 0.5rem;
    font-size: 12px;
    text-align: center;
    color: #555;
  }

  .print-qr {
    display: block;
    margin: 0.5rem auto;
    text-align: center;
  }

  .print-qr svg, .print-qr canvas, .print-qr img {
    max-width: 100px;
    max-height: 100px;
  }

  .print-body {
    font-size: 14px;
    line-height: 1.8;
    text-align: justify;
    white-space: pre-wrap;
  }

  .print-a4.result-card-print-sheet {
    width: 180mm !important;
    height: 267mm !important;
    min-height: 267mm !important;
    max-height: 267mm !important;
    padding: 0 !important;
    margin: 0 auto !important;
    overflow: hidden !important;
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  .result-card-print-sheet .result-card-document {
    font-size: 10px !important;
  }

  .result-card-print-sheet .result-card-header {
    padding: 2mm 3mm !important;
  }

  .result-card-print-sheet .result-card-student-info {
    padding: 1.5mm 2.5mm !important;
  }

  .result-card-print-sheet .result-card-header,
  .result-card-print-sheet .result-card-student-info,
  .result-card-print-sheet .result-card-notice,
  .result-card-print-sheet .result-card-summary,
  .result-card-print-sheet .result-card-footer {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .result-card-print-sheet .result-card-table-wrap {
    overflow: visible !important;
  }

  .result-card-print-sheet .result-card-table {
    width: 100% !important;
    table-layout: fixed;
    font-size: 10.5px !important;
    line-height: 1.25;
  }

  .result-card-print-sheet .result-card-table th {
    padding: 1.5mm 0.8mm !important;
  }

  .result-card-print-sheet .result-card-table td {
    padding: 1mm 0.8mm !important;
  }

  .result-card-print-sheet .result-card-table thead {
    display: table-header-group;
  }

  .result-card-print-sheet .result-card-table tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .result-card-print-sheet .result-card-last-subject-row {
    break-after: avoid-page;
    page-break-after: avoid;
  }

  .result-card-print-sheet .result-card-average-row {
    break-before: avoid-page;
    page-break-before: avoid;
  }

  .result-card-print-sheet .result-card-summary {
    gap: 2mm !important;
  }

  .result-card-print-sheet .result-card-summary > div {
    padding: 2mm !important;
  }

  .result-card-print-sheet .result-card-footer {
    margin-top: 0 !important;
    padding-top: 2mm !important;
  }

  .result-card-print-sheet .result-card-footer .min-h-24 {
    min-height: 20mm !important;
  }

  .result-card-print-sheet .result-card-footer .mt-12 {
    margin-top: 8mm !important;
  }

  .result-card-print-sheet .result-card-footer-meta {
    margin-top: 2mm !important;
    padding-top: 1.5mm !important;
  }
}

@media screen {
  .print-only { display: none; }
  .no-print { display: block; }

  .print-preview-bg {
    background: #e5e7eb;
    min-height: 100vh;
    padding: 1rem;
  }

  .print-a4 {
    width: 210mm;
    min-height: 297mm;
    padding: 1.5cm;
    margin: 0 auto;
    background: white;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    box-sizing: border-box;
    font-family: ${ARABIC_FONT_STACK};
    direction: rtl;
    color: #000;
  }

  .print-a5 {
    width: 148mm;
    min-height: 210mm;
    padding: 1cm;
    margin: 0 auto;
    background: white;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    box-sizing: border-box;
    font-family: ${ARABIC_FONT_STACK};
    direction: rtl;
    color: #000;
  }

  table.print-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  table.print-table th,
  table.print-table td {
    border: 1px solid #333;
    padding: 6px 8px;
    text-align: center;
  }

  table.print-table th {
    background: #f5f5f5;
    font-weight: 700;
  }

  .print-header {
    text-align: center;
    margin-bottom: 1rem;
    border-bottom: 2px solid #000;
    padding-bottom: 0.5rem;
  }

  .print-logo {
    max-height: 60px;
    margin-bottom: 0.25rem;
  }

  .print-stamp {
    max-height: 50px;
    opacity: 0.9;
  }

  .print-footer {
    margin-top: 1.5rem;
    border-top: 1px solid #ccc;
    padding-top: 0.5rem;
    font-size: 12px;
    text-align: center;
    color: #555;
  }

  .print-qr {
    display: block;
    margin: 0.5rem auto;
    text-align: center;
  }

  .print-qr svg, .print-qr canvas, .print-qr img {
    max-width: 100px;
    max-height: 100px;
  }

  .print-body {
    font-size: 14px;
    line-height: 1.8;
    text-align: justify;
    white-space: pre-wrap;
  }

  .print-a4.result-card-print-sheet .result-card-document {
    min-height: 0 !important;
  }
}
`;

export function injectPrintStyles(id = 'print-styles'): void {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = PRINT_CSS;
  document.head.appendChild(style);
}

export function removePrintStyles(id = 'print-styles'): void {
  const el = document.getElementById(id);
  if (el) el.remove();
}
