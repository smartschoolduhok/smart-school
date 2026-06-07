import React from 'react';

export interface PrintableTableColumn<T = Record<string, unknown>> {
  key: string;
  header: string;
  width?: string;
  align?: 'center' | 'right' | 'left';
  render?: (row: T, index: number) => React.ReactNode;
}

export interface PrintableTableProps<T = any> {
  columns: PrintableTableColumn<T>[];
  data: T[];
  caption?: string;
  emptyText?: string;
}

function PrintableTable<T = any>({
  columns,
  data,
  caption,
  emptyText = 'لا توجد بيانات',
}: PrintableTableProps<T>) {
  return (
    <table className="print-table">
      {caption && <caption className="text-sm font-semibold mb-2">{caption}</caption>}
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              style={{
                width: col.width,
                textAlign: col.align || 'center',
              }}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.length === 0 && (
          <tr>
            <td
              colSpan={columns.length}
              className="text-center text-gray-500 py-4"
            >
              {emptyText}
            </td>
          </tr>
        )}
        {data.map((row, idx) => (
          <tr key={idx}>
            {columns.map((col) => {
              const content = col.render
                ? col.render(row, idx)
                : ((row as Record<string, any>)[col.key] as React.ReactNode) ?? '-';
              return (
                <td
                  key={col.key}
                  style={{ textAlign: col.align || 'center' }}
                >
                  {content}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default PrintableTable;
