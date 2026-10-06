import { useLayoutEffect, useRef, type RefObject } from 'react';

// The print preview can open above a details dialog. Only the top dialog owns focus.
const dialogs: HTMLElement[] = [];
const inertElements = new Map<HTMLElement, { count: number; original: boolean }>();
let bodyOverflow = '';

export function useRegisterDialog(ref: RefObject<HTMLDivElement | null>, onClose: () => void, busy = false) {
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const background: HTMLElement[] = [];
    // Cover siblings at every level, including dialogs rendered inside the app root.
    let branch: HTMLElement = dialog;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement && !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) {
          const existing = inertElements.get(sibling);
          inertElements.set(sibling, { count: (existing?.count || 0) + 1, original: existing?.original ?? sibling.inert });
          background.push(sibling);
          sibling.inert = true;
        }
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    if (!dialogs.length) bodyOverflow = document.body.style.overflow;
    dialogs.push(dialog);
    document.body.style.overflow = 'hidden';
    dialog.focus({ preventScroll: true });
    const isTop = () => dialogs[dialogs.length - 1] === dialog;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex]')).filter(element => {
      if (element.tabIndex < 0 || element.matches(':disabled') || element.closest('fieldset[disabled],[hidden],[inert],[aria-hidden="true"]')) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    const onKey = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!latest.current.busy) latest.current.onClose();
      }
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      const outside = !dialog.contains(document.activeElement) || document.activeElement === dialog;
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
    };
    const onFocus = (event: FocusEvent) => {
      if (isTop() && event.target instanceof Node && !dialog.contains(event.target)) dialog.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      const wasTop = isTop();
      const position = dialogs.indexOf(dialog);
      if (position !== -1) dialogs.splice(position, 1);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      for (const element of background) {
        const state = inertElements.get(element);
        if (state && --state.count === 0) { element.inert = state.original; inertElements.delete(element); }
      }
      if (!dialogs.length) document.body.style.overflow = bodyOverflow;
      if (wasTop && previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
    };
  }, [ref]);
}
