import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import {fixture,request,root,snapshot} from './helpers/school-workflow-fixture.mjs';
const vite=await createServer({root,appType:'custom',server:{middlewareMode:true,hmr:false}});
const {default:app}=await vite.ssrLoadModule('/src/worker.ts'); after(()=>vite.close());
const req=(f,role,method,path,body)=>request(app,f,role,method,path,body);
const input=()=>({school_id:1,conversation_key:crypto.randomUUID(),student_id:101,academic_year_id:1,parent_user_id:8,staff_user_id:3,title:'متابعة الطالب',body:'رسالة خاصة'});
async function create(f,role='teacher',b=input()) {const r=await req(f,role,'POST','/api/communication',b);assert.equal(r.status,201,JSON.stringify(r));return {b,t:r.data,path:`/api/communication/${r.data.conversation_key}`};}

test('contacts enforce teacher assignments, linked children, roles and explicit admin school',async t=>{
 const f=fixture(t);
 const teacher=await req(f,'teacher','GET','/api/communication/contacts');assert.equal(teacher.status,200);assert.equal(teacher.data.contacts.length,1);assert.equal(teacher.data.contacts[0].student_id,101);
 const parent=await req(f,'parent','GET','/api/communication/contacts');assert.ok(parent.data.contacts.every(c=>c.parent_user_id===8 && c.student_id===101));
 assert.equal((await req(f,'admin','GET','/api/communication')).status,400);
 assert.equal((await req(f,'owner','GET','/api/communication?school_id=2')).status,403);
 assert.equal((await req(f,'accountant','GET','/api/communication')).status,403);
 assert.equal((await req(f,'parent','POST','/api/communication',{...input(),parent_user_id:9})).status,403);
 assert.equal((await req(f,'teacher','POST','/api/communication',{...input(),student_id:102,parent_user_id:9})).status,403);
});
test('parent initiates, staff replies, DTO and notifications preserve privacy, read receipts monotonic',async t=>{
 const f=fixture(t),c=await create(f,'parent');
 assert.equal(f.db.prepare('SELECT count(*) n FROM notification_recipients WHERE user_id=3').get().n,1);
 const other=await req(f,'otherParent','GET',c.path);assert.equal(other.status,404);
 assert.equal((await req(f,'foreignParent','GET',c.path)).status,404);
 const send={school_id:1,message_key:crypto.randomUUID(),revision:c.t.revision,body:'رد المدرسة'};
 const r=await req(f,'teacher','POST',c.path+'/messages',send);assert.equal(r.status,201,JSON.stringify(r));
 const before=snapshot(f.db);assert.equal((await req(f,'teacher','POST',c.path+'/messages',send)).status,200);assert.deepEqual(snapshot(f.db),before);
 const n=await req(f,'parent','GET','/api/notifications');assert.equal(n.data.unread_count,1);assert.equal(n.data.notifications[0].body.includes('رد المدرسة'),false);
 const d=await req(f,'parent','GET',c.path);assert.equal(d.data.messages.length,2);assert.deepEqual(d.data.audit,[]);assert.equal(d.data.can_manage,false);assert.equal('sender_user_id' in d.data.messages[0],false);
 assert.equal((await req(f,'parent','POST',c.path+'/read',{school_id:1,last_message_id:r.data.id})).status,200);
 assert.equal((await req(f,'parent','POST',c.path+'/read',{school_id:1,last_message_id:d.data.messages[0].id})).status,200);
 assert.equal(f.db.prepare('SELECT last_message_id FROM parent_conversation_reads WHERE user_id=8').get().last_message_id,r.data.id);
 assert.equal((await req(f,'parent','GET','/api/notifications')).data.unread_count,0);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('creation retry is idempotent; reuse with different content conflicts',async t=>{
 const f=fixture(t),c=await create(f);const before=snapshot(f.db);
 assert.equal((await req(f,'teacher','POST','/api/communication',c.b)).status,200);assert.deepEqual(snapshot(f.db),before);
 assert.equal((await req(f,'teacher','POST','/api/communication',{...c.b,body:'different'})).status,409);assert.deepEqual(snapshot(f.db),before);
});
test('stale writes and closed replies produce no extra messages, audit or notifications',async t=>{
 const f=fixture(t),c=await create(f);
 assert.equal((await req(f,'teacher','POST',c.path+'/status',{revision:c.t.revision,status:'closed',reason:''})).status,400);
 const close=await req(f,'teacher','POST',c.path+'/status',{revision:c.t.revision,status:'closed',reason:'انتهت المتابعة'});assert.equal(close.status,200);
 const before=snapshot(f.db);
 assert.equal((await req(f,'parent','POST',c.path+'/messages',{message_key:crypto.randomUUID(),revision:close.data.revision,body:'blocked'})).status,409);assert.deepEqual(snapshot(f.db),before);
 assert.equal((await req(f,'parent','POST',c.path+'/status',{revision:close.data.revision,status:'open',reason:'x'})).status,403);
 const reopen=await req(f,'owner','POST',c.path+'/status',{revision:close.data.revision,status:'open',reason:'تصحيح المتابعة'});assert.equal(reopen.status,200);
 assert.throws(()=>f.db.exec("UPDATE parent_messages SET body='changed'"),/immutable/);
 assert.throws(()=>f.db.exec('DELETE FROM parent_conversation_audit'),/immutable/);
 assert.throws(()=>f.db.exec('DELETE FROM parent_conversations'),/immutable/);
});
test('revocation hides messages and notifications from parents and teachers immediately',async t=>{
 const f=fixture(t),c=await create(f);
 f.db.exec("UPDATE parent_student_links SET status='inactive' WHERE parent_user_id=8");
 assert.equal((await req(f,'parent','GET',c.path)).status,404);assert.equal((await req(f,'parent','GET','/api/notifications')).data.unread_count,0);
 assert.equal((await req(f,'parent','POST',c.path+'/messages',{message_key:crypto.randomUUID(),revision:c.t.revision,body:'no'})).status,404);
 // Management retains audit oversight after a parent link is removed.
 assert.equal((await req(f,'owner','GET',c.path)).status,200);
 f.db.exec("UPDATE parent_student_links SET status='active' WHERE parent_user_id=8; UPDATE teacher_employee_links SET status='inactive' WHERE teacher_user_id=3");
 assert.equal((await req(f,'teacher','GET',c.path)).status,404);
 assert.equal((await req(f,'parent','GET',c.path)).status,404);
});
test('authorization is rechecked inside atomic write when a link is revoked after preflight',async t=>{
 const f=fixture(t),c=await create(f);const before=f.db.prepare('SELECT count(*) n FROM parent_messages').get().n;
 f.d1.beforeWrite=()=>f.db.exec("UPDATE parent_student_links SET status='inactive' WHERE parent_user_id=8");
 const r=await req(f,'teacher','POST',c.path+'/messages',{message_key:crypto.randomUUID(),revision:c.t.revision,body:'racing message'});assert.equal(r.status,409,JSON.stringify(r));
 assert.equal(f.db.prepare('SELECT count(*) n FROM parent_messages').get().n,before);assert.equal(f.db.prepare('SELECT count(*) n FROM communication_write_guards').get().n,0);
});
test('a failure after thread creation rolls back thread, message, audit and notification',async t=>{
 const f=fixture(t),before=snapshot(f.db);f.d1.failAt=2;
 const r=await req(f,'teacher','POST','/api/communication',input());assert.equal(r.status,503);assert.deepEqual(snapshot(f.db),before);
});
test('invalid or oversized data and unrelated read cursor never write',async t=>{
 const f=fixture(t),c=await create(f),before=snapshot(f.db);
 for(const b of [{...input(),unexpected:true},{...input(),body:'x'.repeat(4001)},{...input(),conversation_key:'bad'}]) assert.equal((await req(f,'teacher','POST','/api/communication',b)).status,400);
 assert.equal((await req(f,'teacher','POST',c.path+'/read',{last_message_id:999999})).status,404);assert.deepEqual(snapshot(f.db),before);
});
