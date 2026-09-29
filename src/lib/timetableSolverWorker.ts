import { solvePreparedTimetable, type PreparedTimetableSolver } from './timetableSolverPrepared.ts';
import { TimetableSolverSafetyLimitError } from './timetableSolver.ts';
import type { TimetableSolverWorkerResponse } from './timetableSolverClient.ts';

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<PreparedTimetableSolver>) => void) | null;
  postMessage: (message: TimetableSolverWorkerResponse) => void;
};
worker.onmessage = async event => {
  try {
    worker.postMessage({ok: true, data: await solvePreparedTimetable(event.data)});
  } catch (error) {
    worker.postMessage({ok: false, error: error instanceof TimetableSolverSafetyLimitError
      ? 'استغرق التوليد وقتًا أطول من المسموح. اختر صفًا أو شعبة لتوليد نطاق أصغر ثم أعد المحاولة.'
      : 'تعذر بناء اقتراح الجدول. أعد المحاولة وراجع بيانات النصاب والقيود إذا استمرت المشكلة.'});
  }
};
