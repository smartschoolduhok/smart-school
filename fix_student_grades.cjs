const fs = require('fs');
let g = fs.readFileSync('src/modules/grades/GradesPage.tsx', 'utf8');

// 1) Improve table headers with clearer labels and grouping
const oldHeaders = `<tr className="bg-gray-50 text-gray-600 text-xs">
                  <th className="px-3 py-2 text-right font-medium border-b border-gray-200">المادة</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">الشهر الأول</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">الشهر الثاني</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">معدل الفصل الأول</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">نصف السنة</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">الشهر الثالث</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">الشهر الرابع</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">معدل الفصل الثاني</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">السعي السنوي</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">الامتحان النهائي</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">الدرجة النهائية</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">درجة الإكمال</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">الحالة</th>
                  <th className="px-2 py-2 text-center font-medium border-b border-gray-200 w-24">ملاحظات</th>
                </tr>`;

const newHeaders = `<tr className="bg-gray-50 text-gray-600 text-xs">
                  <th rowSpan={2} className="px-3 py-2 text-right font-medium border-b border-gray-200 align-middle">المادة</th>
                  <th colSpan={3} className="px-2 py-1 text-center font-medium border-b border-gray-200 border-l border-gray-200 bg-blue-50/40">الفصل الأول</th>
                  <th colSpan={3} className="px-2 py-1 text-center font-medium border-b border-gray-200 border-l border-gray-200 bg-emerald-50/40">الفصل الثاني</th>
                  <th colSpan={3} className="px-2 py-1 text-center font-medium border-b border-gray-200 border-l border-gray-200 bg-amber-50/40">السنوي</th>
                  <th colSpan={2} className="px-2 py-1 text-center font-medium border-b border-gray-200 border-l border-gray-200 bg-rose-50/40">النهائي</th>
                  <th rowSpan={2} className="px-2 py-2 text-center font-medium border-b border-gray-200 w-20 align-middle">الحالة</th>
                  <th rowSpan={2} className="px-2 py-2 text-center font-medium border-b border-gray-200 w-20 align-middle">ملاحظات</th>
                </tr>
                <tr className="bg-gray-50 text-gray-500 text-[10px]">
                  {/* First term sub-columns */}
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">الشهر ١</th>
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">الشهر ٢</th>
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">نصف السنة</th>
                  {/* Second term sub-columns */}
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">الشهر ٣</th>
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">الشهر ٤</th>
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">معدل الفصل</th>
                  {/* Annual sub-columns */}
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">السعي</th>
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">النهائي</th>
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">الدرجة</th>
                  {/* Final sub-columns */}
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">الإكمال</th>
                  <th className="px-1 py-1 text-center font-medium border-b border-gray-200 w-20">الفعّالة</th>
                </tr>`;

if (!g.includes(oldHeaders)) {
  console.error('Could not find old headers pattern');
  process.exit(1);
}
g = g.replace(oldHeaders, newHeaders);

// 2) Fix the table body to match the new header structure (7 editable + 5 read-only + status + notes)
// Currently maps ['first_month','second_month','mid_year_exam','third_month','fourth_month','final_exam','completion_exam']
// Read-only shows: first_term_average, second_term_average, annual_effort, final_grade, completion_exam
// We need: first_month, second_month, mid_year_exam, third_month, fourth_month, final_exam, completion_exam (7 editable)
// Read-only: first_term_average, second_term_average, annual_effort, final_grade, effective_grade (or completion_exam duplicated?)
// Actually looking at original: editable = first_month, second_month, mid_year_exam, third_month, fourth_month, final_exam, completion_exam
// Read-only = first_term_average, second_term_average, annual_effort, final_grade, completion_exam
// That's 7 + 5 + status + notes = 14 columns. But original had 13 data cols + status + notes = 15 th columns.
// Wait let me re-count:
// Original th: المادة, الشهر1, الشهر2, معدل الفصل1, نصف السنة, الشهر3, الشهر4, معدل الفصل2, السعي, النهائي, الدرجة, الإكمال, الحالة, ملاحظات = 14 cols
// Original td: المادة + 7 editable + 5 read-only (معدل1, معدل2, سعي, نهائي, إكمال) + الحالة + ملاحظات = 1+7+5+1+1=15 cols?
// Wait: editable = first_month, second_month, mid_year_exam, third_month, fourth_month, final_exam, completion_exam = 7 inputs
// read-only = first_term_average, second_term_average, annual_effort, final_grade, completion_exam = 5
// But completion_exam appears in both! In editable and read-only. That's a bug - it's shown twice.
// Let me look at original code more carefully.

// In the original tbody:
// 1. g.subject_name
// 2-8. editable fields: first_month, second_month, mid_year_exam, third_month, fourth_month, final_exam, completion_exam
// 9. first_term_average (read-only)
// 10. second_term_average (read-only)
// 11. annual_effort (read-only)
// 12. final_grade (read-only)
// 13. completion_exam (read-only) - THIS IS DUPLICATED!
// 14. statusBadge
// 15. notes input

// The headers were: المادة, الشهر1, الشهر2, معدل1, نصف, الشهر3, الشهر4, معدل2, سعي, نهائي, درجة, إكمال, حالة, ملاحظات = 14
// Wait that doesn't match. Let me re-read.
// Headers: المادة(1), الشهر الأول(2), الشهر الثاني(3), معدل الفصل الأول(4), نصف السنة(5), الشهر الثالث(6), الشهر الرابع(7), معدل الفصل الثاني(8), السعي السنوي(9), الامتحان النهائي(10), الدرجة النهائية(11), درجة الإكمال(12), الحالة(13), ملاحظات(14) = 14 th
// Body: td(1), 7 editable inputs(2-8), 5 read-only tds(9-13), status(14), notes(15) = 15 td
// That's off by 1. The completion_exam is duplicated.

// In the new header structure I want:
// Row1: المادة | الفصل الأول(3) | الفصل الثاني(3) | السنوي(3) | النهائي(2) | الحالة | ملاحظات = 1+3+3+3+2+1+1 = 14 th spanning
// Row2: | شهر1 | شهر2 | نصف | شهر3 | شهر4 | معدل | سعي | نهائي | درجة | إكمال | فعّالة | | = 12 sub th
// Total columns = 14
// Body needs 14 tds.

// Let's fix the body: 
// 1. subject_name
// 2. first_month (editable)
// 3. second_month (editable)
// 4. mid_year_exam (editable)
// 5. third_month (editable)
// 6. fourth_month (editable)
// 7. second_term_average (read-only)
// 8. annual_effort (read-only)
// 9. final_exam (editable)
// 10. final_grade (read-only)
// 11. completion_exam (editable)
// 12. effective_grade (read-only) or completion_exam read-only... Actually let me think about what makes sense.

// Hmm, the original code structure is quite complex. Let me be more careful. The original maps over fields:
// ['first_month','second_month','mid_year_exam','third_month','fourth_month','final_exam','completion_exam']
// Then shows read-only: first_term_average, second_term_average, annual_effort, final_grade, completion_exam

// Wait, first_term_average isn't in the editable list but is shown as read-only. The editable list has 7 items.
// first_term_average would be computed from first_month + second_month + mid_year_exam.
// second_term_average from third_month + fourth_month.

// For the new layout with 14 columns:
// 1. subject_name
// 2. first_month (editable)
// 3. second_month (editable)
// 4. mid_year_exam (editable)
// 5. third_month (editable)
// 6. fourth_month (editable)
// 7. first_term_average (read-only) - computed
// 8. second_term_average (read-only) - computed
// 9. annual_effort (read-only) - computed
// 10. final_exam (editable)
// 11. final_grade (read-only) - computed
// 12. completion_exam (editable)
// 13. result_status (read-only badge)
// 14. notes (editable)

// But the headers I proposed have:
// First term: month1, month2, mid_year (3 cols)
// Second term: month3, month4, term_avg (3 cols)
// Annual: effort, final_exam, final_grade (3 cols)
// Final: completion, effective (2 cols)
// Total data = 3+3+3+2 = 11 + subject = 12 + status + notes = 14

// Let me rebuild the entire tbody section carefully.

const oldTbodyStart = `<tbody>
                {grades.map((g) => (
                  <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 border-b border-gray-100 font-medium text-gray-900">{g.subject_name}</td>
                    {(['first_month','second_month','mid_year_exam','third_month','fourth_month','final_exam','completion_exam'] as const).map((field) => (
                      <td key={field} className="px-1 py-1 border-b border-gray-100">
                        <input
                          type="text"
                          inputMode="numeric"
                          defaultValue={displayNum(g[field] as any)}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            const current = g[field] === null ? '' : toArabicDigits(String(g[field]));
                            if (val !== current) handleSaveGrade(g, field, val);
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className="w-full px-1.5 py-1 text-center text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                          placeholder="—"
                        />
                      </td>
                    ))}
                    {/* Read-only calculated fields */}
                    <td className="px-2 py-2 border-b border-gray-100 text-center text-gray-600 font-medium bg-gray-50/50">{displayNum(g.first_term_average)}</td>
                    <td className="px-2 py-2 border-b border-gray-100 text-center text-gray-600 font-medium bg-gray-50/50">{displayNum(g.second_term_average)}</td>
                    <td className="px-2 py-2 border-b border-gray-100 text-center text-gray-600 font-medium bg-gray-50/50">{displayNum(g.annual_effort)}</td>
                    <td className="px-2 py-2 border-b border-gray-100 text-center text-gray-600 font-medium bg-gray-50/50">{displayNum(g.final_grade)}</td>
                    <td className="px-2 py-2 border-b border-gray-100 text-center text-gray-600 font-medium bg-gray-50/50">{displayNum(g.completion_exam)}</td>
                    <td className="px-2 py-2 border-b border-gray-100 text-center">{statusBadge(g.result_status)}</td>
                    <td className="px-1 py-1 border-b border-gray-100">
                      <input
                        type="text"
                        defaultValue={g.notes || ''}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val !== (g.notes || '')) handleSaveGrade(g, 'notes', val);
                        }}
                        className="w-full px-1.5 py-1 text-center text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        placeholder="—"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>`;

const newTbodyStart = `<tbody>
                {grades.map((g) => (
                  <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 border-b border-gray-100 font-medium text-gray-900">{g.subject_name}</td>
                    {/* First term: editable */}
                    {(['first_month','second_month','mid_year_exam'] as const).map((field) => (
                      <td key={field} className="px-1 py-1 border-b border-gray-100">
                        <input
                          type="text"
                          inputMode="numeric"
                          defaultValue={displayNum(g[field] as any)}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            const current = g[field] === null ? '' : toArabicDigits(String(g[field]));
                            if (val !== current) handleSaveGrade(g, field, val);
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className="w-full px-1.5 py-1 text-center text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                          placeholder="—"
                        />
                      </td>
                    ))}
                    {/* Second term: editable */}
                    {(['third_month','fourth_month'] as const).map((field) => (
                      <td key={field} className="px-1 py-1 border-b border-gray-100">
                        <input
                          type="text"
                          inputMode="numeric"
                          defaultValue={displayNum(g[field] as any)}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            const current = g[field] === null ? '' : toArabicDigits(String(g[field]));
                            if (val !== current) handleSaveGrade(g, field, val);
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className="w-full px-1.5 py-1 text-center text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                          placeholder="—"
                        />
                      </td>
                    ))}
                    {/* Second term average: read-only */}
                    <td className="px-1 py-1 border-b border-gray-100 text-center text-gray-600 font-medium bg-gray-50/50">{displayNum(g.second_term_average)}</td>
                    {/* Annual: read-only effort */}
                    <td className="px-1 py-1 border-b border-gray-100 text-center text-gray-700 font-semibold bg-amber-50/30">{displayNum(g.annual_effort)}</td>
                    {/* Final exam: editable */}
                    <td className="px-1 py-1 border-b border-gray-100">
                      <input
                        type="text"
                        inputMode="numeric"
                        defaultValue={displayNum(g.final_exam as any)}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          const current = g.final_exam === null ? '' : toArabicDigits(String(g.final_exam));
                          if (val !== current) handleSaveGrade(g, 'final_exam', val);
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="w-full px-1.5 py-1 text-center text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        placeholder="—"
                      />
                    </td>
                    {/* Final grade: read-only */}
                    <td className="px-1 py-1 border-b border-gray-100 text-center text-gray-700 font-semibold bg-amber-50/30">{displayNum(g.final_grade)}</td>
                    {/* Completion exam: editable */}
                    <td className="px-1 py-1 border-b border-gray-100">
                      <input
                        type="text"
                        inputMode="numeric"
                        defaultValue={displayNum(g.completion_exam as any)}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          const current = g.completion_exam === null ? '' : toArabicDigits(String(g.completion_exam));
                          if (val !== current) handleSaveGrade(g, 'completion_exam', val);
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="w-full px-1.5 py-1 text-center text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        placeholder="—"
                      />
                    </td>
                    {/* Effective grade: read-only (same as completion or final) */}
                    <td className="px-1 py-1 border-b border-gray-100 text-center text-gray-700 font-semibold bg-rose-50/30">{displayNum(g.effective_grade ?? g.final_grade)}</td>
                    {/* Status */}
                    <td className="px-2 py-2 border-b border-gray-100 text-center">{statusBadge(g.result_status)}</td>
                    {/* Notes */}
                    <td className="px-1 py-1 border-b border-gray-100">
                      <input
                        type="text"
                        defaultValue={g.notes || ''}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val !== (g.notes || '')) handleSaveGrade(g, 'notes', val);
                        }}
                        className="w-full px-1.5 py-1 text-center text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        placeholder="—"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>`;

if (!g.includes(oldTbodyStart)) {
  console.error('Could not find old tbody pattern');
  process.exit(1);
}
g = g.replace(oldTbodyStart, newTbodyStart);

// 3) Add helper text below the table with clearer labels
const oldTableEnd = `</table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   Tab 2: إدخال درجات شعبة`;

const newTableEnd = `</table>
          </div>
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 space-y-1">
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block"></span> الفصل الأول: الشهر ١ + الشهر ٢ + نصف السنة</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span> الفصل الثاني: الشهر ٣ + الشهر ٤</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span> السعي السنوي = معدل الفصل الأول + معدل الفصل الثاني</span>
            </p>
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block"></span> الدرجة الفعّالة = النهائي (أو الإكمال إذا أقل من النجاح)</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block"></span> الحقول الرمادية تُحسب تلقائيًا</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   Tab 2: إدخال درجات شعبة`;

if (!g.includes(oldTableEnd)) {
  console.error('Could not find old table end pattern');
  process.exit(1);
}
g = g.replace(oldTableEnd, newTableEnd);

// 4) Also update the save success message in handleSaveGrade to be clearer
const oldSaveMsg = `setMessage({ text: 'تم حفظ الدرجة بنجاح', type: 'success' });`;
const newSaveMsg = `setMessage({ text: 'تم حفظ الدرجة بنجاح — اضغط Enter أو انقر خارج الحقل لحفظ القيمة', type: 'success' });`;

if (g.includes(oldSaveMsg)) {
  g = g.replace(oldSaveMsg, newSaveMsg);
}

fs.writeFileSync('src/modules/grades/GradesPage.tsx', g, 'utf8');
console.log('StudentGradesTab updated successfully');
