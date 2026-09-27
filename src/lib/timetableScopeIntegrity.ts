import type { TimetableScope } from './timetableScope.ts';

export interface TimetableScopeProof {
  schoolId: number;
  academicYearId: number;
  revision: number;
  scope: TimetableScope;
  loadIds: number[];
}

function message(proof: TimetableScopeProof): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify([
    'smart-school-timetable-scope-v1', proof.schoolId, proof.academicYearId, proof.revision,
    proof.scope, [...proof.loadIds].sort((a, b) => a - b),
  ]));
}

function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signTimetableScope(proof: TimetableScopeProof, secret: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), message(proof)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyTimetableScope(proof: TimetableScopeProof, token: string, secret: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const bytes = Uint8Array.from(token.match(/../g)!, byte => parseInt(byte, 16));
  return crypto.subtle.verify('HMAC', await key(secret), bytes, message(proof));
}
