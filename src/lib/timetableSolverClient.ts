import type { PreparedTimetableSolver } from './timetableSolverPrepared.ts';
import type { TimetableSolverProposalWithIntegrity } from './timetableAdoption.ts';

export type TimetableSolverWorkerResponse = {ok: true; data: TimetableSolverProposalWithIntegrity} | {ok: false; error: string};
type SolverWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;

/** There is deliberately no synchronous fallback: solving must never block the page. */
export function solveTimetableInWorker(prepared: PreparedTimetableSolver, options: {
  signal?: AbortSignal;
  timeoutMs?: number;
  createWorker?: () => SolverWorker;
} = {}): Promise<TimetableSolverProposalWithIntegrity> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException('تم إلغاء التوليد', 'AbortError')); return; }
    let worker: SolverWorker;
    try {
      worker = options.createWorker ? options.createWorker()
        : new Worker(new URL('./timetableSolverWorker.ts', import.meta.url), {type: 'module'});
    } catch {
      reject(new Error('تعذر بدء التوليد في هذا المتصفح. حدّث الصفحة ثم أعد المحاولة.'));
      return;
    }
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (data?: TimetableSolverProposalWithIntegrity, error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
      if (error) reject(error); else resolve(data!);
    };
    const abort = () => finish(undefined, new DOMException('تم إلغاء التوليد', 'AbortError'));
    options.signal?.addEventListener('abort', abort, {once: true});
    worker.onmessage = (event: MessageEvent<TimetableSolverWorkerResponse>) => {
      const message = event.data;
      if (message?.ok === true && Array.isArray(message.data?.entries) && typeof message.data?.proposal_digest === 'string') finish(message.data);
      else finish(undefined, new Error(message?.ok === false && typeof message.error === 'string'
        ? message.error : 'تعذر قراءة نتيجة التوليد. أعد المحاولة.'));
    };
    worker.onerror = () => finish(undefined, new Error('تعذر تشغيل التوليد. حدّث الصفحة وأعد المحاولة.'));
    worker.onmessageerror = () => finish(undefined, new Error('تعذر نقل بيانات التوليد. أعد المحاولة.'));
    timer = setTimeout(() => finish(undefined, new Error('استغرق التوليد وقتًا طويلًا. اختر صفًا أو شعبة لتوليد نطاق أصغر ثم أعد المحاولة.')), options.timeoutMs ?? 30_000);
    try { worker.postMessage(prepared); }
    catch { finish(undefined, new Error('تعذر إرسال بيانات الجدول للتوليد. أعد المحاولة.')); }
  });
}
