const fs = require('fs');
let a = fs.readFileSync('src/lib/api.ts', 'utf8');

// Update getGradeSettings to accept optional school_id
const oldGet = `export function getGradeSettings() {
  return fetchApi<Record<string, any>>('/api/grade-settings');
}`;

const newGet = `export function getGradeSettings(schoolId?: number | null) {
  const qs = schoolId != null ? '?school_id=' + schoolId : '';
  return fetchApi<Record<string, any>>('/api/grade-settings' + qs);
}`;

if (!a.includes(oldGet)) {
  console.error('Could not find oldGet pattern');
  process.exit(1);
}
a = a.replace(oldGet, newGet);

// Update updateGradeSettings to accept optional school_id and include in payload
const oldUpdate = `export function updateGradeSettings(data: Record<string, any>) {
  // Non-admin users: backend derives school_id from JWT.
  // Do NOT include school_id in body for principals/teachers.
  return fetchApi<Record<string, any>>('/api/grade-settings', { method: 'PUT', body: JSON.stringify(data) });
}`;

const newUpdate = `export function updateGradeSettings(data: Record<string, any>, schoolId?: number | null) {
  const payload = schoolId != null ? { ...data, school_id: schoolId } : data;
  return fetchApi<Record<string, any>>('/api/grade-settings', { method: 'PUT', body: JSON.stringify(payload) });
}`;

if (!a.includes(oldUpdate)) {
  console.error('Could not find oldUpdate pattern');
  process.exit(1);
}
a = a.replace(oldUpdate, newUpdate);

fs.writeFileSync('src/lib/api.ts', a, 'utf8');
console.log('api.ts updated successfully');
