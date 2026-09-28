import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {root,weekFixture,example} from './helpers/week-setup-fixture.mjs';
import {loadWeekSetup} from '../src/lib/weekSetupDb.ts';
import {publicWeekSnapshot,planWeekSetup,generateWeekTemplate,WEEK_LEAVE_MESSAGE} from '../src/lib/weekSetup.ts';

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
async function mount(t,overrides={},prepareContext=context=>context) {
 window.confirm=()=>true;
 const f=weekFixture(t),context=prepareContext(await loadWeekSetup(f.d1,1,1)),data=publicWeekSnapshot(context);
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
async function openExample(u){await click(button(u,'إعداد سريع للدروس والاستراحات'));await click(button(u,'تحميل مثال فقط: 7 دروس و2 استراحة'));await click(button(u,'توليد الفترات'));}
async function targetWednesday(u){await click(find(u,'استهداف الأربعاء'));await click(find(u,'تفعيل الأربعاء ضمن الحفظ'));}
const savedSevenLessonDays=context=>({...context,slots:[...context.slots.filter(s=>s.day_of_week>1),...[0,1].flatMap(day=>generateWeekTemplate({start_time:'13:00',lesson_count:7,lesson_minutes:35,breaks:[{after_lesson:3,minutes:15},{after_lesson:5,minutes:10}]}).map((p,i)=>({...p,id:1000+day*100+i,school_id:context.school_id,academic_year_id:context.academic_year_id,day_of_week:day,created_at:0,updated_at:0})))]});

test('behavior: generation shows all example periods/totals, no autosave or preset writes',async t=>{
 const u=await mount(t);await openExample(u);
 assert.equal(find(u,'بداية الفترة 1').value,'13:00');assert.equal(find(u,'نهاية الفترة 9').value,'17:30');assert.equal(find(u,'رقم درس الفترة 7').value,'5');
 assert.match(u.container.textContent,/دقائق الدروس: 245.*الاستراحات: 25.*المدة الكلية: 270/);assert.equal(u.calls.apply.length,0);assert.equal(u.calls.preview.length,0);
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
test('behavior: editing a saved day immediately loads its periods and original break positions',async t=>{
 const u=await mount(t,{},savedSevenLessonDays),card=find(u,'ملخص الأحد');
 await click([...card.querySelectorAll('button')].find(b=>b.textContent==='تعديل الدروس والاستراحات'));
 assert.equal(find(u,'بداية الدوام').value,'13:00');assert.equal(find(u,'عدد الدروس').value,'7');
 assert.equal(find(u,'موضع الاستراحة 1').value,'3');assert.equal(find(u,'موضع الاستراحة 2').value,'5');
 assert.equal(find(u,'مدة الاستراحة 1').value,'15');assert.equal(find(u,'نهاية الفترة 9').value,'17:30');
 await click(button(u,'معاينة التغييرات'));
 assert.equal(u.calls.preview[0].mode,'configure_day');assert.deepEqual(u.calls.preview[0].template,u.context.slots.filter(s=>s.day_of_week===0).map(({slot_index,slot_type,lesson_number,label,start_time,end_time,is_active})=>({slot_index,slot_type,lesson_number,label,start_time,end_time,is_active})));
 assert.match(find(u,'خطة إعداد الأسبوع').textContent,/قابل للتطبيق/);assert.equal(u.calls.apply.length,0);
 let confirmations=0;window.confirm=()=>{confirmations++;return false;};await click(button(u,'تحميل مثال فقط: 7 دروس و2 استراحة'));
 assert.equal(confirmations,1);assert.equal(find(u,'موضع الاستراحة 1').value,'3');assert.ok(find(u,'خطة إعداد الأسبوع'));
});
test('behavior: quick saved-day loading preserves identities and selected days while shortening a break',async t=>{
 const u=await mount(t,{},savedSevenLessonDays);await click(button(u,'إعداد سريع للدروس والاستراحات'));await click(button(u,'تحميل اليوم المحفوظ بدل المسودة'));
 assert.equal(find(u,'طريقة التطبيق').value,'update_matching_keep_extra');assert.equal(find(u,'استهداف الأحد').checked,true);assert.equal(find(u,'استهداف الأحد').disabled,false);
 assert.equal(find(u,'موضع الاستراحة 1').value,'3');assert.equal(find(u,'موضع الاستراحة 2').value,'5');await click(find(u,'استهداف الاثنين'));
 await input(find(u,'مدة الاستراحة 1'),'10');await click(button(u,'توليد الفترات'));
 assert.match(u.container.textContent,/دقائق الدروس: 245.*الاستراحات: 20.*المدة الكلية: 265/);assert.equal(find(u,'نهاية الفترة 9').value,'17:25');
 await click(button(u,'معاينة التغييرات'));const request=u.calls.preview[0];
 assert.equal(request.source_day_of_week,null);assert.deepEqual(request.targets,[{day_of_week:0,activate_day:false},{day_of_week:1,activate_day:false}]);
 assert.deepEqual(request.template.map(({slot_index,slot_type,lesson_number})=>({slot_index,slot_type,lesson_number})),u.context.slots.filter(s=>s.day_of_week===0).map(({slot_index,slot_type,lesson_number})=>({slot_index,slot_type,lesson_number})));
 assert.equal(button(u,'تأكيد الحفظ').disabled,false);assert.equal(u.calls.apply.length,0);
});
test('behavior: copying a saved day hydrates generator settings before regenerating',async t=>{
 const u=await mount(t,{},savedSevenLessonDays),card=find(u,'ملخص الأحد');await click([...card.querySelectorAll('button')].find(b=>b.textContent==='نسخ فترات هذا اليوم إلى…'));
 assert.equal(find(u,'عدد الدروس').value,'7');assert.equal(find(u,'موضع الاستراحة 1').value,'3');assert.equal(find(u,'موضع الاستراحة 2').value,'5');
 await input(find(u,'مدة الاستراحة 1'),'10');await click(button(u,'توليد الفترات'));assert.equal(find(u,'نهاية الفترة 9').value,'17:25');assert.equal(find(u,'استهداف الأحد').disabled,true);
});
test('behavior: identity-block recovery confirms draft replacement and keeps selected target days',async t=>{
 const u=await mount(t,{},savedSevenLessonDays);await openExample(u);await input(find(u,'طريقة التطبيق'),'update_matching_keep_extra');await click(find(u,'استهداف الأحد'));await click(find(u,'استهداف الاثنين'));await click(button(u,'معاينة التغييرات'));
 const recovery=button(u,'تحميل إعدادات الأحد المحفوظة بدل المسودة');let prompt;window.confirm=message=>{prompt=message;return false;};await click(recovery);
 assert.equal(prompt,WEEK_LEAVE_MESSAGE);assert.equal(find(u,'موضع الاستراحة 1').value,'2');assert.ok(find(u,'خطة إعداد الأسبوع'));
 window.confirm=()=>true;await click(recovery);assert.equal(find(u,'موضع الاستراحة 1').value,'3');assert.equal(find(u,'موضع الاستراحة 2').value,'5');assert.equal(find(u,'استهداف الأحد').checked,true);assert.equal(find(u,'استهداف الاثنين').checked,true);
 assert.equal(u.container.querySelector('[aria-label="خطة إعداد الأسبوع"]'),null);assert.equal(u.calls.apply.length,0);
});
test('behavior: replacement keeps draft and targets, displays archive impact, and requires fresh consent before apply',async t=>{
 const u=await mount(t,{},savedSevenLessonDays);await openExample(u);await input(find(u,'طريقة التطبيق'),'update_matching_keep_extra');await click(find(u,'استهداف الأحد'));await click(find(u,'استهداف الاثنين'));await click(button(u,'معاينة التغييرات'));
 const original=structuredClone(u.calls.preview[0]);await click(button(u,'استبدال جدول الأيام المحددة وأرشفة القديم'));
 assert.equal(find(u,'طريقة التطبيق').value,'replace_selected_days');assert.equal(find(u,'موضع الاستراحة 1').value,'2');assert.equal(find(u,'استهداف الأحد').checked,true);assert.equal(find(u,'استهداف الاثنين').checked,true);assert.equal(u.calls.apply.length,0);
 const replacement={old_periods:18,archived_entries:3,carried_entries:2,removed_entries:1,archived_availability:2,carried_availability:1,removed_availability:1,locked_entries:1};
 const base=await planWeekSetup(u.context,original);
 u.api.preview=async request=>{u.calls.preview.push(structuredClone(request));return {data:{...base,can_apply:true,blockers:[],days:[],counts:{...base.counts,create:18,blocked:0},replacement}};};
 u.api.apply=async request=>{u.calls.apply.push(structuredClone(request));return {data:{...base,applied:true}};};
 await click(button(u,'معاينة التغييرات'));assert.deepEqual(u.calls.preview.at(-1).template,original.template);assert.deepEqual(u.calls.preview.at(-1).targets,original.targets);
 assert.match(find(u,'أثر استبدال الجدول').textContent,/الفترات القديمة المؤرشفة: 18/);assert.match(find(u,'أثر استبدال الجدول').textContent,/المنقولة للجدول الجديد: 2.*المُزالة من الجدول الحالي: 1/);assert.equal(button(u,'تأكيد الحفظ').disabled,true);
 await click(find(u,'تأكيد استبدال الجدول وأرشفة القديم'));assert.equal(button(u,'تأكيد الحفظ').disabled,false);
 await input(find(u,'اسم الفترة 1'),'Revised lesson');assert.equal(u.container.querySelector('[aria-label="خطة إعداد الأسبوع"]'),null);
 await click(button(u,'معاينة التغييرات'));assert.equal(find(u,'تأكيد استبدال الجدول وأرشفة القديم').checked,false);assert.equal(button(u,'تأكيد الحفظ').disabled,true);
 await click(find(u,'تأكيد استبدال الجدول وأرشفة القديم'));await click(button(u,'تأكيد الحفظ'));
 assert.equal(u.calls.apply.length,1);assert.equal(u.calls.apply[0].confirm_replace,true);assert.equal(u.calls.apply[0].mode,'replace_selected_days');assert.deepEqual(u.calls.apply[0].targets,original.targets);
});
test('behavior: all raw edits invalidate preview; unfinished generator input is dirty',async t=>{
 const u=await mount(t);await openExample(u);await targetWednesday(u);await click(button(u,'معاينة التغييرات'));assert.ok(button(u,'تأكيد الحفظ'));
 await input(find(u,'عدد الدروس'),'');assert.equal(find(u,'عدد الدروس').value,'');assert.equal(u.container.querySelector('[aria-label="خطة إعداد الأسبوع"]'),null);assert.equal(u.calls.dirty.at(-1),true);
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

test('behavior: per-day count editor targets one day, derives start/duration and exposes deactivation preview',async t=>{
 const u=await mount(t),card=find(u,'ملخص الأحد');
 await click([...card.querySelectorAll('button')].find(b=>b.textContent==='تعديل الدروس والاستراحات'));
 assert.equal(find(u,'بداية الدوام').value,'08:00');assert.equal(find(u,'المدة الافتراضية للدرس').value,'40');
 assert.equal(find(u,'عدد الدروس').value,'4');assert.equal(find(u,'استهداف الأحد').checked,true);assert.equal(find(u,'استهداف الاثنين').disabled,true);
 assert.match(u.container.textContent,/عند التقليل ستظهر الفترات الزائدة كغير نشطة/);
 await input(find(u,'عدد الدروس'),'2');await click(button(u,'توليد الفترات'));await click(button(u,'معاينة التغييرات'));
 assert.equal(u.calls.preview[0].mode,'configure_day');assert.deepEqual(u.calls.preview[0].targets,[{day_of_week:0,activate_day:false}]);assert.equal(u.calls.preview[0].template.filter(p=>p.slot_type==='lesson').length,2);
 assert.match(find(u,'خطة إعداد الأسبوع').textContent,/غير نشطة/);assert.equal(u.calls.apply.length,0);
});
test('behavior: reducing an occupied saved day offers replacement while retaining its single-day scope',async t=>{
 const u=await mount(t,{},context=>{
  const saved=savedSevenLessonDays(context),slot=saved.slots.find(s=>s.day_of_week===0&&s.lesson_number===7);
  return {...saved,entries:[...saved.entries,{id:7000,school_id:1,academic_year_id:1,slot_id:slot.id,teaching_load_id:2,is_locked:1,created_by_user_id:1,updated_by_user_id:1,created_at:0,updated_at:0}]};
 });
 const card=find(u,'ملخص الأحد');await click([...card.querySelectorAll('button')].find(b=>b.textContent==='تعديل الدروس والاستراحات'));
 assert.equal(find(u,'طريقة التطبيق').value,'configure_day');assert.ok([...find(u,'طريقة التطبيق').options].some(o=>o.value==='replace_selected_days'));
 await input(find(u,'عدد الدروس'),'5');await click(button(u,'توليد الفترات'));await click(button(u,'معاينة التغييرات'));
 assert.equal(button(u,'تأكيد الحفظ').disabled,true);assert.match(find(u,'خطة إعداد الأسبوع').textContent,/لا يمكن تقليل الدروس/);
 await click(button(u,'استبدال جدول الأيام المحددة وأرشفة القديم'));
 assert.equal(find(u,'طريقة التطبيق').value,'replace_selected_days');assert.equal(find(u,'استهداف الأحد').checked,true);assert.equal(find(u,'استهداف الأحد').disabled,true);
 assert.equal(find(u,'استهداف الاثنين').checked,false);assert.equal(find(u,'استهداف الاثنين').disabled,true);assert.equal(find(u,'عدد الدروس').value,'5');
 await click(button(u,'معاينة التغييرات'));const request=u.calls.preview.at(-1);
 assert.equal(request.mode,'replace_selected_days');assert.deepEqual(request.targets,[{day_of_week:0,activate_day:false}]);assert.equal(request.template.filter(p=>p.slot_type==='lesson').length,5);
 assert.match(find(u,'أثر استبدال الجدول').textContent,/المُزالة من الجدول الحالي: 1/);assert.equal(button(u,'تأكيد الحفظ').disabled,true);
 await click(find(u,'تأكيد استبدال الجدول وأرشفة القديم'));assert.equal(button(u,'تأكيد الحفظ').disabled,false);assert.equal(u.calls.apply.length,0);
});
test('keyboard/mobile structural safeguards and existing matrix/school/year/tab guards remain wired',async t=>{
 const u=await mount(t);await openExample(u);const dialog=u.container.querySelector('[role="dialog"]');assert.equal(dialog.getAttribute('aria-modal'),'true');assert.ok(dialog.className.includes('w-full'));assert.ok(dialog.className.includes('overflow-y-auto'));assert.ok(dialog.className.includes('max-h-[94dvh]'));
 assert.ok([...dialog.querySelectorAll('input,select')].every(el=>!!el.getAttribute('aria-label')));
 const last=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].at(-1);last.focus();await act(async()=>last.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));assert.equal(document.activeElement,button(u,'إغلاق المسودة'));
 window.confirm=()=>true;await act(async()=>dialog.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));assert.equal(u.container.querySelector('[role="dialog"]'),null);
 const page=readFileSync(join(root,'src/modules/timetable/TimetablePage.tsx'),'utf8');assert.match(page,/matrixDirty.current && !window.confirm\(MATRIX_LEAVE_MESSAGE\)/);assert.match(page,/!weekDirty.current \|\| window.confirm\(WEEK_LEAVE_MESSAGE\)/);assert.ok((page.match(/allowMatrixLeave\(\)/g)||[]).length>=4);assert.match(page,/onChanged=\{reloadYearData\}/);
 const fence=new WeekDraftFence();fence.setScope('A');const old=fence.capture();fence.setScope('B');fence.setScope('A');assert.equal(old(),false);const fresh=fence.capture();fence.invalidate();assert.equal(fresh(),false);
});
