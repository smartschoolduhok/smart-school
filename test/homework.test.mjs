import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';
import {
  LocalD1,
  fixtureSQL,
  migrationFiles,
  migrationSQL,
  root,
  snapshot,
} from './helpers/teaching-load-matrix-fixture.mjs';

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());

const secret = 'generated-local-homework-secret-only';
const identities = {
  owner: 'owner@matrix.test',
  admin: 'admin@matrix.test',
  teacher: 'teacher@matrix.test',
  principal: 'principal@matrix.test',
  registrar: 'registrar@matrix.test',
  accountant: 'accountant@matrix.test',
  parent1: 'parent1@matrix.test',
  parent2: 'parent2@matrix.test',
  foreignParent: 'foreign-parent@matrix.test',
};
const tokens = Object.fromEntries(await Promise.all(Object.entries(identities).map(async ([key, email]) => [
  key,
  await signJWT({ email, auth_version: 1 }, secret),
])));

class MemoryHomeworkFiles {
  constructor() {
    this.objects = new Map();
    this.onPut = null;
    this.deleteFailures = 0;
  }

  async put(key, value, options = {}) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(await value.arrayBuffer());
    this.objects.set(key, { bytes, httpMetadata: options.httpMetadata || null });
    if (this.onPut) {
      const callback = this.onPut;
      this.onPut = null;
      callback(key);
    }
  }

  async get(key) {
    const object = this.objects.get(key);
    if (!object) return null;
    const copy = object.bytes.slice();
    return {
      body: new Blob([copy]).stream(),
      httpMetadata: object.httpMetadata,
      arrayBuffer: async () => copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
    };
  }

  async delete(key) {
    if (this.deleteFailures > 0) {
      this.deleteFailures -= 1;
      throw new Error('simulated object-store delete failure');
    }
    this.objects.delete(key);
  }
}

function createFixture(t) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  t.after(() => database.close());
  for (const file of migrationFiles) database.exec(migrationSQL(file));
  database.exec(fixtureSQL);
  database.exec(`
    INSERT INTO users(id,school_id,full_name,email,role_id,status,auth_version) VALUES
      (8,1,'Parent One','parent1@matrix.test',8,'active',1),
      (9,1,'Parent Two','parent2@matrix.test',8,'active',1),
      (10,2,'Foreign Parent','foreign-parent@matrix.test',8,'active',1);
    INSERT INTO teacher_employee_links(school_id,teacher_user_id,employee_id,status,created_by_user_id)
    VALUES (1,3,2,'active',1);
    INSERT INTO students(id,school_id,student_number,full_name,gender,class_id,section_id,status) VALUES
      (101,1,'S101','Eligible Student','male',1,2,'active'),
      (102,1,'S102','Other Subject Student','female',1,2,'active'),
      (103,2,'S103','Secret Student','male',3,3,'active');
    INSERT INTO student_enrollments(
      school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id
    ) VALUES
      (1,101,1,1,2,'active','pending',1),
      (1,102,1,1,2,'active','pending',1),
      (2,103,3,3,3,'active','pending',2);
    INSERT INTO student_subjects(
      school_id,student_id,subject_id,class_id,section_id,is_active,assigned_by_user_id
    ) VALUES
      (1,101,1,1,2,1,1),
      (1,102,2,1,2,1,1),
      (2,103,5,3,3,1,2);
    INSERT INTO parent_student_links(school_id,parent_user_id,student_id,status,created_by_user_id) VALUES
      (1,8,101,'active',1),
      (1,9,102,'active',1),
      (2,10,103,'active',2);
  `);
  return { database, d1: new LocalD1(database), files: new MemoryHomeworkFiles() };
}

async function request(fixture, role, method, path, body, headers = {}) {
  const options = {
    method,
    headers: { Authorization: `Bearer ${tokens[role]}`, ...headers },
  };
  if (body !== undefined) {
    if (body instanceof FormData) options.body = body;
    else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }
  const response = await app.request(`http://localhost${path}`, options, {
    DB: fixture.d1,
    JWT_SECRET: secret,
    APP_ENV: 'test',
    HOMEWORK_FILES: fixture.files,
  });
  const contentType = response.headers.get('content-type') || '';
  return {
    status: response.status,
    headers: response.headers,
    body: contentType.includes('application/json') ? await response.json() : new Uint8Array(await response.arrayBuffer()),
  };
}

const draftPayload = (overrides = {}) => ({
  school_id: 1,
  teaching_load_id: 2,
  title: 'تمارين الجمع',
  instructions: 'حل الأسئلة من 1 إلى 5 في الدفتر.',
  assigned_date: '2026-09-22',
  due_at: Math.floor(Date.parse('2026-09-24T08:00:00+03:00') / 1000),
  ...overrides,
});

async function createDraft(fixture, role = 'teacher', overrides = {}) {
  return request(fixture, role, 'POST', '/api/homework', draftPayload(overrides));
}

async function publishDraft(fixture, homework, role = 'teacher') {
  return request(fixture, role, 'POST', `/api/homework/${homework.homework_key}/publish`, {
    school_id: 1,
    revision: homework.revision,
  });
}

test('0041 is additive on a populated 0040 database and leaves foreign keys clean', t => {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  t.after(() => database.close());
  for (const file of migrationFiles.filter(file => file !== '0041_homework.sql')) database.exec(migrationSQL(file));
  database.exec(fixtureSQL);
  const before = snapshot(database);
  database.exec(migrationSQL('0041_homework.sql'));
  const after = snapshot(database);
  for (const [table, rows] of Object.entries(before)) assert.deepEqual(after[table], rows, table);
  assert.deepEqual(
    Object.keys(after).filter(table => !(table in before)).sort(),
    ['homework_assignments', 'homework_attachments', 'homework_audience', 'homework_audit', 'homework_write_guards'],
  );
  assert.equal(Object.keys(after).length, 81);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('scopes enforce role, active teacher link, explicit admin target and tenant isolation', async t => {
  const fixture = createFixture(t);
  const teacher = await request(fixture, 'teacher', 'GET', '/api/homework/scopes?school_id=1');
  assert.equal(teacher.status, 200, JSON.stringify(teacher.body));
  assert.deepEqual(teacher.body.data.loads.map(load => load.id), [2]);
  assert.equal(teacher.body.data.loads[0].teacher_name, 'Teacher B');

  const owner = await request(fixture, 'owner', 'GET', '/api/homework/scopes?school_id=1');
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
  assert.deepEqual(owner.body.data.loads.map(load => load.id), [2, 3]);
  assert.equal((await request(fixture, 'owner', 'GET', '/api/homework/scopes?school_id=2')).status, 403);
  assert.equal((await request(fixture, 'accountant', 'GET', '/api/homework/scopes?school_id=1')).status, 403);
  assert.equal((await request(fixture, 'parent1', 'GET', '/api/homework/scopes?school_id=1')).status, 403);
  assert.equal((await request(fixture, 'admin', 'GET', '/api/homework/scopes')).status, 400);
  assert.equal((await request(fixture, 'admin', 'GET', '/api/homework/scopes?school_id=2')).status, 200);

  fixture.database.prepare("UPDATE sections SET status='inactive' WHERE id=2").run();
  const inactiveSectionScopes = await request(fixture, 'teacher', 'GET', '/api/homework/scopes?school_id=1');
  assert.equal(inactiveSectionScopes.status, 200, JSON.stringify(inactiveSectionScopes.body));
  assert.deepEqual(inactiveSectionScopes.body.data.loads, []);
  assert.equal((await createDraft(fixture)).status, 409);
});

test('drafts are private and updates use optimistic revisions', async t => {
  const fixture = createFixture(t);
  const created = await createDraft(fixture);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.status, 'draft');
  assert.equal(created.body.data.revision, 0);
  assert.equal(created.body.data.teacher_employee_id, 2);

  const matchingList = await request(fixture, 'teacher', 'GET', '/api/homework?school_id=1&teaching_load_id=2&assigned_date=2026-09-22');
  assert.equal(matchingList.status, 200, JSON.stringify(matchingList.body));
  assert.equal(matchingList.body.data.length, 1);
  assert.equal((await request(fixture, 'teacher', 'GET', '/api/homework?school_id=1&teaching_load_id=3')).body.data.length, 0);
  assert.equal((await request(fixture, 'teacher', 'GET', '/api/homework?school_id=1&assigned_date=2026-02-30')).status, 400);

  assert.equal((await request(fixture, 'parent1', 'GET', '/api/homework')).status, 403);
  assert.equal((await request(fixture, 'teacher', 'POST', '/api/homework', draftPayload({ teaching_load_id: 3 }))).status, 403);
  assert.equal((await request(fixture, 'owner', 'GET', `/api/homework/${created.body.data.homework_key}?school_id=2`)).status, 403);

  const changed = await request(fixture, 'teacher', 'PATCH', `/api/homework/${created.body.data.homework_key}`, {
    school_id: 1,
    revision: 0,
    title: 'تمارين الجمع المحدثة',
    instructions: 'حل الأسئلة من 1 إلى 7.',
    assigned_date: '2026-09-22',
    due_at: null,
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.data.revision, 1);
  assert.equal(changed.body.data.title, 'تمارين الجمع المحدثة');

  const stale = await request(fixture, 'teacher', 'PATCH', `/api/homework/${created.body.data.homework_key}`, {
    school_id: 1,
    revision: 0,
    title: 'كتابة متأخرة',
    instructions: 'لا يجب حفظها.',
    assigned_date: '2026-09-22',
    due_at: null,
  });
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.code, 'homework_stale');
  assert.equal(fixture.database.prepare('SELECT title FROM homework_assignments WHERE homework_key=?').get(created.body.data.homework_key).title, 'تمارين الجمع المحدثة');

  fixture.database.prepare("UPDATE timetable_teaching_loads SET status='inactive' WHERE id=2").run();
  const inactiveLoadList = await request(fixture, 'teacher', 'GET', '/api/homework?school_id=1');
  assert.equal(inactiveLoadList.status, 200, JSON.stringify(inactiveLoadList.body));
  assert.deepEqual(inactiveLoadList.body.data, []);
  assert.equal((await request(fixture, 'teacher', 'GET', `/api/homework/${created.body.data.homework_key}?school_id=1`)).status, 403);
  assert.equal((await request(fixture, 'owner', 'GET', `/api/homework/${created.body.data.homework_key}?school_id=1`)).status, 200);
  const staleLoadPublish = await request(fixture, 'owner', 'POST', `/api/homework/${created.body.data.homework_key}/publish`, {
    school_id: 1,
    revision: changed.body.data.revision,
  });
  assert.equal(staleLoadPublish.status, 409, JSON.stringify(staleLoadPublish.body));
  assert.equal(staleLoadPublish.body.code, 'invalid_homework_load');
});

test('canonical load drift blocks scopes, new drafts and publication', async t => {
  const fixture = createFixture(t);
  const created = await createDraft(fixture);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  fixture.database.prepare('UPDATE subjects SET class_id=2,section_id=NULL WHERE id=1').run();

  const scopes = await request(fixture, 'teacher', 'GET', '/api/homework/scopes?school_id=1');
  assert.equal(scopes.status, 200, JSON.stringify(scopes.body));
  assert.deepEqual(scopes.body.data.loads.map(load => load.id), []);

  const rejectedDraft = await createDraft(fixture, 'teacher', { title: 'Stale subject placement' });
  assert.equal(rejectedDraft.status, 409, JSON.stringify(rejectedDraft.body));
  assert.equal(rejectedDraft.body.code, 'invalid_homework_load');

  const rejectedPublish = await publishDraft(fixture, created.body.data, 'owner');
  assert.equal(rejectedPublish.status, 409, JSON.stringify(rejectedPublish.body));
  assert.equal(rejectedPublish.body.code, 'invalid_homework_load');
  assert.equal(
    fixture.database.prepare('SELECT status FROM homework_assignments WHERE homework_key=?').get(created.body.data.homework_key).status,
    'draft',
  );

  assert.throws(
    () => fixture.database.prepare(`
      INSERT INTO homework_assignments (
        homework_key,school_id,academic_year_id,teaching_load_id,class_id,section_id,
        subject_id,teacher_employee_id,academic_year_name_snapshot,class_name_snapshot,
        section_name_snapshot,subject_name_snapshot,teacher_name_snapshot,title,instructions,
        assigned_date,created_by_user_id,updated_by_user_id
      ) VALUES (
        '00000000-0000-4000-8000-000000000099',1,1,2,1,2,1,2,
        '2026-2027','Class A','B','Math','Teacher B','Invalid direct draft','Blocked',
        '2026-09-22',3,3
      )
    `).run(),
    /homework load invalid/,
  );

  fixture.database.prepare('UPDATE subjects SET class_id=1,section_id=NULL WHERE id=1').run();
  fixture.database.prepare("INSERT INTO sections(id,school_id,class_id,name,status) VALUES(20,1,2,'New Section','active')").run();
  const ownerScopes = await request(fixture, 'owner', 'GET', '/api/homework/scopes?school_id=1');
  assert.equal(ownerScopes.status, 200, JSON.stringify(ownerScopes.body));
  assert.deepEqual(ownerScopes.body.data.loads.map(load => load.id), [2]);
  const staleWholeClassDraft = await createDraft(fixture, 'owner', {
    teaching_load_id: 3,
    title: 'Stale whole-class load',
  });
  assert.equal(staleWholeClassDraft.status, 409, JSON.stringify(staleWholeClassDraft.body));
  assert.equal(staleWholeClassDraft.body.code, 'invalid_homework_load');
});

test('protected attachments round-trip locally and reject spoofing with cleanup', async t => {
  const fixture = createFixture(t);
  const created = await createDraft(fixture);
  const homework = created.body.data;
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const form = new FormData();
  form.set('school_id', '1');
  form.set('revision', String(homework.revision));
  form.set('file', new File([png], 'worksheet.png', { type: 'image/png' }));
  const uploaded = await request(fixture, 'teacher', 'POST', `/api/homework/${homework.homework_key}/attachments`, form);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.data.mime_type, 'image/png');
  assert.equal(uploaded.body.data.size_bytes, png.byteLength);
  assert.equal(fixture.files.objects.size, 1);

  const download = await request(fixture, 'teacher', 'GET', `/api/homework/attachments/${uploaded.body.data.attachment_key}?school_id=1`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'image/png');
  assert.deepEqual(download.body, png);

  const spoofedForm = new FormData();
  spoofedForm.set('school_id', '1');
  spoofedForm.set('revision', String(homework.revision));
  spoofedForm.set('file', new File(['<script>'], 'fake.pdf', { type: 'application/pdf' }));
  const spoofed = await request(fixture, 'teacher', 'POST', `/api/homework/${homework.homework_key}/attachments`, spoofedForm);
  assert.equal(spoofed.status, 400, JSON.stringify(spoofed.body));
  assert.equal(spoofed.body.code, 'invalid_homework_attachment_signature');
  assert.equal(fixture.files.objects.size, 1);

  const second = await createDraft(fixture, 'teacher', { title: 'Failure cleanup' });
  fixture.files.onPut = () => {
    fixture.database.exec("INSERT INTO homework_write_guards(token,valid) VALUES('attachment-race',1)");
    fixture.database.prepare("UPDATE homework_assignments SET status='published', published_by_user_id=1, published_at=unixepoch(), updated_by_user_id=1, revision=revision+1 WHERE homework_key=?").run(second.body.data.homework_key);
    fixture.database.exec("DELETE FROM homework_write_guards WHERE token='attachment-race'");
  };
  const failureForm = new FormData();
  failureForm.set('school_id', '1');
  failureForm.set('revision', '0');
  failureForm.set('file', new File([png], 'cleanup.png', { type: 'image/png' }));
  const failed = await request(fixture, 'teacher', 'POST', `/api/homework/${second.body.data.homework_key}/attachments`, failureForm);
  assert.equal(failed.status, 409, JSON.stringify(failed.body));
  assert.equal(fixture.files.objects.size, 1, 'failed metadata write must remove the just-uploaded object');

  const third = await createDraft(fixture, 'teacher', { title: 'Ambiguous object write cleanup' });
  fixture.files.onPut = () => {
    throw new Error('simulated object-store failure after write');
  };
  const objectFailureForm = new FormData();
  objectFailureForm.set('school_id', '1');
  objectFailureForm.set('revision', '0');
  objectFailureForm.set('file', new File([png], 'ambiguous.png', { type: 'image/png' }));
  const objectFailure = await request(fixture, 'teacher', 'POST', `/api/homework/${third.body.data.homework_key}/attachments`, objectFailureForm);
  assert.equal(objectFailure.status, 500, JSON.stringify(objectFailure.body));
  assert.equal(fixture.files.objects.size, 1, 'ambiguous object-store failure must attempt cleanup');
});

test('database attachment limits reject both a sixth file and totals over 20 MiB', async t => {
  const fixture = createFixture(t);
  const insertMetadata = (homeworkKey, size) => fixture.database.prepare(`
    INSERT INTO homework_attachments(
      attachment_key,school_id,homework_id,object_key,original_name,
      mime_type,size_bytes,sha256,created_by_user_id
    )
    SELECT ?,1,id,?,'fixture.pdf','application/pdf',?, ?,3
    FROM homework_assignments WHERE homework_key=?
  `).run(crypto.randomUUID(), `fixture/${crypto.randomUUID()}`, size, 'a'.repeat(64), homeworkKey);

  const totalDraft = await createDraft(fixture, 'teacher', { title: 'Total size guard' });
  for (let index = 0; index < 4; index += 1) insertMetadata(totalDraft.body.data.homework_key, 5 * 1024 * 1024);
  assert.throws(() => insertMetadata(totalDraft.body.data.homework_key, 1), /homework attachment total exceeded/);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM homework_attachments WHERE homework_id=?').get(
    fixture.database.prepare('SELECT id FROM homework_assignments WHERE homework_key=?').get(totalDraft.body.data.homework_key).id,
  ).count, 4);

  const countDraft = await createDraft(fixture, 'teacher', { title: 'Attachment count guard' });
  for (let index = 0; index < 5; index += 1) insertMetadata(countDraft.body.data.homework_key, 1);
  assert.throws(() => insertMetadata(countDraft.body.data.homework_key, 1), /homework attachment limit exceeded/);
});

test('attachment removal remains retryable when object cleanup fails', async t => {
  const fixture = createFixture(t);
  const created = await createDraft(fixture);
  const homework = created.body.data;
  const pdf = new TextEncoder().encode('%PDF-1.7\ncleanup');
  const form = new FormData();
  form.set('school_id', '1');
  form.set('revision', String(homework.revision));
  form.set('file', new File([pdf], 'cleanup.pdf', { type: 'application/pdf' }));
  const uploaded = await request(fixture, 'teacher', 'POST', `/api/homework/${homework.homework_key}/attachments`, form);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  assert.equal(fixture.files.objects.size, 1);

  fixture.files.deleteFailures = 1;
  const failedRemoval = await request(
    fixture,
    'teacher',
    'POST',
    `/api/homework/${homework.homework_key}/attachments/${uploaded.body.data.attachment_key}/remove`,
    { school_id: 1, revision: homework.revision },
  );
  assert.equal(failedRemoval.status, 503, JSON.stringify(failedRemoval.body));
  assert.equal(failedRemoval.body.code, 'homework_attachment_cleanup_pending');
  assert.equal(
    fixture.database.prepare('SELECT status FROM homework_attachments WHERE attachment_key=?').get(uploaded.body.data.attachment_key).status,
    'removal_pending',
  );
  assert.equal(fixture.files.objects.size, 1);

  const blockedPublish = await publishDraft(fixture, homework);
  assert.equal(blockedPublish.status, 409, JSON.stringify(blockedPublish.body));
  assert.equal(blockedPublish.body.code, 'homework_attachment_cleanup_pending');

  const retriedRemoval = await request(
    fixture,
    'teacher',
    'POST',
    `/api/homework/${homework.homework_key}/attachments/${uploaded.body.data.attachment_key}/remove`,
    { school_id: 1, revision: homework.revision },
  );
  assert.equal(retriedRemoval.status, 200, JSON.stringify(retriedRemoval.body));
  assert.equal(retriedRemoval.body.data.status, 'removed');
  assert.equal(
    fixture.database.prepare('SELECT status FROM homework_attachments WHERE attachment_key=?').get(uploaded.body.data.attachment_key).status,
    'removed',
  );
  assert.equal(fixture.files.objects.size, 0);
});

test('publish snapshots eligible students and notifications exactly once', async t => {
  const fixture = createFixture(t);
  const created = await createDraft(fixture);
  assert.throws(
    () => fixture.database.prepare(`
      UPDATE homework_assignments
      SET status='published', revision=revision+1,
          published_by_user_id=1, published_at=unixepoch(),
          updated_by_user_id=1, updated_at=unixepoch()
      WHERE homework_key=?
    `).run(created.body.data.homework_key),
    /homework write guard missing/,
  );
  fixture.d1.resetQueryBudget(50);
  const published = await publishDraft(fixture, created.body.data);
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.data.status, 'published');
  assert.equal(published.body.data.revision, 1);
  assert.deepEqual(published.body.data.audience.map(item => item.student_id), [101]);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM homework_audience').get().count, 1);
  assert.equal(fixture.database.prepare("SELECT COUNT(*) count FROM school_notifications WHERE reference_type='homework'").get().count, 1);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM notification_recipients').get().count, 1);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM grades').get().count, 0);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM employee_salaries').get().count, 0);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM treasury_transactions').get().count, 0);
  assert.ok(fixture.d1.executions.length < 50);
  assert.ok(fixture.d1.executions.every(statement => statement.parameters <= 100));
  assert.throws(
    () => fixture.database.prepare(`
      INSERT INTO homework_audience(
        school_id,homework_id,student_id,student_name_snapshot,
        student_number_snapshot,notification_key
      ) SELECT school_id,id,101,'Eligible Student','S101','00000000-0000-4000-8000-000000000000'
        FROM homework_assignments WHERE homework_key=?
    `).run(created.body.data.homework_key),
    /homework audience write guard missing/,
  );

  const retried = await publishDraft(fixture, created.body.data);
  assert.equal(retried.status, 409, JSON.stringify(retried.body));
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM homework_audience').get().count, 1);
  assert.equal(fixture.database.prepare("SELECT COUNT(*) count FROM school_notifications WHERE reference_type='homework'").get().count, 1);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM notification_recipients').get().count, 1);
});

test('publish rolls back when the eligible roster changes inside the write boundary', async t => {
  const fixture = createFixture(t);
  const created = await createDraft(fixture);
  fixture.d1.beforeWrite = () => {
    fixture.database.exec(`
      INSERT INTO students(id,school_id,student_number,full_name,gender,class_id,section_id,status)
      VALUES(104,1,'S104','Concurrent Student','female',1,2,'active');
      INSERT INTO student_enrollments(
        school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id
      ) VALUES(1,104,1,1,2,'active','pending',1);
    `);
  };
  const published = await publishDraft(fixture, created.body.data);
  assert.equal(published.status, 409, JSON.stringify(published.body));
  assert.equal(published.body.code, 'homework_stale');
  const persisted = fixture.database.prepare('SELECT status,revision FROM homework_assignments WHERE homework_key=?').get(created.body.data.homework_key);
  assert.equal(persisted.status, 'draft');
  assert.equal(persisted.revision, 0);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM homework_audience').get().count, 0);
  assert.equal(fixture.database.prepare("SELECT COUNT(*) count FROM school_notifications WHERE reference_type='homework'").get().count, 0);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM homework_write_guards').get().count, 0);

  const loadRaceDraft = await createDraft(fixture, 'teacher', { title: 'Active load race' });
  fixture.d1.beforeWrite = () => {
    fixture.database.prepare("UPDATE timetable_teaching_loads SET status='inactive' WHERE id=2").run();
  };
  const loadRace = await publishDraft(fixture, loadRaceDraft.body.data);
  assert.equal(loadRace.status, 409, JSON.stringify(loadRace.body));
  assert.equal(loadRace.body.code, 'homework_stale');
  const loadRacePersisted = fixture.database.prepare('SELECT status,revision FROM homework_assignments WHERE homework_key=?').get(loadRaceDraft.body.data.homework_key);
  assert.equal(loadRacePersisted.status, 'draft');
  assert.equal(loadRacePersisted.revision, 0);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM homework_audience').get().count, 0);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM homework_write_guards').get().count, 0);
});

test('parent feed and protected downloads re-check the current active link', async t => {
  const fixture = createFixture(t);
  const created = await createDraft(fixture);
  const homework = created.body.data;
  const pdf = new TextEncoder().encode('%PDF-1.7\nlocal');
  const form = new FormData();
  form.set('school_id', '1');
  form.set('revision', '0');
  form.set('file', new File([pdf], 'lesson.pdf', { type: 'application/pdf' }));
  const uploaded = await request(fixture, 'teacher', 'POST', `/api/homework/${homework.homework_key}/attachments`, form);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const published = await publishDraft(fixture, homework);
  assert.equal(published.status, 200, JSON.stringify(published.body));

  const feed = await request(fixture, 'parent1', 'GET', '/api/homework/parent');
  assert.equal(feed.status, 200, JSON.stringify(feed.body));
  assert.equal(feed.body.data.homework.length, 1);
  const parentItem = feed.body.data.homework[0];
  assert.deepEqual(parentItem.students.map(student => student.id), [101]);
  assert.equal(parentItem.attachments.length, 1);
  assert.deepEqual(Object.keys(parentItem).sort(), [
    'assigned_date',
    'attachments',
    'class_name',
    'due_at',
    'homework_key',
    'instructions',
    'section_name',
    'students',
    'subject_name',
    'teacher_name',
    'title',
  ]);
  assert.deepEqual(Object.keys(parentItem.attachments[0]).sort(), [
    'attachment_key',
    'mime_type',
    'original_name',
    'size_bytes',
  ]);
  const parentDetail = await request(fixture, 'parent1', 'GET', `/api/homework/${homework.homework_key}`);
  assert.equal(parentDetail.status, 200, JSON.stringify(parentDetail.body));
  assert.deepEqual(Object.keys(parentDetail.body.data).sort(), Object.keys(parentItem).sort());
  assert.deepEqual(parentDetail.body.data.students.map(student => student.id), [101]);
  assert.equal((await request(fixture, 'parent2', 'GET', '/api/homework/parent')).body.data.homework.length, 0);
  assert.equal((await request(fixture, 'foreignParent', 'GET', '/api/homework/parent')).body.data.homework.length, 0);
  assert.equal((await request(fixture, 'parent2', 'GET', `/api/homework/attachments/${uploaded.body.data.attachment_key}`)).status, 404);
  assert.equal((await request(fixture, 'foreignParent', 'GET', `/api/homework/attachments/${uploaded.body.data.attachment_key}`)).status, 404);
  const download = await request(fixture, 'parent1', 'GET', `/api/homework/attachments/${uploaded.body.data.attachment_key}`);
  assert.equal(download.status, 200);
  assert.deepEqual(download.body, pdf);

  fixture.database.prepare("UPDATE parent_student_links SET status='inactive', updated_at=unixepoch() WHERE parent_user_id=8 AND student_id=101").run();
  const revokedFeed = await request(fixture, 'parent1', 'GET', '/api/homework/parent');
  assert.equal(revokedFeed.status, 200);
  assert.equal(revokedFeed.body.data.homework.length, 0);
  assert.equal((await request(fixture, 'parent1', 'GET', `/api/homework/attachments/${uploaded.body.data.attachment_key}`)).status, 404);
  const notifications = await request(fixture, 'parent1', 'GET', '/api/notifications');
  assert.equal(notifications.status, 200);
  assert.equal(notifications.body.data.notifications.length, 0);
});

test('withdrawal is audited, withdraws notifications and preserves immutable history', async t => {
  const fixture = createFixture(t);
  const created = await createDraft(fixture);
  const published = await publishDraft(fixture, created.body.data);
  const withdrawn = await request(fixture, 'teacher', 'POST', `/api/homework/${created.body.data.homework_key}/withdraw`, {
    school_id: 1,
    revision: published.body.data.revision,
    reason: 'تصحيح مطلوب في نص السؤال',
  });
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
  assert.equal(withdrawn.body.data.status, 'withdrawn');
  assert.equal(withdrawn.body.data.withdrawal_reason, 'تصحيح مطلوب في نص السؤال');
  assert.equal(fixture.database.prepare("SELECT COUNT(*) count FROM school_notifications WHERE status='withdrawn' AND reference_key=?").get(created.body.data.homework_key).count, 1);
  assert.deepEqual(
    fixture.database.prepare('SELECT action FROM homework_audit ORDER BY id').all().map(row => row.action),
    ['created', 'published', 'withdrawn'],
  );
  assert.throws(() => fixture.database.prepare('DELETE FROM homework_assignments WHERE homework_key=?').run(created.body.data.homework_key), /homework history immutable/);
  assert.throws(() => fixture.database.prepare('DELETE FROM homework_audience').run(), /homework audience immutable/);
  assert.throws(() => fixture.database.prepare('UPDATE homework_audit SET reason=reason').run(), /homework audit immutable/);
});

test('replacement is a unique linked draft and read-only roles cannot mutate', async t => {
  const fixture = createFixture(t);
  const created = await createDraft(fixture);
  const published = await publishDraft(fixture, created.body.data);
  const withdrawn = await request(fixture, 'owner', 'POST', `/api/homework/${created.body.data.homework_key}/withdraw`, {
    school_id: 1,
    revision: published.body.data.revision,
    reason: 'سيصدر بديل مصحح',
  });
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
  fixture.database.prepare("UPDATE subjects SET name='Mathematics Updated' WHERE id=1").run();

  const replacement = await request(fixture, 'teacher', 'POST', `/api/homework/${created.body.data.homework_key}/replacement`, {
    school_id: 1,
    title: 'تمارين الجمع — نسخة مصححة',
    instructions: 'حل الأسئلة من 1 إلى 4.',
    assigned_date: '2026-09-22',
    due_at: null,
  });
  assert.equal(replacement.status, 201, JSON.stringify(replacement.body));
  assert.equal(replacement.body.data.status, 'draft');
  assert.equal(replacement.body.data.replaces_homework_key, created.body.data.homework_key);
  assert.equal(replacement.body.data.subject_name, 'Mathematics Updated');
  assert.equal(
    fixture.database.prepare('SELECT action FROM homework_audit WHERE homework_id=(SELECT id FROM homework_assignments WHERE homework_key=?)').get(replacement.body.data.homework_key).action,
    'replaced',
  );
  assert.equal((await request(fixture, 'teacher', 'POST', `/api/homework/${created.body.data.homework_key}/replacement`, {
    school_id: 1,
    title: 'بديل ثانٍ',
    instructions: 'يجب رفضه.',
    assigned_date: '2026-09-22',
    due_at: null,
  })).status, 409);

  assert.equal((await request(fixture, 'registrar', 'GET', '/api/homework?school_id=1')).status, 200);
  assert.equal((await createDraft(fixture, 'registrar')).status, 403);
  assert.equal((await createDraft(fixture, 'accountant')).status, 403);
  assert.equal((await request(fixture, 'admin', 'GET', '/api/homework')).status, 400);
});
