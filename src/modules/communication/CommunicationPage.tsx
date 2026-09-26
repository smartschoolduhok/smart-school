import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { fetchApi } from '../../lib/api';
import type { CommunicationContact, ConversationDetail, ParentConversation } from '../../lib/parentCommunication';

const input = 'w-full min-w-0 rounded-lg border border-gray-300 bg-white p-2.5';
const button = 'rounded-lg bg-primary-600 px-4 py-2 text-white disabled:opacity-50';
const time = (n: number) => new Date(n * 1000).toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad' });

export default function CommunicationPage() {
  const { schoolId, isSystemAdmin, schools, selectSchool } = useTenantSchool();
  const [params] = useSearchParams();
  const [threads, setThreads] = useState<ParentConversation[]>([]);
  const [contacts, setContacts] = useState<CommunicationContact[]>([]);
  const [contactsMore, setContactsMore] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [reply, setReply] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const epoch = useRef(0), selectionEpoch = useRef(0), createKey = useRef(''), messageKey = useRef('');

  async function loadThreads(before?: number) {
    if (!schoolId) return;
    const token = epoch.current;
    const r = await fetchApi<{ conversations: ParentConversation[]; next_cursor: number | null }>(`/api/communication?school_id=${schoolId}${before ? `&before=${before}` : ''}`);
    if (token !== epoch.current) return;
    if (r.error) setError(r.error);
    else if (r.data) { setThreads(old => before ? [...old, ...r.data!.conversations] : r.data!.conversations); setCursor(r.data.next_cursor); }
  }
  async function open(key: string, older = false) {
    if (!schoolId) return;
    const token = epoch.current, seq = ++selectionEpoch.current;
    const oldMessages = older ? detail?.messages || [] : [];
    if (!older) { setDetail(null); setReply(''); setReason(''); setCreating(false); messageKey.current=''; }
    const r = await fetchApi<ConversationDetail>(`/api/communication/${encodeURIComponent(key)}?school_id=${schoolId}${older && oldMessages.length ? `&before=${oldMessages[0].id}` : ''}`);
    if (token !== epoch.current || seq !== selectionEpoch.current) return;
    if (r.error) { setError(r.error); return; }
    if (!r.data) return;
    const data = r.data;
    setDetail({ ...data, messages: [...data.messages, ...oldMessages] });
    if (!older && data.messages.length) {
      await fetchApi(`/api/communication/${key}/read`, { method:'POST', body:JSON.stringify({ school_id:schoolId,last_message_id:data.messages[data.messages.length-1].id }) });
      if (token === epoch.current) void loadThreads();
    }
  }
  useEffect(() => {
    epoch.current++; selectionEpoch.current++;
    setThreads([]); setContacts([]); setDetail(null); setError(''); setSelection(''); setTitle(''); setBody(''); setReply(''); setReason(''); setBusy(false); setCreating(false); setCursor(null); createKey.current=''; messageKey.current='';
    void loadThreads();
    return () => { epoch.current++; selectionEpoch.current++; };
  }, [schoolId]);
  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchApi<{contacts:CommunicationContact[];has_more:boolean}>(`/api/communication/contacts?school_id=${schoolId}&q=${encodeURIComponent(query)}`).then(r => {
        if (cancelled) return;
        if(r.error) setError(r.error);
        else if(r.data) { setContacts(r.data.contacts); setContactsMore(r.data.has_more); setSelection(''); }
      });
    }, 200);
    return () => { cancelled=true; clearTimeout(timer); };
  }, [schoolId,query]);
  useEffect(() => { const key=params.get('conversation'); if(schoolId && key) void open(key); }, [schoolId,params]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); const contact=contacts[Number(selection)]; if (selection === '' || !contact || !schoolId || busy) return;
    const token=epoch.current; setBusy(true); setError(''); createKey.current ||= crypto.randomUUID();
    const r=await fetchApi<ParentConversation>('/api/communication',{method:'POST',body:JSON.stringify({school_id:schoolId,conversation_key:createKey.current,student_id:contact.student_id,academic_year_id:contact.academic_year_id,parent_user_id:contact.parent_user_id,staff_user_id:contact.staff_user_id,title,body})});
    if(token!==epoch.current) return; setBusy(false);
    if(r.error) setError(r.error);
    else if(r.data) { createKey.current=''; setTitle(''); setBody(''); await loadThreads(); await open(r.data.conversation_key); }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault(); if(!detail || !schoolId || busy) return;
    const token=epoch.current; setBusy(true); setError(''); messageKey.current ||= crypto.randomUUID();
    const key=detail.conversation.conversation_key;
    const r=await fetchApi(`/api/communication/${key}/messages`,{method:'POST',body:JSON.stringify({school_id:schoolId,message_key:messageKey.current,revision:detail.conversation.revision,body:reply})});
    if(token!==epoch.current) return; setBusy(false);
    if(r.error) setError(r.error); else { messageKey.current=''; setReply(''); await open(key); }
  }
  async function status() {
    if(!detail || !schoolId || busy || !reason.trim()) return;
    const token=epoch.current; setBusy(true); setError(''); const key=detail.conversation.conversation_key;
    const r=await fetchApi(`/api/communication/${key}/status`,{method:'POST',body:JSON.stringify({school_id:schoolId,revision:detail.conversation.revision,status:detail.conversation.status==='open'?'closed':'open',reason})});
    if(token!==epoch.current) return; setBusy(false);
    if(r.error) setError(r.error); else { setReason(''); await open(key); }
  }
  return <div dir="rtl" className="space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">تواصل ولي الأمر</h1><p className="text-sm text-gray-500">محادثات خاصة بالطالب مع مدرسته ومدرسيه.</p></div>
      <button type="button" className={button} disabled={!schoolId || busy} onClick={()=>{selectionEpoch.current++;setCreating(true);setDetail(null);setError('');}}>محادثة جديدة</button></div>
    {isSystemAdmin && <label className="block">المدرسة<select className={input} value={schoolId || ''} onChange={e=>selectSchool(e.target.value?Number(e.target.value):null)}><option value="">اختر المدرسة</option>{schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
    {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}<button type="button" className="mr-3 underline" onClick={()=>{setError('');void loadThreads();if(detail)void open(detail.conversation.conversation_key);}}>تحديث</button></div>}
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
      <aside className="min-w-0 space-y-2"><button type="button" className="text-sm text-primary-700" onClick={()=>void loadThreads()}>تحديث المحادثات</button>
        {threads.length===0 && <p className="rounded-xl border bg-white p-5 text-gray-500">لا توجد محادثات متاحة.</p>}
        {threads.map(t=><button disabled={busy} type="button" key={t.conversation_key} onClick={()=>void open(t.conversation_key)} className={`w-full rounded-xl border p-4 text-right ${detail?.conversation.conversation_key===t.conversation_key?'border-primary-500 bg-primary-50':'bg-white'}`}>
          <span className="block break-words font-bold">{t.title}</span><span className="block text-sm text-gray-600">{t.student_name}</span><span className="text-xs text-gray-500">{t.status==='open'?'مفتوحة':'مغلقة'} · {time(t.updated_at)}</span>{t.unread_count>0 && <span className="mr-2 rounded-full bg-primary-600 px-2 text-xs text-white">{t.unread_count} غير مقروءة</span>}
        </button>)}{cursor && <button className={button} type="button" onClick={()=>void loadThreads(cursor)}>المزيد</button>}
      </aside>
      <section className="min-w-0 rounded-xl border bg-white p-4 sm:p-5">
        {creating ? <form onSubmit={create} className="space-y-4"><h2 className="font-bold">محادثة جديدة</h2>
          <label className="block">البحث باسم الطالب<input className={input} value={query} onChange={e=>setQuery(e.target.value)} /></label>
          <label className="block">الطالب وجهة التواصل<select className={input} required value={selection} onChange={e=>{setSelection(e.target.value);createKey.current='';}}><option value="">اختر جهة التواصل</option>{contacts.map((c,i)=><option key={`${c.student_id}-${c.parent_user_id}-${c.staff_user_id}`} value={i}>{c.student_name} — {c.parent_name} ↔ {c.staff_name}</option>)}</select></label>
          {contactsMore && <p className="text-sm text-amber-700">اكتب اسم الطالب لتضييق النتائج.</p>}
          <label className="block">الموضوع<input className={input} required maxLength={160} value={title} onChange={e=>{setTitle(e.target.value);createKey.current='';}} /></label>
          <label className="block">الرسالة<textarea className={input} rows={5} required maxLength={4000} value={body} onChange={e=>{setBody(e.target.value);createKey.current='';}} /></label>
          <button className={button} disabled={busy || selection===''}>إرسال</button>
        </form> : detail ? <div className="space-y-4"><div><h2 className="break-words text-lg font-bold">{detail.conversation.title}</h2><p className="text-sm text-gray-500">{detail.conversation.student_name} · {detail.conversation.parent_name} · {detail.conversation.staff_name}</p></div>
          {detail.has_more && <button className="text-primary-700" onClick={()=>void open(detail.conversation.conversation_key,true)}>رسائل أقدم</button>}
          <div className="space-y-3" aria-live="polite">{detail.messages.map(m=><article key={m.message_key} className={`rounded-xl p-3 ${m.mine?'bg-primary-50':'bg-gray-50'}`}><div className="flex flex-wrap justify-between gap-1 text-xs text-gray-500"><b>{m.sender_name}</b><time>{time(m.created_at)}</time></div><p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.body}</p></article>)}</div>
          {detail.conversation.status==='open' ? <form onSubmit={send} className="space-y-2"><label className="block">رد جديد<textarea className={input} rows={3} required maxLength={4000} value={reply} onChange={e=>{setReply(e.target.value);messageKey.current='';}} /></label><button className={button} disabled={busy || !reply.trim()}>إرسال الرد</button></form> : <p className="rounded-lg bg-amber-50 p-3">المحادثة مغلقة. تستطيع المدرسة إعادة فتحها.</p>}
          {detail.can_manage && <details className="border-t pt-3"><summary className="cursor-pointer">إدارة المحادثة وسجل الإجراءات</summary><div className="mt-3 space-y-3"><label className="block">سبب {detail.conversation.status==='open'?'الإغلاق':'إعادة الفتح'}<input className={input} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} /></label><button className={button} disabled={busy || !reason.trim()} onClick={()=>void status()}>{detail.conversation.status==='open'?'إغلاق المحادثة':'إعادة فتح المحادثة'}</button><ul className="space-y-1 text-xs text-gray-500">{detail.audit.map((a,i)=><li key={i}>{({created:'إنشاء',message:'رسالة',closed:'إغلاق',reopened:'إعادة فتح'} as Record<string,string>)[a.action]} · {time(a.created_at)} {a.reason && `— ${a.reason}`}</li>)}</ul></div></details>}
        </div> : <p className="py-16 text-center text-gray-500">اختر محادثة أو ابدأ محادثة جديدة.</p>}
      </section>
    </div>
  </div>;
}
