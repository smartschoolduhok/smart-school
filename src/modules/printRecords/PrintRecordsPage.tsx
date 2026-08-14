import { useState, useEffect } from 'react';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import { getPrintRecords } from '../../lib/api';
import { toArabicDigits } from '../../lib/arabicDigits';
import { Printer, Loader2, FileText, Receipt, GraduationCap, Filter, Calendar, User } from 'lucide-react';

/* ─── Helpers ─── */
function typeBadge(type: string) {
  const cls =
    type === 'official_book' ? 'bg-primary-100 text-primary-700' :
    type === 'result_card' ? 'bg-emerald-100 text-emerald-700' :
    type === 'receipt' ? 'bg-amber-100 text-amber-700' :
    'bg-gray-100 text-gray-700';
  const label =
    type === 'official_book' ? 'كتاب رسمي' :
    type === 'result_card' ? 'كارت نتيجة' :
    type === 'receipt' ? 'إيصال' :
    type;
  return <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${cls}`}>{label}</span>;
}

function formatDate(ts: number | string): string {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  return d.toLocaleDateString('ar-IQ', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ─── Types ─── */
type FilterType = 'all' | 'official_book' | 'result_card' | 'receipt';

interface RecordItem {
  id: number;
  document_id: number;
  print_type: string;
  printed_at: number;
  printed_by_name?: string;
  created_at: string;
}

const TYPE_OPTIONS: { key: FilterType; label: string; icon: React.ReactNode }[] = [
  { key: 'all', label: 'الكل', icon: <Filter size={16} /> },
  { key: 'official_book', label: 'كتب رسمية', icon: <FileText size={16} /> },
  { key: 'result_card', label: 'كروت نتائج', icon: <GraduationCap size={16} /> },
  { key: 'receipt', label: 'إيصالات', icon: <Receipt size={16} /> },
];

export default function PrintRecordsPage() {
  const schoolScope = useTenantSchool();
  const { schoolId } = schoolScope;
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filterUser, setFilterUser] = useState('');

  const fetchRecords = async () => {
    if (schoolId == null) { setRecords([]); setLoading(false); return; }
    setLoading(true);
    try {
      const filters: any = {};
      if (filterType !== 'all') filters.print_type = filterType;
      if (fromDate) filters.from_date = Math.floor(new Date(fromDate).getTime() / 1000);
      if (toDate) filters.to_date = Math.floor(new Date(toDate + 'T23:59:59').getTime() / 1000);
      if (filterUser) filters.user_id = parseInt(filterUser, 10);
      const res = await getPrintRecords(filters, schoolId);
      setRecords((res.data || []) as RecordItem[]);
    } catch (e) { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    setFilterType('all');
    setFromDate('');
    setToDate('');
    setFilterUser('');
    void fetchRecords();
  }, [schoolId]);

  useEffect(() => { void fetchRecords(); }, [filterType, fromDate, toDate, filterUser]);

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center">
          <Printer size={20} className="text-primary-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">سجلات الطباعة</h1>
          <p className="text-sm text-gray-500">تتبع ومراقبة عمليات الطباعة في النظام</p>
        </div>
      </div>

      <SystemAdminSchoolSelector {...schoolScope} />

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 space-y-3">
        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.map(t => (
            <button
              key={t.key}
              onClick={() => setFilterType(t.key)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filterType === t.key ? 'bg-primary-50 text-primary-700 border border-primary-200' : 'text-gray-600 hover:bg-gray-50 border border-gray-200'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">من تاريخ</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">إلى تاريخ</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">المستخدم</label>
            <input type="number" value={filterUser} onChange={e => setFilterUser(e.target.value)} placeholder="معرف المستخدم" className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
        </div>
      </div>

      {/* Records */}
      {loading ? <div className="text-center py-8"><Loader2 className="animate-spin mx-auto" /></div> :
       records.length === 0 ? <div className="text-gray-500 text-center py-8">لا توجد سجلات طباعة</div> :
       <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
         <table className="w-full text-sm">
           <thead className="bg-gray-50 text-gray-600">
             <tr>
               <th className="px-4 py-3 text-right font-medium">#</th>
               <th className="px-4 py-3 text-right font-medium">نوع المستند</th>
               <th className="px-4 py-3 text-right font-medium">معرف المستند</th>
               <th className="px-4 py-3 text-right font-medium">طبع بواسطة</th>
               <th className="px-4 py-3 text-right font-medium">تاريخ الطباعة</th>
             </tr>
           </thead>
           <tbody className="divide-y divide-gray-100">
             {records.map(r => (
               <tr key={r.id} className="hover:bg-gray-50">
                 <td className="px-4 py-3">{toArabicDigits(String(r.id))}</td>
                 <td className="px-4 py-3">{typeBadge(r.print_type)}</td>
                 <td className="px-4 py-3">{toArabicDigits(String(r.document_id))}</td>
                 <td className="px-4 py-3 flex items-center gap-2">
                   <User size={14} className="text-gray-400" />
                   {r.printed_by_name || '—'}
                 </td>
                 <td className="px-4 py-3">{formatDate(r.printed_at)}</td>
               </tr>
             ))}
           </tbody>
         </table>
       </div>}
    </div>
  );
}
