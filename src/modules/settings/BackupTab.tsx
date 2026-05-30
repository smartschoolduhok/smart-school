import { useState } from 'react';
import { Database, Download, Cloud, RotateCcw, FileJson, FileSpreadsheet, Loader2, AlertCircle } from 'lucide-react';

interface BackupAction {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: 'ready' | 'coming_soon' | 'disabled';
  onClick?: () => void;
}

export default function BackupTab() {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const actions: BackupAction[] = [
    {
      icon: <Download size={24} className="text-blue-600" />,
      title: 'تصدير بيانات المدرسة',
      description: 'تصدير جميع بيانات المدرسة (طلاب، فصول، درجات، مالية) إلى ملف JSON مضغوط',
      status: 'coming_soon',
    },
    {
      icon: <FileJson size={24} className="text-emerald-600" />,
      title: 'تصدير JSON',
      description: 'تصدير البيانات الأساسية بتنسيق JSON للاستيراد في نسخة أخرى',
      status: 'coming_soon',
    },
    {
      icon: <FileSpreadsheet size={24} className="text-green-600" />,
      title: 'تصدير Excel',
      description: 'تصدير التقارير والجداول بتنسيق Excel أو CSV',
      status: 'coming_soon',
    },
    {
      icon: <Cloud size={24} className="text-sky-600" />,
      title: 'النسخ الاحتياطي السحابي',
      description: 'حفظ نسخة احتياطية تلقائية في التخزين السحابي (R2)',
      status: 'coming_soon',
    },
    {
      icon: <RotateCcw size={24} className="text-amber-600" />,
      title: 'استعادة من نسخة',
      description: 'استعادة البيانات من ملف نسخة احتياطية سابقة',
      status: 'coming_soon',
    },
    {
      icon: <Database size={24} className="text-purple-600" />,
      title: 'تفريغ قاعدة البيانات',
      description: 'حذف جميع بيانات المدرسة (يتطلب تأكيد إضافي)',
      status: 'disabled',
    },
  ];

  const handleClick = (action: BackupAction, id: string) => {
    if (action.status !== 'ready') return;
    setLoadingId(id);
    action.onClick?.();
    setTimeout(() => setLoadingId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3 text-blue-800">
        <AlertCircle size={20} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">النسخ الاحتياطي والاستعادة</p>
          <p className="text-sm mt-0.5">
            هذه الميزات ستكون متاحة في المرحلة القادمة. حالياً يتم الاحتفاظ بجميع البيانات في قاعدة بيانات D1 مع إمكانية التصدير اليدوي عبر صفحات التقارير.
          </p>
        </div>
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {actions.map((action, idx) => {
          const id = String(idx);
          const isDisabled = action.status === 'disabled' || action.status === 'coming_soon';
          return (
            <button
              key={id}
              onClick={() => handleClick(action, id)}
              disabled={isDisabled}
              className={`text-right rounded-xl border p-5 transition-all ${
                isDisabled
                  ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                  : 'border-gray-200 bg-white hover:border-primary-300 hover:shadow-sm'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                  {action.icon}
                </div>
                {action.status === 'coming_soon' && (
                  <span className="text-xs font-medium bg-amber-50 text-amber-700 px-2 py-1 rounded-full border border-amber-200">
                    قريباً
                  </span>
                )}
                {action.status === 'disabled' && (
                  <span className="text-xs font-medium bg-red-50 text-red-700 px-2 py-1 rounded-full border border-red-200">
                    معطل
                  </span>
                )}
              </div>
              <h4 className="text-sm font-bold text-gray-900 mb-1">{action.title}</h4>
              <p className="text-xs text-gray-500 leading-relaxed">{action.description}</p>
              {loadingId === id && (
                <div className="mt-3 flex items-center gap-2 text-xs text-primary-600">
                  <Loader2 size={14} className="animate-spin" />
                  جاري المعالجة...
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Database info */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-base font-bold text-gray-900">معلومات قاعدة البيانات</h3>
        </div>
        <div className="px-6 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">نوع قاعدة البيانات</span>
              <span className="font-medium text-gray-900">Cloudflare D1 (SQLite)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">نظام التشفير</span>
              <span className="font-medium text-gray-900">Web Crypto API / SHA-256</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">التوزيع الجغرافي</span>
              <span className="font-medium text-gray-900">Edge Network (Global)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">آلية الاستعادة</span>
              <span className="font-medium text-gray-900">Snapshot + Migration</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
