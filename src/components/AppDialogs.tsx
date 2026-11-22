import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { AlertTriangle, Info } from 'lucide-react';

// In-app replacements for window.alert/confirm/prompt: RTL, readable on
// phones, keyboard friendly. Call sites await them. When no <AppDialogHost>
// is mounted (a page rendered on its own, e.g. in tests) they fall back to the
// browser dialogs, so behaviour never silently changes to "always cancel".

type DialogKind = 'alert' | 'confirm' | 'prompt';
export interface DialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive or irreversible actions. */
  danger?: boolean;
}
export interface PromptOptions extends DialogOptions {
  defaultValue?: string;
  /** Prompts require a non-empty answer unless this is false. */
  required?: boolean;
  multiline?: boolean;
}
interface DialogRequest extends PromptOptions {
  id: number;
  kind: DialogKind;
  message: string;
  resolve: (value: boolean | string | null) => void;
}

let nextId = 1;
let hosts = 0;
let queue: DialogRequest[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const current = () => queue[0] ?? null;

function enqueue<T extends boolean | string | null>(kind: DialogKind, message: string, options: PromptOptions): Promise<T> {
  return new Promise<T>(resolve => {
    queue = [...queue, { ...options, id: nextId++, kind, message, resolve: resolve as DialogRequest['resolve'] }];
    emit();
  });
}

function settle(value: boolean | string | null) {
  const [head, ...rest] = queue;
  if (!head) return;
  queue = rest;
  emit();
  head.resolve(value);
}

const hasBrowser = () => typeof window !== 'undefined';

export function appAlert(message: string, options: DialogOptions = {}): Promise<void> {
  if (!hosts) { if (hasBrowser() && typeof window.alert === 'function') window.alert(message); return Promise.resolve(); }
  return enqueue<boolean>('alert', message, options).then(() => undefined);
}

export function appConfirm(message: string, options: DialogOptions = {}): Promise<boolean> {
  if (!hosts) return Promise.resolve(hasBrowser() && typeof window.confirm === 'function' ? window.confirm(message) : false);
  return enqueue<boolean>('confirm', message, options);
}

export function appPrompt(message: string, options: PromptOptions = {}): Promise<string | null> {
  if (!hosts) return Promise.resolve(hasBrowser() && typeof window.prompt === 'function' ? window.prompt(message, options.defaultValue) : null);
  return enqueue<string | null>('prompt', message, options);
}

/** Test/diagnostic hook: number of mounted hosts and pending dialogs. */
export function appDialogState() { return { hosts, pending: queue.length }; }

const DEFAULT_TITLES: Record<DialogKind, string> = { alert: 'تنبيه', confirm: 'تأكيد', prompt: 'مطلوب إدخال' };

export function AppDialogHost() {
  useEffect(() => {
    hosts += 1;
    return () => {
      hosts -= 1;
      // A host unmounting with open dialogs must not leave callers waiting forever.
      if (!hosts) { const pending = queue; queue = []; emit(); for (const request of pending) request.resolve(request.kind === 'confirm' ? false : null); }
    };
  }, []);
  const request = useSyncExternalStore(subscribe, current, () => null);
  return request ? <DialogPanel key={request.id} request={request} /> : null;
}

function DialogPanel({ request }: { request: DialogRequest }) {
  const [value, setValue] = useState(request.defaultValue ?? '');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const returnFocus = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const isPrompt = request.kind === 'prompt';
  const required = isPrompt && request.required !== false;
  const blocked = required && value.trim() === '';

  useEffect(() => {
    (isPrompt ? inputRef.current : confirmRef.current)?.focus();
    const previous = returnFocus.current;
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [isPrompt]);

  const cancel = () => settle(request.kind === 'confirm' ? false : request.kind === 'alert' ? true : null);
  const accept = () => {
    if (blocked) return;
    settle(isPrompt ? value.trim() : true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    if (event.key === 'Enter' && !(request.multiline && isPrompt) && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); accept(); }
    if (event.key === 'Tab') {
      // Keep focus inside the dialog.
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('input,textarea,button:not([disabled])')];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };

  const titleId = `app-dialog-title-${request.id}`, messageId = `app-dialog-message-${request.id}`;
  const Icon = request.danger ? AlertTriangle : Info;
  const field = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-3 sm:items-center sm:p-4" dir="rtl"
      onMouseDown={event => { if (event.target === event.currentTarget && request.kind !== 'prompt') cancel(); }}>
      <div role={request.kind === 'alert' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}
        onKeyDown={onKeyDown} className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-start gap-3 p-4 sm:p-5">
          <span className={`mt-0.5 shrink-0 rounded-full p-2 ${request.danger ? 'bg-red-50 text-red-600' : 'bg-primary-50 text-primary-600'}`}><Icon size={18} /></span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold text-gray-900">{request.title ?? DEFAULT_TITLES[request.kind]}</h2>
            <p id={messageId} className="mt-1.5 whitespace-pre-line break-words text-sm leading-6 text-gray-700">{request.message}</p>
            {isPrompt && (request.multiline
              ? <textarea ref={inputRef} rows={3} value={value} onChange={event => setValue(event.target.value)} aria-labelledby={messageId} className={`${field} mt-3`} />
              : <input ref={inputRef} value={value} onChange={event => setValue(event.target.value)} aria-labelledby={messageId} className={`${field} mt-3`} />)}
            {isPrompt && blocked && <p className="mt-1 text-xs text-gray-500">هذا الحقل مطلوب.</p>}
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 p-3 sm:flex-row sm:justify-start sm:p-4">
          <button ref={confirmRef} type="button" onClick={accept} disabled={blocked}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${request.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'}`}>
            {request.confirmLabel ?? (request.kind === 'alert' ? 'حسنًا' : 'تأكيد')}
          </button>
          {request.kind !== 'alert' && (
            <button type="button" onClick={cancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              {request.cancelLabel ?? 'إلغاء'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
