import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
const window=new Window({url:'http://localhost'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLSelectElement','Node','Event','MouseEvent','KeyboardEvent','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?window:window[key]});
globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createElement,act}=await import('react'),{createRoot}=await import('react-dom/client');
const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,appType:'custom',optimizeDeps:{noDiscovery:true,include:[]},esbuild:{jsx:'automatic'},ssr:{noExternal:['react-router-dom','react-router'],resolve:{conditions:['module','browser','development']}},server:{middlewareMode:true,hmr:false}});
const {default:SystemHealthPage}=await vite.ssrLoadModule('/src/modules/systemHealth/SystemHealthPage.tsx');
const nav=await vite.ssrLoadModule('/src/components/navigation.tsx');
after(async()=>{await vite.close();await window.happyDOM.close();});
const flush=()=>act(async()=>{for(let i=0;i<5;i++)await new Promise(r=>setTimeout(r,0));});
const button=(container,text)=>[...container.querySelectorAll('button')].find(b=>b.textContent.includes(text));
async function mount(t){const container=document.createElement('div');document.body.append(container);const root=createRoot(container);await act(async()=>root.render(createElement(SystemHealthPage)));t.after(async()=>{await act(async()=>root.unmount());container.remove();});await flush();return container;}
function serve(t,{configured=false,errors=[]}={}){const calls=[];const original=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{const path=String(url);calls.push({path,method:init.method||'GET'});
    const body=path.startsWith('/api/system/health')?{data:{environment:'staging',database:{status:'ok',latency_ms:12},migrations:{applied:63,last:'0062_system_error_events.sql'},errors_24h:errors.length?3:0,errors_7d:errors.length?5:0,telegram_configured:configured,checked_at:'2026-11-15T10:00:00Z'}}
      :path.startsWith('/api/system/errors')?{data:errors}:{data:{sent:true}};
    return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});};
  t.after(()=>{globalThis.fetch=original;});return calls;}

test('the health page is linked from the schools page, not added to the five-item admin menu group',async()=>{
  assert.ok(!nav.getVisibleNavigationItems('system_admin').some(item=>item.path==='/system-health'));
  const source=await (await import('node:fs/promises')).readFile(new URL('../src/modules/schools/SchoolsPage.tsx',import.meta.url),'utf8');
  assert.ok(source.includes('to="/system-health"'));
});

test('a quiet system shows database, migrations and an empty error list; the test button needs Telegram',async t=>{
  serve(t);const c=await mount(t);
  assert.match(c.textContent,/قاعدة البيانات/);assert.match(c.textContent,/0062_system_error_events\.sql/);
  assert.match(c.textContent,/غير مهيأة/);assert.match(c.textContent,/ماكو أخطاء خادم/);
  assert.equal(button(c,'إرسال رسالة اختبار').disabled,true);
});

test('grouped errors are listed with their route, count and schools, and periods reload the list',async t=>{
  const calls=serve(t,{configured:true,errors:[{fingerprint:'f1',method:'GET',route:'/api/treasury/categories',status:500,error_name:'Error',error_message:'no such table',occurrences:3,first_seen:1794700000,last_seen:1794740000,schools:1}]});
  const c=await mount(t);
  assert.match(c.textContent,/GET \/api\/treasury\/categories/);assert.match(c.textContent,/no such table/);
  assert.ok(c.querySelector('.overflow-x-auto table'),'the table scrolls instead of widening the page on phones');
  await act(async()=>button(c,'آخر 30 يوم').click());await flush();
  assert.ok(calls.some(call=>call.path==='/api/system/errors?days=30'));
  await act(async()=>button(c,'إرسال رسالة اختبار').click());await flush();
  assert.ok(calls.some(call=>call.path==='/api/system/alerts/test'&&call.method==='POST'));
  assert.match(c.textContent,/وصلت رسالة الاختبار/);
});
