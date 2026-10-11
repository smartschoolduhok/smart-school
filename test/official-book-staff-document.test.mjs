import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';

const staffCSS = await readFile(new URL('../src/components/officialBooks/officialBookStaffDocument.css', import.meta.url), 'utf8');

const window = new Window({ url: 'http://localhost' });
const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: 'automatic' },
  server: { middlewareMode: true, hmr: false },
});
const { OfficialBookDocument } = await vite.ssrLoadModule('/src/components/officialBooks/OfficialBookDocument.tsx');
after(async () => { await vite.close(); await window.happyDOM.close(); });

const layout = {
  header_mode: 'custom', custom_header_ar: 'ترويسة المدرسة الأولى\nقسم المدرسة', show_english_header: false,
  show_verification_qr: false, show_verification_number: false, show_verification_note: false,
};
const rows = [
  { employee_id: 46, name: 'اسم المعاونة', job_title: 'معاونة' },
  { employee_id: 35, name: 'اسم المدرس (متقاعد)', job_title: 'مدرس' },
  { employee_id: null, name: 'مدرس جديد', job_title: 'محاضر' },
];
const book = {
  id: 1, document_number: '36', title: 'الأوامر المدرسية للمدرسين', body_text: 'نرفق لكم قائمة بأسماء الكادر.',
  status: 'issued', created_at: '2026-10-09T12:00:00Z', document_date: '2026-10-11',
  verification_token: 'staff-verification-token', school_name_snapshot: 'اسم المدرسة الأولى',
  principal_name_snapshot: 'اسم المدير', use_logo_snapshot: 1, logo_url_snapshot: '/school-first-logo.png',
  footer_text_snapshot: 'تذييل المدرسة الأولى',
};
function render({ mode = 'letter_with_attachment', staffRows = rows, settings = {}, override = {} } = {}) {
  const element = window.document.createElement('div');
  element.innerHTML = renderToStaticMarkup(createElement(OfficialBookDocument, {
    book: {
      ...book,
      settings_snapshot_json: JSON.stringify({ official_book_layout: layout, staff_roster: { mode, rows: staffRows }, ...settings }),
      ...override,
    },
    verificationUrl: 'https://example.com/verify/staff',
  }));
  return element;
}

test('staff letter renders the issued text plus a separate roster with editable names and job titles preserved', () => {
  const output = render();
  assert.equal(output.querySelectorAll('.official-book-staff-page').length, 2);
  assert.match(output.querySelector('.official-book-staff-letter').textContent, /نرفق لكم قائمة بأسماء الكادر/);
  assert.match(output.querySelector('.official-book-staff-letter').textContent, /اسم المدير/);
  const attachment = output.querySelector('.official-book-staff-attachment');
  assert.equal(attachment.querySelectorAll('tbody tr').length, rows.length);
  assert.deepEqual([...attachment.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)), [
    ['١', 'اسم المعاونة', 'معاونة'], ['٢', 'اسم المدرس (متقاعد)', 'مدرس'], ['٣', 'مدرس جديد', 'محاضر'],
  ]);
  assert.equal(attachment.querySelector('tbody tr').dataset.employeeId, '46');
  assert.equal(attachment.querySelector('.official-book-staff-name').className, 'official-book-staff-name');
  assert.doesNotMatch(attachment.textContent, /نرفق لكم|اسم المدير/);
});

test('builtin staff letter displays recipient before a single subject and preserves the frozen issued body', () => {
  const issuedBody = 'إلى / التعليم العام / قسم تربية دهوك\nم / الأوامر المدرسية للمدرسين\n\nتحية طيبة...\n\nنرفق لكم الأوامر المدرسية الخاصة بالمدرسين لمدرستنا.\n\nالمرفقات: قائمة بأسماء المدرسين.';
  const issuedBook = { ...book, body_text: issuedBody };
  const output = render({ override: issuedBook });
  const letter = output.querySelector('.official-book-staff-letter');
  const recipient = letter.querySelector('.official-book-staff-recipient');
  const heading = letter.querySelector('h1');
  const body = letter.querySelector('.official-book-body');
  assert.equal(recipient.textContent, 'إلى / التعليم العام / قسم تربية دهوك');
  assert.equal(heading.textContent, 'م / الأوامر المدرسية للمدرسين');
  assert.deepEqual([...recipient.parentNode.children].filter(element => [recipient, heading, body].includes(element)), [recipient, heading, body]);
  assert.equal((letter.textContent.match(/الأوامر المدرسية للمدرسين/g) || []).length, 1);
  assert.match(body.textContent, /^تحية طيبة/);
  assert.doesNotMatch(body.textContent, /إلى \/|م \/ الأوامر المدرسية للمدرسين/);
  assert.equal(issuedBook.body_text, issuedBody);
});

test('custom staff letter bodies without the recipient-subject opening are displayed in full', () => {
  const customBody = 'إلى / جهة المدرسة\nصياغة خاصة بدون سطر موضوع\nم / موضوع في داخل النص';
  const output = render({ override: { body_text: customBody } });
  const letter = output.querySelector('.official-book-staff-letter');
  assert.equal(letter.querySelector('.official-book-staff-recipient'), null);
  assert.equal(letter.querySelector('h1').textContent, book.title);
  assert.equal(letter.querySelector('.official-book-body').textContent, customBody);
});

test('attachment-only mode excludes the letter and signature and derives metadata from the schoolchosen issue date', () => {
  const output = render({ mode: 'attachment_only', settings: { document_date: '2026-10-12' } });
  assert.equal(output.querySelectorAll('.official-book-staff-page').length, 1);
  assert.equal(output.querySelector('.official-book-staff-letter'), null);
  const metadata = output.querySelector('.official-book-staff-metadata').textContent;
  assert.match(metadata, /العدد: ٣٦/);
  assert.match(metadata, /اليوم: الاثنين/);
  assert.match(metadata, /١٢.*١٠.*٢٠٢٦/);
  assert.doesNotMatch(output.textContent, /نرفق لكم|اسم المدير/);
});

test('every staff page uses the same saved school stationery and logo, never another school identity', () => {
  const output = render({
    settings: { official_book_layout: { ...layout, custom_header_ar: 'ترويسة المدرسة الثانية\nمديرية المدرسة الثانية' } },
    override: { school_name_snapshot: 'اسم المدرسة الثانية', logo_url_snapshot: '/school-second-logo.png', footer_text_snapshot: 'تذييل المدرسة الثانية' },
  });
  for (const header of output.querySelectorAll('header')) assert.match(header.textContent, /ترويسة المدرسة الثانية/);
  for (const footer of output.querySelectorAll('footer')) assert.match(footer.textContent, /تذييل المدرسة الثانية/);
  assert.equal(output.querySelectorAll('.official-book-staff-watermark').length, 2);
  for (const image of output.querySelectorAll('img')) assert.equal(image.getAttribute('src'), '/school-second-logo.png');
  assert.doesNotMatch(output.textContent, /المدرسة الأولى|المنار/);
});

test('logo and verification visibility flags are respected in an attachment, while school text stays visible', () => {
  const withoutLogo = render({ mode: 'attachment_only', override: { use_logo_snapshot: 0 } });
  assert.equal(withoutLogo.querySelector('img'), null);
  assert.match(withoutLogo.querySelector('header').textContent, /ترويسة المدرسة الأولى/);
  assert.equal(withoutLogo.querySelector('svg'), null);
  assert.doesNotMatch(withoutLogo.textContent, /staff-verification-token/);
  const verified = render({ mode: 'attachment_only', settings: { official_book_layout: { ...layout, show_verification_qr: true, show_verification_number: true } } });
  assert.ok(verified.querySelector('svg'));
  assert.match(verified.querySelector('footer').textContent, /staff-verification-token/);
});

test('custom header blank lines, school English preference and untrusted roster text render safely', () => {
  const output = render({
    staffRows: [{ name: '<script>staff()</script>', job_title: '<b>معاونة</b>' }],
    settings: { use_arabic_indic_digits: false, official_book_layout: { ...layout, custom_header_ar: 'ترويسة\n\nقسم', show_english_header: true, custom_header_en: 'School English' } },
  });
  assert.equal(output.querySelector('script'), null);
  assert.equal(output.querySelector('tbody b'), null);
  assert.match(output.querySelector('tbody').textContent, /<script>staff\(\)<\/script>/);
  assert.match(output.querySelector('header').textContent, /School English/);
  assert.ok(output.querySelector('header').textContent.includes('\u00a0'));
  assert.equal(output.querySelector('tbody td').textContent, '1');
});

test('long staff lists keep every row with print rules for repeated table headings and intact rows', () => {
  const output = render({ mode: 'attachment_only', staffRows: Array.from({ length: 100 }, (_, index) => ({ name: `مدرس ${index}`, job_title: 'مدرس' })) });
  assert.equal(output.querySelectorAll('tbody tr').length, 100);
  assert.match(staffCSS, /\.official-book-staff-letter\s*\{[^}]*break-after: page;/);
  assert.match(staffCSS, /\.official-book-staff-table thead\s*\{[^}]*display: table-header-group;/);
  assert.match(staffCSS, /\.official-book-staff-table tr,[^{]*\{[^}]*break-inside: avoid;/);
  assert.match(staffCSS, /\.official-book-staff-table \.official-book-staff-name\s*\{[^}]*font-weight: 400;/);
});

test('legacy books without a staff roster retain their original single-document layout', () => {
  const output = render({ override: { settings_snapshot_json: JSON.stringify({ official_book_layout: layout }) } });
  assert.equal(output.querySelector('.official-book-staff-document'), null);
  assert.equal(output.querySelectorAll('.official-book-document').length, 1);
  assert.equal(output.querySelector('table'), null);
  assert.match(output.querySelector('.official-book-body').textContent, /نرفق لكم/);
  assert.match(output.textContent, /اسم المدير/);
});
