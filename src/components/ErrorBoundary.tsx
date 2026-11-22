import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// A render error in one page must not blank the whole app. The boundary shows
// a recoverable message; `resetKey` (the route path) clears it on navigation.
// A failed lazy chunk after a new deploy is the common case: reloading fixes it.

interface Props { children: ReactNode; resetKey?: string; }
interface State { error: Error | null; }

export function isChunkLoadError(error: unknown): boolean {
  const text = `${(error as Error)?.name ?? ''} ${(error as Error)?.message ?? ''}`;
  return /ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(text);
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Details stay in the console; the screen shows no stack or internal text.
    console.error('[ui] render error', error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <div role="alert" dir="rtl" className="mx-auto my-10 max-w-lg rounded-xl border border-red-100 bg-white p-6 text-center shadow-sm">
        <AlertTriangle className="mx-auto mb-3 text-red-500" size={32} />
        <h2 className="text-lg font-bold text-gray-900">{stale ? 'تم تحديث البرنامج' : 'حدث خطأ غير متوقع في هذه الصفحة'}</h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          {stale ? 'نزلت نسخة جديدة من البرنامج. أعد تحميل الصفحة للمتابعة.' : 'بياناتك المحفوظة سليمة. أعد تحميل الصفحة أو ارجع للصفحة الرئيسية، وإذا تكرر الخطأ أبلغ الإدارة.'}
        </p>
        <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
          <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
            <RefreshCw size={16} />إعادة تحميل الصفحة
          </button>
          {!stale && <a href="/" className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">الصفحة الرئيسية</a>}
        </div>
      </div>
    );
  }
}
