import { useState, useEffect } from 'react';
import { GraduationCap, Calendar, Link2, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface Props {
  data: Record<string, any>;
  canEdit: boolean;
}

export default function AcademicTab({ data }: Props) {
  const { user } = useAuth();
  const [academicYear, setAcademicYear] = useState<string>('2025-2026');
  const [loading, setLoading] = useState(false);

  // In a real implementation, we would fetch the active academic year
  // For Phase 11 MVP, we show read-only info with a link to grades
  const school = data?.school || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <GraduationCap size={20} className="text-primary-600" />
          السنة الدراسية
        </h2>
        <span className="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-200">
          وضع القراءة فقط
        </span>
      </div>

      <div className="bg-gray-50 rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">السنة الدراسية الحالية</label>
            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg border border-gray-200 text-sm text-gray-800">
              <Calendar size={16} className="text-gray-400" />
              {academicYear}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">المدرسة</label>
            <div className="px-4 py-2 bg-white rounded-lg border border-gray-200 text-sm text-gray-800">
              {school.name || '---'}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">نوع المدرسة</label>
            <div className="px-4 py-2 bg-white rounded-lg border border-gray-200 text-sm text-gray-800">
              {school.school_type || '---'}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">المدينة</label>
            <div className="px-4 py-2 bg-white rounded-lg border border-gray-200 text-sm text-gray-800">
              {school.city || '---'}
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">إدارة السنة الدراسية</h3>
          <p className="text-sm text-gray-500 mb-4">
            إدارة السنوات الدراسية والفصول متاحة من خلال صفحة إعدادات الدرجات.
          </p>
          <a
            href="/grades"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-50 text-primary-700 rounded-lg text-sm font-medium hover:bg-primary-100 transition-colors border border-primary-200"
          >
            <Link2 size={16} />
            اذهب إلى إعدادات الدرجات
          </a>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3 text-blue-700">
        <AlertCircle size={20} className="shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-sm mb-1">ملاحظة</p>
          <p className="text-sm opacity-90">
            إعدادات السنة الدراسية والفصول الدراسية وتوزيع المواد تُدار من خلال وحدات النظام الأخرى.
            ستتم إضافة إدارة السنة الدراسية هنا في تحديث قادم.
          </p>
        </div>
      </div>
    </div>
  );
}
