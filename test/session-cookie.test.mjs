import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {createServer} from 'vite';
import {financeFixture,root,snapshot} from './helpers/finance-fixture.mjs';
import {hashPassword} from '../src/lib/authSecurity.ts';
import {signJWT,decodeJwtPayloadUnsafe} from '../src/lib/jwtSecurity.ts';
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts'); after(()=>vite.close());
const secret='local-only-generated-session-test-82d059a4b12494f9';
const password='generated-local-password';
const hash=await hashPassword(password);
const origin='https://school.test';
function fixture(t){const f=financeFixture(t);f.db.prepare('UPDATE users SET password_hash=? WHERE id=1').run(hash);return f;}
async function req(f,path,{method='GET',body,headers={},url=origin,env={}}={}){
 const res=await app.fetch(new Request(url+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)}),{DB:f.d1,JWT_SECRET:secret,APP_ENV:'staging',...env});
 const json=await res.json();return {res,json};
}
async function login(f,patch={},options={}){const r=await req(f,'/api/auth/login',{method:'POST',body:{email:'owner@matrix.test',password,...patch},...options});assert.equal(r.res.status,200,JSON.stringify(r.json));return {...r,cookie:r.res.headers.get('set-cookie')?.split(';')[0],csrf:r.json.data.csrf_token};}
const auth=s=>({Cookie:s.cookie,'X-CSRF-Token':s.csrf,Origin:origin,'Sec-Fetch-Site':'same-origin'});

test('browser login sets a host-only HttpOnly Secure Strict cookie and never returns JWT',async t=>{
 const f=fixture(t),s=await login(f,{}, {headers:{Origin:origin,'Sec-Fetch-Site':'same-origin'}});
 const header=s.res.headers.get('set-cookie');assert.match(header,/^__Host-smart_school_session=/);for(const attr of ['HttpOnly','Secure','SameSite=Strict','Path=/'])assert.ok(header.includes(attr));assert.doesNotMatch(header,/Domain=|Max-Age=/i);
 assert.equal('token' in s.json.data,false);assert.match(s.csrf,/^[a-f0-9]{64}$/);assert.equal(s.res.headers.get('cache-control'),'no-store');
 const me=await req(f,'/api/auth/me',{headers:auth(s)});assert.equal(me.res.status,200);assert.equal(me.json.data.role_key,'school_owner');assert.equal(me.json.csrf_token,s.csrf);assert.equal('token' in me.json,false);
});
test('remember-me persists only until the existing eight-hour JWT expiry',async t=>{
 const f=fixture(t),s=await login(f,{remember_me:true});assert.match(s.res.headers.get('set-cookie'),/Max-Age=28800/);
 const p=decodeJwtPayloadUnsafe(s.cookie.split('=')[1]);assert.equal(p.exp-p.iat,28800);
});
test('missing, forged and previous-session CSRF tokens cause no database writes',async t=>{
 const f=fixture(t),first=await login(f),second=await login(f);assert.notEqual(first.csrf,second.csrf);
 for(const csrf of [undefined,'forged',first.csrf,'0'.repeat(64)]){
  const before=snapshot(f.db);const headers={Cookie:second.cookie,...(csrf?{'X-CSRF-Token':csrf}:{} )};const r=await req(f,'/api/auth/logout',{method:'POST',headers});
  assert.equal(r.res.status,403);assert.equal(r.json.code,'csrf_invalid');assert.deepEqual(snapshot(f.db),before);assert.equal(r.res.headers.get('set-cookie'),null);
 }
});
test('valid logout revokes the exact session and expires its cookie',async t=>{
 const f=fixture(t),s=await login(f);const r=await req(f,'/api/auth/logout',{method:'POST',headers:auth(s)});assert.equal(r.res.status,200);assert.match(r.res.headers.get('set-cookie'),/Max-Age=0/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM revoked_sessions').get().n,1);
 assert.equal((await req(f,'/api/auth/me',{headers:{Cookie:s.cookie}})).res.status,401);
});
test('untrusted origins and same-site siblings cannot use cookie sessions even when CORS allows them',async t=>{
 const f=fixture(t),s=await login(f);for(const headers of [{Origin:'https://sibling.school.test','Sec-Fetch-Site':'same-site'},{'Sec-Fetch-Site':'cross-site'},{Origin:'null'}]){
  const before=snapshot(f.db);const r=await req(f,'/api/auth/logout',{method:'POST',headers:{...auth(s),...headers},env:{ALLOWED_ORIGINS:'https://sibling.school.test'}});assert.equal(r.res.status,403);assert.deepEqual(snapshot(f.db),before);
 }
});
test('login rejects forged origins and simple form content types before authentication writes',async t=>{
 const f=fixture(t);for(const headers of [{Origin:'https://sibling.school.test'},{'Sec-Fetch-Site':'cross-site'},{'Content-Type':'text/plain'},{'Content-Type':'application/x-www-form-urlencoded'}]){
  const before=snapshot(f.db);const r=await req(f,'/api/auth/login',{method:'POST',headers,body:{email:'owner@matrix.test',password},env:{ALLOWED_ORIGINS:'https://sibling.school.test'}});assert.ok([403,415].includes(r.res.status));assert.deepEqual(snapshot(f.db),before);
 }
});
test('CLI requires explicit bearer mode; browser metadata cannot request a readable session JWT',async t=>{
 const f=fixture(t),s=await login(f,{session_mode:'bearer'});assert.ok(s.json.data.token);assert.equal(s.cookie,undefined);assert.equal(s.csrf,undefined);
 assert.equal((await req(f,'/api/auth/me',{headers:{Authorization:`Bearer ${s.json.data.token}`}})).res.status,200);
 for(const headers of [{Origin:origin},{'Sec-Fetch-Site':'same-origin'},{'Sec-Fetch-Mode':'cors'},{Cookie:'other=value'}]){
  const r=await req(f,'/api/auth/login',{method:'POST',headers,body:{email:'owner@matrix.test',password,session_mode:'bearer'}});assert.equal(r.res.status,403);
 }
});
test('cookie JWT cannot be reused as bearer to evade CSRF and duplicate credentials are rejected',async t=>{
 const f=fixture(t),s=await login(f),token=s.cookie.split('=')[1];
 assert.equal((await req(f,'/api/auth/logout',{method:'POST',headers:{Authorization:`Bearer ${token}`}})).res.status,401);
 for(const headers of [{Cookie:s.cookie,Authorization:`Bearer ${token}`},{Cookie:s.cookie+'; '+s.cookie}])assert.equal((await req(f,'/api/auth/me',{headers})).res.status,400);
});
test('current role, school isolation, account disable and auth-version revocation apply to cookie sessions',async t=>{
 const f=fixture(t),s=await login(f);
 assert.equal((await req(f,'/api/students?school_id=2',{headers:auth(s)})).res.status,403);
 f.db.exec('UPDATE users SET auth_version=auth_version+1 WHERE id=1');assert.equal((await req(f,'/api/auth/me',{headers:auth(s)})).res.status,401);
 const fresh=await login(f);f.db.exec("UPDATE users SET status='inactive' WHERE id=1");assert.equal((await req(f,'/api/auth/me',{headers:auth(fresh)})).res.status,401);
});
test('expired and tampered cookie sessions cannot read data and are cleared',async t=>{
 const f=fixture(t);const token=await signJWT({id:1,email:'owner@matrix.test',auth_version:1,session_transport:'cookie'},secret,{nowSeconds:100,expiresInSeconds:60});
 for(const value of [token,'tampered']){const r=await req(f,'/api/auth/me',{headers:{Cookie:'__Host-smart_school_session='+value}});assert.equal(r.res.status,401);assert.match(r.res.headers.get('set-cookie'),/Max-Age=0/);}
});
test('HTTPS is mandatory outside explicitly local loopback development',async t=>{
 const f=fixture(t);for(const options of [{url:'http://school.test',env:{APP_ENV:'local'}},{url:'http://localhost',env:{APP_ENV:'staging'}}]){
  const before=snapshot(f.db);const r=await req(f,'/api/auth/login',{method:'POST',body:{email:'owner@matrix.test',password},...options});assert.equal(r.res.status,503);assert.deepEqual(snapshot(f.db),before);
 }
 const s=await login(f,{}, {url:'http://localhost',env:{APP_ENV:'local'}});assert.match(s.cookie,/^smart_school_session=/);assert.doesNotMatch(s.res.headers.get('set-cookie'),/; Secure/);assert.match(s.res.headers.get('set-cookie'),/HttpOnly/);
});
test('malformed login options never create a session',async t=>{
 const f=fixture(t);for(const body of [null,{}, {email:'owner@matrix.test',password,session_mode:'unknown'},{email:'owner@matrix.test',password,remember_me:'true'}]){
  const r=await req(f,'/api/auth/login',{method:'POST',body});assert.equal(r.res.status,400);assert.equal(r.res.headers.get('set-cookie'),null);
 }
});

test('school detail routes enforce the same tenant boundary as school lists',async t=>{
 const f=fixture(t),owner=await login(f);
 assert.equal((await req(f,'/api/schools/1',{headers:auth(owner)})).res.status,200);
 const before=snapshot(f.db);
 assert.equal((await req(f,'/api/schools/2',{headers:auth(owner)})).res.status,403);
 assert.deepEqual(snapshot(f.db),before);
 f.db.prepare('UPDATE users SET password_hash=? WHERE id=2').run(hash);
 const admin=await login(f,{email:'admin@matrix.test'});
 assert.equal((await req(f,'/api/schools/2',{headers:auth(admin)})).res.status,200);
});

test('an existing session cannot assume another account after its email is reassigned',async t=>{
 const f=fixture(t),owner=await login(f);
 f.db.prepare('UPDATE users SET password_hash=? WHERE id=2').run(hash);
 const admin=await login(f,{email:'admin@matrix.test'});
 assert.equal((await req(f,'/api/users/1',{method:'PUT',headers:auth(admin),body:{school_id:1,email:'former-owner@matrix.test'}})).res.status,200);
 assert.equal((await req(f,'/api/users',{method:'POST',headers:auth(admin),body:{full_name:'Replacement Admin',role_key:'system_admin',email:'owner@matrix.test',password}})).res.status,201);
 const stale=await req(f,'/api/auth/me',{headers:auth(owner)});
 assert.equal(stale.res.status,401,JSON.stringify(stale.json));
 assert.equal(stale.json.data,undefined);
});

test('sessions without an immutable account id are rejected',async t=>{
 const f=fixture(t),token=await signJWT({email:'owner@matrix.test',auth_version:1,session_transport:'cookie'},secret);
 assert.equal((await req(f,'/api/auth/me',{headers:{Cookie:'__Host-smart_school_session='+token}})).res.status,401);
});

test('bearer authentication also rejects a signed email/account-id mismatch',async t=>{
 const f=fixture(t),token=await signJWT({id:1,email:'admin@matrix.test',auth_version:1,session_transport:'bearer'},secret);
 const before=snapshot(f.db);
 assert.equal((await req(f,'/api/auth/me',{headers:{Authorization:`Bearer ${token}`}})).res.status,401);
 assert.deepEqual(snapshot(f.db),before);
});

test('disabling then re-enabling an account does not revive its previous session',async t=>{
 const f=fixture(t),owner=await login(f);
 f.db.prepare('UPDATE users SET password_hash=? WHERE id=2').run(hash);
 const admin=await login(f,{email:'admin@matrix.test'});
 for(const status of ['inactive','active']) assert.equal((await req(f,'/api/users/1/status',{method:'PUT',headers:auth(admin),body:{status}})).res.status,200);
 assert.equal((await req(f,'/api/auth/me',{headers:auth(owner)})).res.status,401);
 assert.equal((await login(f)).res.status,200);
});

test('editing email uses the same canonical identity and duplicate check as login',async t=>{
 const f=fixture(t);f.db.prepare('UPDATE users SET password_hash=? WHERE id=2').run(hash);
 const admin=await login(f,{email:'admin@matrix.test'}),before=snapshot(f.db);
 const duplicate=await req(f,'/api/users/2',{method:'PUT',headers:auth(admin),body:{school_id:null,email:'  OWNER@matrix.test  '}});
 assert.equal(duplicate.res.status,409);
 assert.deepEqual(snapshot(f.db),before);
 const changed=await req(f,'/api/users/1',{method:'PUT',headers:auth(admin),body:{school_id:1,email:'  NEW-OWNER@matrix.test  '}});
 assert.equal(changed.res.status,200);
 assert.equal(changed.json.data.email,'new-owner@matrix.test');
 assert.equal((await login(f,{email:'new-owner@matrix.test'})).res.status,200);
});
