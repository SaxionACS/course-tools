// Tests of the widgets' logic (assets/widgets/widgets.js), run by scripts/check.py:
//
//     quarto run tests/widgets.js
//
// The answers printed in PDFs are read back from their text and checked with
// the code that checks a student's answer in the browser, for many goals of
// every kind: number patterns, arithmetic flags, register maps, register code
// and frames to decode. Goals that cannot be reached must be reported instead.
// Encoders and shifts are compared with independent calculations.
const here = new URL('.', import.meta.url);
(0, eval)(await Deno.readTextFile(new URL('../src/course_tools/assets/widgets/widgets.js', here)));
const {Widget, Bits, Protocols, internals: I} = globalThis.CourseWidgets;

let passed = 0;
const failed = [];
function ok(condition, what, detail = '') {
  if (condition) passed++;
  else failed.push(`${what}${detail ? `: ${detail}` : ''}`);
}
// A small deterministic random generator, so that a failure can be repeated.
let seed = 12345;
const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const rndBig = w => { let x = 0n; for (let k = 0; k < w; k += 16) x = (x << 16n) | BigInt(rnd(65536)); return x & Bits.mask(w); };
const print = c => Widget.print(c);
const answerText = r => (r.exercise ? r.exercise.answer.map(p => p.text ?? p.code).join('\n') : '');

// ---- number: the printed bit pattern meets the goal ----------------------
for (const w of [1, 2, 4, 7, 8, 12, 16, 31, 32, 48, 64]) {
  for (let k = 0; k < 12; k++) {
    const kind = ['signed', 'unsigned', 'value'][k % 3];
    const half = 1n << BigInt(w - 1);
    const x = kind === 'signed' ? rndBig(w) - half : kind === 'unsigned' ? rndBig(w) : (k % 2 ? rndBig(w) : rndBig(w) - half);
    const c = {type: 'number', width: w, goal: {[kind]: x.toString()}};
    const r = print(c);
    const m = answerText(r).match(/^([01 ]+) \(0x/);
    const v = m ? BigInt('0b' + m[1].replace(/ /g, '')) : null;
    ok(!r.error && v !== null && I.numberGoalMet(c, v, w), `number ${w} bits, goal ${kind} ${x}`, answerText(r) || r.error || r.warnings.join('; '));
  }
  const tooBig = print({type: 'number', width: w, goal: {unsigned: (Bits.mask(w) + 1n).toString()}});
  ok(!tooBig.exercise && tooBig.warnings.some(m => m.includes('does not fit')), `number ${w} bits: a goal that does not fit is reported`);
}
ok(print({type: 'number', goal: {signed: -1, unsigned: 254}}).warnings.some(m => m.includes('different bit patterns')),
  'number: goals that contradict each other are reported');

// ---- arithmetic: all flag goals, compared with every pair of operands -----
const FLAGS = ['C', 'V', 'N', 'Z'];
for (const w of [4, 8]) {
  for (const op of ['add', 'sub']) {
    for (const convention of ['arm', 'intel']) {
      const cv = I.conventionOf({convention});
      const reachable = new Set();
      for (let a = 0n; a <= Bits.mask(w); a++) {
        for (let b = 0n; b <= Bits.mask(w); b++) {
          const f = I.addSub(a, b, w, op === 'sub', cv).flags;
          reachable.add(FLAGS.map(k => f[k]).join(''));
        }
      }
      // every goal on one, two and all four flags
      const goals = [];
      for (let mask = 1; mask < 16; mask++) {
        for (let values = 0; values < 16; values++) {
          if (values & ~mask) continue;
          goals.push(Object.fromEntries(FLAGS.map((k, i) => [k, i]).filter(([, i]) => mask & (1 << i)).map(([k, i]) => [convention === 'intel' ? cv[k] : k, (values >> i) & 1])));
        }
      }
      let checked = 0;
      for (const flags of goals) {
        const c = {type: 'arithmetic', op, width: w, convention, goal: {flags}};
        const want = Object.entries(flags).map(([k, x]) => [{CF: 'C', OF: 'V', SF: 'N', ZF: 'Z'}[k] || k, x]);
        const possible = [...reachable].some(s => want.every(([k, x]) => +s[FLAGS.indexOf(k)] === x));
        const r = print(c);
        if (!possible) { ok(!r.exercise && r.warnings.some(m => m.includes('no two operands')), `arithmetic ${op} ${w} bits ${convention} ${JSON.stringify(flags)}: unreachable, reported`); continue; }
        const m = answerText(r).match(/A = \S+ \(([01 ]+)\) and B = \S+ \(([01 ]+)\)/);
        const a = m && BigInt('0b' + m[1].replace(/ /g, '')), b = m && BigInt('0b' + m[2].replace(/ /g, ''));
        const goal = m && I.arithmeticGoal(c, w);
        ok(m && I.arithmeticGoalMet(goal, I.addSub(a, b, w, op === 'sub', cv), w), `arithmetic ${op} ${w} bits ${convention} ${JSON.stringify(flags)}`, answerText(r) || r.warnings.join('; '));
        checked++;
      }
      ok(checked > 20, `arithmetic ${op} ${w} bits ${convention}: many reachable goals`, String(checked));
    }
  }
}
// 16 bits: only special operands are tried; a goal reachable with 8 bits must be found, others reported
for (const op of ['add', 'sub']) {
  for (const flags of [{C: 1, V: 1}, {C: 0, V: 1}, {C: 1, V: 0, Z: 1}, {N: 1, C: 0}, {Z: 1, C: 0}, {V: 1, N: 0}, {Z: 1, N: 1}]) {
    const c = {type: 'arithmetic', op, width: 16, goal: {flags}};
    const r = print(c);
    const reach8 = !!print(Object.assign({}, c, {width: 8})).exercise;
    const m = answerText(r).match(/A = \S+ \(([01 ]+)\) and B = \S+ \(([01 ]+)\)/);
    if (!reach8) { ok(!r.exercise && r.warnings.some(x => x.includes('no two operands')), `arithmetic ${op} 16 bits ${JSON.stringify(flags)}: unreachable, reported`); continue; }
    ok(m && I.arithmeticGoalMet(I.arithmeticGoal(c, 16), I.addSub(BigInt('0b' + m[1].replace(/ /g, '')), BigInt('0b' + m[2].replace(/ /g, '')), 16, op === 'sub', I.conventionOf({})), 16),
      `arithmetic ${op} 16 bits ${JSON.stringify(flags)}`, answerText(r) || r.warnings.join('; '));
  }
}
{
  const r = print({type: 'arithmetic', op: 'add', width: 8, goal: {result: 44, flags: {C: 1}}});
  ok(/= \S+ \(0010 1100\), C = 1/.test(answerText(r)), 'arithmetic: a goal with a result', answerText(r));
}

// ---- registers: random layouts and goals ----------------------------------
function randomRegister(w) {
  const fields = [];
  let i = w - 1, n = 0;
  while (i >= 0) {
    const size = 1 + rnd(Math.min(4, i + 1));
    if (rnd(5) === 0) { i -= 1; continue; }   // a reserved bit
    const access = ['rw', 'rw', 'rw', 'r', 'w'][rnd(5)];
    fields.push({bits: size === 1 ? i : `${i}..${i - size + 1}`, name: `F${n++}`, access});
    i -= size;
  }
  return {type: 'register', name: 'REG', width: w, reset: rndBig(w).toString(), fields};
}
for (let k = 0; k < 150; k++) {
  const w = [4, 8, 8, 16, 32, 64][k % 6];
  const c = Object.assign(randomRegister(w), {view: 'map'});
  const reg = I.registerFields(c);
  if (!reg.fields.length) continue;
  const goalFields = {};
  for (const f of reg.fields) if (rnd(2)) goalFields[f.name] = rnd(2 ** Math.min(f.width, 30));
  if (!Object.keys(goalFields).length) goalFields[reg.fields[0].name] = 1;
  c.goal = {fields: goalFields};
  const r = print(c);
  const readOnly = Object.keys(goalFields).some(n => reg.byName[n].access === 'r');
  if (readOnly) { ok(!r.exercise && r.warnings.some(m => m.includes('read-only')), `register map ${k}: a read-only field in the goal is reported`); continue; }
  const m = answerText(r).match(/^REG = (0x[0-9A-F]+) /);
  const v = m && BigInt(m[1]);
  const reset = Bits.u(Bits.big(c.reset), w);
  // the browser: what a student can set (read-only and reserved bits keep their reset value), and the goal check
  ok(m && I.settable(reg, reset, v) === v && I.registerGoalMet(reg, c, v).ok, `register map ${k} (${w} bits)`, answerText(r) || r.warnings.join('; '));
}
for (let k = 0; k < 150; k++) {
  const w = [8, 8, 16, 32, 64][k % 5];
  const c = Object.assign(randomRegister(w), {view: 'code'});
  const reg = I.registerFields(c);
  const goal = {};
  if (reg.fields.length && rnd(3)) goal.fields = {[reg.fields[0].name]: rnd(2 ** Math.min(reg.fields[0].width, 30))};
  const bits = [...Array(w).keys()].filter(() => rnd(6) === 0);
  for (const i of bits) (goal[['set_bits', 'clear_bits', 'toggle_bits'][rnd(3)]] ||= []).push(i);
  if (!Object.keys(goal).length) goal.set_bits = [0];
  c.goal = goal;
  const r = print(c);
  const code = r.exercise && r.exercise.answer.find(p => p.code)?.code;
  let right = !!code && I.checkCode(code, reg, c).ok;
  // 8 bits: every starting value
  if (right && w === 8) {
    const g = I.codeGoal(reg, c), stmts = globalThis.CourseWidgets.CLang.parse(code);
    for (let init = 0n; init < 256n && right; init++) {
      const got = globalThis.CourseWidgets.CLang.run(stmts, {REG: init}, {}, 8, code).REG;
      let want = init;
      for (const [f, x] of g.fields) want = (want & ~Bits.fieldMask(f.hi, f.lo)) | (BigInt(x) << BigInt(f.lo));
      want = Bits.u(((want | g.set) & ~g.clear) ^ g.toggle, 8);
      right = got === want;
    }
  }
  ok(right, `register code ${k} (${w} bits) ${JSON.stringify(goal)}`, code || r.warnings.join('; '));
}
ok(print({type: 'register', view: 'code', name: 'R', fields: [{bits: '3..0', name: 'A'}], goal: {fields: {B: 1}}}).warnings.some(m => m.includes('no field B')),
  'register code: an unknown field in the goal is reported');
ok(print({type: 'register', name: 'R', fields: [{bits: [6, 5], name: 'A'}]}).error?.includes('should look like 7 or 6..5'), 'register: bits: [6, 5] is refused');
ok(print({type: 'register', name: 'R', fields: [{bits: '6:5', name: 'A'}]}).error?.includes('should look like 7 or 6..5'), 'register: bits: 6:5 is refused');
ok(print({type: 'register', name: 'R', width: 40, fields: [{bits: 35, name: 'A'}], value: 0}).error === undefined, 'register: 40 bits');

// ---- frames: the printed answer is what was sent -------------------------
for (let k = 0; k < 40; k++) {
  const n = 1 + rnd(4), bytes = [...Array(n)].map(() => rnd(256));
  const protocol = ['uart', 'spi', 'i2c'][k % 3];
  const c = {type: 'frame', protocol, goal: 'decode'};
  if (protocol === 'uart') c.data = bytes;
  if (protocol === 'spi') c.mosi = bytes;
  if (protocol === 'i2c') c.transfers = [{write: bytes.slice(0, 1)}, {read: bytes.slice(1)}].filter(t => (t.write || t.read).length);
  const r = print(c);
  const got = [...answerText(r).matchAll(/0x([0-9A-F]+)/g)].map(m => parseInt(m[1], 16));
  ok(JSON.stringify(got) === JSON.stringify(bytes), `frame decode ${protocol} ${JSON.stringify(bytes)}`, answerText(r) || r.error);
  // not in the picture, nor in the tooltips (I²C shows its address, 0x48, as 0x90 and 0x91 with R/W)
  const shown = bytes.filter(b => r.svg.includes('0x' + b.toString(16).toUpperCase().padStart(2, '0')) && !(protocol === 'i2c' && [0x48, 0x90, 0x91].includes(b)));
  ok(r.svg && !shown.length, `frame decode ${protocol}: no values in the picture`, JSON.stringify(shown));
}

// ---- encoders --------------------------------------------------------------
{
  const spec = Protocols.uart({bytes: [0x48], bit_order: 'lsb'}, false);
  const levels = spec.lanes[0].segs.slice(1, 11).map(s => s.level).join('');
  ok(levels === '0000100101', 'uart: start bit, 0x48 least significant bit first, stop bit', levels);
  const even = Protocols.uart({bytes: [0x4F], parity: 'even'}, false).lanes[0].labels.find(l => l.text === 'P');
  const odd = Protocols.uart({bytes: [0x4F], parity: 'odd'}, false).lanes[0].labels.find(l => l.text === 'P');
  ok(even && odd, 'uart: parity bits');
  // frames back to back: the start bit of 'i' follows the stop bit of 'H'; with gap, idle bit times between them
  const wire = c => { const s = Protocols.uart(c, false); return s.lanes[0].segs.map(g => String(g.level).repeat(g.t1 - g.t0)).join(''); };
  const hi = wire({bytes: [0x48, 0x69]});
  ok(hi === '1' + '0000100101' + '0100101101' + '1', 'uart: frames back to back, no idle bit between them', hi);
  const gap = wire({bytes: [0x48, 0x69], gap: 3});
  ok(gap === '1' + '0000100101' + '111' + '0100101101' + '1', 'uart: gap: 3 idles 3 bit times between frames', gap);
  ok(print({type: 'frame', data: 'Hi', gap: -1}).error?.includes('gap is 0'), 'uart: gap: -1 is refused');
  for (let mode = 0; mode < 4; mode++) {
    const s = Protocols.spi({mosiBytes: [0xA5], misoBytes: null, mode}, false);
    const clk = s.lanes[1].segs;
    const levelAt = t => clk.find(g => g.t0 <= t && t < g.t1).level;
    const cpol = mode >> 1;
    // sampling edges: the clock changes there, to 1 - CPOL for CPHA 0 and to CPOL for CPHA 1
    const right = s.samples.length === 8 && s.samples.every(m => levelAt(m.t - 0.5) !== levelAt(m.t + 0.5)
      && levelAt(m.t + 0.5) === ((mode & 1) ? cpol : 1 - cpol));
    // data is stable around every sampling edge
    const mosi = s.lanes[2].segs;
    const stable = s.samples.every(m => { const seg = mosi.find(g => g.t0 < m.t && m.t < g.t1); return seg && seg.level !== undefined; });
    ok(right && stable && clk[0].level === cpol, `spi mode ${mode}: idle level, sampling edges, stable data`);
  }
  const i2c = Protocols.i2c({address: 0x48, transfers: [{write: [0]}, {read: [0x19, 0x80]}]}, false);
  ok(JSON.stringify(i2c.groups.map(g => g.text)) === JSON.stringify(['0x48 + W', '0x00', '0x48 + R', '0x19', '0x80']), 'i2c: address and data bytes');
}

// ---- packets: packing order ---------------------------------------------
{
  const fields = I.packetFields({fields: [{name: 'id', bits: 8, value: 0x2A}, {name: 't', bits: 16, value: -125, signed: true},
    {name: 'flags', bits: 4, value: 0b1010}, {name: 'seq', bits: 4, value: 7}]});
  const bytes = st => I.packFields(fields, Object.assign({byte_order: 'big', pack: 'msb'}, st)).map(b => b.value);
  ok(JSON.stringify(bytes({byte_order: 'little'})) === JSON.stringify([0x2A, 0x83, 0xFF, 0xA7]), 'packet: little-endian, packed from bit 7');
  ok(JSON.stringify(bytes({})) === JSON.stringify([0x2A, 0xFF, 0x83, 0xA7]), 'packet: big-endian');
  ok(JSON.stringify(bytes({pack: 'lsb'})) === JSON.stringify([0x2A, 0xFF, 0x83, 0x7A]), 'packet: packed from bit 0');
  const odd = I.packFields(I.packetFields({fields: [{name: 'a', bits: 3, value: 5}, {name: 'b', bits: 7, value: 0x41}]}), {pack: 'lsb'});
  ok(JSON.stringify(odd.map(b => b.value)) === JSON.stringify([0x0D, 0x02]), 'packet: a field across a byte boundary, from bit 0', JSON.stringify(odd.map(b => b.value)));
}

// ---- shifts: one bit at a time = the C operators --------------------------
for (let k = 0; k < 200; k++) {
  const w = [4, 8, 16, 32, 64][k % 5], v = rndBig(w), n = 1 + rnd(w);
  const ops = Object.keys(I.SHIFTS);
  const op = ops[k % ops.length];
  let bits = I.toSlots(v, w), carry = 1;
  const c0 = carry;
  for (let s = 0; s < n; s++) {
    const r = I.shiftOnce(bits, I.SHIFTS[op].plan(bits, carry));
    bits = r.bits;
    if (I.SHIFTS[op].carry) carry = r.out;
  }
  const got = I.fromSlots(bits), N = BigInt(n), W = BigInt(w);
  // through the carry: a rotation of the w + 1 bits C:value
  const wide = (BigInt(c0) << W) | v, M = Bits.mask(w + 1), W1 = W + 1n;
  const expected = {
    shl: Bits.u(v << N, w), shr: v >> N, sar: Bits.u(Bits.s(v, w) >> N, w),
    rol: Bits.u((v << N) | (v >> ((W - N) % W)), w), ror: Bits.u((v >> N) | (v << ((W - N) % W)), w),
    rcl: Bits.u(((wide << N) | (wide >> (W1 - N))) & M, w), rcr: Bits.u(((wide >> N) | (wide << (W1 - N))) & M, w),
  }[op];
  ok(got === expected, `shift ${op} ${w} bits by ${n}`, `${got} ≠ ${expected}`);
}

// ---- every type and view prints, and wrong settings are reported --------
const all = [
  {type: 'number', width: 64, value: '0xDEADBEEFCAFEF00D', explain: true}, {type: 'number', view: 'wheel', width: 3, signed: true},
  {type: 'arithmetic', op: 'sub', width: 16, a: 1, b: 2, signed: false}, {type: 'shift', width: 64, value: -1, op: 'rcr', amount: 3},
  {type: 'register', view: 'ops', name: 'P', width: 32, value: 7}, {type: 'frame', protocol: 'spi', mosi: [1, 2, 3, 4, 5, 6, 7, 8], word_bits: 16},
  {type: 'packet', fields: [{name: 'x', bits: 64, value: '18446744073709551615'}], send: 'uart'},
];
for (const c of all) {
  const r = print(c);
  ok(!r.error && r.svg && r.svg.startsWith('<svg') && r.svg.endsWith('</svg>') && !r.warnings.length, `prints: ${JSON.stringify(c).slice(0, 60)}`, r.error || r.warnings.join('; '));
}
ok(print({type: 'number', colour: 'red'}).warnings.includes('unknown setting "colour"'), 'an unknown setting is reported');
ok(print({type: 'number', controls: ['bits', 'dial']}).warnings.some(m => m.startsWith('unknown control "dial"')), 'an unknown control is reported');
ok(print({type: 'shift', goal: {value: 1}}).warnings.some(m => m.startsWith('this widget has no goal')), 'a goal on a widget without goals is reported');
ok(print({type: 'number', signed: 'maybe'}).error?.includes('signed is true, false or both'), 'signed: true, false or both');
ok(print({type: 'arithmetic', convention: 'x86'}).error?.includes('convention is arm or intel'), 'convention: arm or intel');
ok(print({type: 'number', width: 65}).error?.includes('width must be 1 … 64'), 'widths up to 64 bits');
ok(!print({type: 'number', editable: true}).warnings.length && print({type: 'number', editable: 'yes'}).warnings.includes('editable is true or false'),
  'editable is true or false');

console.log(failed.length ? failed.map(f => `FAIL ${f}`).join('\n') : '');
console.log(`${passed} ok, ${failed.length} failed`);
if (failed.length) Deno.exit(1);
