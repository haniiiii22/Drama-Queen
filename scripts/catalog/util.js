import { createHash } from 'node:crypto';

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Digest of the ordered list of source keys; null for an empty list. */
export const sourceDigest = (keys) => (keys.length ? sha256(keys.join('\n')) : null);

/** Replaces every occurrence of a secret value with ***. Used on anything that could be logged. */
export function makeRedactor(secrets) {
  const list = secrets.filter((s) => typeof s === 'string' && s.length >= 4);
  return (text) => {
    let out = String(text);
    for (const s of list) out = out.split(s).join('***');
    return out;
  };
}

/** Strips characters that could forge GitHub workflow commands or terminal escapes from log text. */
export function safeLogText(text, max = 200) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/::/g, ': ').slice(0, max);
}
