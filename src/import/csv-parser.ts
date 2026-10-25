import type { CsvColumnMeta, CsvDataRow, ParsedCsvDocument } from './types';

export interface ParseCsvOptions {
  hasHeaderRow?: boolean;
  delimiter?: ',' | ';' | '\t';
}

function detectDelimiter(csvText: string): ',' | ';' | '\t' {
  const firstNonEmptyLine =
    csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';

  let inQuotes = false;
  let commas = 0;
  let semicolons = 0;
  let tabs = 0;

  for (let i = 0; i < firstNonEmptyLine.length; i++) {
    const ch = firstNonEmptyLine[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === ',') commas++;
      else if (ch === ';') semicolons++;
      else if (ch === '\t') tabs++;
    }
  }

  if (tabs > commas && tabs >= semicolons) return '\t';
  if (semicolons > commas) return ';';
  return ',';
}

/**
 * Header-agnostic RFC-4180 CSV parser.
 * Parses arbitrary CSV files regardless of column naming or header presence.
 * The user maps the resulting column indices to target schema fields in Step 2.
 */
export function parseCsvDocument(
  csvText: string,
  options: ParseCsvOptions = {},
): ParsedCsvDocument {
  const hasHeaderRow = options.hasHeaderRow ?? true;
  const cleanedText = csvText.replace(/^\uFEFF/, ''); // Strip UTF-8 BOM if present
  const delimiter = options.delimiter ?? detectDelimiter(cleanedText);

  const rawRows: { lineNumber: number; cells: string[] }[] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  let currentLineNumber = 1;
  let rowStartLineNumber = 1;

  for (let i = 0; i < cleanedText.length; i++) {
    const ch = cleanedText[i];
    const next = cleanedText[i + 1];

    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') {
          currentLineNumber++;
        }
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === delimiter) {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && next === '\n') {
        i++;
      }
      currentRow.push(currentCell);
      currentCell = '';

      const isBlankRow = currentRow.every((cell) => cell.trim() === '');
      if (!isBlankRow) {
        rawRows.push({
          lineNumber: rowStartLineNumber,
          cells: currentRow,
        });
      }

      currentRow = [];
      currentLineNumber++;
      rowStartLineNumber = currentLineNumber;
      continue;
    }

    currentCell += ch;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    const isBlankRow = currentRow.every((cell) => cell.trim() === '');
    if (!isBlankRow) {
      rawRows.push({
        lineNumber: rowStartLineNumber,
        cells: currentRow,
      });
    }
  }

  if (rawRows.length === 0) {
    return {
      delimiter,
      hasHeaderRow,
      columns: [],
      rows: [],
    };
  }

  const maxColumns = rawRows.reduce((max, r) => Math.max(max, r.cells.length), 0);
  const headerCells = hasHeaderRow ? rawRows[0].cells : [];
  const dataSourceRows = hasHeaderRow ? rawRows.slice(1) : rawRows;

  const rows: CsvDataRow[] = dataSourceRows.map((raw, idx) => {
    const normalizedCells = Array.from({ length: maxColumns }, (_, colIdx) =>
      raw.cells[colIdx] !== undefined ? raw.cells[colIdx] : '',
    );
    return {
      rowNumber: idx + 1,
      sourceLineNumber: raw.lineNumber,
      cells: normalizedCells,
    };
  });

  const columns: CsvColumnMeta[] = Array.from({ length: maxColumns }, (_, colIdx) => {
    const rawHeader = (headerCells[colIdx] ?? '').trim();
    const displayLabel =
      hasHeaderRow && rawHeader.length > 0
        ? `Col ${colIdx + 1}: ${rawHeader}`
        : `Column ${colIdx + 1}`;
    const sampleValues = rows
      .slice(0, 3)
      .map((r) => r.cells[colIdx]?.trim() ?? '')
      .filter((v) => v.length > 0);

    return {
      index: colIdx,
      rawHeader,
      displayLabel,
      sampleValues,
    };
  });

  return {
    delimiter,
    hasHeaderRow,
    columns,
    rows,
  };
}
