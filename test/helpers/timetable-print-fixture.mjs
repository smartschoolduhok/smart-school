export function printFixture() {
  const classes = [
    {id: 1, school_id: 1, name: 'الأول', stage: 'ابتدائي', status: 'active', order_index: 1},
    {id: 2, school_id: 1, name: 'الأول المتوسط', stage: 'متوسط', status: 'active', order_index: 2},
    {id: 3, school_id: 1, name: 'مؤرشف', stage: 'ابتدائي', status: 'archived', order_index: 3},
  ];
  const sections = [{id: 11, school_id: 1, class_id: 1, name: 'أ', status: 'active'}, {id: 12, school_id: 1, class_id: 1, name: 'ب', status: 'active'}];
  const days = [0, 1, 2, 3, 4].map(day => ({id: day + 1, school_id: 1, academic_year_id: 1, day_of_week: day, is_active: 1, order_index: day}));
  let id = 0;
  const slots = days.flatMap((day, i) => {
    const count = [7, 6, 7, 5, 6][i];
    return Array.from({length: count + 1}, (_, j) => {
      const start = 8 * 60 + j * 40;
      const time = n => `${Math.floor(n / 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
      return {id: ++id, school_id: 1, academic_year_id: 1, day_of_week: day.day_of_week, slot_index: j + 1, slot_type: j === 3 ? 'break' : 'lesson', lesson_number: j === 3 ? null : j < 3 ? j + 1 : j,
        label: j === 3 ? 'استراحة' : `حصة ${j < 3 ? j + 1 : j}`, start_time: time(start), end_time: time(start + 40), is_active: 1};
    });
  });
  const entry = (id, classId, sectionId, subject) => ({id, school_id: 1, academic_year_id: 1, slot_id: slots[0].id, teaching_load_id: id, subject_id: id,
    class_id: classId, class_name: classes.find(c => c.id === classId).name, section_id: sectionId, section_name: sectionId === 11 ? 'أ' : sectionId === 12 ? 'ب' : null,
    subject_name: subject, employee_id: 7, employee_name: 'سارة', is_locked: 1, hard_conflicts: [], warnings: []});
  return {school: {id: 1, name: 'مدرسة الاختبار', logo_url: null}, academic_year: {id: 1, name: '2026–2027'}, classes, sections, days, slots,
    teachers: [{id: 7, school_id: 1, full_name: 'سارة', status: 'active'}], subjects: [], loads: [], entries: [entry(1, 1, null, 'رياضيات مشتركة'), entry(2, 2, null, 'فيزياء')], invalid_entries: [], invalid_entry_count: 0};
}
