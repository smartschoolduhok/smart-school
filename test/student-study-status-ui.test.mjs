import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const window = new Window({url:'http://localhost', width:390, height:844});
for (const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLImageElement','Node','Event','MouseEvent','localStorage','sessionStorage']) Object.defineProperty(globalThis, key, {configurable:true, value:key === 'window' ? window : window[key]});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {createElement, act} = await import('react');
const {createRoot} = await import('react-dom/client');
const vite = await createServer({root:fileURLToPath(new URL('..', import.meta.url)),configFile:false,appType:'custom',optimizeDeps:{noDiscovery:true,include:[]},esbuild:{jsx:'automatic'},ssr:{noExternal:['react-router-dom','react-router'],resolve:{conditions:['module','browser','development']}},server:{middlewareMode:true,hmr:false}});
const {default:Panel} = await vite.ssrLoadModule('/src/modules/students/StudentStudyStatusPanel.tsx');
const {StudentRosterDocument,filterStudentRoster} = await vite.ssrLoadModule('/src/components/studentDocuments/StudentRosterDocument.tsx');
const {StudentRosterPreview} = await vite.ssrLoadModule('/src/modules/print/PrintStudentRosterPage.tsx');
const {default:StudentsPage} = await vite.ssrLoadModule('/src/modules/students/StudentsPage.tsx');
const {AuthProvider} = await vite.ssrLoadModule('/src/hooks/useAuth.tsx');
const {MemoryRouter} = await vite.ssrLoadModule('react-router-dom');
after(async () => {await vite.close(); await window.happyDOM.close();});
const years = schoolId => [3,2].map(id => ({id,school_id:schoolId,name:id === 3 ? '2026-2027':'2025-2026',is_active:id === 3 ? 1:0}));
const student = (id=11,schoolId=1) => ({id,school_id:schoolId,current_academic_year_id:3,class_id:4,birth_date:'2012-05-05',gender:'male'});
const status = (id=11,year=3,extra={}) => ({student_id:id,academic_year_id:year,study_status:'regular',grades_visible:true,age_exception:null,revision:0,updated_at:null,...extra});
const deferred = () => {let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function mount(t,overrides={}) {
  const container=document.createElement('div');document.body.append(container);const app=createRoot(container);
  const props={student:student(),schoolId:1,role:'school_owner',history:[],loadYears:async id=>({data:years(id)}),loadClasses:async()=>({data:[{id:4,name:'الأول المتوسط'},{id:5,name:'الثاني المتوسط'}]}),loadStatus:async(id,scope)=>({data:status(id,scope.academic_year_id)}),saveStatus:async(id,input)=>({data:status(id,input.academic_year_id,{...input,revision:input.revision+1})}),...overrides};
  await act(async()=>app.render(createElement(Panel,props)));
  t.after(async()=>{await act(async()=>app.unmount());container.remove();});
  return {container,async render(next){Object.assign(props,next);await act(async()=>app.render(createElement(Panel,props)));}};
}
const label = (ui,text) => {const found=[...ui.container.querySelectorAll('label')].find(item=>item.textContent.startsWith(text));assert.ok(found,`label ${text}`);return found.querySelector('input,select,textarea');};
const button = (ui,text) => {const found=[...ui.container.querySelectorAll('button')].find(item=>item.textContent===text);assert.ok(found,`button ${text}`);return found;};
async function input(element,value){await act(async()=>{const proto=element.tagName==='SELECT'?HTMLSelectElement.prototype:element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new window.Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
async function click(element){await act(async()=>element.click());}
async function submit(ui){await act(async()=>ui.container.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));}

test('designation is independent of grades visibility and saves explicit annual revision with reason',async t=>{
  const writes=[];let refreshed=0;
  const ui=await mount(t,{loadStatus:async()=>({data:status(11,3,{grades_visible:false,revision:7})}),saveStatus:async(id,input)=>{writes.push({id,...input});return {data:status(id,input.academic_year_id,{...input,revision:8})};},onSaved:()=>refreshed++});
  await input(label(ui,'نوع الدراسة'),'affiliated');
  assert.equal(label(ui,'إظهار درجات').checked,false);
  await input(label(ui,'سبب التغيير'),'تحويل موثق إلى الانتساب');await submit(ui);
  assert.deepEqual(writes,[{id:11,school_id:1,academic_year_id:3,revision:7,study_status:'affiliated',grades_visible:false,age_exception:null,change_reason:'تحويل موثق إلى الانتساب'}]);
  assert.equal(refreshed,1);assert.match(ui.container.textContent,/المراجعة 8/);
});
test('pre-enrollment age exception requires complete document and explicit verification',async t=>{
  const writes=[];
  const ui=await mount(t,{student:{...student(),class_id:null},saveStatus:async(id,input)=>{writes.push(input);return {data:status(id,3,{...input,revision:1})};}});
  await click(label(ui,'استثناء عمر'));
  await input(label(ui,'الصف المشمول'),'5');await input(label(ui,'رقم الكتاب'),'123/ش');await input(label(ui,'تاريخ الكتاب'),'2026-09-01');await input(label(ui,'الجهة المصدرة'),'المديرية');await input(label(ui,'سبب الاستثناء'),'استثناء أصغر من السن للصف المحدد');await input(label(ui,'سبب التغيير'),'توثيق الكتاب');
  await submit(ui);assert.equal(writes.length,0);assert.match(ui.container.textContent,/أكد مطابقة كتاب الاستثناء/);
  await click(label(ui,'راجعت الكتاب'));await submit(ui);
  assert.equal(writes.length,1);assert.equal(writes[0].confirm_age_exception_verified,true);assert.equal(writes[0].age_exception.class_id,5);assert.equal(writes[0].age_exception.reference,'123/ش');
  assert.equal('birth_date' in writes[0].age_exception,false);
});
test('revision conflict preserves unsaved changes and does not reload over them',async t=>{
  let reads=0;
  const ui=await mount(t,{loadStatus:async()=>{reads++;return {data:status()};},saveStatus:async()=>({error:'تغيرت المراجعة. أعد تحميل الحالة.',status:409})});
  await input(label(ui,'نوع الدراسة'),'hosted');await input(label(ui,'سبب التغيير'),'استضافة');await submit(ui);
  assert.equal(label(ui,'نوع الدراسة').value,'hosted');assert.equal(label(ui,'سبب التغيير').value,'استضافة');assert.equal(reads,1);
  window.confirm=()=>false;await click(button(ui,'إعادة تحميل الحالة المحفوظة'));assert.equal(reads,1);
  await input(label(ui,'السنة الدراسية للوضع'),'2');assert.equal(label(ui,'السنة الدراسية للوضع').value,'3');
});
test('a late year response cannot overwrite the selected year',async t=>{
  const pending=deferred();
  const ui=await mount(t,{loadStatus:async(id,scope)=>scope.academic_year_id===3?pending.promise:{data:status(id,2,{study_status:'hosted',revision:4})}});
  await input(label(ui,'السنة الدراسية للوضع'),'2');assert.equal(label(ui,'نوع الدراسة').value,'hosted');
  await act(async()=>pending.resolve({data:status(11,3,{study_status:'affiliated'})}));
  assert.equal(label(ui,'نوع الدراسة').value,'hosted');assert.match(ui.container.textContent,/المراجعة 4/);
});
test('tenant change discards pending saves and does not refresh grades for old student',async t=>{
  const pending=deferred();let refreshed=0;
  const ui=await mount(t,{saveStatus:async()=>pending.promise,onSaved:()=>refreshed++});
  await input(label(ui,'نوع الدراسة'),'hosted');await input(label(ui,'سبب التغيير'),'حفظ');await submit(ui);
  await ui.render({student:student(22,2),schoolId:2});
  await act(async()=>pending.resolve({data:status(11,3,{study_status:'hosted',revision:1})}));
  assert.equal(refreshed,0);assert.equal(label(ui,'نوع الدراسة').value,'regular');assert.match(ui.container.textContent,/المراجعة 0/);
});
test('parents and teachers never request private annual settings; registrar reads without write controls',async t=>{
  let reads=0;
  const ui=await mount(t,{role:'parent',loadStatus:async()=>{reads++;return {data:status()};}});
  assert.equal(reads,0);assert.equal(ui.container.querySelector('form'),null);
  await ui.render({role:'teacher'});assert.equal(reads,0);
  await ui.render({role:'registrar'});assert.equal(reads,1);assert.ok(ui.container.querySelector('fieldset').disabled);
  assert.equal([...ui.container.querySelectorAll('button')].some(item=>item.textContent==='حفظ الوضع الدراسي'),false);
});
test('stale identity exception is explained and re-verification is required before saving',async t=>{
  const exception={reference:'كتاب 7',document_date:'2026-09-01',authority:'المديرية',reason:'استثناء رسمي',class_id:4,birth_date:'2011-01-01',gender:'male',verified_by_user_id:1,verified_at:1};const writes=[];
  const ui=await mount(t,{loadStatus:async()=>({data:status(11,3,{age_exception:exception,revision:2})}),saveStatus:async(id,input)=>{writes.push(input);return {data:status(id,3,{...input,revision:3})};}});
  assert.match(ui.container.textContent,/لا يطابق الصف أو بيانات الميلاد/);await input(label(ui,'سبب التغيير'),'إعادة مطابقة الميلاد');await submit(ui);assert.equal(writes.length,0);
  await click(label(ui,'راجعت الكتاب'));await submit(ui);assert.equal(writes[0].confirm_age_exception_verified,true);
});

function roster(count=55){return {school:{id:1,name:'مدرسة الاختبار'},academic_year:{id:3,name:'2026-2027',is_active:1},rows:[status(1,3,{age_exception:{reason:'سر استثناء لا يطبع',reference:'مرجع خاص'}})],roster:Array.from({length:count},(_,i)=>({student_id:i+1,student_number:`ST-${i+1}`,full_name:`طالب ${i+1} ذو اسم طويل للاختبار`,class_id:4,class_name:'الأول المتوسط',section_id:8,section_name:'أ',study_status:i%3===0?'affiliated':i%3===1?'hosted':'regular',grades_visible:i%2===0,phone:'07000000000',grade:98}))};}
test('multi-page roster retains hidden-grade students and omits grades, contacts and exception evidence',async t=>{
  const data=roster();const container=document.createElement('div');document.body.append(container);const app=createRoot(container);
  await act(async()=>app.render(createElement(StudentRosterDocument,{summary:data})));t.after(async()=>{await act(async()=>app.unmount());container.remove();});
  assert.equal(container.querySelectorAll('.student-roster-row').length,55);assert.equal(container.querySelectorAll('.staff-document-page').length,3);
  assert.doesNotMatch(container.textContent,/سر استثناء|مرجع خاص|07000000000/);assert.match(container.textContent,/انتساب/);assert.match(container.textContent,/استضافة/);
  assert.equal(filterStudentRoster(data.roster,{study_status:'affiliated'}).length,19);
  assert.equal(filterStudentRoster(data.roster,{q:'ST-2',class_id:4}).length,11);
});
test('empty annual roster is a valid empty state and no print action is offered',async t=>{
  const container=document.createElement('div');document.body.append(container);const app=createRoot(container);
  await act(async()=>app.render(createElement(StudentRosterPreview,{schoolId:1,academicYearId:3,loadRoster:async()=>({data:roster(0)})})));t.after(async()=>{await act(async()=>app.unmount());container.remove();});
  assert.match(container.textContent,/لا توجد تسجيلات نشطة/);assert.doesNotMatch(container.textContent,/طباعة \/ حفظ PDF/);
});
test('roster scope change rejects a late old-school response',async t=>{
  const pending=deferred(),container=document.createElement('div');document.body.append(container);const app=createRoot(container);
  const loadRoster=async scope=>scope.school_id===1?pending.promise:{data:{...roster(2),school:{id:2,name:'المدرسة الجديدة'}}};
  await act(async()=>app.render(createElement(StudentRosterPreview,{schoolId:1,academicYearId:3,loadRoster})));
  await act(async()=>app.render(createElement(StudentRosterPreview,{schoolId:2,academicYearId:3,loadRoster})));
  await act(async()=>pending.resolve({data:roster(55)}));
  assert.match(container.textContent,/المدرسة الجديدة/);assert.doesNotMatch(container.textContent,/مدرسة الاختبار/);assert.equal(container.querySelectorAll('.student-roster-row').length,2);
  t.after(async()=>{await act(async()=>app.unmount());container.remove();});
});
async function mountDirectory(t,role='school_owner'){
  localStorage.clear();sessionStorage.clear();const calls=[];
  globalThis.fetch=async url=>{const path=String(url).split('?')[0];calls.push(path);let data;
    if(path==='/api/auth/me')data={id:1,school_id:1,role_key:role,full_name:'اختبار'};
    else if(path==='/api/students')data=roster(3).roster.map(row=>({...row,id:row.student_id,school_id:1,status:'active',gender:'male'}));
    else if(path==='/api/classes')data=[{id:4,name:'الأول المتوسط'}];
    else if(path==='/api/sections')data=[{id:8,class_id:4,name:'أ'}];
    else if(path==='/api/academic-years')data=years(1);
    else if(path==='/api/student-study-status')data={...roster(3),rows:[status(1,3,{study_status:'affiliated',grades_visible:false}),status(2,3,{study_status:'hosted'})]};
    else throw new Error('Unexpected '+path);
    return new Response(JSON.stringify({data,csrf_token:'a'.repeat(64)}),{headers:{'Content-Type':'application/json'}});
  };
  const container=document.createElement('div');document.body.append(container);const app=createRoot(container);
  await act(async()=>app.render(createElement(AuthProvider,null,createElement(MemoryRouter,null,createElement(StudentsPage)))));
  t.after(async()=>{await act(async()=>app.unmount());container.remove();});return {container,calls};
}
test('directory shows annual badges, filters designation and retains hidden-grade students',async t=>{
  const ui=await mountDirectory(t);assert.equal(ui.container.querySelectorAll('tbody tr').length,3);assert.match(ui.container.textContent,/الدرجات مخفية/);
  await input(ui.container.querySelector('[aria-label="تصفية نوع الدراسة"]'),'affiliated');assert.equal(ui.container.querySelectorAll('tbody tr').length,1);assert.match(ui.container.querySelector('tbody').textContent,/طالب 1/);
  const print=[...ui.container.querySelectorAll('a')].find(item=>item.textContent==='معاينة قائمة التوزيع');assert.match(print.getAttribute('href'),/academic_year_id=3/);assert.match(print.getAttribute('href'),/study_status=affiliated/);
  await input(ui.container.querySelector('[aria-label="تصفية نوع الدراسة"]'),'regular');assert.equal(ui.container.querySelectorAll('tbody tr').length,1);assert.match(ui.container.querySelector('tbody').textContent,/طالب 3/);
});
test('teacher directory does not request private status list or render management filter',async t=>{
  const ui=await mountDirectory(t,'teacher');assert.equal(ui.calls.includes('/api/student-study-status'),false);assert.equal(ui.container.querySelector('[aria-label="تصفية نوع الدراسة"]'),null);assert.equal(ui.container.querySelectorAll('tbody tr').length,3);
});
