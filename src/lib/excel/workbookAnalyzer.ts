import {
  columnKey,
  confidenceLevel,
  extractClassValue,
  extractSectionValue,
  isExcelErrorValue,
  normalizeHeader,
} from './normalizers.ts';
import {
  classifyFromAnalysis,
  gradeHeaderSignal,
  inferStudentFields,
  profileColumns,
  studentHeaderSignal,
} from './semanticInference.ts';
import { inferGradeFields, inferSubjectFromWorkbookContext, isGradeHeader } from './gradeSemantics.ts';
import type {
  AnalyzeWorksheetOptions,
  DataRegion,
  ExcelCell,
  HeaderDetection,
  MetadataCandidate,
  SheetRecord,
  WorksheetAnalysis,
  WorksheetCategory,
  WorksheetRows,
} from './types.ts';

function nonEmptyColumns(row: ExcelCell[]): number[] {
  const columns: number[] = [];
  row.forEach((cell, columnIndex) => {
    if (normalizeHeader(cell)) columns.push(columnIndex);
  });
  return columns;
}

function isSummaryRow(row: ExcelCell[]): boolean {
  const text = row.map(normalizeHeader).filter(Boolean).join(' ');
  return /(?:المجموع|المعدل|النتيجه|الناجح|الراسب|summary|total|average|result)/u.test(text);
}

function scoreHeaderRow(row: ExcelCell[]): number {
  const values = row.map(normalizeHeader).filter(Boolean);
  if (!values.length) return -1;
  let score = Math.min(values.length, 8) * 0.22;
  let recognized = 0;
  for (const value of values) {
    const studentScore = studentHeaderSignal(value);
    if (studentScore > 0) {
      score += studentScore;
      recognized += 1;
    }
    if (gradeHeaderSignal(value) || isGradeHeader(value)) {
      score += 2.5;
      recognized += 1;
    }
  }
  if (recognized >= 2) score += 2;
  if (values.length === 1) score -= 1.2;
  return score;
}

export function extractHeaders(row: ExcelCell[]): string[] {
  const counts = new Map<string, number>();
  return row.map(cell => {
    const header = String(cell ?? '').trim();
    if (!header || isExcelErrorValue(cell)) return '';
    const count = (counts.get(header) || 0) + 1;
    counts.set(header, count);
    return count === 1 ? header : `${header} (${count})`;
  });
}

function consecutiveBlankRows(rows: WorksheetRows, startRow: number, endRow: number): number {
  let count = 0;
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
    if (nonEmptyColumns(rows[rowIndex] || []).length) break;
    count += 1;
  }
  return count;
}

function dominantColumns(rows: WorksheetRows, rowIndexes: number[]): Set<number> {
  const frequencies = new Map<number, number>();
  for (const rowIndex of rowIndexes) {
    for (const columnIndex of nonEmptyColumns(rows[rowIndex] || [])) {
      frequencies.set(columnIndex, (frequencies.get(columnIndex) || 0) + 1);
    }
  }
  const minimumFrequency = Math.max(1, Math.ceil(rowIndexes.length * 0.5));
  return new Set([...frequencies.entries()]
    .filter(([, frequency]) => frequency >= minimumFrequency)
    .map(([columnIndex]) => columnIndex));
}

function rowMatchesDominantStructure(row: ExcelCell[], expectedColumns: Set<number>): boolean {
  const columns = nonEmptyColumns(row);
  if (!columns.length || !expectedColumns.size) return false;
  const overlap = columns.filter(column => expectedColumns.has(column)).length;
  const expectedCoverage = overlap / expectedColumns.size;
  const rowCoverage = overlap / columns.length;
  return expectedCoverage >= 0.5 && rowCoverage >= 0.5;
}

export function detectHeaderRow(rows: WorksheetRows, maxNonEmptyRows = 20): HeaderDetection {
  let bestIndex = 0;
  let bestScore = -1;
  let nonEmptyRows = 0;
  for (let index = 0; index < rows.length && nonEmptyRows < maxNonEmptyRows; index += 1) {
    const row = rows[index] || [];
    if (!nonEmptyColumns(row).length) continue;
    nonEmptyRows += 1;
    const score = scoreHeaderRow(row);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  const reliable = bestScore >= 5;
  return {
    headerRowIndex: reliable ? bestIndex : null,
    headerRowNumber: reliable ? bestIndex + 1 : null,
    columnNames: reliable ? extractHeaders(rows[bestIndex] || []) : [],
    score: Math.max(0, Number(bestScore.toFixed(2))),
    confidence: confidenceLevel(bestScore >= 9 ? 0.9 : bestScore >= 5 ? 0.72 : 0.35),
  };
}

export function detectHeaderRowAt(rows: WorksheetRows, headerRowIndex: number | null): HeaderDetection {
  if (headerRowIndex == null) {
    return { headerRowIndex: null, headerRowNumber: null, columnNames: [], score: 0, confidence: 'low' };
  }
  const boundedIndex = Math.max(0, Math.min(Math.trunc(headerRowIndex), Math.max(0, rows.length - 1)));
  const score = Math.max(0, scoreHeaderRow(rows[boundedIndex] || []));
  return {
    headerRowIndex: boundedIndex,
    headerRowNumber: boundedIndex + 1,
    columnNames: extractHeaders(rows[boundedIndex] || []),
    score: Number(score.toFixed(2)),
    confidence: confidenceLevel(score >= 9 ? 0.9 : score >= 5 ? 0.72 : 0.35),
  };
}

function largestNonEmptyBlock(rows: WorksheetRows): { start: number; end: number } | null {
  const blocks: Array<{ start: number; end: number; weight: number }> = [];
  let start: number | null = null;
  let weight = 0;
  for (let rowIndex = 0; rowIndex <= rows.length; rowIndex += 1) {
    const count = rowIndex < rows.length ? nonEmptyColumns(rows[rowIndex] || []).length : 0;
    if (count > 0) {
      if (start == null) start = rowIndex;
      weight += count;
    } else if (start != null) {
      blocks.push({ start, end: rowIndex - 1, weight });
      start = null;
      weight = 0;
    }
  }
  blocks.sort((left, right) => right.weight - left.weight || (right.end - right.start) - (left.end - left.start));
  return blocks[0] || null;
}

export function detectDataRegions(rows: WorksheetRows, header: HeaderDetection): DataRegion[] {
  if (!rows.length) return [];
  const dominantBlock = header.headerRowIndex == null ? largestNonEmptyBlock(rows) : null;
  let block = header.headerRowIndex != null
    ? { start: header.headerRowIndex, end: rows.length - 1 }
    : dominantBlock;
  if (!block) return [];

  if (header.headerRowIndex == null && dominantBlock) {
    const anchorRows = Array.from(
      { length: dominantBlock.end - dominantBlock.start + 1 },
      (_, offset) => dominantBlock.start + offset,
    ).filter(index => nonEmptyColumns(rows[index] || []).length > 0);
    const expectedColumns = dominantColumns(rows, anchorRows.slice(0, 10));
    let expandedStart = dominantBlock.start;
    let blankRowsCrossed = 0;
    for (let rowIndex = dominantBlock.start - 1; rowIndex >= 0; rowIndex -= 1) {
      if (!nonEmptyColumns(rows[rowIndex] || []).length) {
        blankRowsCrossed += 1;
        if (blankRowsCrossed > 1) break;
        continue;
      }
      if (isSummaryRow(rows[rowIndex] || []) || !rowMatchesDominantStructure(rows[rowIndex] || [], expectedColumns)) break;
      expandedStart = rowIndex;
    }
    block = { start: expandedStart, end: rows.length - 1 };
  }

  const startRow = header.headerRowIndex ?? block.start;
  const dataStartRow = header.headerRowIndex != null ? header.headerRowIndex + 1 : startRow;
  let endRow = block.end;
  let observedDataRows = 0;
  const observedRowIndexes: number[] = [];
  for (let rowIndex = dataStartRow; rowIndex <= block.end; rowIndex += 1) {
    const columns = nonEmptyColumns(rows[rowIndex] || []);
    if (!columns.length) {
      if (observedDataRows >= 2) {
        const blankCount = consecutiveBlankRows(rows, rowIndex, block.end);
        const nextRowIndex = rowIndex + blankCount;
        const nextRows = Array.from({ length: 3 }, (_, offset) => nextRowIndex + offset)
          .filter(index => index <= block.end && nonEmptyColumns(rows[index] || []).length > 0);
        const nextIsSummary = nextRowIndex <= block.end && isSummaryRow(rows[nextRowIndex] || []);
        const expectedColumns = dominantColumns(rows, observedRowIndexes.slice(-10));
        const followingMatches = nextRows.some(index => rowMatchesDominantStructure(rows[index] || [], expectedColumns));
        if (blankCount >= 2 || nextIsSummary || !followingMatches) {
          endRow = rowIndex - 1;
          break;
        }
      }
      continue;
    }
    if (observedDataRows >= 2 && isSummaryRow(rows[rowIndex] || [])) {
      endRow = rowIndex - 1;
      break;
    }
    observedDataRows += 1;
    observedRowIndexes.push(rowIndex);
  }

  const relevantRows = rows.slice(startRow, endRow + 1);
  const allColumns = relevantRows.flatMap(nonEmptyColumns);
  if (!allColumns.length || endRow < dataStartRow) return [];
  const startColumn = Math.min(...allColumns);
  const endColumn = Math.max(...allColumns);
  const dataRows = rows.slice(dataStartRow, endRow + 1).filter(row => nonEmptyColumns(row).length > 0);
  const span = Math.max(1, endColumn - startColumn + 1);
  const density = dataRows.length
    ? dataRows.reduce((sum, row) => sum + nonEmptyColumns(row).filter(column => column >= startColumn && column <= endColumn).length / span, 0) / dataRows.length
    : 0;
  const continuity = ratioOfRowsWithData(rows, dataStartRow, endRow);
  const confidence = Math.max(0, Math.min(1, Number((density * 0.5 + continuity * 0.35 + Math.min(dataRows.length / 10, 1) * 0.15).toFixed(3))));
  return [{
    startRow,
    endRow,
    startColumn,
    endColumn,
    dataStartRow,
    rowCount: dataRows.length,
    confidence,
  }];
}

function ratioOfRowsWithData(rows: WorksheetRows, startRow: number, endRow: number): number {
  if (endRow < startRow) return 0;
  const count = rows.slice(startRow, endRow + 1).filter(row => nonEmptyColumns(row).length > 0).length;
  return count / Math.max(1, endRow - startRow + 1);
}

function metadataFromText(
  originalText: string,
  source: MetadataCandidate['source'],
  sourceWeight: number,
): MetadataCandidate[] {
  const candidates: MetadataCandidate[] = [];
  const normalized = normalizeHeader(originalText);
  const subjectMatch = originalText.match(/^(?:المادة|ماده|subject)\s*[:：\-–—]?\s*(.+)$/iu);
  if (subjectMatch?.[1]?.trim()) {
    const subjectName = subjectMatch[1].trim();
    candidates.push({
      field: 'subject_name',
      source: { ...source, value: subjectName } as MetadataCandidate['source'],
      confidence: Math.min(1, sourceWeight + 0.12),
      reasons: ['النص المحيط بالجدول يذكر المادة صراحةً'],
      originalText,
    });
  }
  const classValue = extractClassValue(originalText);
  if (classValue) {
    const explicit = /(?:الصف|class|grade)/u.test(normalized);
    candidates.push({
      field: 'class_name',
      source: { ...source, value: classValue } as MetadataCandidate['source'],
      confidence: Math.min(1, sourceWeight + (explicit ? 0.12 : 0)),
      reasons: [explicit ? 'النص يذكر الصف صراحةً' : 'النص يشبه اسم صف دراسي'],
      originalText,
    });
  }
  const sectionValue = extractSectionValue(originalText);
  if (sectionValue) {
    candidates.push({
      field: 'section_name',
      source: { ...source, value: sectionValue } as MetadataCandidate['source'],
      confidence: Math.min(1, sourceWeight + 0.08),
      reasons: ['النص المحيط بالجدول يتضمن شعبة معروفة'],
      originalText,
    });
  }
  return candidates;
}

export function extractMetadata(
  sheetName: string,
  fileName: string | undefined,
  rows: WorksheetRows,
  region: DataRegion,
): MetadataCandidate[] {
  const metadata: MetadataCandidate[] = [];
  for (let rowIndex = 0; rowIndex < region.startRow; rowIndex += 1) {
    (rows[rowIndex] || []).forEach((cell, columnIndex) => {
      const originalText = String(cell ?? '').trim();
      if (!originalText) return;
      metadata.push(...metadataFromText(originalText, { type: 'metadata-cell', row: rowIndex, column: columnIndex, value: originalText }, 0.78));
    });
  }
  metadata.push(...metadataFromText(sheetName, { type: 'sheet-name', value: sheetName }, 0.68));
  if (fileName) {
    const withoutExtension = fileName.replace(/\.[^.]+$/u, '');
    metadata.push(...metadataFromText(withoutExtension, { type: 'file-name', value: withoutExtension }, 0.48));
  }
  return metadata.sort((left, right) => right.confidence - left.confidence);
}

export function analyzeWorksheet(
  name: string,
  rows: WorksheetRows,
  options: AnalyzeWorksheetOptions = {},
): WorksheetAnalysis {
  const hasOverride = Object.prototype.hasOwnProperty.call(options, 'headerRowIndex');
  const header = hasOverride ? detectHeaderRowAt(rows, options.headerRowIndex ?? null) : detectHeaderRow(rows);
  const regions = detectDataRegions(rows, header);
  const fallbackRegion: DataRegion = {
    startRow: header.headerRowIndex ?? 0,
    endRow: Math.max(0, rows.length - 1),
    startColumn: 0,
    endColumn: Math.max(0, ...rows.map(row => row.length - 1)),
    dataStartRow: header.headerRowIndex != null ? header.headerRowIndex + 1 : 0,
    rowCount: Math.max(0, rows.length - (header.headerRowIndex != null ? header.headerRowIndex + 1 : 0)),
    confidence: 0.2,
  };
  const region = regions[0] || fallbackRegion;
  const metadata = extractMetadata(name, options.fileName, rows, region);
  const columns = profileColumns(rows, region, header.headerRowIndex);
  const fieldInferences = inferStudentFields(columns, metadata);
  const gradeFieldInferences = inferGradeFields(columns, fieldInferences);
  const rawGradeInferenceCount = gradeFieldInferences.filter(inference => inference.kind === 'raw_grade' && inference.confidence >= 0.7).length;
  const classification = classifyFromAnalysis(name, columns, fieldInferences, rawGradeInferenceCount);
  const subjectInference = inferSubjectFromWorkbookContext(name, metadata, options.subjects);
  const table = {
    ...header,
    columnNames: columns.map(column => column.displayName),
    region,
    columns,
    fieldInferences,
    gradeFieldInferences,
    category: classification.category,
    categoryConfidence: classification.confidence,
  };
  return {
    ...header,
    columnNames: table.columnNames,
    name,
    category: classification.category,
    categoryConfidence: classification.confidence,
    rowCount: region.rowCount,
    regions,
    tables: [table],
    metadata,
    columns,
    gradeFieldInferences,
    subjectInference,
  };
}

export function classifyWorksheet(
  name: string,
  rows: WorksheetRows,
  detection = detectHeaderRow(rows),
): WorksheetCategory {
  return analyzeWorksheet(name, rows, { headerRowIndex: detection.headerRowIndex }).category;
}

export function sheetRowsToRecords(
  rows: WorksheetRows,
  headerRowIndex: number | null,
  region?: DataRegion,
): SheetRecord[] {
  const startRow = region?.dataStartRow ?? (headerRowIndex != null ? headerRowIndex + 1 : 0);
  const endRow = region?.endRow ?? Math.max(0, rows.length - 1);
  const startColumn = region?.startColumn ?? 0;
  const endColumn = region?.endColumn ?? Math.max(0, ...rows.map(row => row.length - 1));
  return rows.slice(startRow, endRow + 1).map((row, offset) => {
    const record: SheetRecord = { _excel_row_number: startRow + offset + 1 };
    for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
      record[columnKey(columnIndex)] = row?.[columnIndex] ?? '';
    }
    return record;
  });
}

export function analysisRowsToRecords(rows: WorksheetRows, analysis: WorksheetAnalysis): SheetRecord[] {
  return sheetRowsToRecords(rows, analysis.headerRowIndex, analysis.regions[0]);
}

export function buildMappedRows(
  records: SheetRecord[],
  mapping: Record<string, string>,
): Array<Record<string, unknown>> {
  return records.map(record => {
    const mapped: Record<string, unknown> = { excel_row_number: record._excel_row_number };
    for (const [field, sourceKey] of Object.entries(mapping)) {
      if (sourceKey) mapped[field] = record[sourceKey] ?? null;
    }
    return mapped;
  });
}
