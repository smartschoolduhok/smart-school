import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTenantSchool } from '../../hooks/useTenantSchool';
import { useSchoolRequestGuard } from '../../hooks/useSchoolRequestGuard';
import { SystemAdminSchoolSelector } from '../../components/SystemAdminSchoolSelector';
import {
  getSchoolSettings, getDocumentSettings, getSystemSettings
} from '../../lib/api';
import { canEditSchoolSettings } from '../../lib/rbac';
import {
  Building2, GraduationCap, FileText, Globe, Shield,
  Loader2, AlertCircle, CheckCircle, UsersRound, ChevronDown
} from 'lucide-react';

import SchoolProfileTab from './SchoolProfileTab';
import AcademicTab from './AcademicTab';
import DocumentTab from './DocumentTab';
import LocalizationTab from './LocalizationTab';
import SecurityTab from './SecurityTab';
import AccessLinksTab from './AccessLinksTab';

type TabKey = 'profile' | 'academic' | 'document' | 'localization' | 'access' | 'security';

const TAB_CONFIG: { key: TabKey; label: string; icon: React.ReactNode; managementOnly?: boolean }[] = [
  { key: 'profile', label: 'بيانات المدرسة', icon: <Building2 size={18} /> },
  { key: 'academic', label: 'السنة الدراسية', icon: <GraduationCap size={18} /> },
  { key: 'document', label: 'إعدادات الطباعة والوثائق', icon: <FileText size={18} /> },
  { key: 'localization', label: 'إعدادات اللغة والأرقام', icon: <Globe size={18} /> },
  { key: 'access', label: 'ربط المستخدمين', icon: <UsersRound size={18} />, managementOnly: true },
  { key: 'security', label: 'الأمان والصلاحيات', icon: <Shield size={18} /> },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const schoolScope = useTenantSchool();
  const { schoolId: effectiveSchoolId, isSystemAdmin: isAdmin } = schoolScope;
  const captureSchoolRequest = useSchoolRequestGuard(effectiveSchoolId);
  const [activeTab, setActiveTab] = useState<TabKey>('profile');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [schoolData, setSchoolData] = useState<Record<string, any>>({});
  const [documentData, setDocumentData] = useState<Record<string, any>>({});
  const [systemData, setSystemData] = useState<Record<string, any>>({});
  const [loadedSchoolId, setLoadedSchoolId] = useState<number | null>(null);

  const canEdit = canEditSchoolSettings(user?.role_key, effectiveSchoolId);
  const visibleTabs = TAB_CONFIG.filter(tab => !tab.managementOnly || canEdit);
  const primaryTabs = visibleTabs.filter(tab => ['profile', 'academic', 'document'].includes(tab.key));
  const advancedTabs = visibleTabs.filter(tab => ['localization', 'access', 'security'].includes(tab.key));
  const selectedSchoolName = isAdmin
    ? schoolScope.schools.find(school => school.id === effectiveSchoolId)?.name || null
    : user?.school_name || null;

  const loadSettings = useCallback(async () => {
    if (!effectiveSchoolId) {
      setLoading(false);
      return;
    }
    const isCurrent = captureSchoolRequest();
    setLoading(true);
    setError(null);
    try {
      const [schoolRes, docRes, sysRes] = await Promise.all([
        getSchoolSettings(effectiveSchoolId),
        getDocumentSettings(effectiveSchoolId),
        getSystemSettings(effectiveSchoolId),
      ]);
      if (!isCurrent()) return;

      if (schoolRes.error) throw new Error(schoolRes.error);
      if (docRes.error) throw new Error(docRes.error);
      if (sysRes.error) throw new Error(sysRes.error);

      // fetchApi already unwraps the API's outer { data } envelope.
      setSchoolData(schoolRes.data || {});
      setDocumentData(docRes.data || {});
      setSystemData(sysRes.data || {});
      setLoadedSchoolId(effectiveSchoolId);
    } catch (err: any) {
      if (!isCurrent()) return;
      setError(err.message || 'فشل في تحميل الإعدادات');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [effectiveSchoolId]);

  // Load settings when school changes
  useEffect(() => {
    setSchoolData({});
    setDocumentData({});
    setSystemData({});
    setLoadedSchoolId(null);
    setError(null);
    setSuccess(null);
    setActiveTab('profile');
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
        {effectiveSchoolId != null && advancedTabs.length > 0 && (
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Shield size={17} /> إعدادات متقدمة <ChevronDown size={16} />
            </summary>
            <div className="absolute left-0 z-20 mt-2 min-w-64 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
              {advancedTabs.map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm ${activeTab === tab.key ? 'bg-primary-50 font-semibold text-primary-700' : 'text-gray-700 hover:bg-gray-50'}`}
                >
                  {tab.icon}{tab.label}
                </button>
              ))}
            </div>
          </details>
        )}
      </div>

      <SystemAdminSchoolSelector {...schoolScope} />

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
      {isAdmin && !effectiveSchoolId && (
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
      {!loading && effectiveSchoolId != null && loadedSchoolId === effectiveSchoolId ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex overflow-x-auto border-b border-gray-200">
            {primaryTabs.map(tab => (
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
                schoolName={selectedSchoolName}
                canEdit={canEdit}
                schoolId={effectiveSchoolId}
                onSuccess={handleSuccess}
                onError={handleError}
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
            {activeTab === 'access' && canEdit && (
              <AccessLinksTab
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
