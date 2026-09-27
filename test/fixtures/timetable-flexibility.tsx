// Synthetic, local-only UI fixture. It has no authenticated endpoints or writes.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import {MasterTimetableTab} from '../../src/modules/timetable/MasterTimetableTab';
import {WeekSetupTab} from '../../src/modules/timetable/WeekSetupTab';
import {parseWeekRequest, planWeekSetup, publicWeekSnapshot, type WeekContext} from '../../src/lib/weekSetup';
import {printFixture} from '../helpers/timetable-print-fixture.mjs';

const data = printFixture();
// Fill the print sample so layout checks exercise realistic Arabic text density.
data.entries = data.slots.filter(slot => slot.slot_type === 'lesson').flatMap(slot => [
  {classId: 1, sectionId: 11, className: 'الأول الابتدائي', sectionName: 'أ'},
  {classId: 1, sectionId: 12, className: 'الأول الابتدائي', sectionName: 'ب'},
  {classId: 2, sectionId: null, className: 'الأول المتوسط', sectionName: null},
].map((placement, index) => ({...data.entries[0], id: slot.id * 10 + index, slot_id: slot.id,
  class_id: placement.classId, section_id: placement.sectionId, class_name: placement.className, section_name: placement.sectionName,
  subject_name: ['اللغة العربية', 'الرياضيات', 'التربية الإسلامية'][slot.lesson_number! % 3], employee_name: 'المدرسة فاطمة عبد الرحمن'})));
const loadGrid = async () => ({data});
const context: WeekContext = {school_id: 1, academic_year_id: 1, revision: 0, days: data.days, slots: data.slots, loads: [], entries: [], availability: [], constraints: [], history: []};
const api = {
  load: async () => ({data: publicWeekSnapshot(context)}),
  preview: async input => ({data: await planWeekSetup(context, parseWeekRequest(input))}),
  apply: async () => ({error: 'معاينة محلية فقط؛ لا يوجد حفظ للبيانات في نموذج الاختبار.'}),
};
function Fixture() {
  const [week, setWeek] = useState(false);
  return <div className="min-h-screen bg-gray-50" dir="rtl">
    <aside className="no-print fixed right-0 top-0 hidden h-screen w-64 bg-slate-900 p-6 text-white lg:block">المدرسة الذكية — بيانات اختبار محلية</aside>
    <div className="min-h-screen lg:mr-64"><header className="no-print flex gap-3 bg-white p-4"><button onClick={() => setWeek(false)}>معاينة الطباعة</button><button onClick={() => setWeek(true)}>إعداد الأسبوع</button></header>
      <main className="p-3 sm:p-6">{week
        ? <WeekSetupTab schoolId={1} academicYearId={1} dataVersion={0} api={api} onDirtyChange={() => {}} onChanged={() => {}} onEditSlot={() => {}} onDeleteSlot={() => {}} onDayChange={() => {}} />
        : <MasterTimetableTab schoolId={1} academicYearId={1} dataVersion={0} onOpenRepair={() => {}} loadGrid={loadGrid} />}</main>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
