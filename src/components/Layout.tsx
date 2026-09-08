import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isSidebarOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSidebarOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', closeOnEscape);
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
    <div className="min-h-screen bg-body-bg" dir="rtl">
      {isSidebarOpen && (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/45 lg:hidden"
        />
      )}
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="min-h-screen lg:mr-64">
        <Header onMenuClick={() => setIsSidebarOpen(true)} />
        <main className="p-3 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
