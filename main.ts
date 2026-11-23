import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const T = new Uint8Array(256);
for (const [f, ...ops] of [
  [0x80, 0x00, 0x34],
  [0x91, 0x01],
  [0xc1, 0x02],
  [0x84, 0x03, 0x50, 0x51, 0x53],
  [0x86, 0x04],
  [0x8a, 0x05],
  [0x8b, 0x06],
  [0x8f, 0x07],
  [0x89, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x18, 0x19, 0x1a, 0x1c, 0x1d, 0x1e, 0x20, 0x21, 0x22],
  [0x85, 0x17, 0x1b, 0x40],
  [0xa0, 0x30, 0x33],
  [0xa4, 0x31, 0x32],
  [0x88, 0x41],
  [0x81, 0x52],
]) {
  for (const op of ops) T[op] = f;
}

const s = new Int32Array(256);
const c = new Int32Array(64);
const mem = new Int32Array(256);
const out = new Uint8Array(65536);

function exec(p: Uint8Array, inp: Uint8Array): { buf: Uint8Array; exit: number } {
  mem.fill(0);
  const n = p.length;
  let sp = 0;
  let cp = 0;
  let ol = 0;
  let ip = 0;
  let pc = 0;
  let st = 0;
  const end = (exit: number) => ({ buf: out.subarray(0, ol), exit });

  for (;;) {
    if (st === 1_000_000) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = p[pc];
    const f = T[op];
    if (!f) return end(5);
    const imm = (f >> 4) & 7;
    if (pc + imm >= n) return end(9);
    st++;
    const pop = (f >> 2) & 3;
    if (sp < pop) return end(2);
    if (sp - pop + (f & 3) > 256) return end(3);
    const nx = pc + 1 + imm;
    pc = nx;

    if (f === 0x89) {
      const a = s[sp - 2];
      const b = s[sp - 1];
      let r = 0;
      switch (op) {
        case 0x10: r = a + b; break;
        case 0x11: r = a - b; break;
        case 0x12: r = Math.imul(a, b); break;
        case 0x13: if (!b) return end(4); r = a === -2147483648 && b === -1 ? a : (a / b) | 0; break;
        case 0x14: if (!b) return end(4); r = b === -1 ? 0 : a % b; break;
        case 0x15: if (!b) return end(4); r = ((a >>> 0) / (b >>> 0)) | 0; break;
        case 0x16: if (!b) return end(4); r = (a >>> 0) % (b >>> 0); break;
        case 0x18: r = a & b; break;
        case 0x19: r = a | b; break;
        case 0x1a: r = a ^ b; break;
        case 0x1c: r = a << (b & 31); break;
        case 0x1d: r = a >> (b & 31); break;
        case 0x1e: r = a >>> (b & 31); break;
        case 0x20: r = a === b ? 1 : 0; break;
        case 0x21: r = a < b ? 1 : 0; break;
        case 0x22: r = a >>> 0 < b >>> 0 ? 1 : 0; break;
      }
      s[sp - 2] = r;
      sp--;
      continue;
    }

    switch (op) {
      case 0x00: return end(0);
      case 0x01: s[sp++] = (p[nx - 1] << 24) >> 24; break;
      case 0x02: s[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: s[sp] = s[sp - 1]; sp++; break;
      case 0x05: { const t = s[sp - 1]; s[sp - 1] = s[sp - 2]; s[sp - 2] = t; break; }
      case 0x06: s[sp] = s[sp - 2]; sp++; break;
      case 0x07: { const t = s[sp - 3]; s[sp - 3] = s[sp - 2]; s[sp - 2] = s[sp - 1]; s[sp - 1] = t; break; }
      case 0x17: s[sp - 1] = -s[sp - 1]; break;
      case 0x1b: s[sp - 1] = ~s[sp - 1]; break;
      case 0x30:
      case 0x31:
      case 0x32: {
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        if (op === 0x30 || (op === 0x31 ? s[--sp] === 0 : s[--sp] !== 0)) pc = nx + rel;
        break;
      }
      case 0x33:
        if (cp === 64) return end(7);
        c[cp++] = nx;
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 0x34:
        if (!cp) return end(8);
        pc = c[--cp];
        break;
      case 0x40: {
        const a = s[sp - 1];
        if (a & ~255) return end(6);
        s[sp - 1] = mem[a];
        break;
      }
      case 0x41: {
        const a = s[sp - 1];
        if (a & ~255) return end(6);
        mem[a] = s[sp - 2];
        sp -= 2;
        break;
      }
      case 0x50: {
        const str = String(s[sp - 1]);
        if (ol + str.length > 65536) return end(11);
        sp--;
        for (let i = 0; i < str.length; i++) out[ol++] = str.charCodeAt(i);
        break;
      }
      case 0x51:
        if (ol === 65536) return end(11);
        out[ol++] = s[--sp] & 255;
        break;
      case 0x52:
        s[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      case 0x53:
        return end(s[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const res = exec(readFileSync(join(I, id, 'program.bin')), readFileSync(join(I, id, 'input.bin')));
  const d = join(O, id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'stdout.bin'), res.buf);
  writeFileSync(join(d, 'exit.txt'), `${res.exit}\n`);
}
