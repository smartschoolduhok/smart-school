import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, Search, Menu, ChevronLeft } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getNotifications, markNotificationRead } from '../lib/api';
import type { NotificationFeed } from '../lib/gateAttendance';
import { getNavigationLocation, getVisibleNavigationItems, normalizeNavigationSearch } from './navigation';

interface HeaderProps { onMenuClick: () => void; isMenuOpen: boolean; }
const EMPTY_FEED: NotificationFeed = { unread_count: 0, notifications: [] };

export default function Header({ onMenuClick, isMenuOpen }: HeaderProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const locationKeyRef = useRef(location.key);
  locationKeyRef.current = location.key;
  const identity = user ? `${user.id}:${user.school_id}:${user.role_key}` : '';
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const requestSequence = useRef(0);
  const readingNotification = useRef(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [feedState, setFeedState] = useState({ identity, feed: EMPTY_FEED });
  const notificationFeed = feedState.identity === identity ? feedState.feed : EMPTY_FEED;
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');
  const [pendingRead, setPendingRead] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLFormElement>(null);
  const visibleItems = useMemo(() => getVisibleNavigationItems(user?.role_key), [user?.role_key]);
  const currentLocation = getNavigationLocation(location.pathname, user?.role_key);
  const matches = useMemo(() => {
    const normalized = normalizeNavigationSearch(query);
    return normalized ? visibleItems.filter(item => normalizeNavigationSearch(item.label).includes(normalized)).slice(0, 6) : [];
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
    setIsNotificationsOpen(false);
  }, [location.pathname, identity]);

  const loadNotifications = useCallback(async () => {
    if (!identity) return;
    const request = ++requestSequence.current;
    setNotificationsLoading(true);
    setNotificationsError('');
    const response = await getNotifications(20);
    if (identityRef.current !== identity || request !== requestSequence.current) return;
    if (response.error) setNotificationsError(response.error);
    else if (response.data) setFeedState({ identity, feed: response.data });
    setNotificationsLoading(false);
  }, [identity]);

  useEffect(() => {
    setFeedState({ identity, feed: EMPTY_FEED });
    setNotificationsError('');
    setNotificationsLoading(false);
    readingNotification.current = false;
    setPendingRead(false);
    void loadNotifications();
    return () => { requestSequence.current += 1; };
  }, [identity, loadNotifications]);

  function go(path: string) {
    navigate(path);
    setQuery('');
    setIsSearchOpen(false);
  }

  async function openNotification(notificationKey: string, referenceType: string | null) {
    if (readingNotification.current) return;
    const startingLocationKey = locationKeyRef.current;
    const current = notificationFeed.notifications.find(item => item.notification_key === notificationKey);
    const request = ++requestSequence.current;
    if (current && current.read_at == null) {
      readingNotification.current = true;
      setPendingRead(true);
      const response = await markNotificationRead(notificationKey);
      if (identityRef.current !== identity || request !== requestSequence.current) return;
      readingNotification.current = false;
      setPendingRead(false);
      if (response.error) {
        setNotificationsError(response.error);
        return;
      }
      if (response.data) setFeedState(state => ({ identity, feed: {
        unread_count: Math.max(0, state.feed.unread_count - 1),
        notifications: state.feed.notifications.map(item => item.notification_key === notificationKey
          ? { ...item, read_at: response.data!.read_at } : item),
      } }));
    }
    if (locationKeyRef.current !== startingLocationKey) return;
    setIsNotificationsOpen(false);
    if (referenceType === 'student_gate_event') navigate('/attendance');
    if (referenceType === 'parent_conversation') navigate(`/communication?conversation=${encodeURIComponent(current?.reference_key || '')}`);
    if (referenceType === 'grade_progress') navigate('/grade-progress');
    if (referenceType === 'homework') navigate('/homework');
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-3 py-3 sm:px-6 lg:px-7">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,20rem)_auto]">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" id="mobile-menu-button" onClick={onMenuClick}
            className="shrink-0 rounded-lg p-2.5 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary-500 lg:hidden"
            aria-label="فتح القائمة الرئيسية" aria-controls="application-sidebar" aria-expanded={isMenuOpen}>
            <Menu size={21} />
          </button>
          <div className="min-w-0" aria-label="الموقع الحالي">
            <p className="truncate text-[11px] text-slate-500">{currentLocation.group?.label || user?.school_name || 'المدرسة الذكية'}</p>
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-800"><ChevronLeft size={14} className="shrink-0 text-slate-400" /><span className="truncate">{currentLocation.item.label}</span></p>
          </div>
        </div>

        <form ref={searchRef} onSubmit={event => { event.preventDefault(); if (matches[0]) go(matches[0].path); }}
          className="relative order-3 col-span-2 min-w-0 sm:order-2 sm:col-span-1" role="search">
          <Search size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" value={query}
            onChange={event => { setQuery(event.target.value); setIsSearchOpen(true); setIsNotificationsOpen(false); }}
            onFocus={() => { setIsSearchOpen(true); setIsNotificationsOpen(false); }}
            placeholder="ابحث عن صفحة…" aria-label="البحث في صفحات النظام"
            aria-expanded={isSearchOpen && query.trim().length > 0} aria-controls="page-search-results"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-9 text-sm focus:border-primary-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary-500" />
          {isSearchOpen && query.trim() && (
            <div id="page-search-results" className="absolute right-0 top-full z-50 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              {matches.length ? matches.map(item => (
                <button type="button" key={item.path} onClick={() => go(item.path)} className="flex w-full items-center gap-3 border-b border-slate-50 px-4 py-3 text-right text-sm text-slate-700 last:border-0 hover:bg-primary-50 hover:text-primary-700">
                  <span className="shrink-0">{item.icon}</span><span>{item.label}</span>
                </button>
              )) : <p role="status" className="px-4 py-4 text-center text-sm text-slate-500">لا توجد صفحة مطابقة</p>}
            </div>
          )}
        </form>

        <div ref={notificationsRef} className="relative order-2 sm:order-3">
          <button id="notifications-button" ref={notificationsButtonRef} type="button"
            onClick={() => {
              if (!isNotificationsOpen && !readingNotification.current) void loadNotifications();
              setIsNotificationsOpen(!isNotificationsOpen);
              setIsSearchOpen(false);
            }}
            className="relative rounded-lg p-2.5 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary-500"
            aria-label="الإشعارات" aria-expanded={isNotificationsOpen} aria-controls="notifications-menu">
            <Bell size={20} />
            {notificationFeed.unread_count > 0 && <span className="absolute -left-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{notificationFeed.unread_count > 99 ? '99+' : notificationFeed.unread_count}</span>}
          </button>
          {isNotificationsOpen && (
            <div id="notifications-menu" role="region" aria-labelledby="notifications-button" className="absolute left-0 z-50 mt-3 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><span className="text-sm font-semibold text-slate-900">الإشعارات</span>{notificationFeed.unread_count > 0 && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">{notificationFeed.unread_count} جديد</span>}</div>
              <div className="max-h-[min(24rem,60dvh)] overflow-y-auto">
                {notificationsLoading ? <p role="status" className="px-4 py-8 text-center text-sm text-slate-500">جاري تحميل الإشعارات...</p>
                  : notificationsError ? <div className="px-4 py-6 text-center"><p role="alert" className="text-sm text-red-700">{notificationsError}</p><button type="button" onClick={() => void loadNotifications()} className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">إعادة المحاولة</button></div>
                  : !notificationFeed.notifications.length ? <p role="status" className="px-4 py-8 text-center text-sm text-slate-500">لا توجد إشعارات جديدة</p>
                  : notificationFeed.notifications.map(notification => (
                    <button type="button" key={notification.notification_key} disabled={pendingRead}
                      onClick={() => void openNotification(notification.notification_key, notification.reference_type)}
                      className={`block w-full border-b border-slate-100 px-4 py-3 text-right last:border-0 hover:bg-slate-50 disabled:opacity-60 ${notification.read_at == null ? 'bg-blue-50/70' : 'bg-white'}`}>
                      <span className="flex items-start justify-between gap-2"><strong className="text-sm text-slate-900">{notification.title}</strong>{notification.read_at == null && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-600" />}</span>
                      <span className="mt-1 block break-words text-xs leading-5 text-slate-600">{notification.body}</span>
                      <span className="mt-1 block text-[11px] text-slate-500">{new Date(notification.created_at * 1000).toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad' })}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
