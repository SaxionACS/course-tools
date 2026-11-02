// The superloop interpreter against gcc, run by scripts/check.py:
//
//     quarto run tests/superloop_gcc.js [BLOCKS.json]
//
// 1. Random integer expressions over every type the widget knows, with edge
//    values, each run by the interpreter (undefined_behavior: stop) and by a
//    program gcc compiles with UndefinedBehaviorSanitizer. Where the interpreter
//    gives a value, gcc must give the same one and UBSan must find nothing;
//    where the interpreter stops with undefined behaviour, UBSan must report
//    undefined behaviour too. gcc runs with -m32 -funsigned-char where it can
//    (gcc-multilib: int and long 32 bits, char unsigned, as on the RP2040);
//    without -m32 (64-bit long), the expressions leave long out.
// 2. BLOCKS.json (written by check.py): [{where, config}], superloop blocks;
//    the program of every variant must compile with gcc (toC: a fragment's
//    statements in main()) against a pico/stdlib.h made from the interpreter's
//    own list of SDK functions. Blocks with a mistake (the build reports it)
//    are left out.
// 3. printf against the Pico SDK's own printf.c (pico_printf): random formats
//    and values, formatted by the widget and by printf.c compiled with gcc
//    (vfctprintf, as the SDK's printf calls it). printf.c comes from
//    PICO_SDK_PATH, or is downloaded from the SDK at the tag PICO_SDK below.
//
// SUPERLOOP_CASES (default 4000) and SUPERLOOP_SEED change the random cases;
// CC the compiler (default gcc).
const PICO_SDK = '2.3.1';   // the SDK whose printf the widget copies (docs/superloop.md); move it forward here
const here = new URL('.', import.meta.url);
(0, eval)(await Deno.readTextFile(new URL('../src/course_tools/assets/superloop/superloop.js', here)));
const {compile, readConfig, Machine, internals: I} = globalThis.CourseSuperloop;

let passed = 0;
const failed = [];
function ok(condition, what, detail = '') {
  if (condition) passed++;
  else failed.push(`${what}${detail !== '' ? `: ${detail}` : ''}`);
}
const CC = Deno.env.get('CC') || 'gcc';
const tmp = await Deno.makeTempDir({prefix: 'superloop-gcc-'});
async function sh(cmd, args) {
  const out = await new Deno.Command(cmd, {args, stdout: 'piped', stderr: 'piped'}).output();
  const dec = new TextDecoder();
  return {code: out.code, stdout: dec.decode(out.stdout), stderr: dec.decode(out.stderr)};
}

// --- the compiler: -m32 where the 32-bit C library is there ---------------------------
await Deno.writeTextFile(`${tmp}/probe.c`, '#include <stdint.h>\n#include <stdio.h>\nint main(void) { return sizeof(long) == 4 ? 0 : 1; }\n');
const m32 = (await sh(CC, ['-m32', '-o', `${tmp}/probe`, `${tmp}/probe.c`])).code === 0 && (await sh(`${tmp}/probe`, [])).code === 0;
const ARCH = m32 ? ['-m32'] : [];
// in CI (gcc-multilib installed), the 64-bit way out is a failure: long must be tested too
if (Deno.env.get('SUPERLOOP_REQUIRE_M32')) ok(m32, 'gcc -m32 works (gcc-multilib)');
console.log(`gcc: ${(await sh(CC, ['-dumpfullversion'])).stdout.trim()}, ${m32 ? '-m32 (long is 32 bits, as on the RP2040)' : '64-bit (gcc-multilib is missing: long is left out)'}`);

// --- the stand-in for pico/stdlib.h: the interpreter's SDK functions and constants ---------
// (printf, puts, putchar and getchar come from the C library's stdio.h, as on the Pico)
const cType = t => (t === 'str' ? 'const char *' : t);
const stub = ['#ifndef SUPERLOOP_STUB_H', '#define SUPERLOOP_STUB_H', '#include <stdint.h>', '#include <stdbool.h>', '#include <limits.h>',
  '#include <stdio.h>', '#include <inttypes.h>',
  'typedef unsigned int uint;', 'typedef uint64_t absolute_time_t;', 'enum gpio_dir { GPIO_OUT = 1, GPIO_IN = 0 };',
  'enum pico_error_codes { PICO_OK = 0, PICO_ERROR_NONE = 0, PICO_ERROR_GENERIC = -1, PICO_ERROR_TIMEOUT = -2, PICO_ERROR_NO_DATA = -3 };',
  'extern const absolute_time_t nil_time;', 'extern const absolute_time_t at_the_end_of_time;',
  ...Object.entries(I.SDK).filter(([, f]) => !f.libc).map(([name, f]) => `${cType(f.ret)} ${name}(${f.params.length ? f.params.map(cType).join(', ') : 'void'});`), '#endif', ''].join('\n');
for (const h of ['pico/stdlib.h', 'pico/time.h', 'hardware/gpio.h', 'hardware/timer.h']) {
  await Deno.mkdir(`${tmp}/inc/${h.split('/')[0]}`, {recursive: true});
  await Deno.writeTextFile(`${tmp}/inc/${h}`, stub);
}
const consts = Object.keys(I.CONSTS).filter(k => !['true', 'false', 'GPIO_OUT', 'GPIO_IN', 'nil_time', 'at_the_end_of_time'].includes(k));
ok(consts.every(k => /^U?INT(8|16|32|64)?_(MAX|MIN)$|^PICO_(OK|ERROR_[A-Z_]+)$|^EOF$/.test(k)), 'the interpreter\'s constants are those of limits.h, stdint.h, stdio.h and pico/error.h', consts.join(' '));

// --- 1. random expressions ------------------------------------------------------------
let seed = Number(Deno.env.get('SUPERLOOP_SEED') || 20261101);
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = list => list[Math.floor(rnd() * list.length)];
const TYPES = [['bool', 1, false], ['char', 8, false], ['signed char', 8, true], ['unsigned char', 8, false], ['short', 16, true],
  ['unsigned short', 16, false], ['int', 32, true], ['unsigned', 32, false], ['long long', 64, true], ['unsigned long long', 64, false],
  ['int8_t', 8, true], ['uint8_t', 8, false], ['int16_t', 16, true], ['uint16_t', 16, false], ['int32_t', 32, true], ['uint32_t', 32, false],
  ['int64_t', 64, true], ['uint64_t', 64, false], ...(m32 ? [['long', 32, true], ['unsigned long', 32, false]] : [])];
const literal = (v, bits, signed) => {
  // the minimum of a signed type cannot be written as a literal: -9223372036854775807 - 1
  if (signed && v === -(1n << BigInt(bits - 1)) && bits >= 32) return `(-${(1n << BigInt(bits - 1)) - 1n}${bits === 64 ? 'LL' : ''} - 1)`;
  return `${v}${bits === 64 ? (signed ? 'LL' : 'ULL') : !signed && bits === 32 ? 'u' : ''}`;
};
function value([, bits, signed]) {
  if (bits === 1) return rnd() < 0.5 ? 1n : 0n;
  const lo = signed ? -(1n << BigInt(bits - 1)) : 0n, hi = signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n;
  const edges = [lo, hi, 0n, 1n, hi - 1n, ...(signed ? [-1n, lo + 1n] : []), 2n, BigInt(bits), BigInt(bits - 1)];
  const r = rnd();
  if (r < 0.45) return pick(edges.filter(x => x >= lo && x <= hi));
  if (r < 0.75) { const x = BigInt(Math.floor(rnd() * 201) - 100); return x < lo ? lo : x > hi ? hi : x; }
  const span = hi - lo + 1n;
  return lo + BigInt(Math.floor(rnd() * 2 ** 30)) * span / (1n << 30n);
}
const BIN = ['+', '-', '*', '/', '%', '<<', '>>', '&', '|', '^', '==', '!=', '<', '>', '<=', '>=', '&&', '||'];
function expression(vars, depth) {
  const r = rnd();
  if (depth === 0 || r < 0.25) return pick(vars).name;
  if (r < 0.37) return `${pick(['-', '~', '!', '+'])}(${expression(vars, depth - 1)})`;
  if (r < 0.45) return `(${pick(TYPES)[0]})(${expression(vars, depth - 1)})`;
  if (r < 0.5) return `(${expression(vars, depth - 1)} ? ${expression(vars, depth - 1)} : ${expression(vars, depth - 1)})`;
  return `(${expression(vars, depth - 1)} ${pick(BIN)} ${expression(vars, depth - 1)})`;
}
const N = Number(Deno.env.get('SUPERLOOP_CASES') || 4000);
const cases = [];
for (let k = 0; k < N; k++) {
  const vars = Array.from({length: 2 + Math.floor(rnd() * 3)}, (_, i) => { const t = pick(TYPES); return {name: `v${i}`, t, v: value(t)}; });
  const decls = vars.map(x => `volatile ${x.t[0]} ${x.name} = ${literal(x.v, x.t[1], x.t[2])};`).join(' ');
  cases.push({decls, expr: expression(vars, 1 + Math.floor(rnd() * 3))});
}
// the interpreter
for (const c of cases) {
  try {
    const m = new Machine(compile(`uint64_t r;\nint main(void) {\n  ${c.decls}\n  r = (uint64_t)(${c.expr});\n  return 0;\n}`), {ub: 'stop'});
    m.run(1e9, 1e5);
    if (m.returned) c.ours = m.globals[0];
    else c.ub = m.stopped ? m.stopped.message : 'did not finish';
  } catch (e) { c.error = e.message; }
}
ok(cases.every(c => !c.error), 'the interpreter compiles every random case', (cases.find(c => c.error) || {}).error);
// gcc with UBSan: one function per case, its expression on a line of its own. UBSan reports a
// division by zero (or INT_MIN / -1) and then lets it run: x86 traps (SIGFPE), so the program
// jumps to the next case.
const lines = ['#include <stdio.h>', '#include <stdint.h>', '#include <stdbool.h>', '#include <limits.h>', '#include <signal.h>', '#include <setjmp.h>',
  'static sigjmp_buf next;', 'static void trap(int s) { (void)s; siglongjmp(next, 1); }'];
const lineOf = new Map();
cases.forEach((c, k) => {
  lines.push(`static void t${k}(void) { ${c.decls}`);
  lines.push(`  unsigned long long r = (unsigned long long)(${c.expr});`);
  lineOf.set(lines.length, k);
  lines.push(`  printf("${k} %llu\\n", r); }`);
});
lines.push('int main(void) {', '  setvbuf(stdout, NULL, _IONBF, 0);', '  signal(SIGFPE, trap);',
  ...cases.map((_, k) => `  if (!sigsetjmp(next, 1)) t${k}(); else printf("${k} trap\\n");`), '  return 0;', '}', '');
await Deno.writeTextFile(`${tmp}/cases.c`, lines.join('\n'));
const build = await sh(CC, [...ARCH, '-funsigned-char', '-std=gnu11', '-O0', '-w', '-fsanitize=undefined', '-fno-sanitize=alignment', '-o', `${tmp}/cases`, `${tmp}/cases.c`]);
ok(build.code === 0, 'gcc compiles the random cases', build.stderr.split('\n').slice(0, 5).join(' '));
if (build.code === 0) {
  const out = await sh(`${tmp}/cases`, []);
  const theirs = new Map(out.stdout.trim().split('\n').filter(Boolean).map(l => { const [k, v] = l.split(' '); return [Number(k), v === 'trap' ? 'a trap' : BigInt(v)]; }));
  const flagged = new Map();
  for (const l of out.stderr.split('\n')) {
    const m = /cases\.c:(\d+):\d+: runtime error: (.*)/.exec(l);
    if (m && lineOf.has(Number(m[1]))) flagged.set(lineOf.get(Number(m[1])), m[2]);
  }
  let values = 0, both = 0;
  const bad = [];
  cases.forEach((c, k) => {
    if (c.error) return;
    if (c.ub !== undefined) {
      if (flagged.has(k)) both++;
      else bad.push(`case ${k}: the interpreter stops ("${c.ub}"), UBSan finds nothing (gcc gives ${theirs.get(k)}): ${c.decls} r = ${c.expr}`);
    } else if (flagged.has(k)) bad.push(`case ${k}: UBSan finds "${flagged.get(k)}", the interpreter gives ${c.ours}: ${c.decls} r = ${c.expr}`);
    else if (theirs.get(k) !== c.ours) bad.push(`case ${k}: gcc gives ${theirs.get(k)}, the interpreter ${c.ours}: ${c.decls} r = ${c.expr}`);
    else values++;
  });
  console.log(`random cases: ${N} (seed ${Deno.env.get('SUPERLOOP_SEED') || 20261101}): ${values} values as gcc's, ${both} undefined behaviour found by both`);
  ok(bad.length === 0, `the interpreter agrees with gcc on ${N} random expressions`, `${bad.length} disagree:\n  ${bad.slice(0, 8).join('\n  ')}`);
  ok(both > N / 50 && values > N / 2, 'the random cases cover values and undefined behaviour', `${values} values, ${both} undefined behaviour`);
}

// --- 2. the programs of superloop blocks --------------------------------------------------
if (Deno.args[0]) {
  const blocks = [];
  for (const {where, config} of JSON.parse(await Deno.readTextFile(Deno.args[0]))) {
    let c;
    try { c = readConfig(config); } catch { continue; }
    const devices = c.devices.filter(d => !/^GP\d+$/.test(d.name));
    for (const v of c.variants) blocks.push({where: c.variants.length > 1 ? `${where} (${v.name})` : where, src: v.src, devices});
  }
  let k = 0;
  for (const b of blocks) {
    const file = `${tmp}/block${++k}.c`;
    let src;
    try { src = I.toC(b.src, b.devices); }
    catch (e) { ok(false, `${b.where}: the program cannot be turned into C`, e.message); continue; }
    await Deno.writeTextFile(file, src);
    // options that gcc 13 (Ubuntu 24.04, the Check workflow) has too
    const r = await sh(CC, [...ARCH, '-funsigned-char', '-std=gnu11', '-fsyntax-only', `-I${tmp}/inc`, '-Werror=implicit-function-declaration',
      '-Werror=int-conversion', file]);
    ok(r.code === 0, `${b.where}: gcc compiles the program`, r.stderr.split('\n').filter(l => /error/.test(l)).slice(0, 3).join(' '));
  }
  console.log(`block programs: ${blocks.length} compiled with gcc`);
}

// --- 3. printf against the SDK's printf.c ------------------------------------------------------
{
  let source = null;
  const sdk = Deno.env.get('PICO_SDK_PATH');
  if (sdk) source = await Deno.readTextFile(`${sdk}/src/rp2_common/pico_printf/printf.c`).catch(() => null);
  if (!source) {
    const url = `https://raw.githubusercontent.com/raspberrypi/pico-sdk/${PICO_SDK}/src/rp2_common/pico_printf/printf.c`;
    source = await fetch(url).then(r => (r.ok ? r.text() : null)).catch(() => null);
  }
  if (!source) {
    // in CI, printf must be tested; elsewhere, without a network and a PICO_SDK_PATH, it is left out
    if (Deno.env.get('CI')) ok(false, `printf.c of the Pico SDK ${PICO_SDK} could be downloaded`);
    else console.log('printf: printf.c of the Pico SDK is not here (no PICO_SDK_PATH, no network): left out');
  } else {
    await Deno.mkdir(`${tmp}/pp/pico`, {recursive: true});
    await Deno.writeTextFile(`${tmp}/pp/printf.c`, source);
    await Deno.writeTextFile(`${tmp}/pp/pico.h`, '#include <stdbool.h>\n#include <stdint.h>\n#include <stddef.h>\ntypedef unsigned int uint;\n#define WRAPPER_FUNC(x) pp_##x\n#define __printflike(a, b)\n');
    await Deno.writeTextFile(`${tmp}/pp/pico/printf.h`, '#include <stdarg.h>\n#define PICO_PRINTF_ALWAYS_INCLUDED 1\nint vfctprintf(void (*out)(char character, void *arg), void *arg, const char *format, va_list va);\n');
    const CONVS = 'diuxXobcs%', LENS = m32 ? ['', '', '', 'hh', 'h', 'l', 'll', 'z', 'j', 't'] : ['', '', '', 'hh', 'h', 'll'];
    const utf8 = t => String.fromCharCode(...new TextEncoder().encode(t));
    const TEXTS = ['', 'a', 'hello', 'with space', 'tab\there', utf8('µs'), 'a string of more than thirty-two characters'];
    const intIn = (bits, signed) => {
      const v = value([null, bits, signed]);
      return bits === 64 ? v : Number(v);
    };
    const cStr = b => `"${[...b].map(ch => { const c = ch.charCodeAt(0); return c >= 32 && c < 127 && ch !== '"' && ch !== '\\' && ch !== '?' ? ch : `\\${c.toString(8).padStart(3, '0')}`; }).join('')}"`;
    const cases = [];
    for (let k = 0; k < N; k++) {
      let fmt = '';
      const vals = [], args = [];
      for (let n = 1 + Math.floor(rnd() * 3); n > 0; n--) {
        fmt += pick(['', '', ' ', 'x=', '|', '\n', 'ab']);
        const conv = pick(CONVS.split(''));
        let spec = '%';
        for (const f of '-0+ #') if (rnd() < 0.2) spec += f;
        const w = rnd();
        if (w < 0.35) spec += String(Math.floor(rnd() * 41));
        else if (w < 0.5) { spec += '*'; const x = Math.floor(rnd() * 61) - 30; vals.push(x); args.push(`${x}`); }
        const p = rnd();
        if (p < 0.05) spec += '.';
        else if (p < 0.35) spec += `.${Math.floor(rnd() * 41)}`;
        else if (p < 0.45) { spec += '.*'; const x = Math.floor(rnd() * 61) - 20; vals.push(x); args.push(`${x}`); }
        const len = 'cs%'.includes(conv) ? '' : pick(LENS);
        spec += len + conv;
        fmt += spec;
        if (conv === '%') continue;
        if (conv === 's') { const t = pick(TEXTS); vals.push(t); args.push(cStr(t)); continue; }
        if (conv === 'c') { const x = Math.floor(rnd() * 300) - 20; vals.push(x); args.push(`${x}`); continue; }
        const signed = 'di'.includes(conv), big = len === 'll' || len === 'j', longish = 'lzt'.includes(len) && len !== '';
        const type = big ? (signed ? 'long long' : 'unsigned long long') : longish ? (signed ? 'long' : 'unsigned long') : (signed ? 'int' : 'unsigned int');
        // a value of the size the conversion reads; sometimes of the other signedness (a same-size mix)
        const x = intIn(big ? 64 : 32, rnd() < 0.5 ? signed : !signed);
        vals.push(x);
        args.push(big ? `(long long)${BigInt.asIntN(64, BigInt(x))}LL` : `(${type})${x}${x < 0 ? '' : 'u'}`);
      }
      fmt += pick(['', '\n', '.']);
      cases.push({fmt, vals, args});
    }
    const prog = ['#include <stdio.h>', '#include <stdarg.h>', 'int vfctprintf(void (*out)(char, void *), void *arg, const char *format, va_list va);',
      'static char out[4096]; static int on;', 'static void put(char c, void *a) { (void)a; if (on < 4000) out[on++] = c; }',
      'static int t(const char *fmt, ...) { va_list va; va_start(va, fmt); on = 0; int r = vfctprintf(put, 0, fmt, va); va_end(va); return r; }',
      'static void show(int r) { printf("%d:", r); for (int i = 0; i < on; i++) printf("%02x", (unsigned char)out[i]); printf("\\n"); }',
      'int main(void) {', ...cases.map(c => `  show(t(${cStr(c.fmt)}${c.args.map(a => `, ${a}`).join('')}));`), '  return 0;', '}', ''].join('\n');
    await Deno.writeTextFile(`${tmp}/pp/cases.c`, prog);
    const cc = await sh(CC, [...ARCH, '-funsigned-char', '-std=gnu11', '-w', `-I${tmp}/pp`, '-o', `${tmp}/pp/cases`, `${tmp}/pp/cases.c`, `${tmp}/pp/printf.c`]);
    ok(cc.code === 0, 'printf.c of the Pico SDK compiles with gcc', cc.stderr.split('\n').slice(0, 4).join(' '));
    if (cc.code === 0) {
      const got = (await sh(`${tmp}/pp/cases`, [])).stdout.trim().split('\n');
      const hex = s => [...s].map(ch => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      let bad = 0;
      cases.forEach((c, k) => {
        const r = I.formatPrintf(I.readFormat(c.fmt).items, c.vals, 0);
        const mine = `${r.count}:${hex(r.text)}`;
        if (mine !== got[k]) { bad++; if (bad <= 5) ok(false, `printf(${JSON.stringify(c.fmt)}, ${c.args.join(', ')}) as the SDK's printf.c`, `widget ${mine}, printf.c ${got[k]}`); }
      });
      ok(bad === 0, `printf: ${cases.length} random formats as the SDK's printf.c (${PICO_SDK}) prints them`, `${bad} differ`);
      console.log(`printf: ${cases.length} random formats against the SDK's printf.c, ${bad} differ`);
    }
  }
}

await Deno.remove(tmp, {recursive: true});
for (const f of failed) console.log(`FAIL ${f}`);
console.log(`${passed} ok, ${failed.length} failed`);
if (failed.length) Deno.exit(1);
