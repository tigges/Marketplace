import { customAlphabet, nanoid } from "nanoid";

const idAlphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const shortId = customAlphabet(idAlphabet, 12);

/** Prefixed, sortable-ish opaque id, e.g. `mfst_a1b2c3d4e5f6`. */
export function newId(prefix: string): string {
  return `${prefix}_${shortId()}`;
}

/** Raw URL-safe token used for API key material. */
export function newToken(size = 32): string {
  return nanoid(size);
}
