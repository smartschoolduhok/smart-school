import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {fixture, request, root} from './helpers/school-workflow-fixture.mjs';
import {MAX_PAGE_SIZE, pageSlice, parsePaging} from '../src/lib/listPaging.ts';

const window = new Window({url: 'http://localhost'});
for (const key of ['window','document','navigator','HTMLElement','HTMLButtonElement','Element','Node','Event','MouseEvent'])
  Object.defineProperty(globalThis, key, {configurable: true, value: key === 'window' ? window : window[key]});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {createElement, act} = await import('react'), {createRoot} = await import('react-dom/client');
const vite = await createServer({root, appType: 'custom', server: {middlewareMode: true, hmr: false}});
const {default: app} = await vite.ssrLoadModule('/src/worker.ts');
const {default: Pagination} = await vite.ssrLoadModule('/src/components/Pagination.tsx');
after(async () => { await vite.close(); await window.happyDOM.close(); });

test('paging parameters are opt-in, bounded and validated', () => {
  assert.equal(parsePaging({}), null);
  assert.deepEqual(parsePaging({page: '3'}), {page: 3, pageSize: 50, offset: 100});
  assert.deepEqual(parsePaging({page_size: '20'}), {page: 1, pageSize: 20, offset: 0});
  for (const bad of [{page: '0'}, {page: '-1'}, {page: 'abc'}, {page: '1.5'}, {page_size: String(MAX_PAGE_SIZE + 1)}, {page_size: '0'}])
    assert.equal(parsePaging(bad), 'invalid', JSON.stringify(bad));
  const rows = Array.from({length: 120}, (_, i) => i + 1);
  assert.deepEqual(pageSlice(rows, 3, 50), {rows: rows.slice(100), page: 3, pageCount: 3});
  assert.equal(pageSlice(rows, 9, 50).page, 3, 'a page past the end clamps to the last page');
  assert.deepEqual(pageSlice([], 1, 50), {rows: [], page: 1, pageCount: 1});
});

test('print history pages newest first with a total, and keeps the old shape without paging', async t => {
  const f = fixture(t);
  const insert = f.db.prepare("INSERT INTO print_records(school_id, document_id, print_type, printed_at, printed_by_user_id) VALUES (?, ?, 'result_card', ?, 1)");
  for (let i = 1; i <= 7; i++) insert.run(1, i, 1790000000 + i);
  insert.run(2, 99, 1790000100);
  const plain = await request(app, f, 'owner', 'GET', '/api/print-records?school_id=1');
  assert.equal(plain.status, 200); assert.equal(plain.data.length, 7); assert.equal(plain.meta, undefined);
  const second = await request(app, f, 'owner', 'GET', '/api/print-records?school_id=1&page=2&page_size=3');
  assert.equal(second.status, 200, JSON.stringify(second));
  assert.deepEqual(second.meta, {total: 7, page: 2, page_size: 3});
  assert.deepEqual(second.data.map(row => row.document_id), [4, 3, 2]);
  const filtered = await request(app, f, 'owner', 'GET', '/api/print-records?school_id=1&page=1&page_size=50&print_type=official_book');
  assert.deepEqual([filtered.data.length, filtered.meta.total], [0, 0], 'the total follows the filters');
  assert.equal((await request(app, f, 'owner', 'GET', '/api/print-records?school_id=1&page=0')).status, 400);
});

test('fee payments and receipts accept paging without changing the unpaged response', async t => {
  const f = fixture(t);
  for (const path of ['/api/fee-payments', '/api/fee-receipts']) {
    const plain = await request(app, f, 'owner', 'GET', `${path}?school_id=1`);
    assert.equal(plain.status, 200, path); assert.deepEqual(plain.data, []); assert.equal(plain.meta, undefined);
    const paged = await request(app, f, 'owner', 'GET', `${path}?school_id=1&student_id=101&page=1&page_size=25`);
    assert.equal(paged.status, 200, JSON.stringify(paged));
    assert.deepEqual(paged.meta, {total: 0, page: 1, page_size: 25});
    const bad = await request(app, f, 'owner', 'GET', `${path}?school_id=1&page_size=500`);
    assert.equal(bad.status, 400); assert.equal(bad.code, 'invalid_pagination');
  }
});

test('the pager is hidden when one page is enough and moves between pages otherwise', async t => {
  const host = document.createElement('div'); document.body.append(host);
  const reactRoot = createRoot(host);
  t.after(async () => { await act(async () => reactRoot.unmount()); host.remove(); });
  const pages = [];
  const render = page => act(async () => reactRoot.render(createElement(Pagination, {page, pageSize: 50, total: 120, onPageChange: next => pages.push(next)})));
  await act(async () => reactRoot.render(createElement(Pagination, {page: 1, pageSize: 50, total: 50, onPageChange: () => {}})));
  assert.equal(host.querySelector('nav'), null);
  await render(1);
  assert.match(host.textContent, /عرض ١–٥٠ من ١٢٠/);
  const [previous, next] = host.querySelectorAll('button');
  assert.equal(previous.disabled, true); assert.equal(next.disabled, false);
  await act(async () => next.click());
  await render(3);
  assert.match(host.textContent, /عرض ١٠١–١٢٠ من ١٢٠/);
  assert.equal(host.querySelectorAll('button')[1].disabled, true);
  await act(async () => host.querySelectorAll('button')[0].click());
  assert.deepEqual(pages, [2, 2]);
});
