import { useEffect, useRef, useState } from 'react';
import { Bell, Search, Menu } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { toArabicDigits } from '../lib/arabicDigits';

export default function Header() {
  const { user } = useAuth();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isNotificationsOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!notificationsRef.current?.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsNotificationsOpen(false);
        notificationsButtonRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isNotificationsOpen]);

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200 px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button className="lg:hidden p-2 rounded-lg hover:bg-gray-100">
            <Menu size={20} className="text-gray-600" />
          </button>
          <div className="relative">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="بحث..."
              className="w-64 pr-10 pl-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div ref={notificationsRef} className="relative">
            <button
              id="notifications-button"
              ref={notificationsButtonRef}
              type="button"
              onClick={() => setIsNotificationsOpen((open) => !open)}
              className="relative p-2 rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                className="absolute left-0 mt-2 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg z-50"
              >
                <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">
                  الإشعارات
                </div>
                <p role="status" className="px-4 py-8 text-center text-sm text-gray-500">
                  لا توجد إشعارات جديدة
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold text-gray-900">{user?.full_name || 'مستخدم'}</p>
              <p className="text-xs text-gray-500">{user?.role_name || '---'}</p>
            </div>
            <div className="w-9 h-9 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center font-bold text-sm border-2 border-primary-200">
              {user?.full_name?.charAt(0) || 'م'}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
