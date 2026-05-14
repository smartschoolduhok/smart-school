// ===========================================
// Phase 6: Result Cards + QR Verification
// ===========================================

function canGenerateResultCards(roleKey: RoleKey): boolean {
  return ['system_admin', 'school_owner', 'principal', 'vice_principal'].includes(roleKey);
}

function generateVerificationToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 32; i++) {
    token += chars[buf[i] % chars.length];
  }
  return token;
}

async function hashToken(token: string): Promise<string> {
  const data = stringToBuffer(token + 'smart-school-verification-salt-2026');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateCardNumber(schoolId: number, studentId: number): string {
  const ts = Math.floor(Date.now() / 1000);
  return `RC-${schoolId}-${studentId}-${ts}`;
}

function toArabicIndic(num: number | null | undefined): string {
  if (num === null || num === undefined) return '';
  return String(num).replace(/\d/g, d => String.fromCharCode(0x0660 + parseInt(d, 10)));
}

// GET /api/result-cards
// ===========================================
app.get('/api/result-cards', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  try {
    const query = c.req.query();
    const classId = query.class_id ? parseInt(query.class_id, 10) : null;
    const sectionId = query.section_id ? parseInt(query.section_id, 10) : null;
    const studentId = query.student_id ? parseInt(query.student_id, 10) : null;
    const status = query.status || null;

    let sql = `SELECT rc.id, rc.card_number, rc.student_name_snapshot, rc.class_name_snapshot, rc.section_name_snapshot, rc.school_name_snapshot, rc.academic_year_snapshot, rc.general_exemption_status, rc.overall_result_status, rc.generated_at, rc.printed_at, rc.status, rc.verification_token FROM result_cards rc WHERE 1=1`;
    const params: any[] = [];

    if (scope === 'single' && resolvedSchoolId) {
      sql += ` AND rc.school_id = ?`;
      params.push(resolvedSchoolId);
    } else if (query.school_id && user?.role_key === 'system_admin') {
      sql += ` AND rc.school_id = ?`;
      params.push(parseInt(query.school_id, 10));
    }

    if (classId) { sql += ` AND rc.class_id = ?`; params.push(classId); }
    if (sectionId) { sql += ` AND rc.section_id = ?`; params.push(sectionId); }
    if (studentId) { sql += ` AND rc.student_id = ?`; params.push(studentId); }
    if (status) { sql += ` AND rc.status = ?`; params.push(status); }

    sql += ` ORDER BY rc.generated_at DESC`;

    const stmt = db.prepare(sql);
    const rows = await stmt.bind(...params).all<any>();
    return c.json({ data: rows.results || [] });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب كارتات النتائج', detail: err.message }, 500);
  }
});

// GET /api/result-cards/:id
// ===========================================
app.get('/api/result-cards/:id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  try {
    const row = await db.prepare(`SELECT * FROM result_cards WHERE id = ?`).bind(id).first<any>();
    if (!row) {
      return c.json({ error: 'كارت النتيجة غير موجود' }, 404);
    }
    if (scope === 'single' && resolvedSchoolId && row.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك الوصول إلى هذا الكارت' }, 403);
    }
    let data = row;
    try {
      data = { ...row, card_data_parsed: JSON.parse(row.card_data_json) };
    } catch { /* leave as-is */ }
    return c.json({ data });
  } catch (err: any) {
    return c.json({ error: 'فشل في جلب كارت النتيجة', detail: err.message }, 500);
  }
});

// POST /api/result-cards/generate-student/:student_id
// ===========================================
app.post('/api/result-cards/generate-student/:student_id', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canGenerateResultCards(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إنشاء كارتات النتائج' }, 403);
  }

  const studentId = parseInt(c.req.param('student_id'), 10);

  try {
    // Fetch student with class/section/school names
    const student = await db.prepare(`
      SELECT s.id, s.school_id, s.full_name, s.student_number, s.class_id, s.section_id,
             c.name AS class_name, sec.name AS section_name, sch.name AS school_name
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN sections sec ON s.section_id = sec.id
      LEFT JOIN schools sch ON s.school_id = sch.id
      WHERE s.id = ? AND s.status = 'active'
    `).bind(studentId).first<any>();

    if (!student) {
      return c.json({ error: 'الطالب غير موجود أو غير فعال' }, 404);
    }

    if (scope === 'single' && resolvedSchoolId && student.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح: لا يمكنك إنشاء كارت لطالب من مدرسة أخرى' }, 403);
    }

    // Active assigned subjects
    const subjectRows = await db.prepare(`
      SELECT su.id, su.name AS subject_name
      FROM student_subjects ss
      INNER JOIN subjects su ON ss.subject_id = su.id
      WHERE ss.student_id = ? AND ss.is_active = 1 AND su.status = 'active'
      ORDER BY su.name
    `).bind(studentId).all<any>();
    const activeSubjects = subjectRows.results || [];

    if (activeSubjects.length === 0) {
      return c.json({ error: 'لا توجد مواد مفعلة مسندة لهذا الطالب' }, 400);
    }

    // Grades for active subjects
    const gradeRows = await db.prepare(`
      SELECT
        su.id AS subject_id,
        su.name AS subject_name,
        g.annual_effort,
        g.final_exam,
        g.final_grade,
        g.completion_exam,
        g.grade_after_completion,
        g.effective_grade,
        g.result_status,
        g.exemption_status,
        g.first_month,
        g.second_month,
        g.third_month,
        g.fourth_month,
        g.mid_year_exam
      FROM grades g
      INNER JOIN student_subjects ss ON g.student_subject_id = ss.id AND ss.is_active = 1
      INNER JOIN subjects su ON ss.subject_id = su.id
      WHERE ss.student_id = ? AND g.is_active = 1
      ORDER BY su.name
    `).bind(studentId).all<any>();
    const grades = gradeRows.results || [];

    // Missing subjects check
    const gradedSubjectIds = new Set(grades.map((g: any) => g.subject_id));
    const missingSubjects = activeSubjects.filter((s: any) => !gradedSubjectIds.has(s.id));
    if (missingSubjects.length > 0) {
      return c.json({
        error: 'درجات ناقصة: لا يمكن إنشاء الكارت حتى يتم إكمال درجات المواد التالية',
        missing_subjects: missingSubjects.map((s: any) => s.subject_name),
      }, 400);
    }

    // Grade settings
    let passingGrade = 50;
    let exemptionGrade = 90;
    let genAvg = 85;
    let genMin = 75;
    const gs = await db.prepare(`
      SELECT passing_grade, exemption_grade, general_exemption_average_grade, general_exemption_min_subject_grade
      FROM grade_settings WHERE school_id = ?
    `).bind(student.school_id).first<any>();
    if (gs) {
      passingGrade = gs.passing_grade;
      exemptionGrade = gs.exemption_grade;
      genAvg = gs.general_exemption_average_grade ?? 85;
      genMin = gs.general_exemption_min_subject_grade ?? 75;
    }

    // Academic year
    const ay = await db.prepare(`SELECT id, name FROM academic_years WHERE school_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`).bind(student.school_id).first<any>();

    // Compute general exemption based on annual_effort only
    const annualEfforts = grades.map((r: any) => r.annual_effort).filter((v: any) => v !== null && v !== undefined && !isNaN(v)) as number[];
    const avgAnnualEffort = annualEfforts.length > 0 ? Math.round(annualEfforts.reduce((a: number, b: number) => a + b, 0) / annualEfforts.length) : null;
    const minAnnualEffort = annualEfforts.length > 0 ? Math.min(...annualEfforts) : null;
    const generalExemptionEligible = annualEfforts.length === grades.length && avgAnnualEffort !== null && avgAnnualEffort >= genAvg && minAnnualEffort !== null && minAnnualEffort >= genMin;

    // Overall result status
    const failCount = grades.filter((g: any) => g.result_status === 'راسب').length;
    const incompleteCount = grades.filter((g: any) => g.result_status === 'مكمل').length;
    const overallStatus = failCount > 0 ? 'راسب' : (incompleteCount > 0 ? 'مكمل' : 'ناجح');

    // Delete any existing active card for same student to avoid duplicates (or keep history; here we regenerate)
    await db.prepare(`UPDATE result_cards SET status = 'cancelled', updated_at = unixepoch() WHERE student_id = ? AND status = 'active'`).bind(studentId).run();

    const token = generateVerificationToken();
    const tokenHash = await hashToken(token);
    const cardNumber = generateCardNumber(student.school_id, studentId);

    const cardData = {
      school: { id: student.school_id, name: student.school_name },
      student: { id: studentId, name: student.full_name, student_number: student.student_number },
      class: { id: student.class_id, name: student.class_name },
      section: { id: student.section_id, name: student.section_name },
      academic_year: ay ? { id: ay.id, name: ay.name } : null,
      settings: { passing_grade: passingGrade, exemption_grade: exemptionGrade, general_exemption_average_grade: genAvg, general_exemption_min_subject_grade: genMin },
      subjects: grades,
      summary: {
        total_subjects: grades.length,
        annual_effort_average: avgAnnualEffort,
        min_annual_effort: minAnnualEffort,
        general_exemption_eligible: generalExemptionEligible,
        overall_result_status: overallStatus,
      },
      generated_by: user.id,
      generated_at: Math.floor(Date.now() / 1000),
    };

    await db.prepare(`
      INSERT INTO result_cards (
        school_id, student_id, class_id, section_id, academic_year_id,
        card_number, verification_token, verification_hash,
        student_name_snapshot, class_name_snapshot, section_name_snapshot,
        school_name_snapshot, academic_year_snapshot,
        general_exemption_status, annual_effort_average, min_annual_effort,
        overall_result_status, card_data_json,
        generated_by_user_id, generated_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())
    `).bind(
      student.school_id, studentId, student.class_id || null, student.section_id || null, ay?.id || null,
      cardNumber, token, tokenHash,
      student.full_name, student.class_name || null, student.section_name || null,
      student.school_name || null, ay?.name || null,
      generalExemptionEligible ? 1 : 0, avgAnnualEffort, minAnnualEffort,
      overallStatus, JSON.stringify(cardData),
      user.id, Math.floor(Date.now() / 1000)
    ).run();

    const newCard = await db.prepare(`SELECT * FROM result_cards WHERE verification_token = ?`).bind(token).first<any>();

    return c.json({
      data: {
        card: newCard,
        verification_url: `/verify/result-card/${token}`,
      },
      message: 'تم إنشاء كارت النتيجة بنجاح',
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء كارت النتيجة', detail: err.message }, 500);
  }
});

// POST /api/result-cards/generate-section
// ===========================================
app.post('/api/result-cards/generate-section', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;

  if (!user || !canGenerateResultCards(user.role_key)) {
    return c.json({ error: 'غير مسموح: لا تملك صلاحية إنشاء كارتات النتائج' }, 403);
  }

  try {
    const body = await c.req.json();
    const classId = body.class_id ? parseInt(body.class_id, 10) : null;
    const sectionId = body.section_id ? parseInt(body.section_id, 10) : null;

    if (!classId || !sectionId) {
      return c.json({ error: 'معرف الصف والشعبة مطلوبان' }, 400);
    }

    // Verify section belongs to school
    if (scope === 'single' && resolvedSchoolId) {
      const secCheck = await db.prepare(`SELECT school_id FROM sections WHERE id = ?`).bind(sectionId).first<{ school_id: number }>();
      if (!secCheck || secCheck.school_id !== resolvedSchoolId) {
        return c.json({ error: 'غير مسموح: الشعبة لا تنتمي إلى مدرستك' }, 403);
      }
    }

    // Fetch active students in section
    const studentsRows = await db.prepare(`
      SELECT s.id, s.school_id, s.full_name, s.student_number, s.class_id, s.section_id,
             c.name AS class_name, sec.name AS section_name, sch.name AS school_name
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN sections sec ON s.section_id = sec.id
      LEFT JOIN schools sch ON s.school_id = sch.id
      WHERE s.class_id = ? AND s.section_id = ? AND s.status = 'active'
    `).bind(classId, sectionId).all<any>();
    const students = studentsRows.results || [];

    const generated: any[] = [];
    const skipped: { student_id: number; student_name: string; reason: string; missing_subjects?: string[] }[] = [];

    for (const student of students) {
      // Active subjects
      const subjectRows = await db.prepare(`
        SELECT su.id, su.name AS subject_name
        FROM student_subjects ss
        INNER JOIN subjects su ON ss.subject_id = su.id
        WHERE ss.student_id = ? AND ss.is_active = 1 AND su.status = 'active'
      `).bind(student.id).all<any>();
      const activeSubjects = subjectRows.results || [];

      if (activeSubjects.length === 0) {
        skipped.push({ student_id: student.id, student_name: student.full_name, reason: 'لا توجد مواد مفعلة' });
        continue;
      }

      // Grades
      const gradeRows = await db.prepare(`
        SELECT su.id AS subject_id, su.name AS subject_name, g.annual_effort
        FROM grades g
        INNER JOIN student_subjects ss ON g.student_subject_id = ss.id AND ss.is_active = 1
        INNER JOIN subjects su ON ss.subject_id = su.id
        WHERE ss.student_id = ? AND g.is_active = 1
      `).bind(student.id).all<any>();
      const grades = gradeRows.results || [];

      const gradedIds = new Set(grades.map((g: any) => g.subject_id));
      const missing = activeSubjects.filter((s: any) => !gradedIds.has(s.id));
      if (missing.length > 0) {
        skipped.push({ student_id: student.id, student_name: student.full_name, reason: 'درجات ناقصة', missing_subjects: missing.map((s: any) => s.subject_name) });
        continue;
      }

      // Compute eligibility using annual_effort only
      const annualEfforts = grades.map((r: any) => r.annual_effort).filter((v: any) => v !== null && !isNaN(v)) as number[];
      const avgAE = annualEfforts.length > 0 ? Math.round(annualEfforts.reduce((a: number, b: number) => a + b, 0) / annualEfforts.length) : null;
      const minAE = annualEfforts.length > 0 ? Math.min(...annualEfforts) : null;

      let genAvg = 85;
      let genMin = 75;
      const gs = await db.prepare(`SELECT general_exemption_average_grade, general_exemption_min_subject_grade FROM grade_settings WHERE school_id = ?`).bind(student.school_id).first<any>();
      if (gs) { genAvg = gs.general_exemption_average_grade ?? 85; genMin = gs.general_exemption_min_subject_grade ?? 75; }

      const generalExemptionEligible = annualEfforts.length === grades.length && avgAE !== null && avgAE >= genAvg && minAE !== null && minAE >= genMin;

      const failCount = grades.filter((g: any) => g.result_status === 'راسب').length;
      const incompleteCount = grades.filter((g: any) => g.result_status === 'مكمل').length;
      const overallStatus = failCount > 0 ? 'راسب' : (incompleteCount > 0 ? 'مكمل' : 'ناجح');

      const ay = await db.prepare(`SELECT id, name FROM academic_years WHERE school_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`).bind(student.school_id).first<any>();

      await db.prepare(`UPDATE result_cards SET status = 'cancelled', updated_at = unixepoch() WHERE student_id = ? AND status = 'active'`).bind(student.id).run();

      const token = generateVerificationToken();
      const tokenHash = await hashToken(token);
      const cardNumber = generateCardNumber(student.school_id, student.id);

      const cardData = {
        school: { id: student.school_id, name: student.school_name },
        student: { id: student.id, name: student.full_name, student_number: student.student_number },
        class: { id: student.class_id, name: student.class_name },
        section: { id: student.section_id, name: student.section_name },
        academic_year: ay ? { id: ay.id, name: ay.name } : null,
        settings: { general_exemption_average_grade: genAvg, general_exemption_min_subject_grade: genMin },
        subjects: grades,
        summary: {
          total_subjects: grades.length,
          annual_effort_average: avgAE,
          min_annual_effort: minAE,
          general_exemption_eligible: generalExemptionEligible,
          overall_result_status: overallStatus,
        },
        generated_by: user.id,
        generated_at: Math.floor(Date.now() / 1000),
      };

      await db.prepare(`
        INSERT INTO result_cards (
          school_id, student_id, class_id, section_id, academic_year_id,
          card_number, verification_token, verification_hash,
          student_name_snapshot, class_name_snapshot, section_name_snapshot,
          school_name_snapshot, academic_year_snapshot,
          general_exemption_status, annual_effort_average, min_annual_effort,
          overall_result_status, card_data_json,
          generated_by_user_id, generated_at, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())
      `).bind(
        student.school_id, student.id, student.class_id || null, student.section_id || null, ay?.id || null,
        cardNumber, token, tokenHash,
        student.full_name, student.class_name || null, student.section_name || null,
        student.school_name || null, ay?.name || null,
        generalExemptionEligible ? 1 : 0, avgAE, minAE,
        overallStatus, JSON.stringify(cardData),
        user.id, Math.floor(Date.now() / 1000)
      ).run();

      generated.push({ student_id: student.id, student_name: student.full_name, card_number: cardNumber });
    }

    return c.json({
      data: {
        generated_count: generated.length,
        skipped_count: skipped.length,
        generated,
        skipped,
      },
      message: `تم إنشاء ${generated.length} كارت وتم تخطي ${skipped.length} طالب`,
    });
  } catch (err: any) {
    return c.json({ error: 'فشل في إنشاء كارتات الشعبة', detail: err.message }, 500);
  }
});

// PUT /api/result-cards/:id/mark-printed
// ===========================================
app.put('/api/result-cards/:id/mark-printed', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  try {
    const row = await db.prepare(`SELECT school_id, status FROM result_cards WHERE id = ?`).bind(id).first<any>();
    if (!row) return c.json({ error: 'كارت النتيجة غير موجود' }, 404);
    if (scope === 'single' && resolvedSchoolId && row.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }
    if (row.status !== 'active') {
      return c.json({ error: 'لا يمكن تعليم كارت غير فعال كمطبوع' }, 400);
    }
    await db.prepare(`UPDATE result_cards SET printed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).bind(id).run();
    return c.json({ data: { id, printed_at: Math.floor(Date.now() / 1000) }, message: 'تم تعليم الكارت كمطبوع' });
  } catch (err: any) {
    return c.json({ error: 'فشل في تحديث الكارت', detail: err.message }, 500);
  }
});

// PUT /api/result-cards/:id/cancel
// ===========================================
app.put('/api/result-cards/:id/cancel', requireSameSchoolOrAdmin(), async (c) => {
  const db = c.env.DB;
  const user = c.get('user') as UserContext | null;
  const scope = c.get('scope') as 'all' | 'single';
  const resolvedSchoolId = c.get('resolvedSchoolId') as number | null;
  const id = parseInt(c.req.param('id'), 10);

  try {
    const row = await db.prepare(`SELECT school_id, status FROM result_cards WHERE id = ?`).bind(id).first<any>();
    if (!row) return c.json({ error: 'كارت النتيجة غير موجود' }, 404);
    if (scope === 'single' && resolvedSchoolId && row.school_id !== resolvedSchoolId) {
      return c.json({ error: 'غير مسموح' }, 403);
    }
    await db.prepare(`UPDATE result_cards SET status = 'cancelled', updated_at = unixepoch() WHERE id = ?`).bind(id).run();
    return c.json({ data: { id, status: 'cancelled' }, message: 'تم إلغاء الكارت' });
  } catch (err: any) {
    return c.json({ error: 'فشل في إلغاء الكارت', detail: err.message }, 500);
  }
});

// GET /api/verify/result-card/:token
// Public endpoint — no JWT required
// ===========================================
app.get('/api/verify/result-card/:token', async (c) => {
  const db = c.env.DB;
  const token = c.req.param('token');

  try {
    const row = await db.prepare(`
      SELECT card_number, student_name_snapshot, class_name_snapshot, section_name_snapshot,
             school_name_snapshot, academic_year_snapshot, generated_at, status,
             overall_result_status, general_exemption_status
      FROM result_cards WHERE verification_token = ?
    `).bind(token).first<any>();

    if (!row) {
      return c.json({
        valid: false,
        message: 'الكارت غير موجود أو رمز التحقق غير صحيح',
      }, 404);
    }

    if (row.status === 'cancelled') {
      return c.json({
        valid: false,
        cancelled: true,
        message: 'هذا الكارت ملغى ولا يُعتد به',
        card_number: row.card_number,
        student_name: row.student_name_snapshot,
        school_name: row.school_name_snapshot,
        generated_at: row.generated_at,
      });
    }

    return c.json({
      valid: true,
      card_number: row.card_number,
      student_name: row.student_name_snapshot,
      school_name: row.school_name_snapshot,
      class_name: row.class_name_snapshot,
      section_name: row.section_name_snapshot,
      academic_year: row.academic_year_snapshot,
      generated_at: row.generated_at,
      status: row.status,
      overall_result_status: row.overall_result_status,
      general_exemption_status: row.general_exemption_status === 1,
    });
  } catch (err: any) {
    return c.json({ valid: false, message: 'خطأ في التحقق', detail: err.message }, 500);
  }
});
