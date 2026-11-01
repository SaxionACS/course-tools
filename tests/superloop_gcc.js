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
//
// SUPERLOOP_CASES (default 4000) and SUPERLOOP_SEED change the random cases;
// CC the compiler (default gcc).
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
const stub = ['#ifndef SUPERLOOP_STUB_H', '#define SUPERLOOP_STUB_H', '#include <stdint.h>', '#include <stdbool.h>', '#include <limits.h>',
  'typedef unsigned int uint;', 'typedef uint64_t absolute_time_t;', 'enum gpio_dir { GPIO_OUT = 1, GPIO_IN = 0 };',
  'extern const absolute_time_t nil_time;', 'extern const absolute_time_t at_the_end_of_time;',
  ...Object.entries(I.SDK).map(([name, f]) => `${f.ret} ${name}(${f.params.length ? f.params.join(', ') : 'void'});`), '#endif', ''].join('\n');
for (const h of ['pico/stdlib.h', 'pico/time.h', 'hardware/gpio.h', 'hardware/timer.h']) {
  await Deno.mkdir(`${tmp}/inc/${h.split('/')[0]}`, {recursive: true});
  await Deno.writeTextFile(`${tmp}/inc/${h}`, stub);
}
const consts = Object.keys(I.CONSTS).filter(k => !['true', 'false', 'GPIO_OUT', 'GPIO_IN', 'nil_time', 'at_the_end_of_time'].includes(k));
ok(consts.every(k => /^U?INT(8|16|32|64)?_(MAX|MIN)$/.test(k)), 'the interpreter\'s constants are those of limits.h and stdint.h', consts.join(' '));

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

await Deno.remove(tmp, {recursive: true});
for (const f of failed) console.log(`FAIL ${f}`);
console.log(`${passed} ok, ${failed.length} failed`);
if (failed.length) Deno.exit(1);
