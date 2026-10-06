import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {emptyStaffDossier} from '../src/lib/staffDossier.ts';
const window=new Window({url:'http://localhost'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLImageElement','Node','Event','MouseEvent','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?window:window[key]});
globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createElement,act}=await import('react'),{createRoot}=await import('react-dom/client');
const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,appType:'custom',optimizeDeps:{noDiscovery:true,include:[]},esbuild:{jsx:'automatic'},ssr:{noExternal:['react-router-dom','react-router'],resolve:{conditions:['module','browser','development']}},server:{middlewareMode:true,hmr:false}});
const {StaffDossierEditor}=await vite.ssrLoadModule('/src/modules/employees/StaffDossierPage.tsx');
const {StaffDossierDocument}=await vite.ssrLoadModule('/src/components/staffDocuments/StaffDossierDocument.tsx');
after(async()=>{await vite.close();await window.happyDOM.close();});
function fixture(school=1){return {profile:{employee:{id:1,school_id:school,full_name:'مدرس تجريبي '+school,employee_number:'E1',role:'teacher',job_title:'مدرس',salary_amount:500000,address:'العنوان',phone:'123',has_photo:true,photo_updated_at:7,hire_date:null,commencement_date:null},document_settings:{use_arabic_indic_digits:false,date_format:'dd/MM/yyyy',currency:'IQD'},can_view_private:true,can_manage:true,qualifications:[],academic_year:null},dossier:{employee_id:1,school_id:school,school_name:'مدرسة '+school,logo_url:'/logo-'+school+'.svg',version:0,updated_at:null,qualification_links:[],data:emptyStaffDossier()}};}
async function mount(t,Component,props){const container=document.createElement('div');document.body.append(container);const root=createRoot(container);await act(async()=>root.render(createElement(Component,props)));t.after(async()=>{await act(async()=>root.unmount());container.remove();});return{container,async render(patch){props={...props,...patch};await act(async()=>root.render(createElement(Component,props)));}};}
const button=(u,text)=>[...u.container.querySelectorAll('button')].find(b=>b.textContent.includes(text));
async function click(b){assert.ok(b);await act(async()=>b.click());}
async function input(el,value){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));});}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
test('editor loads original profile and blank unknowns; save uses version and enables saved preview',async t=>{
  const f=fixture(),writes=[];const u=await mount(t,StaffDossierEditor,{schoolId:1,employeeId:1,role:'principal',loadProfile:async()=>({data:f.profile}),loadDossier:async()=>({data:f.dossier}),saveDossier:async(id,school,version,data)=>{writes.push({id,school,version,data});return{data:{...f.dossier,version:1,data}};}});
  assert.equal(u.container.querySelector('input[name="birth_date"]').value,'');
  assert.equal(u.container.querySelector('select[name="blood_group"]').getAttribute('dir'),'ltr');assert.equal(u.container.querySelector('select[name="marital_status"]').getAttribute('dir'),null);
  await input(u.container.querySelector('input[name="mother_name"]'),'اسم الأم');await click(button(u,'حفظ'));
  assert.equal(writes.length,1);assert.equal(writes[0].version,0);assert.equal(writes[0].data.mother_name,'اسم الأم');assert.equal('full_name' in writes[0].data,false);
  await click(button(u,'معاينة'));assert.ok(u.container.querySelector('.staff-dossier-document'));assert.equal(button(u,'طباعة').disabled,false);
  assert.equal(u.container.querySelector('.dossier-school-logo').getAttribute('src'),'/logo-1.svg');assert.match(u.container.querySelector('.dossier-portrait').getAttribute('src'),/school_id=1/);
});
test('scope changes clear data immediately and late old requests never expose previous school',async t=>{
  const a=fixture(1),b=fixture(2),late=deferred();const u=await mount(t,StaffDossierEditor,{schoolId:1,employeeId:1,role:'principal',loadProfile:async(_,{school_id})=>school_id===1?late.promise:{data:b.profile},loadDossier:async(_,school)=>({data:school===1?a.dossier:b.dossier})});
  await u.render({schoolId:2});await act(async()=>late.resolve({data:a.profile}));
  assert.match(u.container.textContent,/مدرس تجريبي 2/);assert.doesNotMatch(u.container.textContent,/مدرس تجريبي 1/);
  await u.render({role:'accountant'});assert.doesNotMatch(u.container.textContent,/مدرس تجريبي/);assert.equal(u.container.querySelector('input'),null);
});
test('stale save error preserves draft, and unsaved preview cannot print',async t=>{
  const f=fixture(),u=await mount(t,StaffDossierEditor,{schoolId:1,employeeId:1,role:'principal',loadProfile:async()=>({data:f.profile}),loadDossier:async()=>({data:f.dossier}),saveDossier:async()=>({error:'تم تعديل السجل في جلسة أخرى'})});
  await input(u.container.querySelector('input[name="mother_name"]'),'مسودة محفوظة محلياً');await click(button(u,'حفظ'));assert.match(u.container.textContent,/جلسة أخرى/);assert.equal(u.container.querySelector('input[name="mother_name"]').value,'مسودة محفوظة محلياً');
  await click(button(u,'معاينة'));assert.equal(button(u,'طباعة').disabled,true);assert.match(u.container.textContent,/معاينة غير محفوظة/);
});
test('section navigation exposes matching history counts; invalid row identifies its section and preserves all data',async t=>{
  const f=fixture();f.dossier.data.history.courses=[{date:null,title:'دورة موجودة',reference:null,notes:null}];let writes=0;
  const u=await mount(t,StaffDossierEditor,{schoolId:1,employeeId:1,role:'principal',loadProfile:async()=>({data:f.profile}),loadDossier:async()=>({data:f.dossier}),saveDossier:async()=>{writes++;return{data:f.dossier};}});
  const links=u.container.querySelectorAll('nav[aria-label="أقسام سجل جماعة المدرسين"] a');assert.equal(links.length,9);for(const link of links)assert.ok(u.container.querySelector(link.getAttribute('href')));
  assert.equal(u.container.querySelector('a[href="#dossier-courses"] b').textContent,'1');
  await click(u.container.querySelector('#dossier-courses button'));
  assert.equal(u.container.querySelector('a[href="#dossier-courses"] b').textContent,'2');await click(button(u,'حفظ'));
  assert.equal(writes,0);assert.match(u.container.querySelector('[role="alert"]').textContent,/الدورات، القيد 2/);assert.equal(document.activeElement,u.container.querySelector('[role="alert"]'));
  assert.equal(u.container.querySelector('#dossier-courses input').value,'دورة موجودة');assert.equal(u.container.querySelectorAll('#dossier-courses .dossier-history-editor').length,2);
});
test('print contains every long history row, original photo and section rows; blood group stays LTR',async t=>{
  const f=fixture();f.dossier.data.blood_group='B+';f.dossier.data.history.courses=Array.from({length:50},(_,i)=>({title:'الدورة الفريدة '+i,date:null,reference:'REF-'+i,notes:'نص طويل '.repeat(100)}));f.dossier.data.notes='ختام الملاحظات '.repeat(100);
  const before=structuredClone(f),u=await mount(t,StaffDossierDocument,f);
  assert.equal(u.container.querySelectorAll('.dossier-history')[0].querySelectorAll('tbody tr').length,50);assert.match(u.container.textContent,/الدورة الفريدة 49/);assert.match(u.container.textContent,/ختام الملاحظات/);
  assert.ok(u.container.querySelector('.dossier-page-flow > thead .dossier-school-logo'));assert.equal(u.container.querySelectorAll('.dossier-page-flow > tbody > tr').length,10);
  const bloodGroup=Array.from(u.container.querySelectorAll('.dossier-pair')).find(pair=>pair.querySelector('dt').textContent==='فصيلة الدم').querySelector('bdi');assert.equal(bloodGroup.getAttribute('dir'),'ltr');assert.equal(bloodGroup.textContent,'B+');assert.deepEqual(f,before);
  const logo=u.container.querySelector('.dossier-school-logo');await act(async()=>logo.dispatchEvent(new window.Event('error')));assert.match(u.container.querySelector('.dossier-school-logo').textContent,/تعذر تحميل/);
});
