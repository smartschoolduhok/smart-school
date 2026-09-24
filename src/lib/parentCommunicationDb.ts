import type { Hono } from 'hono';
import type { Bindings, Variables } from '../worker';
import { COMMUNICATION_ROLES, SCHOOL_MANAGEMENT_ROLES, hasRole } from './rbac';
import { boundedText, ensure, positiveId, uuid, workflowBody, workflowResponse, workflowSchool, type WorkflowContext as C } from './schoolWorkflow';
type Row = Record<string, any>;

function scope(c: C, alias = 't'): { sql: string; args: unknown[] } {
  const u = c.get('user');
  if (hasRole(u.role_key, SCHOOL_MANAGEMENT_ROLES)) return { sql: `EXISTS(SELECT 1 FROM users actor JOIN roles actor_role ON actor_role.id=actor.role_id WHERE actor.id=? AND actor.status='active' AND (actor_role.key='system_admin' OR (actor.school_id=${alias}.school_id AND actor_role.key IN ('school_owner','principal','vice_principal'))))`, args: [u.id] };
  return { sql: `EXISTS(SELECT 1 FROM communication_contacts access WHERE access.school_id=${alias}.school_id
    AND access.student_id=${alias}.student_id AND access.academic_year_id=${alias}.academic_year_id
    AND access.parent_user_id=${alias}.parent_user_id AND access.staff_user_id=${alias}.staff_user_id
    AND access.${u.role_key === 'parent' ? 'parent_user_id' : 'staff_user_id'}=?)`, args: [u.id] };
}

// Generic notification bodies contain no message text. Even these notifications
// disappear immediately when either active contact/assignment is revoked.
export const communicationNotificationAccessSql = `(
  coalesce(notification.reference_type,'') <> 'parent_conversation' OR EXISTS (
    SELECT 1 FROM parent_conversations thread JOIN communication_contacts access
      ON access.school_id=thread.school_id AND access.student_id=thread.student_id
      AND access.academic_year_id=thread.academic_year_id AND access.parent_user_id=thread.parent_user_id
      AND access.staff_user_id=thread.staff_user_id
    WHERE thread.conversation_key=notification.reference_key AND thread.school_id=notification.school_id
      AND recipient.user_id IN (thread.parent_user_id,thread.staff_user_id)
  ))`;

async function thread(c: C, school: number, key: string): Promise<Row> {
  const access = scope(c);
  const row = await c.env.DB.prepare(`SELECT t.* FROM parent_conversations t WHERE t.school_id=? AND t.conversation_key=? AND ${access.sql}`)
    .bind(school, key, ...access.args).first<Row>();
  ensure(row, 'conversation_not_found', 'المحادثة غير موجودة أو لم تعد متاحة', 404);
  return row;
}
function dto(row: Row) {
  return { conversation_key: row.conversation_key, student_id: row.student_id, student_name: row.student_name,
    parent_name: row.parent_name, staff_name: row.staff_name, title: row.title, status: row.status,
    revision: Number(row.revision), updated_at: Number(row.updated_at), unread_count: Number(row.unread_count || 0) };
}
function messageDto(row: Row, actor: number) {
  return { id: Number(row.id), message_key: row.message_key, sender_name: row.sender_name,
    body: row.body, created_at: Number(row.created_at), mine: Number(row.sender_user_id) === actor };
}
function writeGuard(c: C, row: Row, expected: number, token: string) {
  const access = scope(c);
  return c.env.DB.prepare(`INSERT INTO communication_write_guards(token,valid)
    SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM parent_conversations t WHERE t.id=? AND t.revision=? AND ${access.sql}) THEN 1 ELSE 0 END`)
    .bind(token, row.id, expected, ...access.args);
}

export function registerParentCommunicationRoutes(app: Hono<{ Bindings: Bindings; Variables: Variables }>) {
  const route = (method: string, path: string, fn: (c: C) => Promise<Response>) =>
    app.on(method, `/api/communication${path}`, c => workflowResponse(c, () => fn(c)));

  route('GET', '/contacts', async c => {
    const school = await workflowSchool(c, c.req.query('school_id'), COMMUNICATION_ROLES);
    const u = c.get('user');
    const filter = u.role_key === 'parent' ? 'AND parent_user_id=?' : hasRole(u.role_key, SCHOOL_MANAGEMENT_ROLES) ? '' : 'AND staff_user_id=?';
    const q = (c.req.query('q') || '').trim().slice(0,100);
    const args: unknown[] = [school]; if (filter) args.push(u.id); args.push(`%${q}%`);
    const rows = await c.env.DB.prepare(`SELECT student_id,student_name,academic_year_id,parent_user_id,parent_name,staff_user_id,staff_name,staff_role
      FROM communication_contacts WHERE school_id=? ${filter} AND student_name LIKE ? ORDER BY student_name,parent_name,staff_name LIMIT 201`).bind(...args).all<Row>();
    return c.json({ data: { contacts: (rows.results || []).slice(0,200), has_more: (rows.results || []).length > 200 } });
  });
  route('GET', '', async c => {
    const school = await workflowSchool(c, c.req.query('school_id'), COMMUNICATION_ROLES);
    const access = scope(c); const u = c.get('user');
    const before = c.req.query('before') ? positiveId(c.req.query('before')) : Number.MAX_SAFE_INTEGER;
    const rows = await c.env.DB.prepare(`SELECT t.*,
      (SELECT count(*) FROM parent_messages m WHERE m.conversation_id=t.id AND m.sender_user_id<>?
        AND m.id>coalesce((SELECT last_message_id FROM parent_conversation_reads r WHERE r.conversation_id=t.id AND r.user_id=?),0)) AS unread_count
      FROM parent_conversations t WHERE t.school_id=? AND t.id<? AND ${access.sql} ORDER BY t.id DESC LIMIT 51`)
      .bind(u.id,u.id,school,before,...access.args).all<Row>();
    const page = (rows.results || []).slice(0,50);
    return c.json({ data: { conversations: page.map(dto), next_cursor: (rows.results || []).length > 50 ? page[49].id : null } });
  });
  route('POST', '', async c => {
    const b = await workflowBody(c, ['school_id','conversation_key','student_id','academic_year_id','parent_user_id','staff_user_id','title','body']);
    const school = await workflowSchool(c,b.school_id,COMMUNICATION_ROLES); const u = c.get('user');
    const key = uuid(b.conversation_key), title = boundedText(b.title,160), body = boundedText(b.body,4000);
    const student = positiveId(b.student_id), year = positiveId(b.academic_year_id), parent = positiveId(b.parent_user_id), staff = positiveId(b.staff_user_id);
    ensure(hasRole(u.role_key,SCHOOL_MANAGEMENT_ROLES) || (u.role_key==='parent' ? parent===u.id : staff===u.id),'forbidden','غير مسموح بإنشاء هذه المحادثة',403);
    const existing = await c.env.DB.prepare('SELECT * FROM parent_conversations WHERE conversation_key=?').bind(key).first<Row>();
    if (existing) {
      await thread(c,school,key);
      const first = await c.env.DB.prepare('SELECT body FROM parent_messages WHERE conversation_id=? ORDER BY id LIMIT 1').bind(existing.id).first<Row>();
      ensure(existing.created_by_user_id===u.id && existing.student_id===student && existing.academic_year_id===year && existing.parent_user_id===parent
        && existing.staff_user_id===staff && existing.title===title && first?.body===body,'idempotency_conflict','معرف الطلب استُخدم لطلب مختلف',409);
      return c.json({ data: dto(existing) });
    }
    const contact = await c.env.DB.prepare('SELECT * FROM communication_contacts WHERE school_id=? AND student_id=? AND academic_year_id=? AND parent_user_id=? AND staff_user_id=?')
      .bind(school,student,year,parent,staff).first<Row>();
    ensure(contact,'contact_unavailable','جهة الاتصال غير متاحة',403);
    const quota = await c.env.DB.prepare('SELECT count(*) n FROM parent_conversations WHERE created_by_user_id=? AND created_at>unixepoch()-3600').bind(u.id).first<{n:number}>();
    ensure(Number(quota?.n || 0)<20,'rate_limited','انتظر قبل إنشاء محادثات إضافية',429);
    const token = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO communication_write_guards(token,valid) SELECT ?,CASE WHEN (SELECT count(*) FROM parent_conversations WHERE created_by_user_id=? AND created_at>unixepoch()-3600)<20 THEN 1 ELSE 0 END`).bind(token,u.id),
      c.env.DB.prepare(`INSERT INTO parent_conversations(conversation_key,school_id,student_id,academic_year_id,parent_user_id,staff_user_id,student_name,parent_name,staff_name,title,created_by_user_id,updated_by_user_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(key,school,student,year,parent,staff,contact.student_name,contact.parent_name,contact.staff_name,title,u.id,u.id),
      c.env.DB.prepare(`INSERT INTO parent_messages(message_key,conversation_id,school_id,sender_user_id,sender_name,body,thread_revision)
        SELECT ?,id,school_id,?,?,?,revision FROM parent_conversations WHERE conversation_key=?`).bind(crypto.randomUUID(),u.id,u.full_name,body,key),
      c.env.DB.prepare('DELETE FROM communication_write_guards WHERE token=?').bind(token),
    ]);
    return c.json({ data: dto(await thread(c,school,key)) },201);
  });
  route('GET', '/:key', async c => {
    const school = await workflowSchool(c,c.req.query('school_id'),COMMUNICATION_ROLES);
    const t = await thread(c,school,uuid(c.req.param('key'))), u = c.get('user');
    const before = c.req.query('before') ? positiveId(c.req.query('before')) : Number.MAX_SAFE_INTEGER;
    const rows = await c.env.DB.prepare('SELECT * FROM parent_messages WHERE conversation_id=? AND id<? ORDER BY id DESC LIMIT 51').bind(t.id,before).all<Row>();
    const canManage = u.role_key !== 'parent';
    const audit = canManage ? await c.env.DB.prepare('SELECT action,reason,revision,created_at FROM parent_conversation_audit WHERE conversation_id=? ORDER BY id DESC LIMIT 100').bind(t.id).all() : { results: [] };
    // Recheck after reads as revocation may have happened between statements.
    await thread(c,school,t.conversation_key);
    return c.json({ data: { conversation: dto(t), messages: (rows.results || []).slice(0,50).reverse().map(row=>messageDto(row,u.id)), has_more: (rows.results || []).length>50, can_manage: canManage, audit: audit.results } });
  });
  route('POST', '/:key/messages', async c => {
    const b = await workflowBody(c,['school_id','message_key','revision','body']);
    const school = await workflowSchool(c,b.school_id,COMMUNICATION_ROLES);
    const t = await thread(c,school,uuid(c.req.param('key'))), u = c.get('user');
    const key = uuid(b.message_key), body = boundedText(b.body,4000), revision = positiveId(b.revision);
    const existing = await c.env.DB.prepare('SELECT * FROM parent_messages WHERE message_key=?').bind(key).first<Row>();
    if (existing) {
      ensure(existing.conversation_id===t.id && existing.sender_user_id===u.id && existing.body===body,'idempotency_conflict','معرف الرسالة مستخدم لرسالة مختلفة',409);
      return c.json({ data: messageDto(existing,u.id) });
    }
    ensure(t.status==='open' && t.revision===revision,'conversation_stale','المحادثة مغلقة أو تغيرت؛ أعد تحميلها',409);
    const token = crypto.randomUUID();
    await c.env.DB.batch([
      writeGuard(c,t,revision,token),
      c.env.DB.prepare(`INSERT INTO communication_write_guards(token,valid) SELECT ?,CASE WHEN (SELECT count(*) FROM parent_messages WHERE sender_user_id=? AND created_at>unixepoch()-60)<20 THEN 1 ELSE 0 END`).bind(token+'-rate',u.id),
      c.env.DB.prepare(`INSERT INTO parent_messages(message_key,conversation_id,school_id,sender_user_id,sender_name,body,thread_revision) VALUES(?,?,?,?,?,?,?)`).bind(key,t.id,school,u.id,u.full_name,body,revision),
      c.env.DB.prepare('DELETE FROM communication_write_guards WHERE token IN (?,?)').bind(token,token+'-rate'),
    ]);
    const row = await c.env.DB.prepare('SELECT * FROM parent_messages WHERE message_key=?').bind(key).first<Row>();
    return c.json({ data: messageDto(row!,u.id) },201);
  });
  route('POST', '/:key/status', async c => {
    const b = await workflowBody(c,['school_id','revision','status','reason']);
    const school = await workflowSchool(c,b.school_id,COMMUNICATION_ROLES);
    const t = await thread(c,school,uuid(c.req.param('key'))), u = c.get('user');
    ensure(u.role_key!=='parent','forbidden','إدارة حالة المحادثة للمدرسة فقط',403);
    ensure(b.status==='open' || b.status==='closed','invalid_status','حالة غير صالحة');
    const reason=boundedText(b.reason,500), revision=positiveId(b.revision), token=crypto.randomUUID();
    ensure(t.status!==b.status,'conversation_stale','الحالة مطبقة مسبقًا',409);
    await c.env.DB.batch([writeGuard(c,t,revision,token),c.env.DB.prepare('UPDATE parent_conversations SET status=?,status_reason=?,revision=revision+1,updated_by_user_id=?,updated_at=unixepoch() WHERE id=?').bind(b.status,reason,u.id,t.id),c.env.DB.prepare('DELETE FROM communication_write_guards WHERE token=?').bind(token)]);
    return c.json({ data: dto(await thread(c,school,t.conversation_key)) });
  });
  route('POST', '/:key/read', async c => {
    const b = await workflowBody(c,['school_id','last_message_id']);
    const school = await workflowSchool(c,b.school_id,COMMUNICATION_ROLES);
    const t = await thread(c,school,uuid(c.req.param('key'))), u = c.get('user'), id=positiveId(b.last_message_id);
    ensure(await c.env.DB.prepare('SELECT id FROM parent_messages WHERE id=? AND conversation_id=?').bind(id,t.id).first(),'message_not_found','الرسالة غير موجودة',404);
    const token=crypto.randomUUID();
    await c.env.DB.batch([writeGuard(c,t,t.revision,token),
      c.env.DB.prepare(`INSERT INTO parent_conversation_reads(conversation_id,user_id,last_message_id) VALUES(?,?,?)
        ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_message_id=max(parent_conversation_reads.last_message_id,excluded.last_message_id),read_at=unixepoch()`).bind(t.id,u.id,id),
      c.env.DB.prepare(`UPDATE notification_recipients SET read_at=coalesce(read_at,unixepoch()) WHERE user_id=? AND school_id=?
        AND notification_key IN (SELECT message_key FROM parent_messages WHERE conversation_id=? AND id<=?)`).bind(u.id,school,t.id,id),
      c.env.DB.prepare('DELETE FROM communication_write_guards WHERE token=?').bind(token)]);
    return c.json({ data: { read: true } });
  });
}
