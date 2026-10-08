import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const window = new Window({url:'http://localhost'});
for (const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLImageElement','Node','Event','MouseEvent','localStorage','sessionStorage']) {
  Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?window:window[key]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createElement,act}=await import('react');
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,appType:'custom',optimizeDeps:{noDiscovery:true,include:[]},esbuild:{jsx:'automatic'},ssr:{noExternal:['react-router-dom','react-router'],resolve:{conditions:['module','browser','development']}},server:{middlewareMode:true,hmr:false}});
const {StaffAttendanceDocument,StaffAttendancePreview}=await vite.ssrLoadModule('/src/modules/print/PrintStaffAttendancePage.tsx');
after(async()=>{await vite.close();await window.happyDOM.close();});
function fixture(schoolId=1,count=28){
  const employees=Array.from({length:count},(_,i)=>({id:i+1,school_id:schoolId,full_name:`موظف ${schoolId} ${i+1}`,primary_qualification:{general_specialization:'فيزياء'},role:i%2?'teacher':'worker',status:'active'}));
  return {roster:{school:{id:schoolId,name:`مدرسة ${schoolId}`,name_en:'School',logo_url:`/school-${schoolId}.png`},prepared_at:1791234000,document_settings:{official_book_layout:null,use_arabic_indic_digits:false,date_format:'dd/MM/yyyy',currency:'IQD'},filters:{status:'active',q:'',role:''},employees,can_view_private:true}};
}
async function mount(t,Component,props){const container=document.createElement('div');document.body.append(container);const root=createRoot(container);await act(async()=>root.render(createElement(Component,props)));t.after(async()=>{await act(async()=>root.unmount());container.remove();});return {container,async render(patch){props={...props,...patch};await act(async()=>root.render(createElement(Component,props)));}};}
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};

test('paper register keeps all active staff roles and leaves every daily field blank',async t=>{
  const data=fixture();const u=await mount(t,StaffAttendanceDocument,{roster:data.roster});
  assert.equal(u.container.querySelectorAll('.staff-document-page').length,1);
  assert.equal(u.container.querySelectorAll('tbody tr').length,28);
  assert.match(u.container.textContent,/اليوم:/);
  assert.match(u.container.textContent,/التاريخ:/);
  assert.doesNotMatch(u.container.textContent,/2026|تاريخ الإعداد|فيزياء|عدم وجود حركة/);
  for(const row of u.container.querySelectorAll('tbody tr')) {
    for(const cell of [...row.cells].slice(2)) assert.equal(cell.textContent,'');
  }
  assert.equal(u.container.querySelectorAll('.attendance-signature').length,56);
  assert.deepEqual([...u.container.querySelectorAll('tbody th')].map(cell=>cell.textContent),data.roster.employees.map(person=>person.full_name));
});

test('overflow pages preserve every name and repeat school identity and blank date',async t=>{
  const data=fixture(1,61);const u=await mount(t,StaffAttendanceDocument,{roster:data.roster});
  assert.equal(u.container.querySelectorAll('.staff-document-page').length,3);
  assert.equal(u.container.querySelectorAll('img[src="/school-1.png"]').length,3);
  assert.equal(u.container.querySelectorAll('tbody tr').length,61);
  assert.deepEqual([...u.container.querySelectorAll('tbody tr')].map(row=>Number(row.cells[0].textContent)),Array.from({length:61},(_,i)=>i+1));
  for(const page of u.container.querySelectorAll('.staff-document-page')) assert.match(page.textContent,/اليوم:.*التاريخ:/);
});

test('late responses and failure cannot expose another school print snapshot',async t=>{
  const oldRoster=deferred(),data=fixture(2,1);
  const loadRoster=id=>id===1?oldRoster.promise:Promise.resolve({data:data.roster});
  const u=await mount(t,StaffAttendancePreview,{schoolId:1,loadRoster});
  await u.render({schoolId:2});
  assert.match(u.container.textContent,/موظف 2 1/);
  await act(async()=>{oldRoster.resolve({data:fixture(1,1).roster});});
  assert.doesNotMatch(u.container.textContent,/موظف 1 1/);
  await u.render({schoolId:null});
  assert.equal(u.container.querySelector('.staff-attendance-document'),null);
});

test('preview uses active roster without requesting dated attendance and hides failed or mismatched results',async t=>{
  const requests=[];
  const u=await mount(t,StaffAttendancePreview,{schoolId:1,loadRoster:async(id,filters)=>{requests.push({id,filters});return {data:fixture(1,1).roster};}});
  assert.deepEqual(requests,[{id:1,filters:{status:'active'}}]);
  assert.equal(u.container.querySelector('input[type="date"]'),null);
  assert.equal(u.container.querySelectorAll('.attendance-time').length,2);
  await u.render({loadRoster:async()=>({error:'تعذر الاتصال'})});
  assert.equal(u.container.querySelector('.staff-attendance-document'),null);
  assert.match(u.container.querySelector('[role="alert"]').textContent,/تعذر الاتصال/);
  const wrongRoster=fixture(1,1).roster;wrongRoster.employees[0].school_id=2;
  await u.render({loadRoster:async()=>({data:wrongRoster})});
  assert.equal(u.container.querySelector('.staff-attendance-document'),null);
  assert.ok(u.container.querySelector('[role="alert"]'));
  await u.render({loadRoster:async()=>({data:fixture(1,0).roster})});
  assert.equal(u.container.querySelector('.staff-attendance-document'),null);
  assert.match(u.container.textContent,/لا يوجد كادر/);
});
