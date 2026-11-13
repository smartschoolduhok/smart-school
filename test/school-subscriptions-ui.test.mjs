import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
const window=new Window({url:'http://localhost'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','Node','Event','MouseEvent','KeyboardEvent','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?window:window[key]});
globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createElement,act}=await import('react'),{createRoot}=await import('react-dom/client');
const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,appType:'custom',optimizeDeps:{noDiscovery:true,include:[]},esbuild:{jsx:'automatic'},ssr:{noExternal:['react-router-dom','react-router'],resolve:{conditions:['module','browser','development']}},server:{middlewareMode:true,hmr:false}});
const nav=await vite.ssrLoadModule('/src/components/navigation.tsx');
const {default:SubscriptionBanner}=await vite.ssrLoadModule('/src/components/SubscriptionBanner.tsx');
const {default:SchoolSubscriptionDialog}=await vite.ssrLoadModule('/src/modules/schools/SchoolSubscriptionDialog.tsx');
const {SCHOOL_MODULE_KEYS}=await vite.ssrLoadModule('/src/lib/schoolSubscriptions.ts');
after(async()=>{await vite.close();await window.happyDOM.close();});
async function mount(t,Component,props){const container=document.createElement('div');document.body.append(container);const root=createRoot(container);await act(async()=>root.render(createElement(Component,props)));t.after(async()=>{await act(async()=>root.unmount());container.remove();});return {container};}
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,0));});
const button=(u,text)=>[...u.container.querySelectorAll('button')].find(b=>b.textContent.includes(text));
const access=patch=>({school_id:1,plan_key:'full',status:'active',ends_on:null,state:'active',days_left:null,read_only_from:null,modules:[...SCHOOL_MODULE_KEYS],...patch});

test('navigation hides disabled modules but keeps core pages and leaves the admin unrestricted',()=>{
  const paths=modules=>nav.getVisibleNavigationItems('school_owner',modules).map(item=>item.path);
  const full=paths(undefined),basic=paths(['grades','official_documents']);
  for (const path of ['/timetable','/fees','/transport','/staff-attendance']) {assert.ok(full.includes(path),path);assert.ok(!basic.includes(path),path);}
  for (const path of ['/','/students','/classes','/subjects','/employees','/grades','/official-books','/settings']) assert.ok(basic.includes(path),path);
  assert.ok(nav.getVisibleNavigationItems('system_admin',null).some(item=>item.path==='/schools'));
  assert.equal(nav.getNavigationLocation('/timetable','school_owner',['grades']).group,null);
  assert.ok(!nav.getDailyNavigationItems('school_owner',['grades']).some(item=>item.path==='/timetable'));
});

test('banner warns before the end, during grace and when read-only, and stays hidden otherwise',async t=>{
  assert.equal((await mount(t,SubscriptionBanner,{subscription:access()})).container.textContent,'');
  assert.equal((await mount(t,SubscriptionBanner,{subscription:null})).container.textContent,'');
  assert.equal((await mount(t,SubscriptionBanner,{subscription:access({ends_on:'2027-06-30',days_left:40})})).container.textContent,'');
  assert.match((await mount(t,SubscriptionBanner,{subscription:access({ends_on:'2027-06-30',days_left:5})})).container.textContent,/ينتهي اشتراك المدرسة بعد 5 يوم/);
  const grace=await mount(t,SubscriptionBanner,{subscription:access({state:'grace',ends_on:'2027-06-30',days_left:9})});
  assert.match(grace.container.textContent,/الاطلاع فقط بعد 9 يوم/);assert.equal(grace.container.querySelector('[role="status"]')!=null,true);
  const locked=await mount(t,SubscriptionBanner,{subscription:access({state:'read_only',days_left:0})});
  assert.ok(locked.container.querySelector('[role="alert"]'));assert.match(locked.container.textContent,/الاطلاع والطباعة فقط/);
  assert.match((await mount(t,SubscriptionBanner,{subscription:access({state:'read_only',status:'suspended'})})).container.textContent,/موقوف/);
});

function details(patch={}){return {subscription:{school_id:1,plan_key:'basic',status:'active',starts_on:null,ends_on:'2027-06-30',grace_days:14,max_students:300,notes:null,revision:3,...patch},overrides:{},modules:['grades','official_documents'],access:{state:'active',days_left:200,read_only_from:'2027-07-15'},active_students:120,audit:[],
  catalog:{modules:SCHOOL_MODULE_KEYS.map(key=>({key,label:key})),plans:[{key:'basic',label:'الأساسية',modules:['grades','official_documents']},{key:'standard',label:'المتقدمة',modules:['grades','official_documents','timetable','attendance','homework','communication','admissions']},{key:'full',label:'الكاملة',modules:[...SCHOOL_MODULE_KEYS]}]}};}

test('subscription dialog saves plan, dates, cap and module exceptions with the loaded revision',async t=>{
  const requests=[];
  globalThis.fetch=async(url,init={})=>{requests.push({url:String(url),method:init.method||'GET',body:init.body?JSON.parse(init.body):null});
    return new Response(JSON.stringify({data:init.method==='PUT'?details({revision:4}):details()}),{status:200,headers:{'Content-Type':'application/json'}});};
  t.after(()=>{delete globalThis.fetch;});
  const u=await mount(t,SchoolSubscriptionDialog,{school:{id:1,name:'المنار'},onClose:()=>{}});await flush();
  assert.match(u.container.textContent,/الطلاب النشطون: ١٢٠ من ٣٠٠/);
  const timetable=[...u.container.querySelectorAll('label')].find(label=>label.textContent.includes('timetable')).querySelector('input');
  assert.equal(timetable.checked,false);
  await act(async()=>timetable.click());
  assert.match(u.container.textContent,/استثناء/);
  await act(async()=>button(u,'حفظ الاشتراك').click());await flush();
  const put=requests.find(r=>r.method==='PUT');
  assert.equal(put.url,'/api/schools/1/subscription');
  assert.deepEqual({plan:put.body.plan_key,ends:put.body.ends_on,cap:put.body.max_students,grace:put.body.grace_days,overrides:put.body.overrides,revision:put.body.expected_revision},
    {plan:'basic',ends:'2027-06-30',cap:300,grace:14,overrides:{timetable:true},revision:3});
  assert.match(u.container.textContent,/تم حفظ الاشتراك/);
});

test('changing the plan clears module exceptions and a stale save reloads the latest version',async t=>{
  let puts=0;
  globalThis.fetch=async(url,init={})=>{if(init.method==='PUT'){puts++;return new Response(JSON.stringify({error:'تغيّر الاشتراك من مستخدم آخر',code:'subscription_stale'}),{status:409,headers:{'Content-Type':'application/json'}});}
    return new Response(JSON.stringify({data:details({revision:puts?5:3})}),{status:200,headers:{'Content-Type':'application/json'}});};
  t.after(()=>{delete globalThis.fetch;});
  const u=await mount(t,SchoolSubscriptionDialog,{school:{id:1,name:'المنار'},onClose:()=>{}});await flush();
  const plan=u.container.querySelector('select');
  await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set.call(plan,'full');plan.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.ok([...u.container.querySelectorAll('input[type="checkbox"]')].every(box=>box.checked));
  await act(async()=>button(u,'حفظ الاشتراك').click());await flush();await flush();
  assert.equal(puts,1);assert.match(u.container.textContent,/تغيّر الاشتراك/);
});
