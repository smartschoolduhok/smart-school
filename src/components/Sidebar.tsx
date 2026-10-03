import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, School, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { DASHBOARD_NAVIGATION_ITEM, getNavigationLocation, getVisibleNavigationGroups } from './navigation';
export { NAVIGATION_GROUPS, DASHBOARD_NAVIGATION_ITEM, getVisibleNavigationItems } from './navigation';
export type { NavigationItem } from './navigation';

interface SidebarProps { isOpen?: boolean; onClose?: () => void; }
export default function Sidebar({ isOpen = false, onClose = () => {} }: SidebarProps) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktop(query.matches);
    sync(); query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const visibleGroups = useMemo(() => getVisibleNavigationGroups(user?.role_key), [user?.role_key]);
  const currentLocation = getNavigationLocation(pathname, user?.role_key);
  const activeGroupKey = currentLocation.group?.key || null;
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroupKey);
  useEffect(() => { setOpenGroup(activeGroupKey); }, [activeGroupKey, pathname, user?.id]);
  return (
    <aside id="application-sidebar" aria-label="التنقل الرئيسي" aria-hidden={!isDesktop && !isOpen} inert={!isDesktop && !isOpen}
      className={`application-sidebar fixed right-0 top-0 z-50 flex h-dvh w-72 max-w-[88vw] flex-col bg-sidebar-bg text-white transition-transform duration-200 lg:w-64 lg:max-w-none lg:translate-x-0 ${isOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full'}`}>
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-5 py-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/15 text-blue-300"><School size={23} /></span>
        <div className="min-w-0 flex-1"><p className="text-sm font-bold leading-6">نظام المدرسة الذكي</p><p className="truncate text-xs text-slate-400" title={user?.school_name || 'الإدارة المركزية'}>{user?.school_name || 'الإدارة المركزية'}</p></div>
        <button type="button" id="sidebar-close-button" onClick={onClose} className="rounded-lg p-2 text-slate-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-blue-300 lg:hidden" aria-label="إغلاق القائمة"><X size={20} /></button>
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-4" aria-label="أقسام النظام">
        <NavLink to="/" end onClick={onClose} className={({ isActive }) => `mb-3 flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${isActive ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}>
          {DASHBOARD_NAVIGATION_ITEM.icon}<span>{DASHBOARD_NAVIGATION_ITEM.label}</span>
        </NavLink>
        {visibleGroups.map(group => {
          const expanded = openGroup === group.key, active = group.key === activeGroupKey, panelId = `navigation-group-${group.key}`;
          return <div key={group.key}>
            <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpenGroup(expanded ? null : group.key)}
              className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right text-sm font-medium ${active || expanded ? 'bg-white/5 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}>
              <span className={active ? 'text-blue-300' : 'text-slate-400'}>{group.icon}</span><span className="min-w-0 flex-1">{group.label}</span><ChevronDown size={15} className={`shrink-0 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
            {expanded && <div id={panelId} className="mr-5 my-1 space-y-0.5 border-r border-slate-700/70 pr-2">
              {group.items.map(item => <Link key={item.path} to={item.path} onClick={onClose}
                aria-current={currentLocation.item.path === item.path ? 'page' : undefined}
                className={`flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] leading-6 ${currentLocation.item.path === item.path ? 'bg-primary-600 font-semibold text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
                <span className="shrink-0">{item.icon}</span><span>{item.label}</span>
              </Link>)}
            </div>}
          </div>;
        })}
      </nav>
      <div className="shrink-0 border-t border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-bold text-slate-200">{user?.full_name?.charAt(0) || 'م'}</span>
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold" title={user?.full_name}>{user?.full_name || 'مستخدم'}</p><p className="mt-0.5 truncate text-[11px] text-slate-400">{user?.role_name || '---'}</p></div>
          <button type="button" onClick={() => { onClose(); void logout(); }} aria-label="تسجيل الخروج" title="تسجيل الخروج" className="rounded-lg p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-300"><LogOut size={18} /></button>
        </div>
      </div>
    </aside>
  );
}
