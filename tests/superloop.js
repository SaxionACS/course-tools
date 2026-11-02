// Tests of the superloop blocks (assets/superloop/superloop.js), run by scripts/check.py:
//
//     quarto run tests/superloop.js
//
// C's integer rules as on the RP2040; every row of the undefined-behaviour
// table (docs/superloop.md) in both modes, with the values a Pico gives;
// mistakes the build reports; the lesson programs run with scripted presses,
// with exact results; goals, scripts and the PDF form. The values of the
// "permit" rows were measured on a Pico (SDK 2.3.1, Release build).
const here = new URL('.', import.meta.url);
(0, eval)(await Deno.readTextFile(new URL('../src/course_tools/assets/superloop/superloop.js', here)));
const {compile, readConfig, Machine, Runner, print, internals: I} = globalThis.CourseSuperloop;
const {MS, US, SEC} = I;

let passed = 0;
const failed = [];
function ok(condition, what, detail = '') {
  if (condition) passed++;
  else failed.push(`${what}${detail !== '' ? `: ${detail}` : ''}`);
}
const err = f => { try { f(); return 'no error'; } catch (e) { return e.message; } };
// run a program until main returns (or ns), return the machine
function run(src, {ub = 'stop', ns = 10 * SEC, cfg = {}} = {}) {
  const m = new Machine(compile(src, {ub}), Object.assign({ub, lineTime: US}, cfg));
  m.run(ns, 5e7);
  return m;
}
const val = (m, name) => { const s = m.prog.lookup(name); return s ? m.value(s).v : undefined; };

// --- C's integer rules on the RP2040 -------------------------------------------------
{
  const m = run(`
    uint8_t x = 200; uint8_t r1; int8_t y = 127; int8_t r2; int r3; uint32_t r4; int r5; uint64_t r6; char c = 200; int r7;
    unsigned r8; long long r9; int r10; int r11; int r12; uint16_t u16 = 65535; int r13; uint32_t r14; int r15; int r16; long r17;
    x += 100; r1 = x;
    y++; r2 = y;
    r3 = -1 < 0u;
    r4 = 0; r4 = r4 - 1;
    uint8_t u = 0; r5 = u - 1;
    r6 = 0ull - 1;
    r7 = c;
    r8 = -7 / 2; r9 = -7 % 2;
    r10 = 7 / -2; r11 = -7 % -2;
    r12 = (int8_t)300;
    r13 = u16 + 1;
    r14 = 0xFFFFFFFF + 1u;
    r15 = 3000000000u > 2;
    r16 = -1L < 1u;
    r17 = 0x7fffffff;`);
  ok(m.returned, 'a fragment runs to its end', m.stopped && m.stopped.message);
  const want = {r1: 44, r2: -128, r3: 0, r4: 4294967295, r5: -1, r6: 18446744073709551615n, r7: 200, r8: 4294967293, r9: -1n,
    r10: -3, r11: -1, r12: 44, r13: 65536, r14: 0, r15: 1, r16: 0, r17: 2147483647};
  for (const [k, v] of Object.entries(want)) ok(val(m, k) === v, `integer rule ${k}`, `${val(m, k)}, not ${v}`);
}
{
  const m = run(`
    int a = 2 + 3 * 4; int b = (2 + 3) * 4; int c = 1 << 2 + 1; int d = 5 & 3 == 3; int e = 0; int f = 0;
    int h = 10; int i = h++ + 1; int j = ++h; int k = 3 > 2 ? 7 : 8; int l = 0; int n = 1, o = 2;
    if (e && (f = 1)) { } int s1 = f;
    if (1 || (f = 2)) { } int s2 = f;
    l = (n = 5, n + 1);
    int q = ~0u >> 28; int w = 0; do { w++; } while (w < 5); int z = 0; for (int t = 0; t < 10; t++) { if (t == 3) continue; if (t == 7) break; z += t; }`);
  const want = {a: 14, b: 20, c: 8, d: 1, i: 11, j: 12, k: 7, s1: 0, s2: 0, l: 6, q: 15, w: 5, z: 18};
  for (const [k, v] of Object.entries(want)) ok(val(m, k) === v, `expression ${k}`, `${val(m, k)}, not ${v}`);
}
{
  const m = run(`int r1; int r2; int fact(int n) { if (n <= 1) return 1; return n * fact(n - 1); }
    int twice(int x) { return 2 * x; } int main(void) { r1 = fact(10); r2 = twice(twice(3)); return 0; }`);
  ok(val(m, 'r1') === 3628800 && val(m, 'r2') === 12, 'functions, recursion');
  const deep = run('int f(int n) { return f(n + 1); } int main(void) { f(0); }');
  ok(deep.stopped && /more than 64 levels deep/.test(deep.stopped.message), 'endless recursion stops', deep.stopped && deep.stopped.message);
}

// --- undefined behaviour: stop, and permit = the Pico's values ------------------------
const UB = [
  // [row, declarations and the statement that sets r, the message (stop), the Pico's value (permit)]
  ['A1 INT_MAX + 1', 'int x = INT_MAX; int r; r = x + 1;', /2147483647 \+ 1 does not fit in an int/, -2147483648],
  ['A4 uint16_t * uint16_t', 'uint16_t a = 50000, b = 50000; uint32_t r; r = a * b;', /50000 \* 50000 does not fit in an int \(uint16_t values become int before the multiplication\)\. Signed overflow is undefined behaviour in C\. Write \(uint32_t\)a \* b\.$/, 2500000000],
  ['A5 -INT_MIN', 'int x = INT_MIN; int r; r = -x;', /does not fit/, -2147483648],
  ['B1 1u << 32', 'int n = 32; uint32_t r; r = 1u << n;', /shifts by 32, but an unsigned int has only 32 bits/, 0],
  ['B1 1u << 33', 'int n = 33; uint32_t r; r = 1u << n;', /shifts by 33/, 0],
  ['B1 1u << 256', 'int n = 256; uint32_t r; r = 1u << n;', /shifts by 256/, 1],
  ['B1 1u << 257', 'int n = 257; uint32_t r; r = 1u << n;', /shifts by 257/, 2],
  ['B2 1u << -1', 'int n = -1; uint32_t r; r = 1u << n;', /negative/, 0],
  ['B2 0x80000000u >> 32', 'int n = 32; uint32_t r; r = 0x80000000u >> n;', /shifts by 32/, 0],
  ['B2 0x80000000u >> 255', 'int n = 255; uint32_t r; r = 0x80000000u >> n;', /shifts by 255/, 0],
  ['B3 -8 >> 32', 'int n = 32; int32_t r; r = -8 >> n;', /shifts by 32/, -1],
  ['B3 8 >> 32', 'int n = 32; int32_t r; r = 8 >> n;', /shifts by 32/, 0],
  ['B3 -8 >> 256', 'int n = 256; int32_t r; r = -8 >> n;', /shifts by 256/, -8],
  ['B4 1 << 31', 'int n = 31; int r; r = 1 << n;', /sign bit of an int. Write 1u << 31/, -2147483648],
  ['B4 -1 << 1', 'int x = -1; int r; r = x << 1;', /negative number to the left/, -2],
  ['B5 1ull << 64', 'int n = 64; uint64_t r; r = 1ull << n;', /only 64 bits/, 0n],
  ['B5 1ull << 255', 'int n = 255; uint64_t r; r = 1ull << n;', /shifts by 255/, 0n],
  ['B5 3ull << 256', 'int n = 256; uint64_t r; r = 3ull << n;', /shifts by 256/, 3n],
  ['B5 (1ull << 63) >> 64', 'int n = 64; uint64_t r; r = (1ull << 63) >> n;', /shifts by 64/, 0n],
  ['D1 7 / 0', 'int z = 0; int r; r = 7 / z;', /division by zero/, 2147483647],
  ['D1 -7 / 0', 'int z = 0; int r; r = -7 / z;', /division by zero/, -2147483648],
  ['D1 0 / 0', 'int z = 0; int r; r = 0 / z;', /division by zero/, 0],
  ['D2 7 % 0', 'int z = 0; int r; r = 7 % z;', /remainder by zero/, 0],
  ['D3 7u / 0', 'unsigned z = 0; unsigned r; r = 7u / z;', /division by zero/, 4294967295],
  ['D3 7u % 0', 'unsigned z = 0; unsigned r; r = 7u % z;', /remainder by zero/, 0],
  ['D4 INT_MIN / -1', 'int x = INT_MIN, y = -1; int r; r = x / y;', /does not fit/, -2147483648],
  ['D4 INT_MIN % -1', 'int x = INT_MIN, y = -1; int r; r = x % y;', /does not fit/, 0],
  ['D5 7ll / 0', 'int64_t z = 0; int64_t r; r = 7ll / z;', /division by zero/, 9223372036854775807n],
  ['D5 -7ll / 0', 'int64_t z = 0; int64_t r; r = -7ll / z;', /division by zero/, -9223372036854775808n],
];
for (const [row, body, msg, value] of UB) {
  const decl = /(uint32_t|int32_t|uint64_t|unsigned|int64_t|int) r;/.exec(body)[0];
  const src = `${decl}\nint main(void) { ${body.replace(decl, '')} return 0; }`;
  const s = run(src);
  ok(s.stopped && msg.test(s.stopped.message) && /undefined behaviour/.test(s.stopped.message), `UB ${row}: stop, with the message`, s.stopped && s.stopped.message);
  const p = run(src, {ub: 'permit'});
  ok(val(p, 'r') === value, `UB ${row}: permit gives the Pico's value`, `${val(p, 'r')}, not ${value}`);
  ok(p.notes.some(n => n.kind === 'ub' && /may do something else/.test(n.text)), `UB ${row}: permit warns`);
}
{
  const s = run('int r; int main(void) { int x; r = x; return 0; }');
  ok(s.stopped && /x is used before it gets a value/.test(s.stopped.message), 'C1 uninitialised read: stop', s.stopped && s.stopped.message);
  ok(val(run('int r; int main(void) { int x; r = x; return 0; }', {ub: 'permit'}), 'r') === 0, 'C1 permit: 0, as gcc');
  ok(val(run('int r; int c(int n) { int count; for (int i = 0; i < n; i++) count++; return count; } int main(void) { r = c(7); return 0; }', {ub: 'permit'}), 'r') === 7, 'C3 permit: an uninitialised counter counts from 0');
  const loop = 'int r; int main(void) { int last = -1; for (int k = 0; k < 7; k++) { int t; if (k == 0) t = 42; last = t; } r = last; return 0; }';
  ok(val(run(loop, {ub: 'permit'}), 'r') === 42, 'C4 permit: the value of the round before');
  ok(/t is used before/.test(run(loop).stopped.message), 'C4 stop: in the second round');
  const nr = 'int r; int f(int a) { if (a > 100) return 1; } int main(void) { r = f(7); return 0; }';
  ok(val(run(nr, {ub: 'permit'}), 'r') === 7, 'F1 permit: the first argument, as gcc');
  ok(/f\(\) ends without a return, but its value is used/.test(run(nr).stopped.message), 'F1 stop');
  ok(val(run('int r; int f(int a) { if (a > 100) return 1; } int main(void) { f(7); r = 5; return 0; }'), 'r') === 5, 'F1: a value nobody uses is no undefined behaviour');
}
// a variable changed twice in one expression: a build error (stop); left to right with a note (permit), as gcc on the Pico
{
  for (const e of ['i = i++ + 1;', 'r = i++ + i++;', 'r = pair(i++, i++);', 'r = i + i++;', 'r = (i = 1) + i;'])
    ok(/i is changed twice in one expression, or changed and also read/.test(err(() => compile(`int i = 7; int r; int pair(int a, int b) { return 100 * a + b; } int main(void) { ${e} return 0; }`))), `E: ${e} is a build error`);
  for (const e of ['i = i + 1;', 'r = i++ && i++;', 'r = i ? i++ : 0;', 'r = (i++, i);', 'gpio_put(15, !gpio_get(15));'])
    ok(err(() => compile(`int i = 7; int r; int main(void) { ${e} return 0; }`)) === 'no error', `E: ${e} is fine`);
  const p = s => val(run(`int i = 7; int r; int pair(int a, int b) { return 100 * a + b; } int main(void) { ${s} return 0; }`, {ub: 'permit'}), s.startsWith('i =') ? 'i' : 'r');
  ok(p('i = i++ + 1;') === 8 && p('r = i++ + i++;') === 15 && p('r = pair(i++, i++);') === 708, 'E1-E3 permit: left to right, as gcc on the Pico');
  const n = run('int i = 7; int main(void) { i = i++ + 1; return 0; }', {ub: 'permit'});
  ok(n.notes.some(x => /changed twice/.test(x.text)), 'E permit: a note');
}

// --- mistakes the build reports ------------------------------------------------------
const ERR = [
  ['int x = 1\nint y;', /^Line 1, column 10: ";" is missing at the end of the line/],
  ['int *p;', /Line 1, column 5: pointers are not supported/],
  ['#define X 5', /#define is not supported in this widget. Use a constant/],
  ['const int X = 1; X = 2;', /X is a constant/],
  ['foo();', /foo\(\) is not a function this widget knows/],
  ['break;', /only allowed inside a loop/],
  ['int a[3];', /arrays are not supported/],
  ['y = 3;', /y is not declared/],
  ['float f;', /float is not supported/],
  ['gpio_put(1);', /takes 2 arguments, not 1/],
  ['int x = 08;', /octal/],
  ['while (true) { int x; ', /"}" is missing/],
  ['int main() { f(); } void f(void) { }', /f\(\) is called before it is declared/],
  ['int x = 1; int x = 2;', /x is declared twice/],
  ['switch (1) { }', /switch is not supported in this widget yet/],
  ['char buf[10]; sprintf(buf, "x");', /arrays are not supported/],
  ['sprintf("x");', /sprintf\(\) is not supported in this widget yet/],
];
for (const [src, pat] of ERR) { const e = err(() => compile(src)); ok(pat.test(e), `build error: ${src.replace(/\n/g, ' ')}`, e); }
const cfg = extra => Object.assign({code: 'while (true) { gpio_put(LED_PIN, gpio_get(BUTTON_PIN)); }', inputs: {BUTTON_PIN: 'hold button'}, outputs: {LED_PIN: 'red led'}}, extra);
const CERR = [
  [{flavour: 1}, /"flavour" is not a setting/],
  [{inputs: {B: 'knob'}}, /"knob" is not an input/],
  [{outputs: {L: 'lamp'}}, /"lamp" is not an output/],
  [{code: 'int LED_PIN = 15; while (true) { }'}, /LED_PIN is the name of an output, so it must be a pin number/],
  [{code: 'const uint LED_PIN = 16; while (true) { }', inputs: {16: 'hold button'}}, /GP16 and LED_PIN are both on GP16|LED_PIN and GP16 are both on GP16/],
  [{watch: ['nope']}, /watch: nope is not a variable/],
  [{timeline: ['cpu', 'nope']}, /timeline: nope is not cpu, an input, an output or a variable/],
  [{params: ['LED_PIN']}, /params: LED_PIN is not a constant of the program/],
  [{script: ['KNOB press at 1 s']}, /KNOB is not an input/],
  [{script: ['BUTTON_PIN press at 2 s', 'BUTTON_PIN press at 1 s']}, /must be in time order/],
  [{script: ['BUTTON_PIN press at 5 s for 1 s']}, /is after the end of the run/],
  [{script: ['BUTTON_PIN high at 1 s']}, /a hold button: write press or release/],
  [{script: ['BUTTON_PIN press 1 s']}, /is not a step/],
  [{goal: {vars: {nope: 1}}}, /goal, vars: nope is not a variable/],
  [{goal: {outputs: {LED_PIN: 'dim'}}}, /goal, outputs, LED_PIN: "dim" is not allowed/],
  [{goal: {}}, /goal: it asks for nothing/],
  [{variants: {a: 'while (true) { }', b: 'while (true) { }'}, code: undefined, goal: {outputs: {LED_PIN: 'on'}}}, /with variants, a goal names its variant/],
  [{undefined_behavior: 'maybe'}, /undefined_behavior: "maybe" is not allowed/],
  [{code: 'int i; while (true) { i = i++ + 1; }'}, /i is changed twice/],
];
for (const [extra, pat] of CERR) { const e = err(() => readConfig(cfg(extra))); ok(pat.test(e), `settings: ${JSON.stringify(extra).slice(0, 70)}`, e); }
ok(readConfig(cfg({code: 'int i; while (true) { i = i++ + 1; }', undefined_behavior: 'permit'})).variants.length === 1, 'permit: a double change is no build error');

// --- the lesson programs, with presses -------------------------------------------------------
const SLEEPING = `const uint32_t BLINK_MS = 1000;
const uint32_t DEBOUNCE_MS = 50;
bool armed = true;
while (true) {
  if (armed) {
    gpio_put(LED_PIN, 1);
    sleep_ms(BLINK_MS);
    gpio_put(LED_PIN, 0);
    sleep_ms(BLINK_MS);
    if (gpio_get(BUTTON_PIN)) {
      sleep_ms(DEBOUNCE_MS);
      if (gpio_get(BUTTON_PIN)) {
        armed = false;
      }
    }
  }
}`;
const CHECKING = `const uint32_t BLINK_MS = 1000;
const uint32_t DEBOUNCE_MS = 50;
bool armed = true;
absolute_time_t next_toggle_time;
absolute_time_t debounce_time;
while (true) {
  if (armed) {
    if (time_reached(next_toggle_time)) {
      next_toggle_time = make_timeout_time_ms(BLINK_MS);
      gpio_put(LED_PIN, !gpio_get(LED_PIN));
    }
    if (!gpio_get(BUTTON_PIN)) {
      debounce_time = make_timeout_time_ms(DEBOUNCE_MS);
    }
    else if (time_reached(debounce_time)) {
      armed = false;
    }
  }
}`;
const DEBOUNCE = `const uint32_t DEBOUNCE_MS = 50;
bool armed = true;
absolute_time_t debounce_time;
while (true) {
  if (armed) {
    if (!gpio_get(BUTTON_PIN)) {
      debounce_time = make_timeout_time_ms(DEBOUNCE_MS);
    }
    else if (time_reached(debounce_time)) {
      armed = false;
    }
  }
  gpio_put(LED_PIN, armed);
}`;
const alarm = extra => readConfig(Object.assign({variants: {sleeping: SLEEPING, checking: CHECKING}, inputs: {BUTTON_PIN: 'hold button'},
  outputs: {LED_PIN: 'red led'}, watch: ['armed'], timeline: ['cpu', 'BUTTON_PIN', 'LED_PIN']}, extra));
// the moment the LED last changed to `level`
const ledAt = (m, level) => { const x = m.outputs.LED_PIN.track.ch.filter(e => !e.band && e.v === level && e.t > 0).pop(); return x && x.t; };
{
  const c = alarm({goal: {variant: 'checking', vars: {armed: false}}});
  const r = I.runScript(c, [{name: 'BUTTON_PIN', kind: 'hold button', down: true, at: 300 * MS, len: 400 * MS}], 3 * SEC);
  const [sleeping, checking] = r.machines;
  ok(val(sleeping, 'armed') === 1, 'sleeping alarm: a press from 0.3 s to 0.7 s is missed');
  ok(!sleeping.inputs.BUTTON_PIN.reads.list.some(x => x.t1 >= 300 * MS && x.t0 <= 700 * MS), 'sleeping alarm: the press was never read');
  ok(Math.abs(checking.goal.met - 350 * MS) < 0.05 * MS, 'checking alarm: armed is false 50 ms after the press', checking.goal.met);
  ok(I.caption(sleeping, c, c.script, 3 * SEC).includes('Without presses') && /never read/.test(I.caption(sleeping, c, [{name: 'BUTTON_PIN', kind: 'hold button', down: true, at: 300 * MS, len: 400 * MS}], 3 * SEC)), 'caption: the missed press');
  const r2 = I.runScript(c, [{name: 'BUTTON_PIN', kind: 'hold button', down: true, at: 0, len: 2100 * MS}], 3 * SEC);
  const t = r2.machines[0].inputs.BUTTON_PIN.reads.list;
  ok(val(r2.machines[0], 'armed') === 0 && t.length === 2 && Math.abs(t[1].t0 - 2050 * MS) < 0.01 * MS, 'sleeping alarm: a press from 0 to 2.1 s disarms at 2.05 s');
}
{
  const c = readConfig({code: DEBOUNCE, inputs: {BUTTON_PIN: 'bouncy hold button'}, outputs: {LED_PIN: 'red led'}, watch: ['armed', 'debounce_time'],
    timeline: ['BUTTON_PIN', 'debounce_time', 'LED_PIN'], window: '400 ms', script: ['BUTTON_PIN press at 100 ms'], run: '400 ms'});
  const r = I.runScript(c, c.script, 400 * MS), m = r.machines[0];
  const flips = m.events.filter(e => e.name === 'BUTTON_PIN');
  const last = Math.max(...flips.map(e => e.t));
  ok(flips.length >= 5 && flips.length <= 9, 'debounce: the press bounces 2 to 4 times (seeded)', flips.length);
  ok(ledAt(m, 0) - last >= 50 * MS && ledAt(m, 0) - last <= 50 * MS + 20 * US, 'debounce: armed is false 50 ms after the last bounce', (ledAt(m, 0) - last) / MS);
  ok(m.deadlines.debounce_time.rec.cur <= m.time, 'debounce: the deadline was reached');
}
{
  const c = readConfig({code: `#include "pico/stdlib.h"
const uint LED_PIN = 15;
const uint BUTTON_PIN = 16;
int main() {
  gpio_init(LED_PIN);
  gpio_set_dir(LED_PIN, GPIO_OUT);
  gpio_init(BUTTON_PIN);
  gpio_set_dir(BUTTON_PIN, GPIO_IN);
  gpio_pull_down(BUTTON_PIN);
  while (true) {
    bool pressed = gpio_get(BUTTON_PIN);
    gpio_put(LED_PIN, pressed);
  }
}`, io_setup: 'code', inputs: {BUTTON_PIN: 'hold button'}, outputs: {LED_PIN: 'red led'}, show: ['iterations'], script: ['BUTTON_PIN press at 50 ms'], run: '51 ms'});
  const m = I.runScript(c, c.script, 51 * MS).machines[0];
  ok(ledAt(m, 1) - 50 * MS >= 0 && ledAt(m, 1) - 50 * MS <= 3 * US, 'the LED follows the button within one round (3 us)', ledAt(m, 1));
  ok(m.iterations > 16000 && m.iterations < 17500, 'the superloop runs every 3 us', m.iterations);
  ok(c.devices.every(d => d.fromCode && !d.byWidget), 'pins from the code are not declared by the widget');
}
{
  const m = new Machine(compile('int main() { gpio_init(15); while (true) { gpio_put(15, 1); sleep_ms(10); } }'), {ub: 'stop', ioSetup: 'code', outputs: [{name: 'LED_PIN', gpio: 15}], inputs: []});
  m.run(100 * MS, 1e6);
  ok(m.outputs.LED_PIN.level === 0 && m.notes.some(n => /gpio_set_dir\(15, GPIO_OUT\) is missing/.test(n.text)), 'io_setup: code without gpio_set_dir: the LED stays off, with a note');
  const w = print({code: 'const uint LED_PIN = 15; int main() { while (true) { gpio_put(LED_PIN, 1); } }', io_setup: 'code', outputs: {LED_PIN: 'red led'}});
  ok(w.warnings.some(x => /never sets up LED_PIN \(GP15\): gpio_init\(LED_PIN\) is missing/.test(x)), 'io_setup: code: a pin never set up is a warning', w.warnings.join(' | '));
  const f = new Machine(compile('int r; int main() { gpio_disable_pulls(17); r = gpio_get(17); }'), {ub: 'stop', ioSetup: 'code', inputs: [{name: 'S', gpio: 17}], outputs: []});
  f.run(SEC, 1e6);
  ok(f.notes.some(n => /floats/.test(n.text)), 'a floating input: a note');
  const low = new Machine(compile('int r1; int r2; int main() { r1 = gpio_get(16); sleep_ms(10); r2 = gpio_get(16); }'), {ub: 'stop', active: 'low', inputs: [{name: 'B', gpio: 16}], outputs: []});
  low.queue('B', [{t: 5 * MS, pressed: true}]);
  low.run(SEC, 1e6);
  ok(val(low, 'r1') === 1 && val(low, 'r2') === 0, 'active: low: released reads 1 (pull-up), pressed reads 0');
}
{
  // brightness as the eye sees it: DELAY_MS = 5 is on half the time, steady
  const prog = compile(`const uint32_t DELAY_MS = 5;
while (true) { gpio_put(LED_PIN, 1); sleep_ms(DELAY_MS); gpio_put(LED_PIN, 0); sleep_ms(DELAY_MS); }`, {devices: [{name: 'LED_PIN', gpio: 15}]});
  const m = new Machine(prog, {ub: 'stop', outputs: [{name: 'LED_PIN', gpio: 15}], inputs: [], tau: 20 * MS});
  let lo = 1, hi = 0;
  for (let t = 200; t < 400; t++) { m.run(t * MS, 1e6); const b = m.brightness('LED_PIN'); lo = Math.min(lo, b); hi = Math.max(hi, b); }
  ok(Math.abs((lo + hi) / 2 - 0.5) < 0.05 && hi - lo < 0.15, 'DELAY_MS = 5: on half the time, steady', `${lo.toFixed(3)} … ${hi.toFixed(3)}`);
  ok(Math.abs(I.lightness(0.5) - 0.7606) < 0.001 && I.lightness(0) === 0 && Math.abs(I.lightness(1) - 1) < 1e-9, 'half the time on looks 76 % bright (CIE L*)');
}
{
  const m = run(`absolute_time_t t0; absolute_time_t t1; int64_t d; bool r1; bool r2; absolute_time_t e;
    t0 = get_absolute_time(); t1 = make_timeout_time_ms(10); r1 = time_reached(t1); sleep_ms(10); r2 = time_reached(t1);
    d = absolute_time_diff_us(t1, t0); e = delayed_by_us(at_the_end_of_time, 5);`);
  ok(val(m, 't1') - val(m, 't0') >= 9999n && val(m, 't1') - val(m, 't0') <= 10001n, 'make_timeout_time_ms(10) is 10 000 us from now');
  ok(val(m, 'r1') === 0 && val(m, 'r2') === 1 && val(m, 'd') < 0n, 'time_reached, absolute_time_diff_us');
  ok(val(m, 'e') === (1n << 63n) - 1n, 'delayed_by_us stops at the end of time (INT64_MAX), as the SDK');
}

// --- goals, scripts and the PDF form ---------------------------------------------------------
{
  const goal = {variant: 'checking', vars: {armed: false}, max_presses: 1};
  const w = print({variants: {sleeping: SLEEPING, checking: CHECKING}, inputs: {BUTTON_PIN: 'hold button'}, outputs: {LED_PIN: 'red led'},
    goal, answer_script: ['BUTTON_PIN press at 100 ms for 150 ms'], answer: 'Press once.'});
  ok(!w.error && w.exercise && w.variants.length === 1 && w.variants[0].name === 'checking' && !w.variants[0].svg,
    'a goal: an exercise with the code of its variant, no timeline in the question', JSON.stringify(w).slice(0, 200));
  ok(w.exercise && w.exercise.answer[1].text === '(BUTTON_PIN pressed at 0.1 s for 0.15 s: armed is false at 0.15 s.)', 'the answer: the script in words and when the goal was met', w.exercise && w.exercise.answer[1].text);
  ok(w.exercise && w.exercise.picture.svg.startsWith('<svg') && w.exercise.picture.svg.includes('<style>'), 'the answer has the timeline of its run, with its styles');
  const both = print({code: DEBOUNCE, inputs: {BUTTON_PIN: 'hold button'}, outputs: {LED_PIN: 'red led'}, goal: {vars: {armed: false}, outputs: {LED_PIN: 'off'}},
    answer_script: ['BUTTON_PIN press at 100 ms for 150 ms'], answer: 'x'});
  ok(both.exercise && both.exercise.answer[1].text === '(BUTTON_PIN pressed at 0.1 s for 0.15 s: armed is false and LED_PIN is off at 0.15 s.)', 'a goal with a variable and an output', both.exercise && both.exercise.answer[1].text);
  const no = print({variants: {sleeping: SLEEPING, checking: CHECKING}, inputs: {BUTTON_PIN: 'hold button'}, outputs: {LED_PIN: 'red led'},
    goal: {variant: 'sleeping', vars: {armed: false}}, answer_script: ['BUTTON_PIN press at 100 ms for 150 ms'], answer: 'x'});
  ok(!no.exercise && no.warnings.some(x => x === 'goal: the answer_script does not reach the goal (armed is still true after 10 s)') && no.variants.length === 2,
    'an answer_script that does not reach the goal: a warning, and the block is printed as pictures', no.warnings.join(' | '));
  const more = readConfig({code: DEBOUNCE, inputs: {BUTTON_PIN: 'hold button'}, outputs: {LED_PIN: 'red led'}, goal: {vars: {armed: false}, max_presses: 1},
    answer_script: ['BUTTON_PIN press at 10 ms for 5 ms', 'BUTTON_PIN press at 100 ms for 100 ms'], answer: 'x'});
  ok(more.warnings.some(x => /has 2 presses, but max_presses is 1/.test(x)), 'max_presses: an answer_script with more presses is a warning');
  const r = I.runScript(more, more.answerScript, SEC);
  ok(r.machines[0].goal.met !== null && r.machines[0].goal.presses === 2, 'max_presses: the presses that led to the goal are counted');
  const p = print({variants: {sleeping: SLEEPING, checking: CHECKING}, inputs: {BUTTON_PIN: 'hold button'}, outputs: {LED_PIN: 'red led'}, watch: ['armed'],
    script: ['BUTTON_PIN press at 300 ms for 400 ms'], print: 'one', variant: 'checking'});
  ok(p.variants.length === 1 && p.variants[0].name === 'checking' && p.variants[0].caption === 'With the script: BUTTON_PIN pressed at 0.3 s for 0.4 s. The press was read. At the end: armed = false.',
    'print: one, and the caption', JSON.stringify(p.variants.map(v => [v.name, v.caption])));
  const long = print({code: SLEEPING, inputs: {BUTTON_PIN: 'hold button'}, outputs: {LED_PIN: 'red led'}, window: '1 s', run: '3500 ms'});
  ok((long.variants[0].svg.match(/<svg/g) || []).length === 5, 'a run longer than the window: rows of the window (4 rows here)', (long.variants[0].svg.match(/<svg/g) || []).length - 1);
  const bad = print({code: 'while (true) { x = 1; }'});
  ok(bad.error && /x is not declared/.test(bad.error), 'print: a block with a mistake gives its error');
  const words = I.runScript; // (used above)
  ok(err(() => readConfig(cfg({script: ['BUTTON_PIN press at 1 s', 'BUTTON_PIN release at 2 s']}))) === 'no error', 'a script: press and release');
  const crash = print({code: 'int z = 0; int r; while (true) { r = 1 / z; }'});
  ok(crash.warnings.some(x => /the program stops in the scripted run: Line 1: division by zero/.test(x)), 'a run that stops at build time: a warning', crash.warnings.join(' | '));
  const many = print({code: 'while (true) { }', run: '60 s', line_time: '10 ns'});
  ok(many.warnings.some(x => /ran 50.000.000 statements; the build stops it there/.test(x)), 'at most 50 million statements per run at build time', many.warnings.join(' | '));
}

// --- the terminal: text, printf and USB stdio ----------------------------------------------
{
  const text = m => m.screen.text();
  const bytes = s => [...s].map(c => c.charCodeAt(0));
  // text: string literals, escapes, UTF-8, "%" PRIu64
  const t = run('const char *A = "a\\tb\\x41\\101\\0z"; const char *B = "µs"; const char *C = "%" PRIu64 "|" PRId32; char *D = "plain";');
  ok(JSON.stringify(bytes(val(t, 'A'))) === JSON.stringify([97, 9, 98, 65, 65, 0, 122]), 'a string literal: its bytes, with escapes', JSON.stringify(bytes(val(t, 'A'))));
  ok(JSON.stringify(bytes(val(t, 'B'))) === JSON.stringify([0xc2, 0xb5, 0x73]), 'a string literal: UTF-8 for letters beyond ASCII');
  ok(val(t, 'C') === '%llu|ld' && val(t, 'D') === 'plain', '<inttypes.h>: "%" PRIu64 is "%llu" (newlib), literals side by side are one', val(t, 'C'));
  ok(I.PRI.PRIu8 === 'hhu' && I.PRI.PRIx16 === 'hx' && I.PRI.PRIu32 === 'lu' && I.PRI.PRIdMAX === 'lld' && I.PRI.PRIuPTR === 'u', 'the PRI macros of arm-none-eabi-gcc');
  const TERR = [
    ['const char *s;', /s is text \(const char \*\), so it needs its text/],
    ['const char *s = "a"; s = "b";', /s is text \(const char \*\): in this widget, it keeps the text it starts with/],
    ['int x = "a";', /x is a number \(int\), but its value is text/],
    ['const char *s = 5;', /s is text \(const char \*\), so its value must be text/],
    ['int x = "a" + 1;', /text \(a string\) can only be printed in this widget/],
    ['if ("a") { }', /text \(a string\) can only be printed/],
    ['const char *s = "a"; int b = s == s;', /text \(a string\) can only be printed/],
    ['unsigned char *p = "x";', /pointers are not supported in this widget \(only const char \* for text\)/],
    ['const char **p;', /pointers are not supported/],
    ['const char *s = "abc', /this text has no closing " on its line/],
    ['const char *s = "\\q";', /"\\q" is not an escape sequence of C/],
    ['puts(5);', /puts\(\) sends text, e.g. puts\("Hello"\)/],
    ['putchar("a");', /putchar\(\) sends one character/],
    ['fflush(stdin);', /fflush\(\) works on stdout only/],
    // printf: the format and its values
    ['printf("%d\\n", time_us_64());', /^Line 1, column 16: %d expects an int, but time_us_64\(\) is a uint64_t: use %llu \(or "%" PRIu64\)$/],
    ['uint32_t x = 5; printf("%llu", x);', /%llu expects an unsigned long long, but x is a uint32_t: use %lu \(or "%" PRIu32\)/],
    ['int32_t n = -1; printf("%lld", n);', /%lld expects a long long, but n is an int32_t: use %ld \(or "%" PRId32\)/],
    ['printf("%x", get_absolute_time());', /%x expects an unsigned int, but get_absolute_time\(\) is an absolute_time_t: use %llx \(or "%" PRIx64\)/],
    ['uint8_t b = 1; printf("%llu", b);', /%llu expects an unsigned long long, but b is a uint8_t: use %u/],
    ['printf("%s", 5);', /%s expects text \(a string\), but 5 is an int: use %d/],
    ['printf("%d", "a");', /%d expects an int, but "a" is text \(a string\): use %s/],
    ['printf("%*d", 5ull, 3);', /the \* in %\*d \(the width\) expects an int, but 5ull is an unsigned long long$/],
    ['printf("%d %s\\n", 1);', /^Line 1, column 1: the format needs 2 values after it, but printf\(\) gets 1: the value for %s is missing. That is undefined behaviour in C/],
    ['printf("%f", 1);', /"%f" prints a float or double, which this widget does not support yet/],
    ['printf("%p", 1);', /"%p" prints a pointer/],
    ['printf("%q");', /"%q" is not a conversion of printf/],
    ['printf("50%");', /the format ends with a single %: write %% to print a percent sign/],
    ['printf("%5.");', /"%5\." at the end of the format is not finished/],
    ['printf("%ls", "a");', /%l is for wide characters|l does not go with %s/],
    ['printf("%llc", 65);', /"%llc": ll does not go with %c/],
    ['void f(const char *fmt) { printf(fmt); } f("x");', /the format of printf\(\) must be text in double quotes/],
    ['printf(5);', /the first value of printf\(\) is the format/],
    ['printf();', /printf\(\) needs a format/],
  ];
  for (const [src, pat] of TERR) { const e = err(() => compile(src)); ok(pat.test(e), `build error: ${src}`, e); }
  ok(compile('printf("%d\\n", 1, 2);').warnings.some(w => w === 'Line 1: printf() gets 2 values after the format, but the format uses 1; the rest is not printed'), 'printf: extra values are a warning');
  ok(compile('const char *F = "%d|"; printf(F, 3);').warnings.length === 0, 'printf: a const char * constant as the format');
  // the output: same-size mixes as the Pico prints them, pico_printf's quirks, return values
  const P = (fmt, ...vals) => I.formatPrintf(I.readFormat(fmt).items, vals, 0);
  const SAME = [
    [['%u|%d|%x|%lld|%lu', -1, 4294967295, -1, 18446744073709551615n, -1], '4294967295|-1|ffffffff|-1|4294967295'],
    [['%hhd|%hhu|%hd|%hu', -1, 257, 65535, -1], '255|1|-1|65535'],   // plain char is unsigned on the RP2040
    [['%#4x|%#x|%#o|%#X', 0x1234, 0, 8, 255], '0x34|0|010|0XFF'],
    [['%050d', 1], `${'0'.repeat(31)}1`],
    [['%.40d', 7], `${'0'.repeat(31)}7`],
    [['%+.0d|%.0d|%5.0d|% d|%+d', 0, 0, 0, 5, 5], '+||     | 5|+5'],
    [['%-05d|%08.3d|%5%|%c%c', 3, 7, 65, 66], '3    |     007|%|AB'],
    [['%*d|%-*d|%.*d', 4, 1, -4, 2, -3, 9], '   1|2   |9'],
    [['%.3s|%5s|%-5s|%.0s', 'abcdef', 'ab', 'ab', 'xyz'], 'abc|   ab|ab   |'],
    [['%b|%#b|%llx', 5, 5, 0xfedcba9876543210n], '101|0b101|fedcba9876543210'],
    [['%lld|%llu', -9223372036854775808n, 18446744073709551615n], '-9223372036854775808|18446744073709551615'],
    [['%zu|%jd|%td', 7, -1n, -2], '7|-1|-2'],
  ];
  for (const [[fmt, ...vals], want] of SAME) { const r = P(fmt, ...vals); ok(r.text === want, `printf("${fmt}") as pico_printf prints it`, JSON.stringify(r.text)); }
  const nul = P('a%cb', 0);
  ok(nul.text === 'ab' && nul.count === 3, 'printf: a 0 character is counted, not sent (pico_printf)', JSON.stringify(nul));
  ok(P('%llu', 12345678n).digits64 === 8 && P('%lu', 5).digits64 === 0, 'printf: the digits of 64-bit numbers (they take time)');
  ok(/more than the widget prints/.test(P('%*d', 2000000000, 1).error || ''), 'printf: a huge width from * stops the program');

  // USB stdio: dropped before stdio_init_all(), before the Pico is on USB, without a terminal
  const cfgT = extra => Object.assign({ub: 'stop', lineTime: US, terminal: 'manual', stdioSetup: 'code'}, extra);
  const mt = (src, extra = {}) => new Machine(compile(src, {ub: 'stop'}), cfgT(extra));
  let m = mt('int main() { printf("a\\n"); stdio_init_all(); printf("b\\n"); sleep_ms(300); printf("c\\n"); sleep_ms(500); printf("d\\n"); while (true) { } }');
  m.queueEvent({t: 600 * MS, kind: 'open'});
  m.run(SEC, 1e7);
  ok(text(m) === 'd', 'only text printed while a terminal is open arrives', JSON.stringify(text(m)));
  ok(JSON.stringify(m.term.prints.map(p => p.why)) === JSON.stringify(['the program has not started USB stdio (stdio_init_all())', 'the Pico was not on USB yet', 'no terminal was open', null]),
    'each dropped print says why', JSON.stringify(m.term.prints.map(p => p.why)));
  const conn = m.term.conn.ch.map(c => `${c.v}@${Math.round(c.t / US)}`).join(' ');
  ok(conn === '0@0 1@250004 2@600000', 'the connection (µs): on USB 0.25 s after stdio_init_all() (at 4.04 µs), then open', conn);
  // Open before the Pico is on USB; terminal: open
  m = mt('int main() { while (true) { } }');
  m.queueEvent({t: 100 * MS, kind: 'open'});
  m.run(200 * MS, 1e7);
  ok(m.usb.openError === 'The computer sees no Pico on USB: the program has not called stdio_init_all(), which starts its USB connection.' && !m.usb.open, 'Open without stdio_init_all(): the computer sees no Pico on USB', m.usb.openError);
  m = mt('int main() { stdio_init_all(); while (true) { } }');
  m.queueEvent({t: 100 * MS, kind: 'open'});
  m.run(200 * MS, 1e7);
  ok(m.usb.openError === 'The computer doesn\'t see the Pico on USB yet.', 'Open in the 0.25 s after stdio_init_all(): not on USB yet', m.usb.openError);
  m = mt('bool c1; bool c2; c1 = stdio_usb_connected(); sleep_ms(300); c2 = stdio_usb_connected(); while (true) { }', {terminal: 'auto', stdioSetup: 'auto'});
  m.run(SEC, 1e7);
  ok(val(m, 'c1') === 0 && val(m, 'c2') === 1 && m.usb.open, 'terminal open: auto connects as soon as the Pico is on USB (stdio_setup: auto starts USB stdio)');
  // the SDK's CR/LF rule, also across calls; puts and putchar
  m = mt('printf("A\\nB\\r\\nC\\r"); printf("\\nD\\n"); putchar(\'\\n\'); puts("E"); while (true) { }', {terminal: 'auto', stdioSetup: 'auto'});
  m.queueEvent({t: 0, kind: 'noop'});
  m = mt('sleep_ms(300); printf("A\\nB\\r\\nC\\r"); printf("\\nD\\n"); putchar(\'\\n\'); puts("E"); while (true) { }', {terminal: 'auto', stdioSetup: 'auto'});
  m.run(SEC, 1e7);
  ok(m.usb.raw === 'A\r\nB\r\nC\r\nD\r\n\r\nE\r\n', 'CR/LF as the SDK sends it (measured on a Pico W)', JSON.stringify(m.usb.raw));
  // getchar() waits; stdio_getchar_timeout_us(); keys typed while the program does not read
  m = mt('int a; int b; int c; int d; sleep_ms(300); a = getchar(); b = stdio_getchar_timeout_us(100000); c = stdio_getchar_timeout_us(0); d = stdio_getchar_timeout_us(500000); while (true) { }', {terminal: 'auto', stdioSetup: 'auto'});
  m.queueEvent({t: 2 * SEC, kind: 'type', bytes: '5'});
  m.queueEvent({t: 2500 * MS, kind: 'type', bytes: 'x'});
  m.run(1500 * MS, 1e7);
  ok(m.state === 3 && m.line === 1, 'getchar() waits for a key (the cpu is waiting)', `${m.state} ${m.line}`);
  m.run(5 * SEC, 1e7);
  ok(val(m, 'a') === 53 && val(m, 'b') === -2 && val(m, 'c') === -2 && val(m, 'd') === 120, 'getchar() gets the key; the timeouts return PICO_ERROR_TIMEOUT (-2)', ['a', 'b', 'c', 'd'].map(n => val(m, n)).join(' '));
  const wait = m.cpu.ch.filter(c => c.v === 3).map(c => Math.round(c.t / MS));
  ok(JSON.stringify(wait) === JSON.stringify([300, 2000, 2100]), 'waiting: from the getchar(), and from the timeout of 100 ms', JSON.stringify(wait));
  m = mt('int n = 0; int bad = 0; int c; sleep_ms(3000); while ((c = stdio_getchar_timeout_us(200000)) >= 0) { if (c != 65 + n % 26) bad++; n++; } while (true) { }', {terminal: 'auto', stdioSetup: 'auto'});
  m.queueEvent({t: SEC, kind: 'type', bytes: Array.from({length: 1000}, (_, k) => String.fromCharCode(65 + k % 26)).join('')});
  m.run(5 * SEC, 1e8);
  ok(val(m, 'n') === 1000 && val(m, 'bad') === 0, 'keys typed while the program sleeps are kept, in order (measured: 1000 of 1000)', `${val(m, 'n')} ${val(m, 'bad')}`);
  m = mt('int n = 0; sleep_ms(2000); while (stdio_getchar_timeout_us(100000) >= 0) n++; while (true) { }', {terminal: 'auto', stdioSetup: 'auto'});
  m.queueEvent({t: SEC, kind: 'type', bytes: '0123456789'});
  m.queueEvent({t: 1100 * MS, kind: 'close'});
  m.queueEvent({t: 1500 * MS, kind: 'open'});
  m.run(4 * SEC, 1e7);
  ok(val(m, 'n') === 10, 'keys typed before the terminal closes stay (measured)', val(m, 'n'));
  m = mt('sleep_ms(300); while (true) { }', {terminal: 'auto', stdioSetup: 'auto'});
  m.queueEvent({t: 400 * MS, kind: 'type', bytes: 'x'.repeat(5000)});
  m.run(SEC, 1e7);
  ok(m.usb.rx.length === 4096 && m.notes.some(n => /stopped taking keys/.test(n.text)), 'at most 4 KB of keys wait; then the terminal stops taking them, with a note');
  // the times measured on a Pico W
  const cost = (src, extra) => { const mm = mt(`uint64_t t0; uint64_t t1; sleep_ms(300); t0 = time_us_64(); ${src}; t1 = time_us_64(); while (true) { }`, Object.assign({terminal: 'auto', stdioSetup: 'auto'}, extra)); mm.run(SEC, 1e8); return Number(val(mm, 't1') - val(mm, 't0')) - 2; };   // (- 2: the statements with t0 and t1)
  ok(cost('printf("abcdefghi\\n")') === 41, 'printf of 10 characters with a terminal open: 40 µs + 0.15 µs a character', cost('printf("abcdefghi\\n")'));
  ok(cost('putchar(\'x\')') === 13, 'putchar with a terminal open: 13 µs');
  ok(cost('printf("abcdefghi\\n")', {terminal: 'manual'}) === 11, 'printf without a terminal (dropped): 10 µs + 0.15 µs a character', cost('printf("abcdefghi\\n")', {terminal: 'manual'}));
  ok(cost('printf("%llu\\n", 12345678ull)', {terminal: 'manual'}) === 20, 'a 64-bit number: 1.1 µs a digit', cost('printf("%llu\\n", 12345678ull)', {terminal: 'manual'}));
  const L64 = '"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-\\n"';
  const flood = mt(`int n = 0; uint64_t t0; uint64_t t1; sleep_ms(300); t0 = time_us_64(); while (n < 1000) { printf(${L64}); n++; } t1 = time_us_64(); while (true) { }`, {terminal: 'auto', stdioSetup: 'auto'});
  flood.run(2 * SEC, 1e8);
  const per = Number(val(flood, 't1') - val(flood, 't0')) / 1000;
  ok(per > 88 && per < 100, 'a flood of 64-character lines: about 0.1 ms a line (measured 98.7 µs; the USB packets set the pace)', per);
  ok(flood.cpu.ch.some(c => c.v === 2), 'a flood waits for room in the USB buffer: busy on the cpu lane');
  // the screen: \r, \b, \t, UTF-8, the last 1000 lines
  const sc = new I.Screen();
  sc.write('abc\rX\r\n\tY\bZ\r\n\xc2\xb5s \xff!\nnext');
  ok(sc.text() === 'Xbc\n        Z\nµs �!\n     next', 'the screen: \\r, \\b, \\t, UTF-8, and a \\n alone keeps the column, as a terminal shows them', JSON.stringify(sc.text()));
  const many = new I.Screen();
  many.write(Array.from({length: 1500}, (_, k) => `${k}\r\n`).join(''));
  ok(many.lines.length === 1000 && many.text().startsWith('501\n'), 'the screen keeps the last 1000 lines');
  // the lesson's beeps, in a script, both variants on the same typing
  const BEEPS = 'int main() {\n  stdio_init_all();\n  while (true) {\n    printf("Enter a number (1-9): ");\n    int n = getchar();\n    if (n < \'1\' || n > \'9\') {\n      printf("\\nInvalid input.\\n");\n      continue;\n    }\n    printf("\\nPlaying %d beeps.\\n", n - \'0\');\n  }\n}\n';
  const WAITING = BEEPS.replace('stdio_init_all();', 'stdio_init_all();\n  while (!stdio_usb_connected()) sleep_ms(10);');
  const beeps = {terminal: {}, stdio_setup: 'manual', variants: {'as is': BEEPS, 'waiting for the terminal': WAITING}, timeline: ['cpu', 'terminal'],
    script: ['terminal open at 1.5 s', 'type "5" at 2 s', 'type "x" at 2.5 s'], run: '3 s'};
  const pb = print(beeps);
  ok(!pb.error && pb.variants[0].terminal === '\nPlaying 5 beeps.\nEnter a number (1-9):\nInvalid input.\nEnter a number (1-9):', 'the beeps, as is: the first prompt is lost', JSON.stringify(pb.variants[0] && pb.variants[0].terminal));
  ok(!pb.error && pb.variants[1].terminal === 'Enter a number (1-9):\nPlaying 5 beeps.\nEnter a number (1-9):\nInvalid input.\nEnter a number (1-9):', 'the beeps, waiting for the terminal: every prompt arrives', JSON.stringify(pb.variants[1] && pb.variants[1].terminal));
  ok(!pb.error && pb.variants[0].caption === 'With the script: the terminal opened at 1.5 s, typed "5" at 2 s, typed "x" at 2.5 s. One print was dropped (the Pico was not on USB yet).',
    'the caption: the terminal steps and the dropped print', pb.variants[0] && pb.variants[0].caption);
  ok(!pb.error && pb.variants[0].svg.includes('sl-tl-dropx') && pb.variants[0].svg.includes('sl-tl-key') && pb.variants[0].svg.includes('terminal open'), 'the PDF timeline has the terminal lane');
  const echo = print(Object.assign({}, beeps, {terminal: {echo: true}, print: 'one', variant: 'waiting for the terminal'}));
  ok(echo.variants[0].terminal === 'Enter a number (1-9): 5\nPlaying 5 beeps.\nEnter a number (1-9): x\nInvalid input.\nEnter a number (1-9):', 'echo: true shows the keys typed', JSON.stringify(echo.variants[0].terminal));
  // settings and scripts
  const tcfg = extra => Object.assign({code: 'while (true) { printf("x"); sleep_ms(100); }', terminal: {}}, extra);
  const TCERR = [
    [{terminal: true}, /terminal: write its settings under it, e.g. terminal: \{open: manual\}/],
    [{terminal: 'auto'}, /terminal: write its settings under it/],
    [{terminal: {open: 'maybe'}}, /terminal, open: "maybe" is not allowed. Write auto, manual or button/],
    [{terminal: {enter: 'tab'}}, /terminal, enter: "tab" is not allowed/],
    [{terminal: {echo: 'yes'}}, /terminal, echo: write true or false/],
    [{terminal: {setup: 'auto'}}, /USB stdio is set up with stdio_setup, at the top level/],
    [{terminal: {flavour: 1}}, /terminal: "flavour" is not a setting of the terminal \(open, enter, echo\)/],
    [{enter: 'cr'}, /"enter" is not a setting of a superloop block: enter belongs in the terminal block/],
    [{echo: true}, /"echo" is not a setting of a superloop block: echo belongs in the terminal block/],
    [{setup: 'code'}, /"setup" is not a setting of a superloop block: setup is called io_setup \(the pins\); USB stdio has stdio_setup/],
    [{stdio_setup: 'maybe'}, /stdio_setup: "maybe" is not allowed. Write auto, code or manual/],
    [{io_setup: 'yes'}, /io_setup: "yes" is not allowed/],
    [{terminal: undefined, timeline: ['cpu', 'terminal']}, /timeline: terminal needs a terminal/],
    [{terminal: undefined, script: ['terminal open at 1 s']}, /the block has no terminal/],
    [{script: ['type "5" at 1 s']}, /the terminal is closed at 1 s: open it first/],
    [{script: ['terminal open at 2 s', 'terminal close at 1 s']}, /the steps of the terminal must be in time order/],
    [{script: ['terminal open at 1 s', 'type 5 at 2 s']}, /is not a step. Write e.g. terminal open at 1.5 s/],
    [{script: ['terminal open at 1 s', 'type "" at 2 s']}, /types nothing/],
    [{goal: {shows: 'x'}, terminal: undefined}, /goal, shows: the block has no terminal/],
    [{goal: {terminal: 'x'}}, /goal: "terminal" is not part of a goal \(variant, vars, outputs, shows, max_presses\)/],
  ];
  for (const [extra, pat] of TCERR) { const e = err(() => readConfig(tcfg(extra))); ok(pat.test(e), `settings: ${JSON.stringify(extra).slice(0, 70)}`, e); }
  const sc2 = readConfig(tcfg({script: ['terminal open at 1 s', 'type "12\\r" at 2 s', 'terminal close at 2.5 s'], terminal: {enter: 'crlf'}}));
  ok(JSON.stringify(sc2.script.map(st => st.bytes || st.action)) === JSON.stringify(['open', '12\r', 'close']) && sc2.enter === '\r\n', 'script: terminal open, type "12\\r" (C escapes), terminal close; enter: crlf');
  ok(readConfig(tcfg({terminal: {open: 'auto'}, script: ['type "5" at 1 s']})).script.length === 1, 'terminal open: auto: a script may type without opening');
  // the defaults: io_setup auto, stdio_setup manual (the program calls stdio_init_all()), terminal open manual; the synonyms
  const dflt = readConfig(tcfg({}));
  ok(dflt.ioSetup === 'auto' && dflt.stdioSetup === 'code' && dflt.terminal === 'manual' && dflt.enter === '\r' && dflt.echo === false,
    'defaults: io_setup auto, stdio_setup manual, terminal: open manual, enter cr, echo false', JSON.stringify([dflt.ioSetup, dflt.stdioSetup, dflt.terminal]));
  const syn = readConfig(tcfg({io_setup: 'manual', stdio_setup: 'manual', terminal: {open: 'button'}}));
  ok(syn.ioSetup === 'code' && syn.stdioSetup === 'code' && syn.terminal === 'manual', 'synonyms: manual = code, button = manual');
  ok(readConfig(tcfg({terminal: null})).terminal === 'manual', 'terminal: with nothing under it: a terminal with the defaults');
  const forgot = I.runScript(readConfig(tcfg({script: ['terminal open at 1 s']})), readConfig(tcfg({script: ['terminal open at 1 s']})).script, 2 * SEC).machines[0];
  ok(forgot.usb.openError === 'The computer sees no Pico on USB: the program has not called stdio_init_all(), which starts its USB connection.',
    'stdio_setup left out (manual): Open says that stdio_init_all() is missing', forgot.usb.openError);
  ok(readConfig({code: 'while (true) { printf("x"); }'}).warnings.some(w => /talks to a terminal \(printf, getchar, …\), but the block has none/.test(w)), 'printf without a terminal: a warning');
  ok(readConfig(tcfg({})).lanes.map(l => l.kind).join() === 'cpu,terminal', 'the default timeline has the terminal after the cpu');
  // a goal on the terminal's text
  const gw = print({code: 'const uint32_t PERIOD_MS = 250;\nwhile (true) { uint64_t ms = time_us_64() / 1000; printf("\\rt = %" PRIu64 ".%03" PRIu64 " s", ms / 1000, ms % 1000); sleep_ms(PERIOD_MS); }',
    terminal: {open: 'auto'}, stdio_setup: 'auto', goal: {shows: 't = 1.0'}, answer_script: [], answer: 'Wait.'});
  ok(gw.exercise && gw.exercise.answer[1].text === '(No presses: the terminal shows "t = 1.0" at 1 s.)' && gw.exercise.terminal === 't = 1.250 s', 'a goal on the terminal: met when the text arrives; the answer\'s terminal ends with its picture', gw.exercise && JSON.stringify([gw.exercise.answer[1].text, gw.exercise.terminal]));
  const gn = print({code: 'while (true) { printf("no"); sleep_ms(100); }', terminal: {}, stdio_setup: 'auto', goal: {shows: 'yes'}, answer_script: ['terminal open at 1 s'], answer: 'x'});
  ok(gn.warnings.some(w => w === 'goal: the answer_script does not reach the goal (the terminal has not shown "yes" after 10 s)'), 'a goal on the terminal that the answer does not reach', gn.warnings.join(' | '));
}

// --- performance (a number, not a check) -------------------------------------------------------
{
  const prog = compile(DEBOUNCE, {devices: [{name: 'LED_PIN', gpio: 15}, {name: 'BUTTON_PIN', gpio: 16}]});
  const m = new Machine(prog, {ub: 'stop', outputs: [{name: 'LED_PIN', gpio: 15}], inputs: [{name: 'BUTTON_PIN', gpio: 16}], tracked: ['debounce_time']});
  const t0 = performance.now();
  m.run(3 * SEC, 1e8);
  const dt = (performance.now() - t0) / 1000;
  console.log(`performance: ${(m.time / US / dt / 1e6).toFixed(1)} million statements per second (the debounce program)`);
}

for (const f of failed) console.log(`FAIL ${f}`);
console.log(`${passed} ok, ${failed.length} failed`);
if (failed.length) Deno.exit(1);
