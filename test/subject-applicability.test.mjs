import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { ANALYTICS_APPLICABLE_GRADE_JOINS } from '../src/lib/subjectApplicability.ts';

function analyticsFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE students (
      id INTEGER PRIMARY KEY,
      school_id INTEGER NOT NULL,
      class_id INTEGER,
      section_id INTEGER,
      religion TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE subjects (
      id INTEGER PRIMARY KEY,
      school_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      religious_track TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE student_subjects (
      id INTEGER PRIMARY KEY,
      school_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      class_id INTEGER,
      section_id INTEGER,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE grades (
      id INTEGER PRIMARY KEY,
      school_id INTEGER NOT NULL,
      student_subject_id INTEGER NOT NULL,
      effective_grade REAL,
      is_active INTEGER NOT NULL
    );

    INSERT INTO students VALUES (1, 1, 99, 98, 'muslim', 'active');
    INSERT INTO subjects VALUES
      (10, 1, 'الإسلامية', 'islamic', 'active'),
      (11, 1, 'العادية غير الفعالة assignment', NULL, 'active'),
      (12, 1, 'المادة المؤرشفة', NULL, 'archived'),
      (13, 1, 'المسيحية غير المسندة', 'christian', 'active'),
      (14, 2, 'مادة مدرسة أخرى', NULL, 'active'),
      (15, 1, 'درجة غير فعالة', NULL, 'active');
    INSERT INTO student_subjects VALUES
      (100, 1, 1, 10, 20, 30, 1),
      (101, 1, 1, 11, 20, 30, 0),
      (102, 1, 1, 12, 20, 30, 1),
      (103, 2, 1, 14, 20, 30, 1),
      (104, 1, 1, 15, 20, 30, 1);
    INSERT INTO grades VALUES
      (1000, 1, 100, 90, 1),
      (1001, 1, 101, 80, 1),
      (1002, 1, 102, 70, 1),
      (1003, 2, 103, 60, 1),
      (1004, 1, 104, 95, 0);
  `);
  return database;
}

function applicableAnalyticsRows(database) {
  return database.prepare(`
    SELECT su.id AS subject_id, su.religious_track, ss.class_id, ss.section_id,
           st.class_id AS legacy_class_id, st.section_id AS legacy_section_id,
           st.religion
    ${ANALYTICS_APPLICABLE_GRADE_JOINS}
    WHERE g.is_active = 1
    ORDER BY su.id
  `).all();
}

test('analytics includes only active same-school assignments to active subjects', () => {
  const database = analyticsFixture();
  const rows = applicableAnalyticsRows(database);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subject_id, 10, 'active assigned religious subject remains academically ordinary');
  assert.equal(rows[0].religious_track, 'islamic');
  assert.ok(!rows.some((row) => row.subject_id === 11), 'inactive assignment excluded');
  assert.ok(!rows.some((row) => row.subject_id === 12), 'inactive subject excluded');
  assert.ok(!rows.some((row) => row.subject_id === 13), 'unassigned religious subject excluded');
  assert.ok(!rows.some((row) => row.subject_id === 14), 'cross-school assignment/grade excluded');
  assert.ok(!rows.some((row) => row.subject_id === 15), 'inactive grade excluded');
});

test('analytics attribution follows assignment placement and personal religion has no effect', () => {
  const database = analyticsFixture();
  let rows = applicableAnalyticsRows(database);
  assert.equal(rows[0].class_id, 20);
  assert.equal(rows[0].section_id, 30);
  assert.equal(rows[0].legacy_class_id, 99);
  assert.equal(rows[0].legacy_section_id, 98);

  database.exec("UPDATE students SET religion = 'christian' WHERE id = 1");
  rows = applicableAnalyticsRows(database);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subject_id, 10);
  assert.equal(rows[0].religious_track, 'islamic');
});

test('worker keeps applicability in assignments for Result Cards, analytics and grade initialization', async () => {
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  const resultCardLoader = worker.slice(
    worker.indexOf('async function loadResultCardEvaluation'),
    worker.indexOf('function resultCardEvaluationFailure'),
  );
  assert.match(resultCardLoader, /FROM student_subjects ss/);
  assert.match(resultCardLoader, /ss\.is_active = 1 AND su\.status = 'active'/);
  assert.match(resultCardLoader, /su\.appears_in_report_card/);
  assert.match(resultCardLoader, /su\.counts_in_average/);
  assert.doesNotMatch(resultCardLoader, /su\.appears_in_report_card = 1/);
  assert.doesNotMatch(resultCardLoader, /students\.religion|student\.religion|s\.religion/);

  const analytics = worker.slice(
    worker.indexOf('// Phase 5: Analytics API Routes'),
    worker.indexOf('// Phase 6: Result Cards + QR Verification'),
  );
  assert.match(analytics, /ANALYTICS_APPLICABLE_GRADE_JOINS/);
  assert.match(analytics, /conditions\.push\('ss\.class_id = \?'\)/);
  assert.match(analytics, /conditions\.push\('ss\.section_id = \?'\)/);
  const exemptionBlockers = analytics.slice(
    analytics.indexOf('// GET /api/analytics/exemption-blockers'),
    analytics.indexOf('// GET /api/analytics/student-summary'),
  );
  assert.match(exemptionBlockers, /\.bind\(genMin, \.\.\.params\)/);
  assert.doesNotMatch(analytics, /students\.religion|st\.religion|religious_track/);

  const initializer = worker.slice(
    worker.indexOf('async function getActiveStudentSubjects'),
    worker.indexOf('// PUT /api/grades/:id'),
  );
  assert.match(initializer, /ss\.is_active = 1 AND s\.status = 'active'/);
  assert.match(initializer, /WHERE ss\.student_id = \? AND ss\.subject_id = \?[\s\S]*ss\.is_active = 1/);
  assert.doesNotMatch(initializer, /religion|religious_track/);
});
