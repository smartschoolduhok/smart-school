import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { toArabicDigits } from '../../lib/arabicDigits';
import { resolvedOfficialBookLayout } from '../../lib/officialBookLayout';
import { formatOfficialBookDisplayDate } from '../../lib/officialBookDates';

export interface OfficialBookDocumentRecord {
  id: number;
  document_number: string;
  title: string;
  body_text: string;
  status: string;
  created_at: string | number;
  document_date?: string | null;
  verification_token: string;
  school_name_snapshot?: string | null;
  principal_name_snapshot?: string | null;
  logo_url_snapshot?: string | null;
  stamp_url_snapshot?: string | null;
  use_logo_snapshot?: number | boolean;
  use_stamp_snapshot?: number | boolean;
  header_text_snapshot?: string | null;
  footer_text_snapshot?: string | null;
  verification_note_snapshot?: string | null;
  settings_snapshot_json?: string | null;
}

function parseSnapshot(source?: string | null): Record<string, any> {
  if (!source) return {};
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function DocumentImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}

function HeaderLines({ lines, dir, preserveEmptyLines = false }: { lines: string[]; dir: 'rtl' | 'ltr'; preserveEmptyLines?: boolean }) {
  return (
    <div dir={dir} className={dir === 'rtl' ? 'text-right' : 'text-left'}>
      {(preserveEmptyLines ? lines : lines.filter(Boolean)).map((line, index) => (
        <div key={`${line}-${index}`} className={`[overflow-wrap:anywhere] ${index === 0 ? 'font-black' : 'font-semibold'}`}>{line || '\u00a0'}</div>
      ))}
    </div>
  );
}

function bookAppearance(book: OfficialBookDocumentRecord) {
  const snapshot = parseSnapshot(book.settings_snapshot_json);
  const schoolName = book.school_name_snapshot || snapshot.school_name || 'المدرسة';
  const layout = resolvedOfficialBookLayout(snapshot.official_book_layout, {
    name: schoolName,
    name_en: snapshot.school_name_en,
    province: snapshot.province,
  });
  const emblemUrl = layout.show_official_emblem ? layout.official_emblem_url : '';
  const schoolLogoUrl = book.use_logo_snapshot
    ? (book.logo_url_snapshot || snapshot.logo_url || '')
    : '';
  const centralMark = emblemUrl || schoolLogoUrl;
  const headerText = book.header_text_snapshot ?? snapshot.official_book_header_text ?? '';
  const footerText = book.footer_text_snapshot ?? snapshot.official_book_footer_text ?? '';
  const verificationNote = book.verification_note_snapshot ?? snapshot.verification_note ?? '';
  return { snapshot, schoolName, layout, emblemUrl, centralMark, headerText, footerText, verificationNote };
}

function OfficialBookHeader({ book }: { book: OfficialBookDocumentRecord }) {
  const { layout, schoolName, emblemUrl, centralMark, headerText } = bookAppearance(book);
  const custom = layout.header_mode === 'custom';
  const columns = custom && !layout.show_english_header
    ? (centralMark ? 'grid-cols-[30mm_1fr]' : 'grid-cols-1')
    : (custom && !centralMark ? 'grid-cols-2' : 'grid-cols-[1fr_30mm_1fr]');
  return (
      <header className="official-book-header border-b-2 border-slate-900 pb-3">
        <div dir="ltr" className={`grid ${columns} items-start gap-4 text-[11px] leading-relaxed`}>
          {(!custom || layout.show_english_header) && <div className={layout.show_english_header ? '' : 'invisible'}>
            <HeaderLines
              dir="ltr"
              preserveEmptyLines={custom}
              lines={custom ? layout.custom_header_en.split(/\r\n|\r|\n/) : [
                layout.country_en,
                layout.ministry_en,
                layout.directorate_en,
                layout.department_en,
                layout.school_name_en,
              ]}
            />
          </div>}
          {(!custom || centralMark) && <div className="flex min-h-20 items-start justify-center">
            {centralMark ? (
              <DocumentImage
                key={centralMark}
                src={centralMark}
                alt={emblemUrl ? 'شعار جمهورية العراق' : 'شعار المدرسة'}
                className="max-h-20 max-w-[28mm] object-contain"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-slate-800 text-center text-[9px] font-black leading-tight">
                {schoolName.split(/\s+/).slice(0, 2).join(' ')}
              </div>
            )}
          </div>}
          <HeaderLines
            dir="rtl"
            preserveEmptyLines={custom}
            lines={custom ? layout.custom_header_ar.split(/\r\n|\r|\n/) : [
              layout.country_ar,
              layout.ministry_ar,
              layout.directorate_ar,
              layout.department_ar,
              layout.school_name_ar,
            ]}
          />
        </div>
        {headerText && (
          <div className="mt-2 whitespace-pre-line border-t border-slate-300 pt-2 text-center text-[11px] font-semibold leading-relaxed [overflow-wrap:anywhere]">
            {headerText}
          </div>
        )}
      </header>
  );
}

function OfficialBookVerification({ book, verificationUrl }: { book: OfficialBookDocumentRecord; verificationUrl: string }) {
  const { layout, verificationNote } = bookAppearance(book);
  return (
    <div className="flex items-end gap-4">
      {layout.show_verification_qr && verificationUrl && (
        <div className="text-center text-[9px] leading-tight text-slate-600">
          <QRCodeSVG value={verificationUrl} size={72} level="M" />
          <div className="mt-1 font-semibold">امسح للتحقق من صحة الكتاب</div>
        </div>
      )}
      {layout.show_verification_note && verificationNote && <div className="max-w-48 whitespace-pre-line text-[9px] leading-relaxed text-slate-500 [overflow-wrap:anywhere]">{verificationNote}</div>}
    </div>
  );
}

function OfficialBookFooter({ book }: { book: OfficialBookDocumentRecord }) {
  const { layout, footerText } = bookAppearance(book);
  if (!footerText && !layout.show_verification_number) return null;
  return (
    <footer className="mt-5 border-t border-slate-400 pt-2 text-center text-[10px] leading-relaxed text-slate-600">
      {footerText && <div className="whitespace-pre-line [overflow-wrap:anywhere]">{footerText}</div>}
      {layout.show_verification_number && <div>رقم التحقق: <span dir="ltr" className="inline-block font-mono">{book.verification_token}</span></div>}
    </footer>
  );
}

export function OfficialBookStationeryPreview({ book }: { book: OfficialBookDocumentRecord }) {
  return (
    <div dir="rtl" className="rounded-xl border border-slate-300 bg-white p-5 text-slate-950" aria-label="معاينة ترويسة وتذييل الكتب الرسمية">
      <OfficialBookHeader book={book} />
      <div className="my-8 text-center text-xs text-slate-400">محتوى الكتاب والتواقيع</div>
      <OfficialBookVerification book={book} verificationUrl="https://example.com/verify/preview" />
      <OfficialBookFooter book={book} />
    </div>
  );
}

export function OfficialBookDocument({ book, verificationUrl }: { book: OfficialBookDocumentRecord; verificationUrl: string }) {
  const { snapshot, layout } = bookAppearance(book);
  const useArabicDigits = snapshot.use_arabic_indic_digits !== false && snapshot.use_arabic_indic_digits !== 0;
  const digits = (value: string) => useArabicDigits ? toArabicDigits(value) : value;
  const dateText = formatOfficialBookDisplayDate(book, useArabicDigits ? 'ar-IQ' : 'en-GB');
  const principalName = book.principal_name_snapshot || snapshot.principal_name || '';
  const stampUrl = book.use_stamp_snapshot ? (book.stamp_url_snapshot || snapshot.stamp_url || '') : '';

  return (
    <article className="official-book-document flex min-h-[267mm] flex-col bg-white text-slate-950" data-layout-version={layout.version}>
      <OfficialBookHeader book={book} />

      <div className="mt-3 grid grid-cols-2 gap-x-8 text-sm font-semibold">
        <div>العدد: <span dir="ltr" className="inline-block max-w-full align-top font-normal [overflow-wrap:anywhere]">{digits(book.document_number)}</span></div>
        <div className="text-left">التاريخ: <span className="font-normal">{digits(dateText)}</span></div>
      </div>

      {book.status === 'cancelled' && (
        <div className="mt-4 border-2 border-red-700 bg-red-50 px-3 py-2 text-center font-black text-red-800">
          كتاب ملغى — غير صالح للاستخدام الرسمي
        </div>
      )}

      <h1 className="mx-auto mt-7 border-b border-slate-900 px-8 pb-1 text-center text-lg font-black">
        {book.title}
      </h1>

      <div className="official-book-body mt-6 whitespace-pre-wrap text-justify text-[15px] leading-[2.05]">
        {book.body_text}
      </div>

      <div className="official-book-closing mt-auto pt-10">
        <div className="official-book-signature grid grid-cols-[1fr_62mm] items-end gap-8">
          <OfficialBookVerification book={book} verificationUrl={verificationUrl} />
          <div className="relative min-h-28 text-center">
            <div className="font-black">مدير المدرسة</div>
            <div className="mt-2 min-h-6 font-semibold">{principalName || 'الاسم والتوقيع'}</div>
            {stampUrl && (
              <DocumentImage src={stampUrl} alt="الختم الرسمي" className="mx-auto mt-2 max-h-20 max-w-28 object-contain opacity-90" />
            )}
          </div>
        </div>
        <OfficialBookFooter book={book} />
      </div>
    </article>
  );
}

export default OfficialBookDocument;
