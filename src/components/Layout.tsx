import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  function closeSidebar() {
    setIsSidebarOpen(false);
    if (window.matchMedia('(max-width: 1023px)').matches) {
      window.requestAnimationFrame(() => document.getElementById('mobile-menu-button')?.focus());
    }
  }

  function openSidebar() {
    setIsSidebarOpen(true);
    window.requestAnimationFrame(() => document.getElementById('sidebar-close-button')?.focus());
  }

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const handleResize = () => { if (desktop.matches) setIsSidebarOpen(false); };
    desktop.addEventListener('change', handleResize);
    return () => desktop.removeEventListener('change', handleResize);
  }, []);

  useEffect(() => {
    if (!isSidebarOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleDrawerKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSidebar();
      }
      if (event.key !== 'Tab') return;
      const focusable = [...document.querySelectorAll<HTMLElement>('#application-sidebar a[href], #application-sidebar button:not([disabled])')]
        .filter(element => !element.closest('[hidden]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement as HTMLElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement as HTMLElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleDrawerKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', handleDrawerKey);
    };
  }, [isSidebarOpen]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-body-bg">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="app-shell min-h-screen bg-body-bg" dir="rtl">
      <a href="#main-content" className="sr-only z-[60] rounded-lg bg-white px-4 py-3 text-primary-700 shadow-lg focus:not-sr-only focus:fixed focus:right-4 focus:top-4">انتقل إلى المحتوى</a>
      {isSidebarOpen && (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          tabIndex={-1}
          onClick={closeSidebar}
          className="fixed inset-0 z-40 bg-black/45 lg:hidden"
        />
      )}
      <Sidebar isOpen={isSidebarOpen} onClose={closeSidebar} />
      <div className="min-h-screen min-w-0 lg:mr-64" inert={isSidebarOpen ? true : undefined}>
        <Header onMenuClick={openSidebar} isMenuOpen={isSidebarOpen} />
        <main id="main-content" tabIndex={-1} className="app-content min-w-0 p-3 outline-none sm:p-6 lg:p-7">
          {children}
        </main>
      </div>
    </div>
  );
}
