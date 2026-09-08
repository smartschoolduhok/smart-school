import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, Search, Menu } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getVisibleNavigationItems } from './Sidebar';

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLFormElement>(null);
  const visibleItems = useMemo(() => getVisibleNavigationItems(user?.role_key), [user?.role_key]);
  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ar');
    if (!normalized) return [];
    return visibleItems.filter(item => item.label.toLocaleLowerCase('ar').includes(normalized)).slice(0, 6);
  }, [query, visibleItems]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!notificationsRef.current?.contains(target)) setIsNotificationsOpen(false);
      if (!searchRef.current?.contains(target)) setIsSearchOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (isNotificationsOpen) notificationsButtonRef.current?.focus();
        setIsNotificationsOpen(false);
        setIsSearchOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isNotificationsOpen]);

  useEffect(() => {
    setQuery('');
    setIsSearchOpen(false);
  }, [location.pathname]);

  function go(path: string) {
    navigate(path);
    setQuery('');
    setIsSearchOpen(false);
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    if (matches[0]) go(matches[0].path);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white px-3 py-3 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
          <button
            type="button"
            onClick={onMenuClick}
            className="rounded-lg p-2 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 lg:hidden"
            aria-label="فتح القائمة الرئيسية"
            aria-controls="application-sidebar"
          >
            <Menu size={21} className="text-gray-600" />
          </button>
          <form ref={searchRef} onSubmit={submitSearch} className="relative min-w-0 flex-1 sm:max-w-xs" role="search">
            <Search size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={event => { setQuery(event.target.value); setIsSearchOpen(true); }}
              onFocus={() => setIsSearchOpen(true)}
              placeholder="انتقل إلى صفحة..."
              aria-label="البحث في صفحات النظام"
              aria-expanded={isSearchOpen && query.trim().length > 0}
              className="w-full rounded-lg border border-gray-200 py-2 pl-3 pr-10 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            {isSearchOpen && query.trim() && (
              <div className="absolute right-0 top-full z-50 mt-2 w-full min-w-64 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                {matches.length > 0 ? matches.map(item => (
                  <button
                    type="button"
                    key={item.path}
                    onClick={() => go(item.path)}
                    className="flex w-full items-center gap-3 border-b border-gray-50 px-4 py-3 text-right text-sm text-gray-700 last:border-0 hover:bg-primary-50 hover:text-primary-700"
                  >
                    {item.icon}
                    <span>{user?.role_key === 'parent' && item.path === '/students' ? 'أبنائي' : item.label}</span>
                  </button>
                )) : (
                  <p role="status" className="px-4 py-4 text-center text-sm text-gray-500">لا توجد صفحة مطابقة</p>
                )}
              </div>
            )}
          </form>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <div ref={notificationsRef} className="relative">
            <button
              id="notifications-button"
              ref={notificationsButtonRef}
              type="button"
              onClick={() => setIsNotificationsOpen(open => !open)}
              className="relative rounded-lg p-2 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              aria-label="الإشعارات"
              aria-haspopup="menu"
              aria-expanded={isNotificationsOpen}
              aria-controls="notifications-menu"
            >
              <Bell size={20} className="text-gray-600" />
            </button>

            {isNotificationsOpen && (
              <div
                id="notifications-menu"
                role="menu"
                aria-labelledby="notifications-button"
                className="absolute left-0 z-50 mt-2 w-72 max-w-[90vw] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
              >
                <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">الإشعارات</div>
                <p role="status" className="px-4 py-8 text-center text-sm text-gray-500">لا توجد إشعارات جديدة</p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right sm:block">
              <p className="max-w-40 truncate text-sm font-semibold text-gray-900">{user?.full_name || 'مستخدم'}</p>
              <p className="max-w-40 truncate text-xs text-gray-500">{user?.role_name || '---'}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-primary-200 bg-primary-100 text-sm font-bold text-primary-700">
              {user?.full_name?.charAt(0) || 'م'}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
