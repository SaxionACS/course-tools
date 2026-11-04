// Tests of the widgets' logic (assets/widgets/widgets.js), run by scripts/check.py:
//
//     quarto run tests/widgets.js
//
// The answers printed in PDFs are read back from their text and checked with
// the code that checks a student's answer in the browser, for many goals of
// every kind: number patterns, arithmetic flags, register maps, register code
// and frames to decode, PWM settings. Goals that cannot be reached must be
// reported instead. Encoders, shifts and the PWM model are compared with
// independent calculations.
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

// ---- widths: the choices of the width control ----------------------------
for (const type of ['number', 'arithmetic']) {
  const r = print({type, width: 16, widths: [32, 8, 16, 8], controls: ['width']});
  ok(!r.error && !r.warnings.length, `${type}: widths in any order, twice is fine`, r.error || r.warnings.join('; '));
  const wrong = print({type, width: 8, widths: [16, 32], controls: ['width']});
  ok(wrong.error === 'width 8 is not one of the widths (16, 32)', `${type}: the width must be one of the widths`, wrong.error);
  ok(print({type, widths: [8, 65], controls: ['width']}).error === 'widths must be 1 … 64, not 65', `${type}: widths up to 64 bits`);
  ok(print({type, widths: 8, controls: ['width']}).error === undefined, `${type}: a single width without brackets`);
  ok(print({type, widths: [8, 16]}).warnings.includes('widths are the choices of the width control: add width to controls'),
    `${type}: widths without the width control are reported`);
}
ok(I.widthsOf({width: 8}, [4, 8, 16]).join() === '4,8,16' && I.widthsOf({width: 8, widths: [32, 8, 8]}, [4]).join() === '8,32',
  "widthsOf: the type's choices, or the widget's own, sorted and once each");
{
  const w = print({type: 'shift', widths: [8, 16]}).warnings;
  ok(w.length === 1 && w[0] === 'unknown setting "widths"', 'widths only for number and arithmetic', w.join('; '));
}

// ---- number: the stdint.h type of 8, 16, 32 and 64 bits -------------------
ok([I.cType(8, 'unsigned'), I.cType(8, 'signed'), I.cType(64, 'unsigned'), I.cType(64, 'signed'), I.cType(4, 'unsigned'), I.cType(12, 'signed')].join()
  === 'uint8_t,int8_t,uint64_t,int64_t,,', 'cType: uintN_t and intN_t for 8, 16, 32 and 64 bits, nothing for other widths');
for (const [w, value, line] of [[8, '0xD2', 'uint8_t 210 · int8_t −46'], [16, -1, 'uint16_t 65535 · int16_t −1'],
  [32, '0x80000000', 'uint32_t 2147483648 · int32_t −2147483648'], [4, 9, 'unsigned 9 · signed −7'], [12, 4095, 'unsigned 4095 · signed −1']]) {
  const svg = print({type: 'number', width: w, value}).svg || '';
  ok(svg.includes(line), `number PDF, ${w} bits: ${line}`, svg.match(/hexadecimal[^<]*/)?.[0]);
}
ok((print({type: 'number', width: 32, value: 7, signed: true}).svg || '').includes('0x00000007 · int32_t 7'), 'number PDF: signed only names int32_t');

// ---- frames: C escapes in text, bit values under the labels, zoom to fit --
{
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const cases = [['AT\\r\\n', [65, 84, 13, 10]], ['\\0', [0]], ['\\x41\\101\\u0042', [65, 65, 66]], ['\\"\\\'\\\\\\?', [34, 39, 92, 63]],
    ['\\t\\a\\b\\f\\v\\e', [9, 7, 8, 12, 11, 27]], ['\\q', [92, 113]], ['\\08', [0, 56]], ['0x48 0x69', [0x48, 0x69]]];
  for (const [text, bytes] of cases) ok(same(I.toBytes(text), bytes), `escapes: ${text}`, JSON.stringify(I.toBytes(text)));
  ok(same(I.toBytes('A\r\n'), [65, 13, 10]), 'text with real control characters (YAML in double quotes) is kept');
  const all = String.fromCharCode(...Array(256).keys());
  ok(I.unescapeText(I.escapeText(all)) === all && !/[\x00-\x1f\x7f]/.test(I.escapeText(all)), 'escapeText and unescapeText round-trip every byte');
  ok(I.escapeText('Hi\r\n\0\\') === 'Hi\\r\\n\\0\\\\', 'escapeText for a text box', I.escapeText('Hi\r\n\0\\'));
  ok(I.byteName(10) === "'\\n' 0x0A" && I.byteName(0) === "'\\0' 0x00" && I.byteName(0x48) === "'H' 0x48" && I.byteName(0x80) === '0x80',
    'frame labels name control characters by their escapes');
  const r = print({type: 'frame', protocol: 'uart', data: 'AT\\r\\n', goal: 'decode'});
  ok(answerText(r) === "frame 1: 'A' 0x41, frame 2: 'T' 0x54, frame 3: '\\r' 0x0D, frame 4: '\\n' 0x0A.", 'a decode answer with escapes', answerText(r));

  const values = c => [...(print(c).svg || '').matchAll(/<text[^>]*class="cw-wv-val"[^>]*>([01])<\/text>/g)].map(m => m[1]).join('');
  ok(values({type: 'frame', protocol: 'uart', data: [0x48]}) === '', 'bit values are off by default');
  ok(values({type: 'frame', protocol: 'uart', data: [0x48], bit_values: true}) === '0000100101',
    'uart: bit values under start, D0 … D7 and stop', values({type: 'frame', protocol: 'uart', data: [0x48], bit_values: true}));
  ok(values({type: 'frame', protocol: 'uart', data: [0x4F], parity: 'even', bit_values: true}) === '01111001011', 'uart: and under the parity bit');
  ok(values({type: 'frame', protocol: 'spi', mode: 3, mosi: [0xA5], miso: [0x3C], bit_values: true}) === '1010010100111100', 'spi: under MOSI and MISO, every mode');
  ok(values({type: 'frame', protocol: 'i2c', address: 0x48, transfers: [{write: [0x80]}], bit_values: true}) === '10010000' + '0' + '10000000' + '0',
    'i2c: under the address, R/W, data and ACK bits');
  ok(!print({type: 'frame', data: 'x', bit_values: true}).warnings.length, 'bit_values is a known setting');

  const spec = Protocols.uart({bytes: [0xF0]}, false);
  const width = 72 + spec.ticks * spec.unit;
  ok(Math.abs(globalThis.CourseWidgets.Wave.fit(spec, 2 * width - 72) - 2) < 1e-9, 'zoom to fit: twice the width at zoom 2');
}

// ---- pwm: the model against independent calculations, goals, answers read back ----
{
  const eq = (a, b, what) => ok(a === b, what, `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  const near = (a, b, rel, what) => ok(Math.abs(a - b) <= rel * Math.abs(b) + 1e-15, what, `${a} vs ${b}`);
  const throws = (f, re, what) => { try { f(); failed.push(`${what}: no error`); } catch (e) { ok(re.test(e.message), what, e.message); } };
  let state = 20261103;   // mulberry32
  const random = () => { state = (state + 0x6D2B79F5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ri = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));

  // ---- quantities ------------------------------------------------------------
  eq(I.quantity('10 kHz', 'Hz', 'frequency'), 10000, 'quantity 10 kHz');
  eq(I.quantity('125 MHz', 'Hz', 'clock'), 125e6, 'quantity 125 MHz');
  eq(I.quantity('125MHz', 'Hz', 'clock'), 125e6, 'quantity without a space');
  eq(I.quantity('25%', '%', 'duty'), 0.25, 'quantity 25%');
  eq(I.quantity('0,5 V', 'V', 'voltage'), 0.5, 'quantity with a decimal comma');
  near(I.quantity('500 ms', 's', 'time'), 0.5, 1e-12, 'quantity 500 ms');
  near(I.quantity('10 us', 's', 'time'), 1e-5, 1e-12, 'quantity 10 us');
  near(I.quantity('10 µs', 's', 'time'), 1e-5, 1e-12, 'quantity 10 µs');
  eq(I.quantity(1000, 'Hz', 'f'), 1000, 'a plain number is in the base unit');
  eq(I.quantity('0.25', '%', 'duty'), 0.25, 'a plain number is a fraction for %');
  throws(() => I.quantity('10 khz', 'Hz', 'frequency'), /^frequency: "10 khz" is not a frequency\. Write a number and a unit, e\.g\. 10 kHz$/, 'case matters: khz');
  throws(() => I.quantity('5 m', 's', 'time'), /is not a time/, 'a prefix needs a unit');
  throws(() => I.quantity('10 kHz', 's', 'time'), /is not a time/, 'the wrong unit');
  {
    const hz = I.quantityTol('10 kHz +/- 100 Hz', 'Hz', 'f'); ok(hz.value === 1e4 && hz.tol === 100 && !hz.rel, 'tolerance in Hz', JSON.stringify(hz));
    const khz = I.quantityTol('10 kHz +/- 0.1 kHz', 'Hz', 'f'); ok(Math.abs(khz.tol - 100) < 1e-9 && !khz.rel, 'tolerance in kHz', JSON.stringify(khz));
    const tight = I.quantityTol('10kHz+/-100Hz', 'Hz', 'f'); ok(tight.value === 1e4 && tight.tol === 100, 'tolerance without spaces', JSON.stringify(tight));
    const a = I.quantityTol('10 kHz +/- 1%', 'Hz', 'f'); ok(a.value === 1e4 && a.tol === 0.01 && a.rel, 'tolerance relative', JSON.stringify(a));
    const b = I.quantityTol('100 us +/- 1 us', 's', 'p'); ok(Math.abs(b.tol - 1e-6) < 1e-15 && !b.rel, 'tolerance of a time', JSON.stringify(b));
    const c = I.quantityTol('25% +/- 0.1%', '%', 'd'); ok(Math.abs(c.tol - 0.001) < 1e-15 && !c.rel, 'tolerance in percentage points', JSON.stringify(c));
    ok(I.quantityTol('10 kHz ± 100 Hz', 'Hz', 'f').tol === 100 && I.quantityTol('10 kHz +- 100 Hz', 'Hz', 'f').tol === 100, '± and +- are read too');
    throws(() => I.quantityTol('9.9 kHz - 10.1 kHz', 'Hz', 'frequency'), /^frequency: "9\.9 kHz - 10\.1 kHz" is not a frequency with a tolerance\. Write it like 10 kHz \+\/- 100 Hz$/, 'a range says how to write it');
    throws(() => I.quantityTol('9.9kHz-10.1kHz', 'Hz', 'frequency'), /Write it like 10 kHz \+\/- 100 Hz$/, 'a range without spaces too');
    throws(() => I.quantityTol('10 kHz +/- 1 V', 'Hz', 'frequency'), /Write it like 10 kHz \+\/- 100 Hz$/, 'a tolerance in the wrong unit');
    throws(() => I.quantityTol('10 khz +/- 100 Hz', 'Hz', 'frequency'), /is not a frequency with a tolerance/, 'a value in the wrong case');
    throws(() => I.quantityTol('10 kHz +/- -100 Hz', 'Hz', 'frequency'), /with a tolerance/, 'a negative tolerance');
    throws(() => I.quantityTol('25% +/- 1', '%', 'duty'), /Write it like 25% \+\/- 0\.1%$/, 'a duty tolerance needs its % sign');
    throws(() => I.quantityTol('10 khz', 'Hz', 'frequency'), /^frequency: "10 khz" is not a frequency\. Write a number and a unit, e\.g\. 10 kHz$/, 'a plain mistake stays a plain message');
    const d = I.quantityTol('25%', '%', 'd'); ok(d.tol === null, 'no tolerance');
  }
  for (const [v, u, t] of [[10000, 'Hz', '10 kHz'], [125e6 / 65536, 'Hz', '1.907 kHz'], [524.288e-6, 's', '524.3 µs'], [8e-9, 's', '8 ns'],
    [31.25e6, 'Hz', '31.25 MHz'], [125e6 / (255.9375 * 65536), 'Hz', '7.452 Hz'], [0.0009999, 's', '999.9 µs'], [0.00099996, 's', '1 ms']]) {
    eq(I.fmtQuantity(v, u), t, `fmtQuantity ${t}`);
  }
  eq(I.fmtPercent(0.25), '25 %', 'fmtPercent exact');
  eq(I.fmtPercent(13107 / 65536), '≈ 19.9997 %', 'fmtPercent of the lesson example');
  eq(I.fmtPercent(65535 / 65536), '≈ 99.9985 %', 'fmtPercent just below 100 %');
  // a value that rounds to the goal is told apart from it
  eq(I.fmtApart(125e6 / (2.5 * 50001), 1000, 'Hz'), '999.98 Hz', 'fmtApart: 999.98 Hz is not 1 kHz');
  eq(I.fmtApart(50001 * 20e-9, 1e-3, 's'), '1.00002 ms', 'fmtApart: 1.00002 ms is not 1 ms');
  eq(I.fmtApart(125e6 / 65536, 10000, 'Hz'), '1.907 kHz', 'fmtApart: 4 digits when they are enough');
  // the numbers say when they are rounded
  eq(I.fmtExact(524.288e-6, 's'), '524.288 µs', 'fmtExact: the lesson\'s period');
  eq(I.fmtExact(125e6 / 65536, 'Hz'), '≈ 1.90735 kHz', 'fmtExact: a rounded frequency');
  eq(I.fmtExact(10000, 'Hz'), '10 kHz', 'fmtExact: an exact frequency');

  // ---- lightness ---------------------------------------------------------------
  near(I.lightness(0.5), 0.7607, 1e-3, 'half the time on looks 76 % bright');
  for (const l of [0, 0.03, 0.08, 0.2, 0.5, 0.9, 1]) near(I.lightness(I.luminance(l)), l, 1e-9, `luminance is the inverse of lightness (${l})`);

  // ---- the model ---------------------------------------------------------------
  const settings = c => I.pwmSettings(c);
  for (let n = 0; n < 200; n++) {
    const wrap = ri(0, 65535), A = ri(0, 65535), B = ri(0, 65535), clkdiv = ri(16, 4095) / 16;
    const m = I.pwmModel(settings({wrap, levels: {A, B}, clkdiv}));
    const ticks = wrap + 1, tick = clkdiv / 125e6;
    near(m.periodS, ticks * tick, 1e-12, `period ${wrap}/${clkdiv}`);
    near(m.freq, 125e6 / clkdiv / ticks, 1e-12, `frequency ${wrap}/${clkdiv}`);
    for (const [ch, l] of [['A', A], ['B', B]]) {
      const c = m.channels.find(x => x.name === ch);
      near(c.duty, (l >= ticks ? ticks : l) / ticks, 1e-12, `duty ${ch} ${l}/${wrap}`);
    }
  }
  // tick by tick: the output is high while counter < level
  for (let wrap = 0; wrap <= 16; wrap++) {
    for (let level = 0; level <= 20; level++) {
      let high = 0;
      for (let counter = 0; counter <= wrap; counter++) if (counter < level) high++;
      eq(I.pwmModel(settings({wrap, level})).channels[0].highTicks, high, `high ticks, wrap ${wrap}, level ${level}`);
    }
  }
  {
    const m = I.pwmModel(settings({wrap: 3, levels: {A: 1, B: 3}}));
    eq(m.periodTicks, 4, 'datasheet figure 105: 4 ticks');
    near(m.freq, 31.25e6, 1e-12, 'datasheet figure 105: 31.25 MHz');
    ok(m.channels[0].duty === 0.25 && m.channels[1].duty === 0.75, 'datasheet figure 105: 25 % and 75 %');
    const l = I.pwmModel(settings({wrap: 65535, level: 13107}));
    near(l.periodS, 524.288e-6, 1e-12, 'lesson: 524.288 µs');
    eq(I.fmtPercent(l.channels[0].duty), '≈ 19.9997 %', 'lesson: 19.9997 %');
    const c = {type: 'pwm', wrap: 65535, level: 13107, goal: {duty: '20%'}};
    ok(I.pwmGoalMet(I.pwmGoal(c, settings(c)), settings(c)).ok, 'lesson: 13107 meets duty: 20%');
    near(I.pwmModel(settings({clkdiv: 255.9375})).freq, 7.4524, 1e-4, 'the lowest frequency: 7.45 Hz');
    near(I.pwmModel(settings({clkdiv: 64})).freq, 29.80, 1e-3, 'clkdiv 64: 29.8 Hz');
  }
  // settings that are wrong
  for (const [c, re] of [[{wrap: 70000}, /wrap is 0 … 65535, not 70000/], [{wrap: 2.5}, /wrap is a whole number/], [{level: -1}, /level A is 0 … 65535/],
    [{levels: {C: 1}}, /a channel is A or B, not "C"/], [{level: 1, levels: {A: 1}}, /level or levels, not both/], [{clkdiv: 1.3}, /multiple of 1\/16.*not 1\.3/],
    [{clkdiv: 256}, /clkdiv is 1 … 255\.9375/], [{clkdiv: 0.5}, /clkdiv is 1 … 255\.9375/], [{periods: 9}, /periods is 1 … 8/], [{show: ['scope']}, /a part to show/],
    [{clock: '125 Mhz'}, /clock: "125 Mhz" is not a frequency/], [{check: 'sometimes'}, /check is button, live/]]) {
    throws(() => settings(c), re, `wrong setting ${JSON.stringify(c)}`);
  }
  eq(settings({wrap: '0x30D3'}).wrap, 12499, 'wrap in hexadecimal');
  eq(settings({clkdiv: 2.5}).clkdiv, 2.5, 'clkdiv 2.5');
  eq(settings({clkdiv: '1.0625'}).clkdiv, 1.0625, 'clkdiv 1.0625');

  // ---- the numbers -----------------------------------------------------------------
  {
    const lines = st => Object.fromEntries(I.pwmNumbers(st));
    eq(lines(settings({wrap: 3, level: 1}))['One tick'], 'Δt = 1 / 125 MHz = 8 ns', 'one tick, no divider');
    eq(lines(settings({wrap: 3, level: 1, clkdiv: 2.5}))['One tick'], 'Δt = clkdiv / clock = 2.5 / 125 MHz = 20 ns', 'one tick with a divider');
    eq(I.pwmNumbers(settings({wrap: 3, level: 1}), {clkdiv: true})[0][1], 'Δt = clkdiv / clock = 1 / 125 MHz = 8 ns', 'one tick with the divider as a control');
    eq(lines(settings({wrap: 65535, level: 13107}))['Duty A'], 'level / (wrap + 1) = 13107 / 65536 ≈ 19.9997 %', 'a rounded duty');
    ok(/524\.288 µs, so the frequency is ≈ 1\.90735 kHz$/.test(lines(settings({wrap: 65535, level: 1}))['Period']), 'the lesson\'s period', lines(settings({wrap: 65535, level: 1}))['Period']);
    ok(/1\.00002 ms, so the frequency is ≈ 999\.98 Hz$/.test(lines(settings({wrap: 50000, level: 1, clkdiv: 2.5}))['Period']), 'one tick too many shows in the numbers', lines(settings({wrap: 50000, level: 1, clkdiv: 2.5}))['Period']);
    eq(lines(settings({wrap: 65535, level: 1, clkdiv: 64}))['Period'], 'T = (wrap + 1) · Δt = (65535 + 1) · 512 ns ≈ 33.5544 ms, so the frequency is ≈ 29.8023 Hz', 'a rounded period');
    eq(lines(settings({wrap: 3, level: 1, clock: '133 MHz'}))['One tick'], 'Δt = 1 / 133 MHz ≈ 7.5188 ns', 'a rounded tick');
    for (let n = 0; n < 200; n++) {
      const text = I.pwmNumbers(settings({wrap: ri(0, 65535), levels: {A: ri(0, 65535)}, clkdiv: ri(16, 4095) / 16})).map(l => l[1]).join(' ');
      ok(!/= ≈/.test(text), 'the numbers never say = ≈', text);
    }
  }

  // ---- the eye ----------------------------------------------------------------
  for (const [P, d] of [[32e-9, 0.25], [100e-6, 0.5], [0.0336, 0.5], [0.134, 0.1]]) {
    let sum = 0;
    const n = 2000;
    for (let k = 0; k < n; k++) sum += I.eyeLevel(P, d * P, (k + 0.5) / n * P);
    near(sum / n, d, P > 0.01 ? 0.02 : 1e-3, `the eye's average over a period is the duty (${P} s, ${d})`);
  }
  {
    const vals = [...Array(50).keys()].map(k => I.eyeLevel(100e-6, 50e-6, k * 3.1e-6));
    ok(Math.max(...vals) - Math.min(...vals) < 0.01, 'at 10 kHz the LED looks steady');
    const slow = [...Array(50).keys()].map(k => I.eyeLevel(0.0336, 0.0168, k * 0.0011));
    ok(Math.max(...slow) - Math.min(...slow) > 0.3, 'at 30 Hz the LED flickers');
  }

  // ---- goals and answers ----------------------------------------------------------
  const goalOf = c => I.pwmGoal(c, settings(c));
  const met = (c, st) => I.pwmGoalMet(goalOf(c), st);
  // the answer as printed: read the numbers back from its text and its code, and check them like a student's answer
  function readBack(c, ex) {
    const text = ex.answer[0].text, code = ex.answer[1].code;
    const st = settings(c);
    const num = (re, s) => { const m = re.exec(s); return m ? Number(m[1]) : null; };
    const wrap = num(/wrap = (\d+)/, text), wrapCode = num(/pwm_set_wrap\(slice, (\d+)\)/, code);
    ok(wrap === wrapCode, 'the text and the code have the same wrap', `${wrap} ${wrapCode}`);
    st.wrap = wrap;
    for (const ch of Object.keys(st.levels)) {
      const l = num(new RegExp(`level ${ch} = (\\d+)`), text);
      if (l !== null) { st.levels[ch] = l; eq(num(new RegExp(`PWM_CHAN_${ch}, (\\d+)\\)`), code), l, `the code has level ${ch}`); }
    }
    const div = num(/clkdiv = ([\d.]+)/, text);
    if (div !== null) { st.clkdiv = div; ok(new RegExp(`pwm_set_clkdiv\\(slice, ${div}(\\.0)?f\\)`).test(code), 'the code has the divider', code); }
    return st;
  }
  {
    const c = {type: 'pwm', wrap: 65535, levels: {A: 0}, controls: ['wrap', 'levels'], goal: {frequency: '10 kHz', duty: '25%'}};
    const ex = Widget.print(c);
    ok(!ex.error && ex.exercise, 'the 10 kHz challenge is an exercise', JSON.stringify(ex.warnings || ex.error));
    eq(ex.exercise.answer[0].text, 'wrap = 12499, level A = 3125: 10 kHz, a duty of 25 %.', 'the 10 kHz answer');
    eq(ex.exercise.answer[1].code, 'pwm_set_wrap(slice, 12499);\npwm_set_chan_level(slice, PWM_CHAN_A, 3125);', 'the 10 kHz code');
    ok(met(c, readBack(c, ex.exercise)).ok, 'the 10 kHz answer meets the goal');
    ok(/One tick: Δt = 1 \/ 125 MHz = 8 ns/.test(ex.svg), 'the exercise in the PDF gives the length of a tick');
    ok(!/12\.5 kHz|10 kHz/.test(ex.svg), 'the exercise in the PDF has no frequency');
    const st = settings(c);
    st.wrap = 12500; st.levels.A = 3125;
    const r = met(c, st);
    eq(r.first.hint, 'Close: wrap = 12500 gives wrap + 1 = 12501 ticks per period, because the counter also counts 0. 10 kHz needs 12500 ticks.', 'hint: wrap = ticks instead of ticks − 1');
    eq(r.first.live, 'the frequency is 9.999 kHz. The goal is 10 kHz.', 'live status of a frequency');
    eq(r.first.blind, 'the frequency is not 10 kHz.', 'blind status of a frequency');
    st.wrap = 12499; st.levels.A = 3125;
    ok(met(c, st).ok, '12499 and 3125 meet the goal');
    // the mistake that does not show at a large wrap
    ok(Math.round(0.25 * 12499) === 3125, 'at wrap 12499, duty × wrap rounds to the right level: the mistake does not show there');
    const s3 = {type: 'pwm', wrap: 3, level: 0, controls: ['levels'], goal: {duty: '75%'}};
    const st3 = settings(s3); st3.levels.A = Math.round(0.75 * 3);
    const r2 = met(s3, st3);
    ok(!r2.ok && /level \/ \(wrap \+ 1\)/.test(r2.first.hint || ''), 'hint: duty × wrap', JSON.stringify(r2.first));
  }
  {
    // a frequency that rounds to the goal: challenge 6 with clkdiv 2.5 and wrap 50000
    const c = {type: 'pwm', controls: ['wrap', 'levels', 'clkdiv'], level: 25000, goal: {frequency: '1 kHz', duty: '50%'}};
    const st = settings(c);
    st.clkdiv = 2.5; st.wrap = 50000;
    const r = met(c, st);
    eq(r.first.live, 'the frequency is 999.98 Hz. The goal is 1 kHz.', 'live: the value is told apart from the goal');
    eq(r.first.hint, 'Close: wrap = 50000 gives wrap + 1 = 50001 ticks per period, because the counter also counts 0. 1 kHz needs 50000 ticks.', 'the hint names the ticks');
    st.wrap = 49999;
    ok(met(c, st).ok, 'clkdiv 2.5, wrap 49999, level 25000 meet the goal');
    // a period goal, and one tick too many at a target that is not a whole number of ticks
    const p = {type: 'pwm', controls: ['wrap'], level: 1, goal: {period: '100 us'}};
    const sp = settings(p); sp.wrap = 12500;
    eq(met(p, sp).first.live, 'the period is 100.01 µs. The goal is 100 µs.', 'live: a period told apart from the goal');
    const f = {type: 'pwm', controls: ['wrap'], level: 1, goal: {frequency: '7 kHz'}};
    const sf = settings(f); sf.wrap = Math.round(125e6 / 7000);
    ok(/7 kHz needs about 17857 ticks\.$/.test(met(f, sf).first.hint || ''), 'about, when the ticks are not a whole number', met(f, sf).first.hint);
  }
  {
    const c = {type: 'pwm', wrap: 65535, levels: {A: 65535}, controls: ['wrap', 'levels'], goal: {duty: '100%'}};
    const ex = Widget.print(c);
    eq(ex.exercise && ex.exercise.answer[0].text, 'wrap = 65534, level A = 65535: a duty of 100 %.', '100 % with wrap a control: 65534 and 65535');
    const st = settings(c);
    ok(/The largest level is 65535/.test(met(c, st).first.hint || ''), 'hint: 100 % at wrap 65535');
    st.wrap = 100; st.levels.A = 100;
    ok(/counter < level is false/.test(met(c, st).first.hint || ''), 'hint: level = wrap for 100 %');
    eq(met(c, st).first.live, 'the duty of channel A is ≈ 99.0099 %. The goal is 100 %.', 'live status of a duty');
  }
  // an explicit tolerance is the author's
  {
    const c = {type: 'pwm', controls: ['wrap'], level: 1, goal: {frequency: '10 kHz +/- 1%'}};
    const st = settings(c);
    for (const [wrap, good] of [[12499, true], [12500, true], [12400, true], [12300, false]]) { st.wrap = wrap; eq(met(c, st).ok, good, `10 kHz +/- 1% at wrap ${wrap}`); }
    const d = {type: 'pwm', wrap: 65535, controls: ['levels'], level: 65535, goal: {duty: '100% +/- 0.1%'}};
    ok(met(d, settings(d)).ok, '100% +/- 0.1% accepts 99.9985 %');
    // a margin in Hz: 9.9 kHz … 10.1 kHz is wrap 12376 … 12625
    const h = {type: 'pwm', controls: ['wrap'], level: 1, goal: {frequency: '10 kHz +/- 100 Hz'}};
    const sh = settings(h);
    for (const [wrap, good] of [[12375, false], [12376, true], [12499, true], [12500, true], [12625, true], [12626, false]]) { sh.wrap = wrap; eq(met(h, sh).ok, good, `10 kHz +/- 100 Hz at wrap ${wrap}`); }
    sh.wrap = 12700;
    eq(met(h, sh).first.live, 'the frequency is 9.842 kHz. The goal is 10 kHz ± 100 Hz.', 'live: the status names the margin');
    eq(met(h, sh).first.blind, 'the frequency is not 10 kHz ± 100 Hz.', 'blind: the status names the margin');
    const ph = Widget.print(h);
    eq(ph.exercise && ph.exercise.answer[0].text, 'wrap = 12499: 10 kHz.', 'the answer with a margin is the exact one');
    const pe = {type: 'pwm', controls: ['wrap'], level: 1, goal: {period: '100 us +/- 1 us'}};
    const sp2 = settings(pe); sp2.wrap = 12600;
    ok(met(pe, sp2).ok, '100 us +/- 1 us accepts 100.8 µs', met(pe, sp2).first && met(pe, sp2).first.live);
  }
  // the three goals that cannot be reached
  for (const [c, re, what] of [
    [{type: 'pwm', controls: ['wrap', 'levels'], goal: {frequency: '1 kHz', duty: '50%'}}, /^goal: no setting gives 1 kHz: the lowest frequency with clkdiv 1 is 1\.907 kHz\. Add clkdiv to controls, or choose a higher frequency$/, 'below the lowest frequency'],
    [{type: 'pwm', controls: ['levels'], goal: {duty: '100%'}}, /^goal: 100 % needs a level of wrap \+ 1 = 65536, but the largest level is 65535\. Add wrap to controls$/, '100 % at a fixed wrap 65535'],
    [{type: 'pwm', wrap: 9, controls: ['levels'], goal: {duty: '25%'}}, /^goal: no level gives 25 % ± 0\.05 % on channel A at wrap 9 \(wrap is not a control\)$/, 'no level at a fixed wrap'],
  ]) {
    const out = Widget.print(c);
    ok(!out.exercise && out.warnings.some(w => re.test(w)), `unreachable: ${what}`, JSON.stringify(out.warnings));
    ok(!out.error && out.svg, `unreachable: ${what}: printed as a picture`);
  }
  {
    const c = {type: 'pwm', controls: ['wrap', 'levels', 'clkdiv'], goal: {frequency: '1 kHz', duty: '50%'}};
    const out = Widget.print(c), ex = out.exercise;
    ok(ex && met(c, readBack(c, ex)).ok, '1 kHz with clkdiv a control', ex && ex.answer[0].text);
    ok(ex && /^clkdiv = 2, wrap = 62499, level A = 31250/.test(ex.answer[0].text), 'whole dividers first', ex && ex.answer[0].text);
    ok(/One tick: Δt = clkdiv \/ 125 MHz/.test(out.svg) && /clkdiv = _+/.test(out.svg), 'the exercise with a divider: the tick in words, a blank for the divider');
  }
  // 100 random reachable goals: a frequency and a duty from a hidden setting
  for (let n = 0; n < 100; n++) {
    const useDiv = random() < 0.5, startDiv = useDiv ? 1 : ri(16, 4095) / 16;
    const div = useDiv ? ri(16, 4095) / 16 : startDiv;
    const wrap = ri(11, 65535), level = ri(Math.ceil(0.01 * (wrap + 1)), Math.floor(0.99 * (wrap + 1)));
    const f = 125e6 / (div * (wrap + 1)), duty = level / (wrap + 1);
    if (f < 2000 || f > 10e6) { n--; continue; }
    const c = {type: 'pwm', wrap: ri(0, 65535), level: ri(0, 65535), clkdiv: startDiv, controls: useDiv ? ['wrap', 'levels', 'clkdiv'] : ['wrap', 'levels'],
      goal: {frequency: `${Number(f.toPrecision(7))} Hz`, duty: `${Number((duty * 100).toFixed(4))}%`}};
    const out = Widget.print(c);
    if (!out.exercise) { failed.push(`random goal ${n}: ${JSON.stringify(c.goal)} ${JSON.stringify(out.warnings)}`); continue; }
    ok(met(c, readBack(c, out.exercise)).ok, `random goal ${n} read back`, out.exercise.answer[0].text);
  }
  // period, two channels, exact wrap and levels
  {
    const c = {type: 'pwm', controls: ['wrap', 'levels'], levels: {A: 0, B: 0}, goal: {period: '100 us +/- 1 us', duty: {A: '25%', B: '75%'}}};
    const ex = Widget.print(c).exercise;
    ok(ex && met(c, readBack(c, ex)).ok && /level B = 9375/.test(ex.answer[0].text), 'two channels and a period', ex && ex.answer[0].text);
    const w = {type: 'pwm', controls: ['wrap', 'levels'], goal: {wrap: 999, levels: {A: 250}}};
    const ew = Widget.print(w).exercise;
    eq(ew && ew.answer[0].text, 'wrap = 999, level A = 250.', 'exact wrap and level');
  }
  // brightness: on the website; in the PDF a picture, with no exercise and no numbers
  {
    const b = {type: 'pwm', wrap: 65535, level: 65535, controls: ['levels'], show: ['outputs', 'led', 'numbers'], goal: {brightness: '50%'}};
    const out = Widget.print(b);
    ok(!out.error && !out.exercise && out.svg, 'brightness: a picture, no exercise', JSON.stringify(out.warnings));
    eq(out.warnings.length, 0, 'brightness: no warning', JSON.stringify(out.warnings));
    ok(!/__________/.test(out.svg) && !/looks/.test(out.svg) && !/Duty A/.test(out.svg), 'brightness: nothing to fill in, no numbers');
    ok(/output A/.test(out.svg), 'brightness: the picture has the output');
    const st = settings(b); st.levels.A = 32768;
    ok(/looks brighter than that/.test(met(b, st).first.hint || ''), 'hint: 50 % on does not look half as bright', JSON.stringify(met(b, st).first));
    eq(met(b, st).first.blind, 'LED A looks too bright.', 'blind status of a brightness');
    const ans = I.pwmAnswer(b, settings(b), goalOf(b));
    ok(met(b, ans).ok && ans.levels.A > 0.17 * 65536 && ans.levels.A < 0.2 * 65536, 'looking half as bright is on about 18 % of the time', String(ans.levels.A));
    // a goal that cannot be reached is still reported
    const no = Widget.print({type: 'pwm', wrap: 1, level: 0, controls: ['levels'], goal: {brightness: '50%'}});
    ok(no.warnings.some(w => /^goal: /.test(w)), 'brightness: a goal that cannot be reached is reported', JSON.stringify(no.warnings));
  }
  // goals that are wrong
  for (const [goal, re] of [[{frequency: '10 kHz', period: '100 us'}, /frequency or a period, not both/], [{speed: 1}, /a goal has frequency, period/],
    [{duty: {B: '50%'}}, /channel B is not shown/], [{duty: '120%'}, /0 % … 100 %/], [{frequency: '10 khz'}, /is not a frequency/], ['scope', /a goal is decode/]]) {
    const out = Widget.print({type: 'pwm', controls: ['wrap', 'levels'], goal});
    ok(out.error ? re.test(out.error) : out.warnings.some(x => re.test(x)), `wrong goal ${JSON.stringify(goal)}`, JSON.stringify(out));
  }
  // decode
  {
    const c = {type: 'pwm', wrap: 4, levels: {A: 3}, goal: 'decode'};
    const out = Widget.print(c);
    eq(out.exercise && out.exercise.answer[0].text, 'wrap = 4, level A = 3: one period is 5 ticks (40 ns); A is high for 3 of them.', 'decode answer');
    ok(/wrap = __________/.test(out.svg) && /level A = __________/.test(out.svg), 'decode: fill-in lines in the PDF');
    ok(!/wrap = 4/.test(out.svg) && !/level A = 3/.test(out.svg), 'decode: the PDF does not give the answer away');
    ok(/One tick: Δt = 1 \/ 125 MHz = 8 ns/.test(out.svg), 'decode: the PDF gives the length of a tick');
    const st = settings(c);
    ok(I.pwmDecodeMet(st, {wrap: 4, levels: {A: 3}}).ok, 'decode: right');
    ok(/counter also counts 0/.test(I.pwmDecodeMet(st, {wrap: 5, levels: {A: 3}}).text), 'decode: hint for ticks instead of wrap');
    ok(/not counter ≤ level/.test(I.pwmDecodeMet(st, {wrap: 4, levels: {A: 2}}).text), 'decode: hint for ≤');
    const hi = settings({type: 'pwm', wrap: 3, levels: {A: 9}, goal: 'decode'});
    ok(I.pwmDecodeMet(hi, {wrap: 3, levels: {A: 4}}).ok, 'decode: any level above wrap is right for an output that is always high');
    ok(Widget.print({type: 'pwm', wrap: 3, goal: 'decode', controls: ['wrap']}).error, 'decode with controls is an error');
  }
  // the picture: a label for every line, the two sections
  {
    const out = Widget.print({type: 'pwm', wrap: 3, levels: {A: 1, B: 3}});
    for (const t of ['wrap = 3', 'level A = 1', 'level B = 3', 'output A', 'output B', 'counter']) ok(out.svg.includes(`>${t}<`), `the PDF has the label "${t}"`);
    ok(/SETTINGS/.test(out.svg) && /RESULT/.test(out.svg) && /class="cw-pwm-divider"/.test(out.svg), 'the PDF has the two sections');
    const one = Widget.print({type: 'pwm', wrap: 3, level: 1, show: ['outputs']});
    ok(!/SETTINGS|RESULT|class="cw-pwm-divider"/.test(one.svg), 'one section needs no headings');
    // labels that would touch are moved apart: level 1 at wrap 65535 is at the height of 0
    const close = Widget.print({type: 'pwm', wrap: 65535, levels: {A: 1, B: 2}});
    const ys = [...close.svg.matchAll(/y="([\d.]+)" class="cw-pwm-axis lab[^>]*>/g)].map(m => Number(m[1])).sort((a, b) => a - b);
    ok(ys.length >= 3 && ys.every((y, k) => !k || y - ys[k - 1] >= 11), 'labels are at least a line apart', ys.join(' '));
    const above = Widget.print({type: 'pwm', wrap: 3, level: 70});
    ok(/level A = 70</.test(above.svg) && /above wrap: always high/.test(above.svg), 'a level above wrap says what it does', above.error);
  }
  // every combination prints
  let printed = 0;
  for (const show of [['counter', 'outputs', 'numbers', 'code'], ['outputs'], ['counter'], ['numbers', 'code', 'led'], ['counter', 'outputs', 'numbers', 'code', 'led']]) {
    for (const wrap of [0, 1, 3, 31, 32, 65535]) {
      for (const levels of [{A: 0}, {A: 1, B: wrap}, {B: Math.min(wrap + 1, 65535)}, {A: 65535}]) {
        for (const goal of [undefined, {duty: {[Object.keys(levels)[0]]: '50%'}}, 'decode']) {
          const c = {type: 'pwm', wrap, levels, show, goal, periods: 1 + (printed % 8), controls: goal && goal !== 'decode' ? ['wrap', 'levels'] : []};
          if (goal === undefined) delete c.goal;
          const out = Widget.print(c);
          ok(!out.error && /^<svg/.test(out.svg) && out.width <= 724, `prints: ${JSON.stringify(c)}`, out.error);
          printed++;
        }
      }
    }
  }
  ok(Widget.print({type: 'pwm', wrap: 3, speed: 2}).warnings.includes('unknown setting "speed"'), 'unknown settings are reported');
  ok(Widget.print({type: 'pwm', wrap: 3, controls: ['duty']}).warnings.some(w => /unknown control "duty"/.test(w)), 'unknown controls are reported');

}

console.log(failed.length ? failed.map(f => `FAIL ${f}`).join('\n') : '');
console.log(`${passed} ok, ${failed.length} failed`);
if (failed.length) Deno.exit(1);
