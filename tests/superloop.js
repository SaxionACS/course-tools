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
  ['printf("hi");', /strings\) is not supported/],
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
}`, setup: 'code', inputs: {BUTTON_PIN: 'hold button'}, outputs: {LED_PIN: 'red led'}, show: ['iterations'], script: ['BUTTON_PIN press at 50 ms'], run: '51 ms'});
  const m = I.runScript(c, c.script, 51 * MS).machines[0];
  ok(ledAt(m, 1) - 50 * MS >= 0 && ledAt(m, 1) - 50 * MS <= 3 * US, 'the LED follows the button within one round (3 us)', ledAt(m, 1));
  ok(m.iterations > 16000 && m.iterations < 17500, 'the superloop runs every 3 us', m.iterations);
  ok(c.devices.every(d => d.fromCode && !d.byWidget), 'pins from the code are not declared by the widget');
}
{
  const m = new Machine(compile('int main() { gpio_init(15); while (true) { gpio_put(15, 1); sleep_ms(10); } }'), {ub: 'stop', setup: 'code', outputs: [{name: 'LED_PIN', gpio: 15}], inputs: []});
  m.run(100 * MS, 1e6);
  ok(m.outputs.LED_PIN.level === 0 && m.notes.some(n => /gpio_set_dir\(15, GPIO_OUT\) is missing/.test(n.text)), 'setup: code without gpio_set_dir: the LED stays off, with a note');
  const w = print({code: 'const uint LED_PIN = 15; int main() { while (true) { gpio_put(LED_PIN, 1); } }', setup: 'code', outputs: {LED_PIN: 'red led'}});
  ok(w.warnings.some(x => /never sets up LED_PIN \(GP15\): gpio_init\(LED_PIN\) is missing/.test(x)), 'setup: code: a pin never set up is a warning', w.warnings.join(' | '));
  const f = new Machine(compile('int r; int main() { gpio_disable_pulls(17); r = gpio_get(17); }'), {ub: 'stop', setup: 'code', inputs: [{name: 'S', gpio: 17}], outputs: []});
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
