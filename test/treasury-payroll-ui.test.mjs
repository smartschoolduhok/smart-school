import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Window } from 'happy-dom';
import { createServer } from 'vite';
import { root } from './helpers/finance-fixture.mjs';

const window = new Window({ url: 'http://localhost', width: 390, height: 844 });
for (const key of [
  'window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement',
  'HTMLTextAreaElement', 'HTMLFormElement', 'Node', 'Event', 'MouseEvent',
  'InputEvent', 'localStorage', 'sessionStorage',
]) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.confirm = () => true;
globalThis.prompt = () => 'Generated reason';

const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const vite = await createServer({
  root, appType: 'custom',
  ssr: { noExternal: ['react-router-dom', 'react-router'], resolve: { conditions: ['module', 'browser', 'development'] } },
  server: { middlewareMode: true, hmr: false },
});
const { default: TreasuryPage } = await vite.ssrLoadModule('/src/modules/treasury/TreasuryPage.tsx');
const { AuthProvider } = await vite.ssrLoadModule('/src/hooks/useAuth.tsx');
const { businessDate, businessMonth } = await vite.ssrLoadModule('/src/lib/businessTime.ts');
after(async () => { await vite.close(); await window.happyDOM.close(); });

const user = { id: 1, role_key: 'school_owner', school_id: 1, full_name: 'Owner' };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

async function mount(t, overrides = {}) {
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('smart_school_user', JSON.stringify(user));
  localStorage.setItem('smart_school_token', 'generated-token');
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).split('?')[0];
    const method = init.method || 'GET';
    const input = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), path, method, input });
    if (overrides[path]) return overrides[path](input, method);
    if (path === '/api/auth/me') return response({ data: user });
    if (path === '/api/treasury/summary') return response({ data: {
      business_date: businessDate(), business_timezone: 'Asia/Baghdad', verified_balance: 50_000,
      cached_balance: 50_000, balance_sync: true, today_income: 80_000, today_expense: 30_000,
      today_net: 50_000, today_transaction_count: 2, pending_fees_count: 1,
      today_closed: false, payroll_integrity: true, payroll_unhealthy_count: 0,
    } });
    if (path === '/api/treasury/categories') return response({ data: [
      { id: 1, name: 'other_income', name_ar: 'واردات أخرى', type: 'income' },
      { id: 2, name: 'bills', name_ar: 'فواتير', type: 'expense' },
    ] });
    if (path === '/api/treasury/transactions') return method === 'POST'
      ? response({ data: { id: 1, replayed: false } }, 201)
      : response({ data: [], meta: { total: 0, limit: 50, offset: 0 } });
    if (path === '/api/treasury/daily-closings') return response({ data: [] });
    if (path === '/api/treasury/reports/daily') return response({ data: {
      date: businessDate(), closed: false,
      summary: { total_income: 80_000, total_expense: 30_000, net: 50_000, transaction_count: 2 },
      by_category: [{ transaction_type: 'expense', category: 'bills', total: 30_000, count: 1 }],
    } });
    if (path === '/api/treasury/reports/monthly') return response({ data: {
      month_key: businessMonth(), closing_count: 1,
      summary: { total_income: 80_000, total_expense: 30_000, net: 50_000, transaction_count: 2 },
      daily_breakdown: [{ day: businessDate(), income: 80_000, expense: 30_000, net: 50_000, count: 2 }],
    } });
    throw new Error(`Unexpected request ${String(url)}`);
  };
  const container = document.createElement('div'); document.body.append(container);
  const rootElement = createRoot(container);
  await act(async () => rootElement.render(createElement(AuthProvider, null, createElement(TreasuryPage))));
  t.after(async () => { await act(async () => rootElement.unmount()); container.remove(); });
  return { container, calls };
}

const button = (view, label) => {
  const match = [...view.container.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
  assert.ok(match, `button ${label}`); return match;
};
const click = (element) => act(async () => element.click());
async function input(element, value) {
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype
      : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}

test('business date uses Baghdad at the UTC day boundary', () => {
  assert.equal(businessDate(new Date('2026-09-06T22:30:00Z')), '2026-09-07');
  assert.equal(businessMonth(new Date('2026-12-31T22:30:00Z')), '2027-01');
});

test('treasury presents four primary sections and creates whole-IQD idempotent entries', async (t) => {
  const view = await mount(t);
  const navLabels = [...view.container.querySelectorAll('[aria-label="أقسام الخزنة"] button')].map((item) => item.textContent.trim());
  assert.deepEqual(navLabels, ['الملخص', 'القيود', 'الإقفالات', 'التقارير']);
  assert.match(view.container.textContent, /توقيت بغداد/);
  await click(button(view, 'إضافة قيد'));
  const form = view.container.querySelector('form');
  const options = [...form.querySelectorAll('option')].map((option) => option.value);
  assert.ok(!options.includes('USD'));
  const amount = form.querySelector('input[type="number"]');
  assert.equal(amount.step, '1');
  await input(form.querySelectorAll('select')[1], 'other_income');
  await input(amount, '100000');
  await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  const post = view.calls.find((item) => item.path === '/api/treasury/transactions' && item.method === 'POST');
  assert.ok(post);
  assert.equal(post.input.currency, 'IQD');
  assert.equal(post.input.business_date, businessDate());
  assert.match(post.input.client_request_id, /^treasury-[0-9a-f-]{36}$/);
});

test('daily and monthly report fields render the API contract and send separate month/year', async (t) => {
  const view = await mount(t);
  await click(button(view, 'التقارير'));
  assert.match(view.container.textContent, /bills/);
  assert.match(view.container.textContent, /٣٠,٠٠٠ د.ع/);
  await click(button(view, 'شهري'));
  assert.match(view.container.textContent, new RegExp(businessDate()));
  const monthlyCall = view.calls.find((item) => item.path === '/api/treasury/reports/monthly');
  assert.ok(monthlyCall);
  const url = new URL(monthlyCall.url, 'http://localhost');
  assert.equal(url.searchParams.get('month'), businessMonth().slice(5, 7));
  assert.equal(url.searchParams.get('year'), businessMonth().slice(0, 4));
});
