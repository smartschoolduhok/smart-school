import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  getSchoolSettings, getDocumentSettings, getSystemSettings,
  getSchools
} from '../../lib/api';
import type { AuthUser, School } from '../../types';
import {
  Building2, GraduationCap, FileText, Globe, Shield, Database,
  Loader2, AlertCircle, Save, CheckCircle
} from 'lucide-react';

import SchoolProfileTab from './SchoolProfileTab';
import AcademicTab from './AcademicTab';
import DocumentTab from './DocumentTab';
import LocalizationTab from './LocalizationTab';
import SecurityTab from './SecurityTab';
import BackupTab from './BackupTab';

type TabKey = 'profile' | 'academic' | 'document' | 'localization' | 'security' | 'backup';

const TAB_CONFIG: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'profile', label: 'بيانات المدرسة', icon: <Building2 size={18} /> },
  { key: 'academic', label: 'السنة الدراسية', icon: <GraduationCap size={18} /> },
  { key: 'document', label: 'إعدادات الطباعة والوثائق', icon: <FileText size={18} /> },
  { key: 'localization', label: 'إعدادات اللغة والأرقام', icon: <Globe size={18} /> },
  { key: 'security', label: 'الأمان والصلاحيات', icon: <Shield size={18} /> },
  { key: 'backup', label: 'النسخ الاحتياطي', icon: <Database size={18} /> },
];

function canManageSettings(roleKey: string): boolean {
  return ['system_admin', 'school_owner', 'principal'].includes(roleKey);
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('profile');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<number | null>(null);

  const [schoolData, setSchoolData] = useState<Record<string, any>>({});
  const [documentData, setDocumentData] = useState<Record<string, any>>({});
  const [systemData, setSystemData] = useState<Record<string, any>>({});

  const isAdmin = user?.role_key === 'system_admin';
  const canEdit = user ? canManageSettings(user.role_key) : false;
  const effectiveSchoolId = isAdmin ? selectedSchoolId : (user?.school_id ?? null);

  const loadSettings = useCallback(async () => {
    if (!effectiveSchoolId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [schoolRes, docRes, sysRes] = await Promise.all([
        getSchoolSettings(effectiveSchoolId),
        getDocumentSettings(effectiveSchoolId),
        getSystemSettings(effectiveSchoolId),
      ]);

      if (schoolRes.error) throw new Error(schoolRes.error);
      if (docRes.error) throw new Error(docRes.error);
      if (sysRes.error) throw new Error(sysRes.error);

      setSchoolData(schoolRes.data?.data || {});
      setDocumentData(docRes.data?.data || {});
      setSystemData(sysRes.data?.data || {});
    } catch (err: any) {
      setError(err.message || 'فشل في تحميل الإعدادات');
    } finally {
      setLoading(false);
    }
  }, [effectiveSchoolId]);

  // Load schools list for admin
  useEffect(() => {
    if (isAdmin) {
      getSchools().then(({ data }) => {
        if (data) {
          setSchools(data as School[]);
          if (!selectedSchoolId && data.length > 0) {
            setSelectedSchoolId(data[0].id);
          }
        }
      });
    }
  }, [isAdmin]);

  // Load settings when school changes
  useEffect(() => {
    if (effectiveSchoolId) {
      loadSettings();
    } else {
      setLoading(false);
    }
  }, [effectiveSchoolId, loadSettings]);

  const handleSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
    loadSettings();
  };

  const handleError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 6000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield size={28} className="text-primary-600" />
            إعدادات النظام
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            إدارة بيانات المدرسة والإعدادات العامة
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">المدرسة:</label>
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500"
              value={selectedSchoolId ?? ''}
              onChange={e => setSelectedSchoolId(Number(e.target.value))}
            >
              {schools.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-red-700">
          <AlertCircle size={20} />
          <p className="font-medium">{error}</p>
          <button onClick={() => setError(null)} className="mr-auto text-sm hover:underline">إغلاق</button>
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3 text-emerald-700">
          <CheckCircle size={20} />
          <p className="font-medium">{success}</p>
          <button onClick={() => setSuccess(null)} className="mr-auto text-sm hover:underline">إغلاق</button>
        </div>
      )}

      {/* Read-only notice for non-editors */}
      {!canEdit && user && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3 text-amber-700">
          <AlertCircle size={20} />
          <p className="font-medium">لديك صلاحية عرض الإعدادات فقط</p>
        </div>
      )}

      {/* Admin without school selected */}
      {isAdmin && !selectedSchoolId && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <AlertCircle size={40} className="text-gray-400 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-gray-900 mb-2">يرجى اختيار مدرسة</h2>
          <p className="text-sm text-gray-500">اختر مدرسة من القائمة أعلاه لعرض إعداداتها</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Loader2 size={32} className="animate-spin text-primary-600 mx-auto mb-4" />
          <p className="text-sm text-gray-500">جاري تحميل الإعدادات...</p>
        </div>
      )}

      {/* Tabs + Content */}
      {!loading && !isAdmin || (isAdmin && selectedSchoolId) ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex overflow-x-auto border-b border-gray-200">
            {TAB_CONFIG.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.key
                    ? 'bg-primary-50 text-primary-700 border-b-2 border-primary-600'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {activeTab === 'profile' && (
              <SchoolProfileTab
                data={schoolData}
                canEdit={canEdit}
                schoolId={effectiveSchoolId}
                onSuccess={handleSuccess}
                onError={handleError}
              />
            )}
            {activeTab === 'academic' && (
              <AcademicTab
                data={schoolData}
                canEdit={canEdit}
              />
            )}
            {activeTab === 'document' && (
              <DocumentTab
                data={documentData}
                canEdit={canEdit}
                schoolId={effectiveSchoolId}
                onSuccess={handleSuccess}
                onError={handleError}
              />
            )}
            {activeTab === 'localization' && (
              <LocalizationTab
                data={systemData}
                canEdit={canEdit}
                schoolId={effectiveSchoolId}
                onSuccess={handleSuccess}
                onError={handleError}
              />
            )}
            {activeTab === 'security' && (
              <SecurityTab
                user={user}
              />
            )}
            {activeTab === 'backup' && <BackupTab />}
          </div>
        </div>
      ) : null}
    </div>
  );
}
