import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {createServer} from 'vite';
import {fixture, root, secret, tokens} from './helpers/school-workflow-fixture.mjs';
import {errorFingerprint, errorRecord, isTelegramConfigured, normalizeRoute, sanitizeErrorMessage, telegramAlertText} from '../src/lib/systemHealth.ts';

const vite = await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app} = await vite.ssrLoadModule('/src/worker.ts');
const {recordServerError} = await vite.ssrLoadModule('/src/lib/systemHealthDb.ts');
after(()=>vite.close());

const TELEGRAM={TELEGRAM_BOT_TOKEN:'123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',TELEGRAM_CHAT_ID:'-1001234567890'};
const flush=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setTimeout(r,0));};
async function call(f,role,method,path,{body,env={}}={}) {
  const headers={'Content-Type':'application/json',...(role?{Authorization:`Bearer ${tokens[role]}`}:{})};
  const r=await app.request(`http://localhost${path}`,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test',...env});
  const json=await r.json();await flush();
  return {status:r.status,...json};
}
function stubTelegram(t,ok=true){const sent=[];const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{sent.push({url:String(url),body:JSON.parse(init.body)});return new Response('{}',{status:ok?200:401});};t.after(()=>{globalThis.fetch=original;});return sent;}
const events=f=>f.db.prepare('SELECT * FROM system_error_events ORDER BY id').all();
// A real 500: the route's table is gone.
const breakTreasury=f=>f.db.exec('DROP TABLE treasury_categories');

test('routes group by shape and error text never carries quoted values or long numbers',async()=>{
  assert.equal(normalizeRoute('/api/students/101/grades?x=1'),'/api/students/:id/grades');
  assert.equal(normalizeRoute('/api/verify/result-card/abcdefghijklmnopqrstuvwxyz123'),'/api/verify/result-card/:token');
  assert.equal(normalizeRoute('/api/x/0b5e1d6a-9c1f-4c7e-8d2a-1f2e3d4c5b6a'),'/api/x/:id');
  assert.equal(sanitizeErrorMessage("UNIQUE constraint failed: students.student_number 'S-1001' phone 07701234567"),"UNIQUE constraint failed: students.student_number '…' phone #");
  assert.equal(sanitizeErrorMessage(null),null);
  assert.equal(sanitizeErrorMessage('x'.repeat(900)).length,500);
  const a=errorRecord({method:'get',path:'/api/students/1',status:500,error:new TypeError('bad 12')});
  const b=errorRecord({method:'GET',path:'/api/students/2',status:500,error:new TypeError('bad 99')});
  assert.equal(a.method,'GET');assert.equal(a.error_name,'TypeError');
  assert.equal(await errorFingerprint(a),await errorFingerprint(b),'different ids are the same error');
  assert.notEqual(await errorFingerprint(a),await errorFingerprint({...a,status:503}));
  const text=telegramAlertText({...a,school_id:3},{environment:'staging',recentCount:4,at:new Date('2026-11-15T10:00:00Z')});
  assert.match(text,/GET \/api\/students\/:id → 500/);assert.match(text,/المدرسة: 3/);assert.match(text,/تكرر 4 مرة/);
  assert.equal(isTelegramConfigured(TELEGRAM),true);
  assert.equal(isTelegramConfigured({TELEGRAM_BOT_TOKEN:'nope',TELEGRAM_CHAT_ID:'1'}),false);
  assert.equal(isTelegramConfigured({TELEGRAM_BOT_TOKEN:TELEGRAM.TELEGRAM_BOT_TOKEN}),false);
});

test('the public health probe answers without a session and reveals nothing else',async t=>{
  const f=fixture(t);
  const r=await app.request('http://localhost/api/health',{},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'ok'});
  const broken={prepare(){throw new Error('D1 down');}};
  const down=await app.request('http://localhost/api/health',{},{DB:broken,JWT_SECRET:secret,APP_ENV:'test'});
  assert.equal(down.status,503);assert.deepEqual(await down.json(),{status:'error'});
  assert.equal((await call(f,null,'GET','/api/system/health')).status,401);
});

test('server errors are recorded once each without leaking details, and only the admin can read them',async t=>{
  const f=fixture(t);breakTreasury(f);
  const first=await call(f,'owner','GET','/api/treasury/categories?school_id=1');
  assert.equal(first.status,500);assert.equal(first.detail,undefined);
  await call(f,'owner','GET','/api/treasury/categories?school_id=1');
  const rows=events(f);
  assert.equal(rows.length,2);
  assert.deepEqual({method:rows[0].method,route:rows[0].route,status:rows[0].status,school:rows[0].school_id,user:rows[0].user_id},{method:'GET',route:'/api/treasury/categories',status:500,school:1,user:1});
  assert.equal(rows[0].fingerprint,rows[1].fingerprint);
  assert.equal((await call(f,'owner','GET','/api/system/errors')).status,403);
  assert.equal((await call(f,'owner','GET','/api/system/health')).status,403);
  const groups=await call(f,'admin','GET','/api/system/errors?days=1');
  assert.equal(groups.status,200);assert.equal(groups.data.length,1);
  assert.equal(groups.data[0].occurrences,2);assert.equal(groups.data[0].schools,1);assert.match(groups.data[0].error_message,/no such table/);
  assert.equal((await call(f,'admin','GET','/api/system/errors?days=99')).status,400);
  const health=await call(f,'admin','GET','/api/system/health');
  assert.equal(health.data.errors_24h,2);assert.equal(health.data.telegram_configured,false);
  assert.equal(health.data.migrations,null,'the fixture has no Wrangler migration log');
  f.db.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO d1_migrations(name) VALUES('0061_school_subscriptions.sql'),('0062_system_error_events.sql')");
  assert.deepEqual((await call(f,'admin','GET','/api/system/health')).data.migrations,{applied:2,last:'0062_system_error_events.sql'});
  assert.equal(events(f).length,2,'4xx answers are not server errors');
});

test('Telegram gets one alert per kind of error per hour, and again after the window',async t=>{
  const f=fixture(t),sent=stubTelegram(t);breakTreasury(f);
  for (let i=0;i<3;i++) await call(f,'owner','GET','/api/treasury/categories?school_id=1',{env:TELEGRAM});
  assert.equal(events(f).length,3);
  assert.equal(sent.length,1);
  assert.match(sent[0].url,/^https:\/\/api\.telegram\.org\/bot123456789:/);
  assert.equal(sent[0].body.chat_id,TELEGRAM.TELEGRAM_CHAT_ID);
  assert.match(sent[0].body.text,/GET \/api\/treasury\/categories → 500/);
  assert.doesNotMatch(sent[0].body.text,/AAAAAAAA/,'the bot token never appears in the message');
  const record=errorRecord({method:'GET',path:'/api/treasury/categories',status:500,error:new Error(events(f)[0].error_message)});
  await recordServerError({DB:f.d1,APP_ENV:'test',...TELEGRAM},{...record,error_name:events(f)[0].error_name},Math.floor(Date.now()/1000)+3601);
  assert.equal(sent.length,2);assert.match(sent[1].body.text,/تكرر|→ 500/);
});

test('a failing error log never breaks the response and alerts still go out once',async t=>{
  const f=fixture(t),sent=stubTelegram(t);breakTreasury(f);
  f.db.exec('DROP TABLE system_error_events; DROP TABLE system_alert_state;');
  const r=await call(f,'owner','GET','/api/treasury/categories?school_id=1',{env:TELEGRAM});
  assert.equal(r.status,500);assert.equal(typeof r.error,'string');assert.equal(r.detail,undefined);
  await call(f,'owner','GET','/api/treasury/categories?school_id=1',{env:TELEGRAM});
  assert.equal(sent.length,1,'memory throttle holds during an outage');
});

test('the admin can send a Telegram test message and gets a clear answer when it is not set up',async t=>{
  const f=fixture(t);
  const missing=await call(f,'admin','POST','/api/system/alerts/test',{body:{}});
  assert.equal(missing.status,400);assert.equal(missing.code,'telegram_not_configured');
  assert.equal((await call(f,'owner','POST','/api/system/alerts/test',{body:{},env:TELEGRAM})).status,403);
  const sent=stubTelegram(t);
  const ok=await call(f,'admin','POST','/api/system/alerts/test',{body:{},env:TELEGRAM});
  assert.equal(ok.status,200);assert.equal(sent.length,1);assert.match(sent[0].body.text,/اختبار تنبيهات/);
  globalThis.fetch=async()=>new Response('{}',{status:401});
  const failed=await call(f,'admin','POST','/api/system/alerts/test',{body:{},env:TELEGRAM});
  assert.equal(failed.status,502);assert.equal(failed.code,'telegram_send_failed');
});
