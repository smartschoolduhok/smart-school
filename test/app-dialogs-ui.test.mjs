import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const window = new Window({url: 'http://localhost'});
for (const key of ['window','document','navigator','HTMLElement','HTMLButtonElement','HTMLInputElement','HTMLTextAreaElement','Element','Node','Event','MouseEvent','KeyboardEvent'])
  Object.defineProperty(globalThis, key, {configurable: true, value: key === 'window' ? window : window[key]});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {createElement, act} = await import('react'), {createRoot} = await import('react-dom/client');
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({root, configFile: false, appType: 'custom', optimizeDeps: {noDiscovery: true, include: []}, esbuild: {jsx: 'automatic'}, server: {middlewareMode: true, hmr: false}});
const dialogs = await vite.ssrLoadModule('/src/components/AppDialogs.tsx');
const {default: ErrorBoundary, isChunkLoadError} = await vite.ssrLoadModule('/src/components/ErrorBoundary.tsx');
after(async () => { await vite.close(); await window.happyDOM.close(); });

const flush = () => act(async () => { for (let i = 0; i < 3; i++) await new Promise(r => setTimeout(r, 0)); });
async function mountHost(t) {
  const container = document.createElement('div'); document.body.append(container);
  const reactRoot = createRoot(container);
  await act(async () => reactRoot.render(createElement(dialogs.AppDialogHost)));
  t.after(async () => { await act(async () => reactRoot.unmount()); container.remove(); });
  return container;
}
const button = (c, text) => [...c.querySelectorAll('button')].find(b => b.textContent.trim() === text);
const key = (el, k) => act(async () => { el.dispatchEvent(new window.KeyboardEvent('keydown', {key: k, bubbles: true})); });

test('without a mounted host the helpers fall back to the browser dialogs', async () => {
  const calls = [];
  window.confirm = message => { calls.push(['confirm', message]); return true; };
  window.alert = message => { calls.push(['alert', message]); };
  window.prompt = (message, value) => { calls.push(['prompt', message, value]); return 'سبب'; };
  assert.equal(dialogs.appDialogState().hosts, 0);
  assert.equal(await dialogs.appConfirm('متأكد؟'), true);
  await dialogs.appAlert('تم');
  assert.equal(await dialogs.appPrompt('السبب؟', {defaultValue: 'مفقودة'}), 'سبب');
  assert.deepEqual(calls, [['confirm', 'متأكد؟'], ['alert', 'تم'], ['prompt', 'السبب؟', 'مفقودة']]);
});

test('confirm renders an RTL dialog; the confirm button resolves true and Escape resolves false', async t => {
  window.confirm = () => { throw new Error('native confirm must not be used while a host is mounted'); };
  const c = await mountHost(t);
  let answer = dialogs.appConfirm('هل أنت متأكد من أرشفة هذا الطالب؟\nلا يمكن التراجع.', {danger: true, confirmLabel: 'أرشفة'});
  await flush();
  const dialog = c.querySelector('[role="dialog"]');
  assert.ok(dialog); assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(c.firstElementChild.getAttribute('dir'), 'rtl');
  assert.match(dialog.textContent, /أرشفة هذا الطالب/);
  assert.match(button(c, 'أرشفة').className, /bg-red-600/, 'destructive actions use the red button');
  await act(async () => button(c, 'أرشفة').click());
  assert.equal(await answer, true);
  assert.equal(c.querySelector('[role="dialog"]'), null);

  answer = dialogs.appConfirm('متابعة؟'); await flush();
  await key(c.querySelector('[role="dialog"]'), 'Escape');
  assert.equal(await answer, false);
});

test('dialogs queue in order and alerts show a single OK button', async t => {
  const c = await mountHost(t);
  const first = dialogs.appAlert('الملف كبير جداً'), second = dialogs.appConfirm('الثاني؟');
  await flush();
  assert.equal(c.querySelector('[role="alertdialog"]').textContent.includes('الملف كبير جداً'), true);
  assert.equal(button(c, 'إلغاء'), undefined);
  await act(async () => button(c, 'حسنًا').click()); await first;
  await flush();
  assert.match(c.querySelector('[role="dialog"]').textContent, /الثاني/);
  await act(async () => button(c, 'إلغاء').click());
  assert.equal(await second, false);
});

test('prompt requires a value, trims it, and cancelling returns null', async t => {
  const c = await mountHost(t);
  let answer = dialogs.appPrompt('اكتب سبب الإلغاء:', {defaultValue: ''});
  await flush();
  const input = c.querySelector('input');
  assert.equal(document.activeElement, input, 'the input receives focus');
  assert.equal(button(c, 'تأكيد').disabled, true);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '  البطاقة مفقودة  '); input.dispatchEvent(new window.Event('input', {bubbles: true}));
  });
  assert.equal(button(c, 'تأكيد').disabled, false);
  await key(input, 'Enter');
  assert.equal(await answer, 'البطاقة مفقودة');

  answer = dialogs.appPrompt('السبب؟', {defaultValue: 'افتراضي'}); await flush();
  assert.equal(c.querySelector('input').value, 'افتراضي');
  await act(async () => button(c, 'إلغاء').click());
  assert.equal(await answer, null);
});

test('unmounting the host settles pending dialogs instead of leaving callers waiting', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const reactRoot = createRoot(container);
  await act(async () => reactRoot.render(createElement(dialogs.AppDialogHost)));
  const pending = dialogs.appConfirm('معلّق؟'), pendingPrompt = dialogs.appPrompt('سبب؟');
  await act(async () => reactRoot.unmount()); container.remove();
  assert.equal(await pending, false); assert.equal(await pendingPrompt, null);
  assert.deepEqual(dialogs.appDialogState(), {hosts: 0, pending: 0});
});

test('the error boundary replaces a crashed page with a recoverable message and resets on navigation', async t => {
  const errors = console.error; console.error = () => {}; t.after(() => { console.error = errors; });
  const Crash = () => { throw new Error('boom'); };
  const container = document.createElement('div'); document.body.append(container);
  const reactRoot = createRoot(container);
  t.after(async () => { await act(async () => reactRoot.unmount()); container.remove(); });
  await act(async () => reactRoot.render(createElement(ErrorBoundary, {resetKey: '/students'}, createElement(Crash))));
  assert.match(container.textContent, /حدث خطأ غير متوقع في هذه الصفحة/);
  assert.doesNotMatch(container.textContent, /boom/, 'internal error text is not shown');
  assert.ok([...container.querySelectorAll('button')].some(b => b.textContent.includes('إعادة تحميل الصفحة')));
  await act(async () => reactRoot.render(createElement(ErrorBoundary, {resetKey: '/grades'}, createElement('p', null, 'صفحة الدرجات'))));
  assert.match(container.textContent, /صفحة الدرجات/);
  assert.equal(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/x.js')), true);
  assert.equal(isChunkLoadError(new Error('boom')), false);
});

test('App mounts the dialog host and error boundaries, and only synchronous leave guards keep native confirm', () => {
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  assert.match(app, /<AppDialogHost \/>/); assert.match(app, /<RoutedErrorBoundary>/); assert.match(app, /<ErrorBoundary>/);
  const files = [];
  const walk = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.(tsx?|mts)$/.test(name)) files.push(path); } };
  walk(join(root, 'src'));
  const native = [];
  for (const file of files) {
    if (file.endsWith('AppDialogs.tsx')) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (/(^|[^.\w$])(window\.)?(alert|prompt)\(/.test(line)) native.push(`${file}:${index + 1}`);
      if (/window\.confirm\(/.test(line)) native.push(`${file.replace(/\\/g, '/').split('/src/')[1]}`);
    });
  }
  // Leave-page guards return a boolean synchronously to their callers.
  assert.deepEqual([...new Set(native)].sort(), [
    'modules/advisors/SectionAdvisorsPage.tsx', 'modules/grades/GradesPage.tsx', 'modules/timetable/TeachingLoadMatrixTab.tsx',
    'modules/timetable/TimetablePage.tsx', 'modules/timetable/WeekSetupTab.tsx',
  ]);
});
