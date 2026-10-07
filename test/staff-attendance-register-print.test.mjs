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
const {StaffAttendanceDocument,StaffAttendancePreview,validAttendancePrintDate}=await vite.ssrLoadModule('/src/modules/print/PrintStaffAttendancePage.tsx');
after(async()=>{await vite.close();await window.happyDOM.close();});
function fixture(schoolId=1,count=28){
  const employees=Array.from({length:count},(_,i)=>({id:i+1,school_id:schoolId,full_name:`مدرس ${schoolId} ${i+1}`,primary_qualification:{general_specialization:'فيزياء'},role:'teacher',status:'active'}));
  return {date:'2026-10-06',roster:{school:{id:schoolId,name:`مدرسة ${schoolId}`,name_en:'School',logo_url:`/school-${schoolId}.png`},prepared_at:1791234000,document_settings:{official_book_layout:null,use_arabic_indic_digits:false,date_format:'dd/MM/yyyy',currency:'IQD'},filters:{status:'active',q:'',role:''},employees,can_view_private:true},rows:employees.map(e=>({employee_id:e.id,employee_name:e.full_name,employee_role:'teacher',employee_number:null,job_title:'مدرس',attendance_date:'2026-10-06',first_entry_at:1791262800,last_exit_at:null,entry_count:1,exit_count:0,late_entries:0,early_exits:0,late_minutes:0,day_state:'inside'}))};
}
async function mount(t,Component,props){const container=document.createElement('div');document.body.append(container);const root=createRoot(container);await act(async()=>root.render(createElement(Component,props)));t.after(async()=>{await act(async()=>root.unmount());container.remove();});return {container,async render(patch){props={...props,...patch};await act(async()=>root.render(createElement(Component,props)));}};}
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};

test('print preserves all staff, repeated school logo and blank signature cells',async t=>{
  const data=fixture();const u=await mount(t,StaffAttendanceDocument,{data});
  assert.equal(u.container.querySelectorAll('.staff-document-page').length,3);
  assert.equal(u.container.querySelectorAll('img[src="/school-1.png"]').length,3);
  assert.equal(u.container.querySelectorAll('tbody tr').length,28);
  assert.equal(u.container.querySelectorAll('.attendance-signature').length,56);
  for(const cell of u.container.querySelectorAll('.attendance-signature')) assert.equal(cell.textContent,'');
  assert.match(u.container.textContent,/عدم وجود حركة لا يثبت الغياب/);
  assert.match(u.container.textContent,/فيزياء/);
  await u.render({blank:true});
  for(const row of u.container.querySelectorAll('tbody tr')) {assert.equal(row.cells[3].textContent,'');assert.equal(row.cells[5].textContent,'');}
});

test('late responses and failure cannot expose another school print snapshot',async t=>{
  const oldRoster=deferred(),oldSummary=deferred(),data=fixture(2,1);
  const loadRoster=id=>id===1?oldRoster.promise:Promise.resolve({data:data.roster});
  const loadSummary=id=>id===1?oldSummary.promise:Promise.resolve({data:data.rows});
  const loadYears=async id=>({data:[{id:1,school_id:id,name:'2026–2027',starts_at:'2026-09-01',ends_at:'2027-06-30'}]});
  const u=await mount(t,StaffAttendancePreview,{schoolId:1,initialDate:'2026-10-06',loadRoster,loadSummary,loadYears});
  await u.render({schoolId:2});
  assert.match(u.container.textContent,/مدرس 2 1/);
  await act(async()=>{const old=fixture(1,1);oldRoster.resolve({data:old.roster});oldSummary.resolve({data:old.rows});});
  assert.doesNotMatch(u.container.textContent,/مدرس 1 1/);
  await u.render({schoolId:null});
  assert.equal(u.container.querySelector('.staff-attendance-document'),null);
});

test('calendar validation rejects normalized invalid dates',()=>{
  assert.equal(validAttendancePrintDate('2026-02-30'),false);
  assert.equal(validAttendancePrintDate('2024-02-29'),true);
  assert.equal(validAttendancePrintDate('2026-2-9'),false);
});
