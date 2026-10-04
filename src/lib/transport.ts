export type TransportMode = 'school' | 'private' | 'family' | 'other' | 'unspecified';
export type TransportDirection = 'to_school' | 'from_school' | 'both';
export type TransportFilterDirection = 'any' | 'to_school' | 'from_school';

export const TRANSPORT_MODES: readonly { value: TransportMode; label: string }[] = [
  { value: 'unspecified', label: 'غير محدد' },
  { value: 'school', label: 'اشتراك المدرسة' },
  { value: 'private', label: 'اشتراك خاص' },
  { value: 'family', label: 'مع الأهل' },
  { value: 'other', label: 'وسيلة أخرى' },
];

export interface ResidentialArea {
  id: number;
  school_id: number;
  name: string;
}

export interface TransportLine {
  id: number;
  school_id: number;
  name: string;
  driver_name: string | null;
  driver_phone: string | null;
}

// Optional on legacy student/import records; reads from migrated storage supply defaults.
export interface TransportStudentFields {
  residential_area_id?: number | null;
  residential_area_name?: string | null;
  pickup_landmark?: string | null;
  guardian_phone_secondary?: string | null;
  transport_to_school?: TransportMode;
  transport_from_school?: TransportMode;
  transport_to_school_line_id?: number | null;
  transport_from_school_line_id?: number | null;
  transport_to_school_line_name?: string | null;
  transport_from_school_line_name?: string | null;
  private_driver_name?: string | null;
  private_driver_phone?: string | null;
}

export interface TransportRosterStudent extends TransportStudentFields {
  id: number;
  full_name: string;
  guardian_phone: string | null;
  address: string | null;
  class_name: string | null;
  section_name: string | null;
}

export interface TransportRoster {
  students: TransportRosterStudent[];
  school_name: string;
  academic_year: { id: number; name: string } | null;
}

export function isTransportMode(value: unknown): value is TransportMode {
  return TRANSPORT_MODES.some((mode) => mode.value === value);
}

export function transportModeLabel(mode: TransportMode | string | null | undefined): string {
  return TRANSPORT_MODES.find((option) => option.value === mode)?.label ?? 'غير محدد';
}

export function normalizeAreaName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

export function areaNameKey(name: string): string {
  return normalizeAreaName(name).replace(/[\u064B-\u065F\u0670\u0640]/gu, '')
    .replace(/[أإآٱ]/gu, 'ا').replace(/ى/gu, 'ي').toLowerCase();
}

export function schoolSubscriptionLabel(student: TransportStudentFields): string {
  const toSchool = student.transport_to_school === 'school';
  const fromSchool = student.transport_from_school === 'school';
  if (toSchool && fromSchool) return 'اشتراك المدرسة: ذهاب وإياب';
  if (toSchool) return 'اشتراك المدرسة: ذهاب فقط';
  if (fromSchool) return 'اشتراك المدرسة: إياب فقط';
  return 'غير مشترك بنقل المدرسة';
}

export function getTransportMissingFields(student: TransportRosterStudent): string[] {
  const missing: string[] = [];
  if (student.residential_area_id == null) missing.push('منطقة السكن');
  if (!student.guardian_phone?.trim()) missing.push('هاتف ولي الأمر');
  if (!student.address?.trim()) missing.push('العنوان التفصيلي');
  if (!student.transport_to_school || student.transport_to_school === 'unspecified') missing.push('طريقة الذهاب');
  if (!student.transport_from_school || student.transport_from_school === 'unspecified') missing.push('طريقة الإياب');
  if (student.transport_to_school === 'school' && !student.transport_to_school_line_id) missing.push('خط الذهاب');
  if (student.transport_from_school === 'school' && !student.transport_from_school_line_id) missing.push('خط الإياب');
  return missing;
}

export interface TransportRosterFilter {
  mode?: TransportMode | 'all';
  direction?: TransportFilterDirection;
  lineId?: number | null;
  // null represents students whose residential area has not been completed yet.
  areaIds?: readonly (number | null)[];
}

export function matchesTransportFilter(student: TransportRosterStudent, filter: TransportRosterFilter): boolean {
  if (filter.areaIds && !filter.areaIds.includes(student.residential_area_id ?? null)) return false;
  const directions: readonly ('to_school' | 'from_school')[] = filter.direction === 'to_school'
    ? ['to_school'] : filter.direction === 'from_school' ? ['from_school'] : ['to_school', 'from_school'];
  // Mode and line must match the SAME journey, so private outbound cannot match a school return line.
  return directions.some((direction) => {
    const mode = student[`transport_${direction}`] ?? 'unspecified';
    if (filter.mode && filter.mode !== 'all' && mode !== filter.mode) return false;
    if (filter.lineId != null && (mode !== 'school' || student[`transport_${direction}_line_id`] !== filter.lineId)) return false;
    return true;
  });
}

export interface TransportAreaGroup {
  areaId: number | null;
  name: string;
  students: TransportRosterStudent[];
}

export function groupTransportStudents(students: readonly TransportRosterStudent[]): TransportAreaGroup[] {
  const groups = new Map<number | null, TransportAreaGroup>();
  for (const student of students) {
    const areaId = student.residential_area_id ?? null;
    if (!groups.has(areaId)) groups.set(areaId, { areaId, name: student.residential_area_name || 'منطقة غير محددة', students: [] });
    groups.get(areaId)!.students.push(student);
  }
  return [...groups.values()].sort((a, b) => a.areaId === null ? 1 : b.areaId === null ? -1 : a.name.localeCompare(b.name, 'ar'))
    .map((group) => ({ ...group, students: group.students.sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar') || a.id - b.id) }));
}
