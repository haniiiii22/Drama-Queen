import { readFileSync, writeFileSync, renameSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

/** File contents, or undefined when the file does not exist. Other errors propagate. */
export function readTextOrUndefined(path) {
  if (!existsSync(path)) return undefined;
  return readFileSync(path, 'utf8');
}

/** Writes through a temp file + rename so readers never see a half-written file. */
export function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o644 });
  renameSync(tmp, path);
}

/** Minimal `--flag` / `--name value` parser. */
export function parseArgs(argv, { flags = [], options = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (flags.includes(name)) out[name] = true;
      else if (options.includes(name)) {
        const v = argv[++i];
        if (v === undefined || v.startsWith('--')) throw new Error(`--${name} needs a value`);
        out[name] = v;
      } else throw new Error(`Unknown option --${name}`);
    } else out._.push(a);
  }
  return out;
}

export function setOutput(name, value) {
  const f = process.env.GITHUB_OUTPUT;
  if (f && /^[a-z_]+$/.test(name) && /^[\w.-]*$/.test(String(value))) appendFileSync(f, `${name}=${value}\n`);
}

export function addSummary(markdown) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) appendFileSync(f, `${markdown}\n`);
}

export const envFlag = (v) => String(v ?? '').trim().toLowerCase() === 'true';
