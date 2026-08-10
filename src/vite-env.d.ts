/// <reference types="vite/client" />

declare module 'node:crypto' {
  export function pbkdf2(
    password: string | Uint8Array,
    salt: string | Uint8Array,
    iterations: number,
    keyLength: number,
    digest: string,
    callback: (error: Error | null, derivedKey: Uint8Array) => void,
  ): void;
}
