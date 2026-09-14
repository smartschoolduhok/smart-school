import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';
import {
  BUILT_IN_OFFICIAL_BOOK_TEMPLATES,
  findBuiltInOfficialBookTemplate,
  renderOfficialBookText,
  validateOfficialBookDraft,
  validateOfficialBookFieldValues,
} from '../src/lib/officialBookTemplates.ts';
import {
  normalizeOfficialBookLayout,
  resolvedOfficialBookLayout,
  validateOfficialBookLayout,
} from '../src/lib/officialBookLayout.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const migration = name => readFileSync(join(rootDir, 'migrations', name), 'utf8');
const secret = 'official-books-test-secret-with-adequate-entropy-20e2';
const vite = await createServer({ root: rootDir, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
const { OfficialBookDocument } = await vite.ssrLoadModule('/src/components/officialBooks/OfficialBookDocument.tsx');
const { formatOfficialBookDate, officialBookDate } = await vite.ssrLoadModule('/src/lib/officialBookLayout.ts');
after(async () => vite.close());

class LocalStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }
  bind(...values) { return new LocalStatement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values), success: true, meta: {} }; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
  }
}

class LocalD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new LocalStatement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

async function createFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  for (const name of [
    '0001_initial_schema.sql',
    '0002_phase2_academic_tables.sql',
    '0010_employees.sql',
    '0011_settings_school_profile.sql',
    '0013_official_books.sql',
    '0016_auth_security.sql',
    '0019_result_card_display_settings.sql',
    '0036_official_book_layout.sql',
  ]) database.exec(migration(name));

  database.exec(`
    INSERT INTO schools (id, name, name_en, school_type, city, province, principal_name, logo_url, official_stamp_url, status) VALUES
      (1, 'مدرسة الحدباء', 'Al-Hadbaa School', 'حكومي', 'الموصل', 'نينوى', 'أحمد المدير', '/school-logo.png', '/stamp.png', 'active'),
      (2, 'مدرسة أخرى', 'Other School', 'خاص', 'دهوك', 'دهوك', 'مدير آخر', NULL, NULL, 'active');
    INSERT INTO school_settings (
      school_id, official_book_header_text, official_book_footer_text,
      official_book_layout_settings_json, use_school_logo_on_docs,
      use_school_stamp_on_docs, default_print_size, default_receipt_size
    ) VALUES (
      1, 'قسم التعليم العام', 'الموصل — نينوى',
      '{"country_ar":"جمهورية العراق","ministry_ar":"وزارة التربية","directorate_ar":"المديرية العامة لتربية نينوى","department_ar":"قسم التعليم العام","country_en":"Republic of Iraq","ministry_en":"Ministry of Education","directorate_en":"Nineveh General Directorate of Education","show_english_header":true,"show_official_emblem":false,"official_emblem_url":""}',
      1, 1, 'A4', 'A5'
    ), (2, NULL, NULL, NULL, 1, 0, 'A4', 'A5');
    INSERT INTO academic_years (id, school_id, name, starts_at, ends_at, is_active) VALUES
      (1, 1, '2026-2027', '2026-09-01', '2027-06-30', 1),
      (2, 2, '2026-2027', '2026-09-01', '2027-06-30', 1);
    INSERT INTO classes (id, school_id, name, stage, status) VALUES
      (1, 1, 'الثالث المتوسط', 'متوسط', 'active'),
      (2, 2, 'الخامس الابتدائي', 'ابتدائي', 'active');
    INSERT INTO sections (id, school_id, class_id, name, status) VALUES
      (1, 1, 1, 'أ', 'active'),
      (2, 2, 2, 'ب', 'active');
    INSERT INTO students (id, school_id, student_number, full_name, gender, class_id, section_id, status) VALUES
      (1, 1, 'S-001', 'علي محمد', 'ذكر', 1, 1, 'active'),
      (2, 2, 'S-002', 'سارة أحمد', 'أنثى', 2, 2, 'active');
    INSERT INTO employees (id, school_id, full_name, role, job_title, status) VALUES
      (1, 1, 'سعد محمود', 'staff', 'معاون المدير', 'active'),
      (2, 2, 'موظف آخر', 'staff', 'كاتب', 'active');
    INSERT INTO users (id, school_id, full_name, email, role_id, status, auth_version) VALUES
      (1, 1, 'Owner One', 'owner-one@example.test', 2, 'active', 1),
      (2, 2, 'Owner Two', 'owner-two@example.test', 2, 'active', 1),
      (3, 1, 'Parent One', 'parent-one@example.test', 8, 'active', 1);
  `);

  return {
    database,
    env: { DB: new LocalD1(database), JWT_SECRET: secret, APP_ENV: 'test' },
    tokens: {
      ownerOne: await signJWT({ email: 'owner-one@example.test', auth_version: 1 }, secret),
      ownerTwo: await signJWT({ email: 'owner-two@example.test', auth_version: 1 }, secret),
      parent: await signJWT({ email: 'parent-one@example.test', auth_version: 1 }, secret),
    },
  };
}

async function api(fixture, token, method, path, body) {
  return app.request(`http://localhost${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, fixture.env);
}

test('built-in registry covers recurring student, verification, committee and staff books', () => {
  assert.equal(BUILT_IN_OFFICIAL_BOOK_TEMPLATES.length, 10);
  assert.equal(new Set(BUILT_IN_OFFICIAL_BOOK_TEMPLATES.map(item => item.preset_key)).size, 10);
  assert.deepEqual(
    new Set(BUILT_IN_OFFICIAL_BOOK_TEMPLATES.map(item => item.category)),
    new Set(['student', 'verification', 'committee', 'administrative']),
  );
  assert.ok(findBuiltInOfficialBookTemplate('student-attendance-confirmation')?.requires_student);
  assert.ok(findBuiltInOfficialBookTemplate('committee-examinations')?.body_text.includes('اللجنة الامتحانية'));
  assert.equal(findBuiltInOfficialBookTemplate('unknown'), null);
});

test('field validation and placeholder rendering never issue an incomplete template silently', () => {
  const template = findBuiltInOfficialBookTemplate('student-attendance-confirmation');
  assert.ok(template);
  assert.match(validateOfficialBookFieldValues(template, {}).error, /الجهة المخاطَبة/);
  const fields = validateOfficialBookFieldValues(template, { recipient: 'جامعة الموصل', purpose: 'التقديم' });
  assert.equal(fields.error, null);
  const rendered = renderOfficialBookText(template.body_text, {
    ...fields.values,
    student_name: 'علي محمد', student_number: 'S-001', class_name: 'الثالث المتوسط',
    section_name: 'أ', academic_year: '2026-2027', school_name: 'مدرسة الحدباء', date: '14/9/2026',
  });
  assert.equal(rendered.unresolved.length, 0);
  assert.match(rendered.text, /جامعة الموصل/);
  assert.match(rendered.text, /علي محمد/);
  assert.match(validateOfficialBookDraft('', 'body'), /عنوان/);
});

test('official header normalization is safe, bilingual and derives the Iraqi directorate from province', () => {
  assert.equal(normalizeOfficialBookLayout('{bad json').country_ar, 'جمهورية العراق');
  assert.match(validateOfficialBookLayout({ show_official_emblem: true, official_emblem_url: '' }), /رابط/);
  assert.match(validateOfficialBookLayout({ official_emblem_url: 'http://insecure.example/logo.png' }), /HTTPS/);
  assert.equal(validateOfficialBookLayout({ show_official_emblem: true, official_emblem_url: 'https://example.test/emblem.png' }), null);
  const layout = resolvedOfficialBookLayout({}, { name: 'مدرسة الحدباء', province: 'نينوى' });
  assert.equal(layout.directorate_ar, 'المديرية العامة لتربية نينوى');
  assert.equal(layout.school_name_ar, 'مدرسة الحدباء');
});

test('templates API returns built-ins without duplicating rows and hides them from parent accounts', async () => {
  const fixture = await createFixture();
  const response = await api(fixture, fixture.tokens.ownerOne, 'GET', '/api/official-book-templates?school_id=1');
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.length, 0);
  assert.equal(payload.meta.presets.length, 10);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM official_book_templates').get().count, 0);

  const denied = await api(fixture, fixture.tokens.parent, 'GET', '/api/official-book-templates?school_id=1');
  assert.equal(denied.status, 403);
});

test('student preset resolves trusted data and freezes the A4 header snapshot', async () => {
  const fixture = await createFixture();
  const response = await api(fixture, fixture.tokens.ownerOne, 'POST', '/api/official-books', {
    school_id: 1,
    preset_key: 'student-attendance-confirmation',
    student_id: 1,
    field_values: { recipient: 'جامعة الموصل', purpose: 'التقديم إلى الجامعة' },
  });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const created = (await response.json()).data;
  const row = fixture.database.prepare('SELECT * FROM official_books WHERE id = ?').get(created.id);
  assert.equal(row.template_id, null);
  assert.equal(row.paper_size, 'A4');
  assert.match(row.body_text, /علي محمد/);
  assert.match(row.body_text, /الثالث المتوسط/);
  assert.match(row.body_text, /2026-2027/);
  assert.doesNotMatch(row.body_text, /\{\{/);
  const snapshot = JSON.parse(row.settings_snapshot_json);
  assert.equal(snapshot.schema_version, 2);
  assert.equal(snapshot.preset_key, 'student-attendance-confirmation');
  assert.equal(snapshot.official_book_layout.directorate_ar, 'المديرية العامة لتربية نينوى');
});

test('manual acceptance preset needs no existing student but remains editable and verifiable', async () => {
  const fixture = await createFixture();
  const response = await api(fixture, fixture.tokens.ownerOne, 'POST', '/api/official-books', {
    school_id: 1,
    preset_key: 'student-acceptance-no-objection',
    title: 'عدم ممانعة قبول — نسخة معدلة',
    field_values: {
      recipient_school: 'مدرسة الرافدين',
      student_name: 'نور حسن',
      target_class: 'الرابع العلمي',
      requested_documents: 'الوثيقة والبطاقة المدرسية',
    },
  });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const data = (await response.json()).data;
  const row = fixture.database.prepare('SELECT * FROM official_books WHERE id = ?').get(data.id);
  assert.equal(row.student_id, null);
  assert.equal(row.title, 'عدم ممانعة قبول — نسخة معدلة');
  assert.match(row.body_text, /نور حسن/);
  assert.match(row.body_text, /مدرسة الرافدين/);
  const verify = await app.request(`http://localhost/api/verify/official-book/${data.verification_token}`, {}, fixture.env);
  assert.equal(verify.status, 200);
  assert.equal((await verify.json()).data.title, row.title);
});

test('generation rejects cross-school linked resources and unresolved edited placeholders', async () => {
  const fixture = await createFixture();
  const crossSchool = await api(fixture, fixture.tokens.ownerOne, 'POST', '/api/official-books', {
    school_id: 1,
    preset_key: 'student-attendance-confirmation',
    student_id: 2,
    field_values: { recipient: 'جهة', purpose: 'غرض' },
  });
  assert.equal(crossSchool.status, 403);
  const unresolved = await api(fixture, fixture.tokens.ownerOne, 'POST', '/api/official-books', {
    school_id: 1,
    preset_key: 'committee-general',
    body_text: 'إلى {{missing_field}}',
    field_values: {
      reference_basis: 'تنظيم العمل', committee_members: 'عضو واحد',
      committee_duties: 'التدقيق', copies: 'للحفظ',
    },
  });
  assert.equal(unresolved.status, 400);
  assert.match((await unresolved.json()).error, /missing_field/);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM official_books').get().count, 0);
});

test('school custom templates remain supported with additional named fields', async () => {
  const fixture = await createFixture();
  fixture.database.prepare(`
    INSERT INTO official_book_templates (id, school_id, title, body_text, paper_size, status, created_by_user_id)
    VALUES (7, 1, 'قالب خاص', 'إلى {{recipient}} — بتاريخ {{date}}', 'A4', 'active', 1)
  `).run();
  const response = await api(fixture, fixture.tokens.ownerOne, 'POST', '/api/official-books', {
    school_id: 1,
    template_id: 7,
    field_values: { recipient: 'قسم الامتحانات' },
  });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const row = fixture.database.prepare('SELECT * FROM official_books ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.template_id, 7);
  assert.match(row.body_text, /قسم الامتحانات/);
  assert.doesNotMatch(row.body_text, /\{\{/);
});

test('document settings validate emblem configuration and persist structured JSON', async () => {
  const fixture = await createFixture();
  const invalid = await api(fixture, fixture.tokens.ownerOne, 'PUT', '/api/settings/document', {
    school_id: 1,
    official_book_layout_settings: { show_official_emblem: true, official_emblem_url: '' },
  });
  assert.equal(invalid.status, 400);

  const valid = await api(fixture, fixture.tokens.ownerOne, 'PUT', '/api/settings/document', {
    school_id: 1,
    official_book_header_text: 'شعبة الإدارة المدرسية',
    official_book_layout_settings: {
      country_ar: 'جمهورية العراق', ministry_ar: 'وزارة التربية',
      directorate_ar: 'المديرية العامة لتربية نينوى', show_english_header: false,
      show_official_emblem: true, official_emblem_url: 'https://example.test/emblem.png',
    },
  });
  assert.equal(valid.status, 200, JSON.stringify(await valid.clone().json()));
  const stored = fixture.database.prepare('SELECT official_book_layout_settings_json FROM school_settings WHERE school_id = 1').get();
  const layout = JSON.parse(stored.official_book_layout_settings_json);
  assert.equal(layout.show_official_emblem, true);
  assert.equal(layout.directorate_ar, 'المديرية العامة لتربية نينوى');
});

test('A4 document renders bilingual hierarchy, QR, signature and no internal audit author', () => {
  const snapshot = {
    schema_version: 2,
    school_name: 'مدرسة الحدباء',
    school_name_en: 'Al-Hadbaa School',
    principal_name: 'أحمد المدير',
    official_book_header_text: 'قسم التعليم العام',
    official_book_footer_text: 'الموصل — نينوى',
    use_arabic_indic_digits: true,
    official_book_layout: {
      country_ar: 'جمهورية العراق', ministry_ar: 'وزارة التربية',
      directorate_ar: 'المديرية العامة لتربية نينوى', country_en: 'Republic of Iraq',
      ministry_en: 'Ministry of Education', directorate_en: 'Nineveh General Directorate of Education',
      show_english_header: true, show_official_emblem: false,
    },
  };
  const html = renderToStaticMarkup(React.createElement(OfficialBookDocument, {
    book: {
      id: 1, document_number: 'BOOK-1-1-1789000000', title: 'تأييد استمرار طالب بالدوام',
      body_text: 'نؤيد أن علي محمد مستمر بالدوام.', status: 'active', created_at: 1789000000,
      verification_token: 'verify-token-20e2', school_name_snapshot: 'مدرسة الحدباء',
      principal_name_snapshot: 'أحمد المدير', settings_snapshot_json: JSON.stringify(snapshot),
    },
    verificationUrl: 'https://school.example/verify/official-book/verify-token-20e2',
  }));
  for (const expected of [
    'official-book-document', 'جمهورية العراق', 'وزارة التربية',
    'المديرية العامة لتربية نينوى', 'Republic of Iraq', 'Ministry of Education',
    'تأييد استمرار طالب بالدوام', 'مدير المدرسة', 'verify-token-20e2', 'role="img"',
  ]) assert.match(html, new RegExp(expected));
  assert.doesNotMatch(html, /أنشئ بواسطة|created_by/);
  assert.equal(officialBookDate(1789000000).getUTCFullYear(), 2026);
  assert.match(formatOfficialBookDate(1789000000), /(?:٢٠٢٦|2026)/);
  assert.match(formatOfficialBookDate('1789000000'), /(?:٢٠٢٦|2026)/);
  assert.doesNotMatch(formatOfficialBookDate(1789000000), /(?:١٩٧٠|1970)/);
  assert.equal(formatOfficialBookDate('not-a-date'), '—');
});

test('A4 document honors legacy numeric zero for Western digits', () => {
  const html = renderToStaticMarkup(React.createElement(OfficialBookDocument, {
    book: {
      id: 2, document_number: 'BOOK-123', title: 'كتاب اختبار', body_text: 'متن الكتاب',
      status: 'active', created_at: 1789000000, verification_token: 'western-digits',
      settings_snapshot_json: JSON.stringify({ use_arabic_indic_digits: 0 }),
    },
    verificationUrl: 'https://school.example/verify/official-book/western-digits',
  }));
  assert.match(html, /BOOK-123/);
  assert.doesNotMatch(html, /BOOK-١٢٣/);
});
