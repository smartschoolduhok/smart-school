import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {root,weekFixture,example} from './helpers/week-setup-fixture.mjs';
import {loadWeekSetup} from '../src/lib/weekSetupDb.ts';
import {publicWeekSnapshot,planWeekSetup,WEEK_LEAVE_MESSAGE} from '../src/lib/weekSetup.ts';

const window=new Window({url:'http://localhost',width:375,height:812});
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','Node','Event','MouseEvent','KeyboardEvent','InputEvent'])globalThis[key]=key==='window'?window:window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createElement,act}=await import('react');
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {WeekSetupTab}=await vite.ssrLoadModule('/src/modules/timetable/WeekSetupTab.tsx');
const {WeekDraftFence}=await vite.ssrLoadModule('/src/modules/timetable/weekDraft.ts');
after(async()=>{await vite.close();await window.happyDOM.close();});

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function mount(t,overrides={}) {
 const f=weekFixture(t),context=await loadWeekSetup(f.d1,1,1),data=publicWeekSnapshot(context);
 const calls={load:[],preview:[],apply:[],dirty:[],changed:0,edit:[],remove:[],day:[]};
 const api={load:async scope=>{calls.load.push(scope);return {data};},preview:async input=>{calls.preview.push(structuredClone(input));return {data:await planWeekSetup(context,input)};},apply:async input=>{calls.apply.push(input);return {data:{...await planWeekSetup(context,input),applied:true}};},...overrides};
 const props={schoolId:1,academicYearId:1,dataVersion:0,onDirtyChange:d=>calls.dirty.push(d),onChanged:()=>{calls.changed++;},onEditSlot:(...a)=>calls.edit.push(a),onDeleteSlot:s=>calls.remove.push(s),onDayChange:(...a)=>calls.day.push(a),api};
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>root.render(createElement(WeekSetupTab,props)));
 t.after(async()=>{await act(async()=>root.unmount());container.remove();});
 const render=async patch=>{Object.assign(props,patch);await act(async()=>root.render(createElement(WeekSetupTab,props)));};
 return {container,calls,api,data,context,render};
}
const find=(u,label)=>{const el=u.container.querySelector(`[aria-label="${label}"]`);assert.ok(el,'element '+label);return el;};
const button=(u,label)=>{const el=[...u.container.querySelectorAll('button')].find(e=>e.textContent===label);assert.ok(el,'button '+label);return el;};
const click=async el=>{await act(async()=>el.click());};
const input=async (el,value)=>{await act(async()=>{
 const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
 Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);
 el.dispatchEvent(new window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));
});};
async function openExample(u){await click(button(u,'إعداد سريع للحصص والاستراحات'));await click(button(u,'تحميل مثال فقط: 7 حصص و2 استراحة'));await click(button(u,'توليد الفترات'));}
async function targetWednesday(u){await click(find(u,'استهداف الأربعاء'));await click(find(u,'تفعيل الأربعاء ضمن الحفظ'));}

test('behavior: generation shows all example periods/totals, no autosave or preset writes',async t=>{
 const u=await mount(t);await openExample(u);
 assert.equal(find(u,'بداية الفترة 1').value,'13:00');assert.equal(find(u,'نهاية الفترة 9').value,'17:30');assert.equal(find(u,'رقم حصة الفترة 7').value,'5');
 assert.match(u.container.textContent,/دقائق الحصص: 245.*الاستراحات: 25.*المدة الكلية: 270/);assert.equal(u.calls.apply.length,0);assert.equal(u.calls.preview.length,0);
 assert.equal(u.container.querySelectorAll('[aria-label^="استهداف"]:checked').length,0);
 await input(find(u,'النهاية المرغوبة'),'18:00');assert.match(u.container.textContent,/الفرق عن النهاية المرغوبة: -30/);assert.equal(find(u,'نهاية الفترة 9').value,'17:30');
});
test('behavior: select/unselect actual request excludes Thursday and preserves separate activation',async t=>{
 const u=await mount(t);await openExample(u);await click(button(u,'تحديد أيام الدوام'));await click(find(u,'استهداف الاثنين'));await targetWednesday(u);await click(button(u,'معاينة التغييرات'));
 assert.deepEqual(u.calls.preview[0].targets.map(t=>t.day_of_week),[0,2,3]);assert.equal(u.calls.preview[0].targets.at(-1).activate_day,true);assert.ok(!u.calls.preview[0].targets.some(t=>t.day_of_week===4));
 assert.equal(u.calls.apply.length,0);assert.match(u.container.textContent,/متخطى؛ لن يتغير/);
});
test('behavior: copy is an editable local source snapshot with source exclusion, no saving',async t=>{
 const u=await mount(t);const card=find(u,'ملخص الأحد');await click([...card.querySelectorAll('button')].find(b=>b.textContent==='نسخ فترات هذا اليوم إلى…'));
 assert.equal(find(u,'بداية الفترة 1').value,'08:00');assert.equal(find(u,'اسم الفترة 4').value,'Break');assert.equal(find(u,'استهداف الأحد').disabled,true);assert.equal(u.calls.apply.length,0);
 await input(find(u,'اسم الفترة 1'),'Local copy');await targetWednesday(u);await click(button(u,'معاينة التغييرات'));
 assert.equal(u.calls.preview[0].source_day_of_week,0);assert.equal(u.calls.preview[0].expected_revision,u.data.revision);assert.equal(u.calls.preview[0].template[0].label,'Local copy');assert.equal(u.data.periods[0].label,'One');assert.equal('id' in u.calls.preview[0].template[0],false);
 await u.render({dataVersion:1});assert.equal(u.calls.load.length,1,'must not silently refresh copied source revision');
});
test('behavior: all raw edits invalidate preview; unfinished generator input is dirty',async t=>{
 const u=await mount(t);await openExample(u);await targetWednesday(u);await click(button(u,'معاينة التغييرات'));assert.ok(button(u,'تأكيد الحفظ'));
 await input(find(u,'عدد الحصص'),'');assert.equal(find(u,'عدد الحصص').value,'');assert.equal(u.container.querySelector('[aria-label="خطة إعداد الأسبوع"]'),null);assert.equal(u.calls.dirty.at(-1),true);
 await click(button(u,'معاينة التغييرات'));await input(find(u,'اسم الفترة 1'),'Edited');assert.equal(u.container.querySelector('[aria-label="خطة إعداد الأسبوع"]'),null);
 await click(button(u,'معاينة التغييرات'));await input(find(u,'طريقة التطبيق'),'update_matching_keep_extra');assert.equal(u.container.querySelector('[aria-label="خطة إعداد الأسبوع"]'),null);
});
test('behavior: dirty close cancel/confirm and refresh-beforeunload, regeneration cancellation',async t=>{
 const u=await mount(t);await openExample(u);let prompts=[];window.confirm=message=>{prompts.push(message);return false;};
 await input(find(u,'اسم الفترة 1'),'Keep me');await click(button(u,'توليد الفترات'));assert.equal(find(u,'اسم الفترة 1').value,'Keep me');
 await click(button(u,'إغلاق المسودة'));assert.ok(u.container.querySelector('[role="dialog"]'));assert.equal(prompts.at(-1),WEEK_LEAVE_MESSAGE);
 const event=new window.Event('beforeunload',{cancelable:true});window.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
 window.confirm=()=>true;await click(button(u,'إغلاق المسودة'));assert.equal(u.container.querySelector('[role="dialog"]'),null);assert.equal(u.calls.dirty.at(-1),false);assert.equal(u.calls.apply.length,0);
});
test('behavior: manual duration does not slide following periods; explicit recalc does',async t=>{
 const u=await mount(t);await openExample(u);await input(find(u,'مدة الفترة 1'),'25');assert.equal(find(u,'نهاية الفترة 1').value,'13:25');assert.equal(find(u,'بداية الفترة 2').value,'13:35');
 await click(button(u,'إعادة حساب الأوقات التالية من بداية الدوام (إزالة الفجوات)'));assert.equal(find(u,'بداية الفترة 2').value,'13:25');
 await input(find(u,'مدة الفترة 1'),'45');assert.equal(find(u,'بداية الفترة 2').value,'13:25','no implicit shift on overlap');
 await click(button(u,'إعادة حساب الأوقات التالية من بداية الدوام (إزالة الفجوات)'));assert.equal(find(u,'بداية الفترة 2').value,'13:45','explicit recalculation repairs temporary overlap');
});
test('behavior: stale pending preview cannot repaint a changed template',async t=>{
 const pending=deferred(),u=await mount(t,{preview:()=>pending.promise});await openExample(u);await targetWednesday(u);await click(button(u,'معاينة التغييرات'));await input(find(u,'اسم الفترة 1'),'New draft');
 await act(async()=>pending.resolve({data:{can_apply:true,days:[],counts:{},warnings:[],blockers:[]}}));assert.equal(u.container.querySelector('[aria-label="خطة إعداد الأسبوع"]'),null);assert.equal(find(u,'اسم الفترة 1').value,'New draft');
});
test('behavior: ABA scope loads cannot replace a newer same-scope snapshot',async t=>{
 const u=await mount(t),old=deferred(),middle=deferred(),latest=deferred();let i=0;u.api.load=()=>[old.promise,middle.promise,latest.promise][i++];
 await u.render({dataVersion:1});await u.render({academicYearId:2});await u.render({academicYearId:1});
 await act(async()=>latest.resolve({data:{...u.data,periods:u.data.periods.map(s=>({...s,label:'CURRENT'}))}}));
 await act(async()=>old.resolve({data:{...u.data,periods:u.data.periods.map(s=>({...s,label:'OBSOLETE'}))}}));await act(async()=>middle.resolve({error:'obsolete error'}));
 const card=find(u,'ملخص الأحد');await click([...card.querySelectorAll('button')].find(b=>b.textContent==='نسخ فترات هذا اليوم إلى…'));assert.equal(find(u,'اسم الفترة 1').value,'CURRENT');assert.ok(!u.container.textContent.includes('obsolete error'));
});
test('behavior: a late apply response cannot close or clear a newly opened draft',async t=>{
 const pending=deferred(),u=await mount(t,{apply:()=>pending.promise});window.confirm=()=>true;await openExample(u);await targetWednesday(u);await click(button(u,'معاينة التغييرات'));await click(button(u,'تأكيد الحفظ'));
 await click(button(u,'إغلاق المسودة'));await openExample(u);await input(find(u,'اسم الفترة 1'),'New session');
 await act(async()=>pending.resolve({data:{applied:true,counts:{create:9,update:0,skipped:0,activated:1}}}));
 assert.equal(find(u,'اسم الفترة 1').value,'New session');assert.equal(u.calls.changed,0);assert.ok(!u.container.textContent.includes('تم الحفظ:'));
});
test('behavior: confirmed save refreshes own data and parent, exact result, clear only completed draft',async t=>{
 const u=await mount(t);await openExample(u);await targetWednesday(u);await click(button(u,'معاينة التغييرات'));await click(button(u,'تأكيد الحفظ'));
 assert.equal(u.calls.apply.length,1);assert.equal(u.calls.apply[0].confirm_apply,true);assert.match(u.calls.apply[0].preview_digest,/^[a-f0-9]{64}$/);assert.equal(u.calls.changed,1);assert.equal(u.calls.load.length,2);assert.equal(u.calls.dirty.at(-1),false);assert.equal(u.container.querySelector('[role="dialog"]'),null);assert.match(u.container.textContent,/تم الحفظ: إضافة 9، تحديث 0، تخطي 0 يوم، تفعيل 1 يوم/);
});
test('behavior: individual customization stays reachable without copying/saving a template',async t=>{
 const u=await mount(t),card=find(u,'ملخص الأحد');await click([...card.querySelectorAll('button')].find(b=>b.textContent==='تخصيص اليوم'));
 await click([...card.querySelectorAll('button')].find(b=>b.textContent==='تعديل الفترة'));assert.equal(u.calls.edit[0][1].id,1);
 await click([...card.querySelectorAll('button')].find(b=>b.textContent==='إضافة فترة'));assert.equal(u.calls.edit[1][0],0);assert.equal(u.calls.edit[1][1],undefined);
 await click(card.querySelector('input[type=checkbox]'));assert.deepEqual(u.calls.day[0],[0,{is_active:0}]);assert.equal(u.calls.apply.length,0);
});
test('keyboard/mobile structural safeguards and existing matrix/school/year/tab guards remain wired',async t=>{
 const u=await mount(t);await openExample(u);const dialog=u.container.querySelector('[role="dialog"]');assert.equal(dialog.getAttribute('aria-modal'),'true');assert.ok(dialog.className.includes('w-full'));assert.ok(dialog.className.includes('overflow-y-auto'));assert.ok(dialog.className.includes('max-h-[94dvh]'));
 assert.ok([...dialog.querySelectorAll('input,select')].every(el=>!!el.getAttribute('aria-label')));
 const last=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].at(-1);last.focus();await act(async()=>last.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));assert.equal(document.activeElement,button(u,'إغلاق المسودة'));
 window.confirm=()=>true;await act(async()=>dialog.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));assert.equal(u.container.querySelector('[role="dialog"]'),null);
 const page=readFileSync(join(root,'src/modules/timetable/TimetablePage.tsx'),'utf8');assert.match(page,/matrixDirty.current && !window.confirm\(MATRIX_LEAVE_MESSAGE\)/);assert.match(page,/!weekDirty.current \|\| window.confirm\(WEEK_LEAVE_MESSAGE\)/);assert.ok((page.match(/allowMatrixLeave\(\)/g)||[]).length>=4);assert.match(page,/onChanged=\{reloadYearData\}/);
 const fence=new WeekDraftFence();fence.setScope('A');const old=fence.capture();fence.setScope('B');fence.setScope('A');assert.equal(old(),false);const fresh=fence.capture();fence.invalidate();assert.equal(fresh(),false);
});
