import assert from 'node:assert/strict';
import test from 'node:test';
import {
  areaNameKey, getTransportMissingFields, groupTransportStudents, isTransportMode,
  matchesTransportFilter, normalizeAreaName, schoolSubscriptionLabel, transportModeLabel,
} from '../src/lib/transport.ts';
import { hasRole, TRANSPORT_ACCESS_ROLES, TRANSPORT_MANAGEMENT_ROLES } from '../src/lib/rbac.ts';

const student = (overrides = {}) => ({
  id: 1, full_name: 'أحمد علي', guardian_phone: '07701234567', address: 'الشارع الأول',
  class_name: 'الأول', section_name: 'أ', residential_area_id: 4, residential_area_name: 'الأندلس',
  transport_to_school: 'school', transport_from_school: 'family', transport_to_school_line_id: 10,
  transport_from_school_line_id: null, ...overrides,
});

test('private subscription and family are explicit transport modes, with safe legacy defaults', () => {
  for (const mode of ['private', 'family', 'school', 'other', 'unspecified']) assert.ok(isTransportMode(mode));
  assert.equal(isTransportMode('round_trip'), false);
  assert.equal(transportModeLabel('private'), 'اشتراك خاص');
  assert.equal(transportModeLabel('family'), 'مع الأهل');
  assert.equal(transportModeLabel(undefined), 'غير محدد');
});

test('school subscription summary derives from each journey independently', () => {
  assert.equal(schoolSubscriptionLabel(student()), 'اشتراك المدرسة: ذهاب فقط');
  assert.equal(schoolSubscriptionLabel(student({ transport_from_school: 'school' })), 'اشتراك المدرسة: ذهاب وإياب');
  assert.equal(schoolSubscriptionLabel(student({ transport_to_school: 'private', transport_from_school: 'school' })), 'اشتراك المدرسة: إياب فقط');
  assert.equal(schoolSubscriptionLabel(student({ transport_to_school: 'private' })), 'غير مشترك بنقل المدرسة');
});

test('mode and line must match the same direction when filtering a driver list', () => {
  const mixed = student({ transport_from_school: 'private' });
  assert.equal(matchesTransportFilter(mixed, { mode: 'private', lineId: 10 }), false);
  assert.equal(matchesTransportFilter(mixed, { mode: 'school', lineId: 10 }), true);
  assert.equal(matchesTransportFilter(mixed, { direction: 'from_school', lineId: 10 }), false);
  assert.equal(matchesTransportFilter(mixed, { direction: 'to_school', lineId: 10 }), true);
});

test('different outbound and return drivers each receive only their actual assignment', () => {
  const mixed = student({ transport_from_school: 'school', transport_from_school_line_id: 20 });
  assert.equal(matchesTransportFilter(mixed, { lineId: 20, direction: 'to_school' }), false);
  assert.equal(matchesTransportFilter(mixed, { lineId: 20, direction: 'from_school' }), true);
  assert.equal(matchesTransportFilter(mixed, { lineId: 20 }), true);
  assert.equal(matchesTransportFilter(mixed, { lineId: 30 }), false);
});

test('selected areas and all/family/private filters preserve exactly the requested scope', () => {
  const students = [student(), student({ id: 2, residential_area_id: 5, transport_to_school: 'family' }),
    student({ id: 3, residential_area_id: null, transport_to_school: 'private' })];
  assert.deepEqual(students.filter((row) => matchesTransportFilter(row, { areaIds: [4, null], mode: 'all' })).map((row) => row.id), [1, 3]);
  assert.deepEqual(students.filter((row) => matchesTransportFilter(row, { areaIds: [], mode: 'all' })), []);
  assert.deepEqual(students.filter((row) => matchesTransportFilter(row, { mode: 'private' })).map((row) => row.id), [3]);
  assert.equal(matchesTransportFilter(student({ transport_to_school: undefined }), { mode: 'unspecified' }), true);
});

test('area grouping retains every selected student once and preserves same-name distinct areas', () => {
  const rows = [student({ id: 2 }), student({ id: 1 }), student({ id: 3, residential_area_id: 5 }),
    student({ id: 4, residential_area_id: null, residential_area_name: null })];
  const groups = groupTransportStudents(rows);
  assert.equal(groups.length, 3);
  assert.equal(groups.at(-1).areaId, null);
  assert.equal(groups.at(-1).name, 'منطقة غير محددة');
  assert.deepEqual(groups.flatMap((group) => group.students.map((row) => row.id)).sort(), [1, 2, 3, 4]);
  assert.deepEqual(rows.map((row) => row.id), [2, 1, 3, 4]);
});

test('incomplete records remain printable and are explicitly identified', () => {
  assert.deepEqual(getTransportMissingFields(student()), []);
  const legacy = student({ residential_area_id: null, guardian_phone: ' ', address: null,
    transport_to_school: 'unspecified', transport_from_school: undefined });
  assert.deepEqual(getTransportMissingFields(legacy), ['منطقة السكن', 'هاتف ولي الأمر', 'العنوان التفصيلي', 'طريقة الذهاب', 'طريقة الإياب']);
  assert.ok(matchesTransportFilter(legacy, { mode: 'all', areaIds: [null] }));
  assert.ok(getTransportMissingFields(student({ transport_to_school_line_id: null })).includes('خط الذهاب'));
});

test('area keys prevent whitespace and common Arabic spelling duplicates', () => {
  assert.equal(normalizeAreaName('  حي   الأندلس  '), 'حي الأندلس');
  assert.equal(areaNameKey('  حَيّ الأندلُس '), areaNameKey('حي الاندلس'));
  assert.equal(areaNameKey('حي الـنور'), areaNameKey('حي النور'));
  assert.notEqual(areaNameKey('حي النور'), areaNameKey('حي الزهور'));
});

test('transport rosters and assignments are restricted to school management and registrars', () => {
  for (const role of ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar']) {
    assert.ok(hasRole(role, TRANSPORT_ACCESS_ROLES));
    assert.ok(hasRole(role, TRANSPORT_MANAGEMENT_ROLES));
  }
  for (const role of ['teacher', 'accountant', 'parent']) {
    assert.equal(hasRole(role, TRANSPORT_ACCESS_ROLES), false);
    assert.equal(hasRole(role, TRANSPORT_MANAGEMENT_ROLES), false);
  }
});
