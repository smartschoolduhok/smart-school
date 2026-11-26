import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toArabicDigits } from '../lib/arabicDigits';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  label?: string;
}

/** Compact RTL pager: "عرض ١–٥٠ من ٣٢٠" with previous/next. Hidden when everything fits on one page. */
export default function Pagination({ page, pageSize, total, onPageChange, disabled = false, label = 'التنقل بين الصفحات' }: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const first = (page - 1) * pageSize + 1, last = Math.min(total, page * pageSize);
  const button = 'inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <nav aria-label={label} className="flex flex-col items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 text-sm text-gray-600 sm:flex-row">
      <p aria-live="polite">عرض {toArabicDigits(String(first))}–{toArabicDigits(String(last))} من {toArabicDigits(String(total))}</p>
      <div className="flex items-center gap-2">
        <button type="button" className={button} disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)} aria-label="الصفحة السابقة">
          <ChevronRight size={16} />السابقة
        </button>
        <span className="min-w-16 text-center">{toArabicDigits(String(page))} / {toArabicDigits(String(pageCount))}</span>
        <button type="button" className={button} disabled={disabled || page >= pageCount} onClick={() => onPageChange(page + 1)} aria-label="الصفحة التالية">
          التالية<ChevronLeft size={16} />
        </button>
      </div>
    </nav>
  );
}
