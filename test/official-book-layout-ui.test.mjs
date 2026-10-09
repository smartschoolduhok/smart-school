import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createServer } from 'vite';
import { normalizeOfficialBookLayout, validateOfficialBookLayout } from '../src/lib/officialBookLayout.ts';

const window = new Window({ url: 'http://localhost' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLTextAreaElement', 'Node', 'Event', 'MouseEvent']) {
  globalThis[key] = key === 'window' ? window : window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { renderToStaticMarkup } = await import('react-dom/server');
const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: 'automatic' },
  server: { middlewareMode: true, hmr: false },
});
const { OfficialBookDocument, OfficialBookStationeryPreview } = await vite.ssrLoadModule('/src/components/officialBooks/OfficialBookDocument.tsx');
const { default: DocumentTab } = await vite.ssrLoadModule('/src/modules/settings/DocumentTab.tsx');
after(async () => { await vite.close(); await window.happyDOM.close(); });

const book = {
  id: 1, document_number: '12/2026', title: 'كتاب تجريبي', body_text: 'نص الكتاب', status: 'issued',
  created_at: '2026-10-09T12:00:00Z', verification_token: 'book-verification-token',
  school_name_snapshot: 'مدرسة الاختبار', principal_name_snapshot: 'المدير',
  footer_text_snapshot: 'تذييل المدرسة\nهاتف المدرسة', verification_note_snapshot: 'ملاحظة المدرسة',
};
const custom = {
  header_mode: 'custom', custom_header_ar: 'المديرية العامة لتربية نينوى\n\nقسم دهوك',
  custom_header_en: 'School-written English\nDuhok Department',
  show_verification_qr: false, show_verification_number: false, show_verification_note: false,
};
function render(layout, overrides = {}, Component = OfficialBookDocument) {
  return renderToStaticMarkup(createElement(Component, {
    book: { ...book, settings_snapshot_json: JSON.stringify({ official_book_layout: layout, province: 'دهوك', school_name_en: 'Automatic School' }), ...overrides },
    verificationUrl: 'https://example.com/verify/book',
  }));
}
function parse(html) { const element = document.createElement('div'); element.innerHTML = html; return element; }

test('old layout snapshots retain structured headers and every existing verification element', () => {
  const old = normalizeOfficialBookLayout({ country_ar: 'الدولة المحفوظة' });
  assert.equal(old.header_mode, 'structured');
  for (const key of ['show_verification_qr', 'show_verification_number', 'show_verification_note']) assert.equal(old[key], true);
  const output = parse(render({ country_ar: 'الدولة المحفوظة' }));
  assert.match(output.querySelector('header').textContent, /الدولة المحفوظة/);
  assert.match(output.querySelector('header').textContent, /مدرسة الاختبار/);
  assert.match(output.querySelector('footer').textContent, /book-verification-token/);
  assert.match(output.textContent, /ملاحظة المدرسة/);
  assert.ok(output.querySelector('svg'));
});

test('custom headers replace all automatic text and footer controls remove only chosen elements', () => {
  const output = parse(render(custom));
  const header = output.querySelector('header').textContent;
  assert.match(header, /المديرية العامة لتربية نينوى/);
  assert.match(header, /قسم دهوك/);
  assert.match(header, /School-written English/);
  assert.doesNotMatch(header, /جمهورية العراق|وزارة التربية|مدرسة الاختبار|Automatic School|تربية دهوك/);
  assert.ok(header.includes('\u00a0'), 'authored blank line remains');
  assert.equal(output.querySelector('svg'), null);
  assert.doesNotMatch(output.textContent, /book-verification-token|ملاحظة المدرسة|امسح للتحقق/);
  assert.match(output.querySelector('footer').textContent, /تذييل المدرسة\nهاتف المدرسة/);
  assert.match(output.textContent, /المدير/);
});

test('blank custom header and footer stay blank, and Arabic-only text has no hidden English content', () => {
  const output = parse(render({ ...custom, custom_header_ar: '', show_english_header: false }, { footer_text_snapshot: '' }));
  assert.equal(output.querySelector('header').textContent.trim(), '');
  assert.equal(output.querySelector('footer'), null);
  assert.equal(output.querySelector('header [dir="ltr"] [dir="ltr"]'), null);
  assert.ok(output.querySelector('header .grid-cols-1'));
});

test('custom header and footer text is escaped and preview uses the same rendered stationery', () => {
  const layout = { ...custom, custom_header_ar: '<script>alert(1)</script>\nاسم المدرسة' };
  const printed = parse(render(layout));
  const preview = parse(render(layout, {}, OfficialBookStationeryPreview));
  assert.equal(printed.querySelector('script'), null);
  assert.match(printed.querySelector('header').textContent, /<script>alert\(1\)<\/script>/);
  assert.equal(printed.querySelector('header').outerHTML, preview.querySelector('header').outerHTML);
  assert.equal(printed.querySelector('footer').outerHTML, preview.querySelector('footer').outerHTML);
});

test('layout validation accepts multiline boundaries and rejects malformed settings', () => {
  assert.equal(validateOfficialBookLayout({ ...custom, custom_header_ar: 'ع'.repeat(1000) }), null);
  assert.equal(validateOfficialBookLayout({ ...custom, custom_header_ar: Array(10).fill('سطر').join('\n') }), null);
  for (const invalid of [
    { header_mode: 'other' }, { custom_header_ar: 15 }, { custom_header_en: [] },
    { custom_header_ar: 'ع'.repeat(1001) }, { custom_header_ar: Array(11).fill('سطر').join('\n') },
    { custom_header_ar: 'نص\u0000' }, { show_verification_qr: 'false' }, { show_verification_number: null },
  ]) assert.ok(validateOfficialBookLayout(invalid), JSON.stringify(invalid));
  const normalized = normalizeOfficialBookLayout(JSON.stringify({ ...custom, custom_header_ar: '  سطر أول\nسطر ثان  ', show_verification_qr: 0 }));
  assert.equal(normalized.custom_header_ar, 'سطر أول\nسطر ثان');
  assert.equal(normalized.show_verification_qr, false);
});

async function mount(t, patch = {}) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const props = { data: { official_book_layout_settings: custom }, school: { name: 'مدرستي' }, schoolId: 3, canEdit: true, onSuccess() {}, onError() {}, ...patch };
  await act(async () => root.render(createElement(DocumentTab, props)));
  t.after(async () => { await act(async () => root.unmount()); container.remove(); });
  return { container, async render(patch) { Object.assign(props, patch); await act(async () => root.render(createElement(DocumentTab, props))); } };
}
async function changeText(element, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}

test('school can type spaces/newlines, preview them, and save custom settings with the school scope', async t => {
  const calls = [], errors = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return Response.json({ data: { message: 'تم' } }); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const u = await mount(t, { onError: value => errors.push(value) });
  const input = u.container.querySelector('[name="custom_header_ar"]');
  await changeText(input, 'المدرسة ');
  assert.equal(input.value, 'المدرسة ');
  await changeText(input, 'المدرسة الأولى\n');
  assert.equal(input.value, 'المدرسة الأولى\n');
  await changeText(input, 'المدرسة الأولى\nقسم دهوك');
  assert.match(u.container.querySelector('[aria-label="معاينة ترويسة وتذييل الكتب الرسمية"] header').textContent, /المدرسة الأولى.*قسم دهوك/);
  await act(async () => u.container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(errors.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.school_id, 3);
  assert.equal(calls[0].body.official_book_layout_settings.custom_header_ar, 'المدرسة الأولى\nقسم دهوك');
  assert.equal(calls[0].body.official_book_layout_settings.show_verification_number, false);
});

test('read-only users cannot change stationery, and school changes reset the editable preview', async t => {
  const u = await mount(t, { canEdit: false });
  for (const input of u.container.querySelectorAll('input, textarea, select')) assert.equal(input.disabled, true);
  await u.render({ canEdit: true, schoolId: 4, school: { name: 'مدرسة ثانية' }, data: { official_book_layout_settings: { ...custom, custom_header_ar: 'ترويسة المدرسة الثانية' } } });
  assert.equal(u.container.querySelector('[name="custom_header_ar"]').value, 'ترويسة المدرسة الثانية');
  assert.match(u.container.querySelector('[aria-label="معاينة ترويسة وتذييل الكتب الرسمية"] header').textContent, /ترويسة المدرسة الثانية/);
  assert.doesNotMatch(u.container.querySelector('[aria-label="معاينة ترويسة وتذييل الكتب الرسمية"] header').textContent, /نينوى/);
});
