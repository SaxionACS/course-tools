/*
 * Superloop: a short C program running against a timeline (course-tools; see
 * docs/superloop.md). A page writes it as a ```superloop block with YAML.
 *
 * This file runs in two places:
 * - in the browser, where it runs the program and draws the code, the board,
 *   the variables and the timeline (`mount`);
 * - at build time in Deno (print.js), where it checks every block and draws
 *   its form for the PDF with the same code: the program runs there too, with
 *   the block's script, in this sandboxed interpreter (no compiler, no I/O,
 *   a limit of statements).
 *
 * The program is C, as on the Pico: the sizes of the RP2040 with
 * arm-none-eabi-gcc (int and long 32 bits, int32_t is long, plain char is
 * unsigned), C's integer promotions and usual arithmetic conversions, and
 * undefined behaviour that stops the program (or, with
 * undefined_behavior: permit, does what a Release build on a Pico does).
 * It is compiled once to a small bytecode that can stop between any two
 * statements. Nothing here uses eval: the program reaches only its own data.
 */
(function (root) {
  'use strict';

  const hasDom = typeof document !== 'undefined';

  // ========================================================================
  // Types: the integers of the RP2040 (arm-none-eabi-gcc)
  // ========================================================================
  // rank as in C: bool < char < short < int < long < long long. 64-bit values are BigInt.
  const T = {};
  const defType = (key, name, bits, signed, rank, extra) =>
    (T[key] = Object.assign({k: 'int', name, bits, signed, rank, big: bits === 64}, extra));
  defType('bool', 'bool', 1, false, 0, {bool: true});
  defType('char', 'char', 8, false, 1);
  defType('schar', 'signed char', 8, true, 1);
  defType('uchar', 'unsigned char', 8, false, 1);
  defType('short', 'short', 16, true, 2);
  defType('ushort', 'unsigned short', 16, false, 2);
  defType('int', 'int', 32, true, 3);
  defType('uint', 'unsigned int', 32, false, 3);
  defType('long', 'long', 32, true, 4);
  defType('ulong', 'unsigned long', 32, false, 4);
  defType('llong', 'long long', 64, true, 5);
  defType('ullong', 'unsigned long long', 64, false, 5);
  T.void = {k: 'void', name: 'void'};
  const alias = (name, of, extra) => Object.assign({}, T[of], {name}, extra);
  const TYPEDEFS = {
    int8_t: alias('int8_t', 'schar'), uint8_t: alias('uint8_t', 'uchar'),
    int16_t: alias('int16_t', 'short'), uint16_t: alias('uint16_t', 'ushort'),
    int32_t: alias('int32_t', 'long'), uint32_t: alias('uint32_t', 'ulong'),
    int64_t: alias('int64_t', 'llong'), uint64_t: alias('uint64_t', 'ullong'),
    size_t: alias('size_t', 'uint'), uint: alias('uint', 'uint'),
    absolute_time_t: alias('absolute_time_t', 'ullong', {time: true}),
  };
  // the plain type of a typedef: the one the arithmetic uses
  const BASE = {};
  for (const t of Object.values(T)) if (t.k === 'int') BASE[`${t.rank}${t.signed}`] = t;
  const base = t => (t.bool ? T.bool : BASE[`${t.rank}${t.signed}`]);
  const promote = t => (t.rank < 3 ? T.int : base(t));
  // the usual arithmetic conversions
  function common(a, b) {
    a = promote(a); b = promote(b);
    if (a === b) return a;
    if (a.signed === b.signed) return a.rank >= b.rank ? a : b;
    const u = a.signed ? b : a, s = a.signed ? a : b;
    if (u.rank >= s.rank) return u;
    if (s.bits > u.bits) return s;
    return BASE[`${s.rank}false`];
  }
  const INT_MAX = 2147483647, INT_MIN = -2147483648;
  const I64_MAX = (1n << 63n) - 1n, I64_MIN = -(1n << 63n), U64_MAX = (1n << 64n) - 1n;
  const range = t => (t.bool ? [0n, 1n] : t.signed ? [-(1n << BigInt(t.bits - 1)), (1n << BigInt(t.bits - 1)) - 1n] : [0n, (1n << BigInt(t.bits)) - 1n]);

  // A value converted to type t (wraps; conversions to a signed type are
  // implementation-defined in C, and gcc wraps). Numbers for up to 32 bits, BigInt for 64.
  function convert(v, t) {
    if (t.bool) return v != 0 ? 1 : 0;
    if (t.big) { const b = typeof v === 'bigint' ? v : BigInt(v); return t.signed ? BigInt.asIntN(64, b) : BigInt.asUintN(64, b); }
    if (typeof v === 'bigint') v = Number(BigInt.asIntN(32, v));
    switch (t.bits) {
      case 32: return t.signed ? v | 0 : v >>> 0;
      case 16: return t.signed ? (v << 16) >> 16 : v & 0xffff;
      default: return t.signed ? (v << 24) >> 24 : v & 0xff;
    }
  }
  // does every value of `from` fit in `to` (so that converting changes nothing but, maybe, the JS type)?
  function fits(from, to) {
    if (to.bool) return !!from.bool;
    if (from.bool) return true;
    if (to.signed) return from.signed ? to.bits >= from.bits : to.bits > from.bits;
    return !from.signed && to.bits >= from.bits;
  }
  const zeroOf = t => (t.big ? 0n : 0);
  const typeName = t => t.name;

  // ========================================================================
  // Lexer
  // ========================================================================
  const KEYWORDS = new Set(['if', 'else', 'while', 'do', 'for', 'break', 'continue', 'return', 'switch', 'case', 'default',
    'goto', 'const', 'static', 'volatile', 'unsigned', 'signed', 'int', 'char', 'short', 'long', 'void', 'bool', '_Bool',
    'struct', 'union', 'enum', 'typedef', 'sizeof', 'extern', 'register', 'auto', 'inline', 'float', 'double']);
  const TYPE_WORDS = new Set(['const', 'static', 'volatile', 'unsigned', 'signed', 'int', 'char', 'short', 'long', 'void',
    'bool', '_Bool', 'struct', 'union', 'enum', 'typedef', 'extern', 'register', 'auto', 'inline', 'float', 'double']);
  const OPS = ['<<=', '>>=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=',
    '%=', '&=', '|=', '^=', '+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '<', '>', '=', '?', ':', ';', ',', '(', ')',
    '{', '}', '[', ']', '.'];
  const HEADERS = new Set(['pico/stdlib.h', 'stdio.h', 'stdint.h', 'stdbool.h', 'stdlib.h', 'limits.h', 'inttypes.h',
    'hardware/gpio.h', 'hardware/timer.h', 'pico/time.h']);

  class CError extends Error {
    constructor(msg, line, col) { super(line ? `Line ${line}${col ? `, column ${col}` : ''}: ${msg}` : msg); this.line = line; this.col = col; this.text = msg; }
  }

  // tokens: {k: 'id' | 'kw' | 'num' | 'char' | 'op' | 'eof', v, line, col, pos, end}; numbers also {value, suffix, radix}
  function lex(src) {
    const toks = [], includes = [], comments = [];
    let i = 0, line = 1, lineStart = 0;
    const at = () => ({line, col: i - lineStart + 1, pos: i});
    const fail = (msg, p) => { throw new CError(msg, (p || at()).line, (p || at()).col); };
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\n') { i++; line++; lineStart = i; continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') { i++; continue; }
      if (ch === '/' && src[i + 1] === '/') {
        const p = at(); let j = src.indexOf('\n', i); if (j < 0) j = src.length;
        comments.push({line: p.line, pos: i, end: j}); i = j; continue;
      }
      if (ch === '/' && src[i + 1] === '*') {
        const p = at(), j = src.indexOf('*/', i + 2);
        if (j < 0) fail('a comment /* is not closed with */', p);
        for (let k = i; k < j; k++) if (src[k] === '\n') { line++; lineStart = k + 1; }
        comments.push({line: p.line, pos: i, end: j + 2}); i = j + 2; continue;
      }
      if (ch === '#') {
        // a preprocessor line: only #include, and only at the start of a line
        const p = at();
        if (src.slice(lineStart, i).trim()) fail('# is only allowed at the start of a line', p);
        let j = src.indexOf('\n', i); if (j < 0) j = src.length;
        const text = src.slice(i, j).replace(/\/\/.*$/, '').trim();
        const m = /^#\s*include\s*([<"])([^>"]+)[>"]\s*$/.exec(text);
        if (m) includes.push({line: p.line, name: m[2], known: HEADERS.has(m[2]), pos: i, end: j});
        else {
          const d = (/^#\s*(\w+)/.exec(text) || [])[1];
          fail(d === 'define' ? '#define is not supported in this widget. Use a constant: const uint32_t DELAY_MS = 500;'
            : `#${d || ''} is not supported in this widget (only #include)`, p);
        }
        comments.push({line: p.line, pos: i, end: j, pp: true});
        i = j; continue;
      }
      const p = at();
      if (/[A-Za-z_]/.test(ch)) {
        let j = i + 1; while (j < src.length && /\w/.test(src[j])) j++;
        const v = src.slice(i, j);
        toks.push({k: KEYWORDS.has(v) ? 'kw' : 'id', v, line: p.line, col: p.col, pos: i, end: j}); i = j; continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+(\.[0-9]*)?([eE][+-]?[0-9]+)?|\.[0-9]+([eE][+-]?[0-9]+)?)([uUlLfF]*)/.exec(src.slice(i));
        let text = m[1], suffix = m[5];
        const j = i + m[0].length;
        if (/[\w.]/.test(src[j] || '')) fail(`"${src.slice(i, j + 1)}" is not a number`, p);
        if (m[2] !== undefined || m[3] || m[4] || /^\./.test(text) || /[fF]/.test(suffix))
          fail('floating-point numbers (float, double) are not supported in this widget yet', p);
        if (!/^(u?(l|ll)?|(l|ll)?u?)$/i.test(suffix) || /lL|Ll/.test(suffix)) fail(`"${suffix}" is not a suffix of a number (use u, l, ul, ll or ull)`, p);
        let radix = 10, value;
        if (/^0[xX]/.test(text)) { radix = 16; value = BigInt(text); }
        else if (/^0[bB]/.test(text)) { radix = 2; value = BigInt(text); }
        else if (/^0[0-9]/.test(text)) {
          if (/[89]/.test(text)) fail(`${text} starts with 0, so it is octal, and octal has no digits 8 and 9`, p);
          radix = 8; value = BigInt('0o' + text.slice(1));
        } else value = BigInt(text);
        toks.push({k: 'num', v: m[0], value, suffix: suffix.toLowerCase(), radix, line: p.line, col: p.col, pos: i, end: j});
        i = j; continue;
      }
      if (ch === "'") {
        let j = i + 1, value;
        if (src[j] === '\\') {
          const e = src[j + 1];
          const SIMPLE = {n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, '?': 63};
          if (e === 'x') { const m = /^[0-9a-fA-F]{1,2}/.exec(src.slice(j + 2)); if (!m) fail('\\x needs hexadecimal digits', p); value = parseInt(m[0], 16); j += 2 + m[0].length; }
          else if (/[0-7]/.test(e) && e !== '0' || (e === '0' && /[0-7]/.test(src[j + 2] || ''))) { const m = /^[0-7]{1,3}/.exec(src.slice(j + 1)); value = parseInt(m[0], 8) & 255; j += 1 + m[0].length; }
          else if (e in SIMPLE) { value = SIMPLE[e]; j += 2; }
          else fail(`'\\${e}' is not a character`, p);
        } else if (src[j] === "'" || src[j] === '\n' || j >= src.length) fail("a character needs something between the quotes, e.g. 'a'", p);
        else {
          const cp = src.codePointAt(j);
          if (cp > 127) fail(`'${String.fromCodePoint(cp)}' is not an ASCII character`, p);
          value = cp; j++;
        }
        if (src[j] !== "'") fail("a character is one letter between ' quotes", p);
        toks.push({k: 'char', v: src.slice(i, j + 1), value: BigInt(value), line: p.line, col: p.col, pos: i, end: j + 1});
        i = j + 1; continue;
      }
      if (ch === '"') fail('text in double quotes (strings) is not supported in this widget yet', p);
      const op = OPS.find(o => src.startsWith(o, i));
      if (!op) fail(`"${ch}" is not allowed in C here`, p);
      toks.push({k: 'op', v: op, line: p.line, col: p.col, pos: i, end: i + op.length});
      i += op.length;
    }
    toks.push({k: 'eof', v: 'the end of the program', line, col: i - lineStart + 1, pos: i, end: i});
    return {toks, includes, comments};
  }

  // ========================================================================
  // Parser: tokens -> syntax tree
  // ========================================================================
  // Expressions: {k: 'num' | 'id' | 'un' | 'pre' | 'post' | 'bin' | 'cond' | 'assign' | 'call' | 'cast' | 'comma', tok, ...}
  // Statements:  {k: 'expr' | 'decl' | 'block' | 'if' | 'while' | 'do' | 'for' | 'break' | 'continue' | 'return' | 'empty', tok, ...}
  const BINARY = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
  const PREC = {};
  BINARY.forEach((ops, k) => ops.forEach(o => (PREC[o] = k + 1)));
  const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=']);
  const UNSUPPORTED = {
    struct: 'struct is not supported in this widget yet', union: 'union is not supported in this widget',
    enum: 'enum is not supported in this widget yet', typedef: 'typedef is not supported in this widget yet',
    float: 'float is not supported in this widget yet', double: 'double is not supported in this widget yet',
    switch: 'switch is not supported in this widget yet', case: 'case is not supported in this widget yet',
    default: 'default is not supported in this widget yet', goto: 'goto is not supported in this widget',
    sizeof: 'sizeof is not supported in this widget yet',
  };

  function parse(src) {
    const {toks, includes, comments} = lex(src);
    let p = 0;
    const peek = (k = 0) => toks[Math.min(p + k, toks.length - 1)];
    const next = () => toks[p++];
    const fail = (msg, tok = peek()) => { throw new CError(msg, tok.line, tok.col); };
    const is = (v, k = 0) => { const t = peek(k); return (t.k === 'op' || t.k === 'kw') && t.v === v; };
    const accept = v => (is(v) ? next() : null);
    const expect = (v, what) => {
      if (is(v)) return next();
      const t = peek();
      if (v === ';') {
        // the most common mistake: point at the end of the line before
        const prev = toks[p - 1];
        if (prev && prev.line < t.line) throw new CError(`";" is missing at the end of the line`, prev.line, prev.col + (prev.end - prev.pos));
        fail(`";" is missing before "${t.v}"`);
      }
      fail(`${what || `"${v}"`} is missing${t.k === 'eof' ? ' at the end' : ` before "${t.v}"`}`);
    };
    const unsupported = t => { if (UNSUPPORTED[t.v]) fail(UNSUPPORTED[t.v], t); };
    const startsType = (k = 0) => {
      const t = peek(k);
      return (t.k === 'kw' && TYPE_WORDS.has(t.v)) || (t.k === 'id' && t.v in TYPEDEFS);
    };

    // type specifiers: unsigned long long, const uint32_t, static bool, ...
    function typeSpec() {
      const first = peek();
      let isConst = false, isStatic = false, sign = null, size = null, longs = 0, name = null, words = 0;
      for (;;) {
        const t = peek();
        if (t.k === 'kw' && UNSUPPORTED[t.v]) unsupported(t);
        if (t.k === 'kw' && ['extern', 'register', 'auto', 'inline'].includes(t.v)) fail(`${t.v} is not supported in this widget`, t);
        if (is('const')) { next(); isConst = true; continue; }
        if (is('volatile')) { next(); continue; }
        if (is('static')) { next(); isStatic = true; continue; }
        if (is('unsigned') || is('signed')) { if (sign) fail(`"${t.v}" twice`, t); sign = next().v; words++; continue; }
        if (is('long')) { next(); longs++; words++; if (longs > 2) fail('long long long is too long', t); continue; }
        if (is('short') || is('char') || is('int') || is('void') || is('bool') || is('_Bool')) {
          if (size && !(size === 'int' || t.v === 'int')) fail(`"${size} ${t.v}" is not a type`, t);
          if (!size || size === 'int') size = next().v; else next();
          words++; continue;
        }
        if (t.k === 'id' && t.v in TYPEDEFS && !name && !size && !sign && !longs) { name = next().v; words++; continue; }
        break;
      }
      if (!words) fail(`a type is missing, e.g. int or uint32_t, before "${peek().v}"`, first);
      let type;
      if (name) type = TYPEDEFS[name];
      else if (size === 'void') { if (sign || longs) fail('void cannot be signed, unsigned or long', first); type = T.void; }
      else if (size === 'bool' || size === '_Bool') { if (sign || longs) fail('bool cannot be signed, unsigned or long', first); type = T.bool; }
      else if (size === 'char') { if (longs) fail('long char is not a type', first); type = sign === 'signed' ? T.schar : sign === 'unsigned' ? T.uchar : T.char; }
      else if (size === 'short') { if (longs) fail('long short is not a type', first); type = sign === 'unsigned' ? T.ushort : T.short; }
      else if (longs === 2) type = sign === 'unsigned' ? T.ullong : T.llong;
      else if (longs === 1) type = sign === 'unsigned' ? T.ulong : T.long;
      else type = sign === 'unsigned' ? T.uint : T.int;
      return {type, isConst, isStatic, tok: first};
    }
    function declarator() {
      if (is('*')) fail('pointers are not supported in this widget');
      const t = next();
      if (t.k !== 'id') fail(t.k === 'kw' ? `"${t.v}" is a word of C and cannot be a name` : `a name is missing before "${t.v}"`, t);
      if (is('[')) fail('arrays are not supported in this widget yet');
      return t;
    }

    function primary() {
      const t = next();
      if (t.k === 'num') return {k: 'num', tok: t};
      if (t.k === 'char') return {k: 'num', tok: t, char: true};
      if (t.k === 'id') return {k: 'id', name: t.v, tok: t};
      if (t.k === 'op' && t.v === '(') {
        const e = expression();
        expect(')', 'a ")"');
        return e;
      }
      if (t.k === 'kw') { unsupported(t); fail(`"${t.v}" cannot be used in an expression`, t); }
      fail(t.k === 'eof' ? 'the program stops in the middle of an expression' : `"${t.v}" is not expected here`, t);
    }
    function postfix() {
      let e = primary();
      for (;;) {
        if (is('(')) {
          const t = next();
          if (e.k !== 'id') fail('only a function name can be called', t);
          const args = [];
          if (!is(')')) do args.push(assignment()); while (accept(','));
          expect(')', 'a ")" after the arguments');
          e = {k: 'call', name: e.name, args, tok: e.tok};
        } else if (is('++') || is('--')) e = {k: 'post', op: next().v, a: e, tok: e.tok};
        else if (is('[')) fail('arrays are not supported in this widget yet');
        else if (is('.') || is('->')) fail('struct is not supported in this widget yet');
        else return e;
      }
    }
    function unary() {
      const t = peek();
      if (is('++') || is('--')) { next(); return {k: 'pre', op: t.v, a: unary(), tok: t}; }
      if (is('-') || is('+') || is('!') || is('~')) { next(); return {k: 'un', op: t.v, a: unary(), tok: t}; }
      if (is('*') || is('&')) fail(`pointers are not supported in this widget (${t.v} in front of a name)`);
      if (is('sizeof')) unsupported(t);
      if (is('(') && startsType(1)) {
        next();
        const {type, tok} = typeSpec();
        if (is('*')) fail('pointers are not supported in this widget');
        expect(')', 'a ")" after the type');
        return {k: 'cast', type, a: unary(), tok: tok || t};
      }
      return postfix();
    }
    function binary(min) {
      let left = unary();
      for (;;) {
        const t = peek();
        const prec = t.k === 'op' ? PREC[t.v] : undefined;
        if (!prec || prec < min) return left;
        next();
        left = {k: 'bin', op: t.v, a: left, b: binary(prec + 1), tok: t};
      }
    }
    function conditional() {
      const c = binary(1);
      if (!is('?')) return c;
      const t = next();
      const a = expression();
      expect(':', 'the ":" of ? :');
      return {k: 'cond', c, a, b: conditional(), tok: t};
    }
    function assignment() {
      const left = conditional();
      const t = peek();
      if (t.k === 'op' && ASSIGN.has(t.v)) { next(); return {k: 'assign', op: t.v, a: left, b: assignment(), tok: t}; }
      return left;
    }
    function expression() {
      let e = assignment();
      while (is(',')) { const t = next(); e = {k: 'comma', a: e, b: assignment(), tok: t}; }
      return e;
    }

    // a declaration after its type: int a = 1, b;
    function declRest(spec, first) {
      const decls = [];
      let name = first;
      for (;;) {
        if (spec.type.k === 'void') fail(`a variable cannot be void: ${name.v}`, name);
        let init = null, span = null;
        if (accept('=')) {
          if (is('{')) fail('{ … } initialisers are not supported in this widget yet');
          const from = peek().pos;
          init = assignment();
          span = [from, toks[p - 1].end];
        }
        decls.push({name: name.v, tok: name, type: spec.type, isConst: spec.isConst, isStatic: spec.isStatic, init, span});
        if (!accept(',')) break;
        name = declarator();
      }
      expect(';');
      return {k: 'decl', decls, tok: spec.tok};
    }
    function statement() {
      const t = peek();
      if (t.k === 'kw') unsupported(t);
      if (startsType()) {
        const spec = typeSpec();
        const name = declarator();
        if (is('(')) fail('a function cannot be defined inside another function', name);
        return declRest(spec, name);
      }
      if (accept('{')) {
        const body = [];
        while (!is('}')) { if (peek().k === 'eof') fail('a "}" is missing at the end', t); body.push(statement()); }
        const close = next();
        return {k: 'block', body, tok: t, close};
      }
      if (accept(';')) return {k: 'empty', tok: t};
      if (accept('if')) {
        expect('(', 'a "(" after if'); const c = expression(); expect(')', 'a ")" after the condition');
        const a = statement();
        const b = accept('else') ? statement() : null;
        return {k: 'if', c, a, b, tok: t};
      }
      if (accept('while')) {
        expect('(', 'a "(" after while'); const c = expression(); expect(')', 'a ")" after the condition');
        return {k: 'while', c, body: statement(), tok: t};
      }
      if (accept('do')) {
        const body = statement();
        const w = expect('while', 'the "while" of do … while');
        expect('(', 'a "(" after while'); const c = expression(); expect(')', 'a ")" after the condition'); expect(';');
        return {k: 'do', body, c, tok: t, ctok: w};
      }
      if (accept('for')) {
        expect('(', 'a "(" after for');
        let init = null;
        if (startsType()) { const spec = typeSpec(); init = declRest(spec, declarator()); }
        else if (!accept(';')) { const it = peek(); init = {k: 'expr', e: expression(), tok: it}; expect(';'); }
        const ctok = peek();
        const c = is(';') ? null : expression();
        expect(';');
        const stok = peek();
        const step = is(')') ? null : expression();
        expect(')', 'a ")" after for (…)');
        return {k: 'for', init, c, ctok, step, stok, body: statement(), tok: t};
      }
      if (accept('break')) { expect(';'); return {k: 'break', tok: t}; }
      if (accept('continue')) { expect(';'); return {k: 'continue', tok: t}; }
      if (accept('return')) {
        const e = is(';') ? null : expression();
        expect(';');
        return {k: 'return', e, tok: t};
      }
      if (t.k === 'eof') fail('a statement is missing at the end', t);
      if (t.k === 'op' && t.v === '}') fail('this "}" has no "{"', t);
      const e = expression();
      expect(';');
      return {k: 'expr', e, tok: t};
    }

    // the whole text: functions, declarations and (in a fragment) statements
    const functions = [], globals = [], statements = [], items = [];
    while (peek().k !== 'eof') {
      const from = peek().pos, n0 = functions.length + statements.length;
      const done = kind => items.push({kind, span: [from, toks[p - 1].end], node: kind === 'function' ? functions[functions.length - 1] : statements[statements.length - 1]});
      if (startsType()) {
        const spec = typeSpec();
        const name = declarator();
        if (is('(')) {
          next();
          const params = [];
          if (is('void') && peek(1).k === 'op' && peek(1).v === ')') next();
          else if (!is(')')) {
            do {
              const ps = typeSpec();
              if (ps.type.k === 'void') fail('a parameter cannot be void', ps.tok);
              const pn = declarator();
              params.push({name: pn.v, tok: pn, type: ps.type, isConst: ps.isConst});
            } while (accept(','));
          }
          expect(')', 'a ")" after the parameters');
          if (accept(';')) { functions.push({name: name.v, tok: name, ret: spec.type, params, proto: true}); done('function'); continue; }
          if (!is('{')) fail(`a "{" is missing: the body of ${name.v}()`);
          const body = statement();
          functions.push({name: name.v, tok: name, ret: spec.type, params, body, isStatic: spec.isStatic});
          done('function');
          continue;
        }
        const d = declRest(spec, name);
        globals.push(d);
        statements.push(d);   // in a fragment, a declaration with a value that needs running runs here
        done('decl');
        continue;
      }
      statements.push(statement());
      done('statement');
      void n0;
    }
    return {functions, globals, statements, items, includes, comments, toks};
  }

  // ========================================================================
  // Compiler: syntax tree -> bytecode, with C's types
  // ========================================================================
  // Instructions are objects {op, a, f, line, ...} of one shape; the machine
  // switches on op. Arithmetic is a closure per type, chosen here, so the
  // machine does not look at types while it runs.
  const OP = {STMT: 1, CONST: 2, LOADG: 3, LOADL: 4, STOREG: 5, STOREL: 6, DECL: 7, CONV: 8, UN: 9, BIN: 10, POP: 11,
    DUP: 12, JMP: 13, JZ: 14, JNZ: 15, CALL: 16, RET: 17, RETEND: 18, SDK: 19, ITER: 20, HALT: 21, SWAP: 22};

  // The machine that runs now: the arithmetic reports undefined behaviour to it.
  let CUR = null;
  const ub = (ins, kind, msg, permitValue) => CUR.ub(ins, kind, msg, permitValue);

  const fmt = v => String(v);
  const kindOf = t => (t.big ? (t.signed ? 'i64' : 'u64') : (t.signed ? 'i32' : 'u32'));

  // ARM's 32-bit shifts use the low byte of the count: 32 or more gives 0 (or the sign)
  const lsl32 = (x, n) => { n &= 255; return n >= 32 ? 0 : (x << n) >>> 0; };
  const lsr32 = (x, n) => { n &= 255; return n >= 32 ? 0 : (x >>> 0) >>> n; };
  const asr32 = (x, n) => { n &= 255; return n >= 32 ? ((x | 0) < 0 ? -1 : 0) : (x | 0) >> n; };
  // 64-bit shifts as gcc compiles them for the Cortex-M0+ (checked on a Pico)
  function shift64(v, n, op, signed) {
    const lo = Number(BigInt.asUintN(32, v)), hi = Number(BigInt.asUintN(32, v >> 32n));
    let rlo, rhi;
    n |= 0;
    if (op === '<<') {
      if (n - 32 >= 0) { rhi = lsl32(lo, n - 32); rlo = lsl32(lo, n); }
      else { rhi = (lsl32(hi, n) + lsr32(lo, 32 - n)) >>> 0; rlo = lsl32(lo, n); }
    } else if (n - 32 >= 0) { rlo = signed ? asr32(hi, n - 32) >>> 0 : lsr32(hi, n - 32); rhi = signed ? asr32(hi, n) >>> 0 : lsr32(hi, n); }
    else { rlo = (lsl32(hi, 32 - n) + lsr32(lo, n)) >>> 0; rhi = signed ? asr32(hi, n) >>> 0 : lsr32(hi, n); }
    const r = (BigInt(rhi) << 32n) | BigInt(rlo);
    return signed ? BigInt.asIntN(64, r) : r;
  }

  // the operation `op` on two values of the (promoted) type t; `hint` ({explain, fix}) explains a promotion in messages
  function binaryOp(op, t, hint = {}) {
    const k = kindOf(t), tn = typeName(t);
    const over = (ins, a, b, wrapped) => ub(ins, 'overflow',
      `${fmt(a)} ${op} ${fmt(b)} does not fit in ${/^[aeiou]/.test(tn) ? 'an' : 'a'} ${tn}${hint.explain || ''}. Signed overflow is undefined behaviour in C${hint.fix ? `. ${hint.fix}` : ''}`, wrapped);
    switch (op) {
      case '+': case '-': case '*': {
        if (k === 'u32') return op === '+' ? (a, b) => (a + b) >>> 0 : op === '-' ? (a, b) => (a - b) >>> 0 : (a, b) => Math.imul(a, b) >>> 0;
        if (k === 'u64') return op === '+' ? (a, b) => BigInt.asUintN(64, a + b) : op === '-' ? (a, b) => BigInt.asUintN(64, a - b) : (a, b) => BigInt.asUintN(64, a * b);
        if (k === 'i32') {
          if (op === '*') return (a, b, ins) => { const r = a * b; return (r > INT_MAX || r < INT_MIN || !Number.isSafeInteger(r)) ? over(ins, a, b, Math.imul(a, b)) : r + 0; };
          return op === '+' ? (a, b, ins) => { const r = a + b; return (r > INT_MAX || r < INT_MIN) ? over(ins, a, b, r | 0) : r; }
            : (a, b, ins) => { const r = a - b; return (r > INT_MAX || r < INT_MIN) ? over(ins, a, b, r | 0) : r; };
        }
        const f = op === '+' ? (a, b) => a + b : op === '-' ? (a, b) => a - b : (a, b) => a * b;
        return (a, b, ins) => { const r = f(a, b); return (r > I64_MAX || r < I64_MIN) ? over(ins, a, b, BigInt.asIntN(64, r)) : r; };
      }
      case '/': case '%': {
        const div = op === '/';
        const big = t.big, zero = big ? 0n : 0;
        const [min, max] = t.signed ? (big ? [I64_MIN, I64_MAX] : [INT_MIN, INT_MAX]) : [zero, big ? U64_MAX : 4294967295];
        // what the Pico SDK's divider returns for x / 0 and x % 0
        const byZero = a => (!div ? zero : a == 0 ? zero : t.signed ? (a > 0 ? max : min) : max);
        const q = big ? (a, b) => (div ? a / b : a % b) : (div ? (a, b) => Math.trunc(a / b) : (a, b) => a % b);
        return (a, b, ins) => {
          if (b == 0) return ub(ins, 'div0', `${div ? 'division' : 'remainder'} by zero (${fmt(a)} ${op} 0). This is undefined behaviour in C`, byZero(a));
          if (t.signed && a === min && b == -1) return ub(ins, 'overflow', `${fmt(a)} ${op} -1 does not fit in ${/^[aeiou]/.test(tn) ? 'an' : 'a'} ${tn}. This is undefined behaviour in C`, div ? min : zero);
          const r = q(a, b);
          return big ? r : r + 0;   // + 0: no -0
        };
      }
      case '&': return k === 'i32' ? (a, b) => a & b : k === 'u32' ? (a, b) => (a & b) >>> 0 : (a, b) => a & b;
      case '|': return k === 'i32' ? (a, b) => a | b : k === 'u32' ? (a, b) => (a | b) >>> 0 : (a, b) => a | b;
      case '^': return k === 'i32' ? (a, b) => a ^ b : k === 'u32' ? (a, b) => (a ^ b) >>> 0 : (a, b) => a ^ b;
      case '==': return (a, b) => (a == b ? 1 : 0);
      case '!=': return (a, b) => (a != b ? 1 : 0);
      case '<': return (a, b) => (a < b ? 1 : 0);
      case '>': return (a, b) => (a > b ? 1 : 0);
      case '<=': return (a, b) => (a <= b ? 1 : 0);
      case '>=': return (a, b) => (a >= b ? 1 : 0);
    }
    throw new Error(`no operation ${op}`);
  }
  // << and >>: t is the promoted type of the left operand; the count is any integer
  function shiftOp(op, t) {
    const w = t.big ? 64 : 32, tn = typeName(t), signed = t.signed;
    const a1 = /^[aeiou]/.test(tn) ? 'an' : 'a';
    return (a, b, ins) => {
      const n = Number(b);
      let bad = null;
      if (n < 0) bad = `${fmt(a)} ${op} ${n} shifts by a negative number`;
      else if (n >= w) bad = `${fmt(a)} ${op} ${n} shifts by ${n}, but ${a1} ${tn} has only ${w} bits`;
      else if (op === '<<' && signed) {
        if (a < 0) bad = `${fmt(a)} << ${n} shifts a negative number to the left`;
        else if ((t.big ? a << BigInt(n) : a * 2 ** n) > (t.big ? I64_MAX : INT_MAX))
          bad = `${fmt(a)} << ${n} shifts a 1 into or past the sign bit of ${a1} ${tn}${n + (t.big ? 0 : 0) === w - 1 && a == 1 ? `. Write ${fmt(a)}u << ${n}` : ''}`;
      }
      let r;
      if (t.big) r = shift64(a, n, op, signed);
      else if (op === '<<') r = signed ? lsl32(a, n) | 0 : lsl32(a, n);
      else r = signed ? asr32(a, n) : lsr32(a, n);
      if (bad) return ub(ins, 'shift', `${bad}. This is undefined behaviour in C`, r);
      return r;
    };
  }
  function unaryOp(op, t) {
    const k = kindOf(t), tn = typeName(t);
    if (op === '-') {
      if (k === 'u32') return a => (-a) >>> 0;
      if (k === 'u64') return a => BigInt.asUintN(64, -a);
      const min = k === 'i32' ? INT_MIN : I64_MIN;
      return (a, ins) => (a === min ? ub(ins, 'overflow', `-(${fmt(a)}) does not fit in ${/^[aeiou]/.test(tn) ? 'an' : 'a'} ${tn}. Signed overflow is undefined behaviour in C`, a) : (k === 'i32' ? -a + 0 : -a));
    }
    if (op === '~') return k === 'i32' ? a => ~a : k === 'u32' ? a => (~a) >>> 0 : k === 'i64' ? a => BigInt.asIntN(64, ~a) : a => BigInt.asUintN(64, ~a);
    if (op === '!') return a => (a == 0 ? 1 : 0);
    throw new Error(`no operation ${op}`);
  }
  const convOp = t => v => convert(v, t);

  // a literal's type, as C chooses it
  function literalType(tok) {
    if (tok.k === 'char') return T.int;
    const v = tok.value, s = tok.suffix, dec = tok.radix === 10;
    const u = s.includes('u'), l = (s.match(/l/g) || []).length;
    let cands;
    if (l === 2) cands = u ? [T.ullong] : dec ? [T.llong] : [T.llong, T.ullong];
    else if (l === 1) cands = u ? [T.ulong, T.ullong] : dec ? [T.long, T.llong] : [T.long, T.ulong, T.llong, T.ullong];
    else cands = u ? [T.uint, T.ulong, T.ullong] : dec ? [T.int, T.long, T.llong] : [T.int, T.uint, T.long, T.ulong, T.llong, T.ullong];
    const t = cands.find(c => v <= range(c)[1]);
    if (!t) throw new CError(`${tok.v} is too large for any integer type`, tok.line, tok.col);
    return t;
  }

  // The functions of the Pico SDK the widget knows; `run` gets the machine and the arguments.
  // Their behaviour is in the machine (sdk*), as on a Pico.
  const ty = n => T[n] || TYPEDEFS[n];
  const SDK = {
    stdio_init_all: {ret: 'void', params: []},
    gpio_init: {ret: 'void', params: ['uint']},
    gpio_set_dir: {ret: 'void', params: ['uint', 'bool']},
    gpio_put: {ret: 'void', params: ['uint', 'bool']},
    gpio_get: {ret: 'bool', params: ['uint']},
    gpio_pull_up: {ret: 'void', params: ['uint']},
    gpio_pull_down: {ret: 'void', params: ['uint']},
    gpio_disable_pulls: {ret: 'void', params: ['uint']},
    sleep_ms: {ret: 'void', params: ['uint32_t'], ms: 1},
    sleep_us: {ret: 'void', params: ['uint64_t'], ms: 0.001},
    busy_wait_ms: {ret: 'void', params: ['uint32_t'], ms: 1},
    busy_wait_us: {ret: 'void', params: ['uint64_t'], ms: 0.001},
    busy_wait_us_32: {ret: 'void', params: ['uint32_t'], ms: 0.001},
    tight_loop_contents: {ret: 'void', params: []},
    get_absolute_time: {ret: 'absolute_time_t', params: []},
    to_us_since_boot: {ret: 'uint64_t', params: ['absolute_time_t']},
    time_us_64: {ret: 'uint64_t', params: []},
    time_us_32: {ret: 'uint32_t', params: []},
    make_timeout_time_ms: {ret: 'absolute_time_t', params: ['uint32_t'], ms: 1},
    make_timeout_time_us: {ret: 'absolute_time_t', params: ['uint64_t'], ms: 0.001},
    delayed_by_ms: {ret: 'absolute_time_t', params: ['absolute_time_t', 'uint32_t']},
    delayed_by_us: {ret: 'absolute_time_t', params: ['absolute_time_t', 'uint64_t']},
    time_reached: {ret: 'bool', params: ['absolute_time_t']},
    absolute_time_diff_us: {ret: 'int64_t', params: ['absolute_time_t', 'absolute_time_t']},
  };
  // constants of the SDK and the C library (macros and enum values in C)
  const CONSTS = {
    true: [T.int, 1], false: [T.int, 0], GPIO_OUT: [T.int, 1], GPIO_IN: [T.int, 0],
    nil_time: [TYPEDEFS.absolute_time_t, 0n], at_the_end_of_time: [TYPEDEFS.absolute_time_t, I64_MAX],
    INT_MAX: [T.int, INT_MAX], INT_MIN: [T.int, INT_MIN], UINT_MAX: [T.uint, 4294967295],
    INT8_MAX: [T.int, 127], INT8_MIN: [T.int, -128], UINT8_MAX: [T.int, 255],
    INT16_MAX: [T.int, 32767], INT16_MIN: [T.int, -32768], UINT16_MAX: [T.int, 65535],
    INT32_MAX: [T.long, INT_MAX], INT32_MIN: [T.long, INT_MIN], UINT32_MAX: [T.ulong, 4294967295],
    INT64_MAX: [T.llong, I64_MAX], INT64_MIN: [T.llong, I64_MIN], UINT64_MAX: [T.ullong, U64_MAX],
  };

  /*
   * compile(src, {devices}) -> program
   *   devices: [{name, gpio}] pin constants the widget declares (before the code)
   * A program: {code, lines, globals (initial values), symbols, main, ...}. Throws CError.
   */
  function compile(src, opts = {}) {
    const ast = parse(src);
    const code = [];
    const emit = (op, props) => { const ins = Object.assign({op, a: 0, f: null, line: 0, n: 0, v: undefined, track: null}, props); code.push(ins); return ins; };
    const here = () => code.length;
    const fail = (msg, tok) => { throw new CError(msg, tok && tok.line, tok && tok.col); };
    const warnings = [];

    // --- symbols ------------------------------------------------------------
    const globalScope = new Map();
    const globals = [];          // {name, type, isConst, value, decl}
    const functions = new Map(); // name -> {name, ret, params, entry, nslots, ...}
    const sdkTimes = [];         // ms values in sleep_ms(…), make_timeout_time_ms(…): for the speed buttons
    for (const d of opts.devices || []) {
      const sym = {kind: 'var', global: true, slot: globals.length, type: TYPEDEFS.uint, isConst: true, name: d.name, device: true, constValue: d.gpio};
      globals.push({name: d.name, type: TYPEDEFS.uint, isConst: true, value: d.gpio, sym});
      globalScope.set(d.name, sym);
    }
    const hasMain = ast.functions.some(f => f.name === 'main' && !f.proto);
    if (hasMain) {
      const stray = ast.statements.find(s => s.k !== 'decl');
      if (stray) fail('this statement is outside a function. With a main(), statements belong inside it', stray.tok);
    }

    // a constant value known now (literals, consts with known values, arithmetic), or undefined
    function constValue(e) {
      try {
        if (e.k === 'num') return {t: literalType(e.tok), v: convert(e.tok.value, literalType(e.tok))};
        if (e.k === 'id') {
          const s = globalScope.get(e.name);
          if (s && s.kind === 'var' && s.isConst && s.constValue !== undefined) return {t: s.type, v: s.constValue};
          if (!s && e.name in CONSTS) return {t: CONSTS[e.name][0], v: convert(CONSTS[e.name][1], CONSTS[e.name][0])};
          return undefined;
        }
        if (e.k === 'un') { const a = constValue(e.a); if (!a) return; const t = e.op === '!' ? T.int : promote(a.t); return {t, v: unaryOp(e.op, t)(convert(a.v, t), {})}; }
        if (e.k === 'cast') { const a = constValue(e.a); return a && {t: e.type, v: convert(a.v, e.type)}; }
        if (e.k === 'bin' && !['&&', '||'].includes(e.op)) {
          const a = constValue(e.a), b = constValue(e.b);
          if (!a || !b) return;
          if (e.op === '<<' || e.op === '>>') { const t = promote(a.t); return {t, v: shiftOp(e.op, t)(convert(a.v, t), b.v, {})}; }
          const t = common(a.t, b.t);
          const r = binaryOp(e.op, t)(convert(a.v, t), convert(b.v, t), {});
          return {t: ['==', '!=', '<', '>', '<=', '>='].includes(e.op) ? T.int : t, v: r};
        }
      } catch (err) { return undefined; }   // undefined behaviour while folding: leave it to the run
      return undefined;
    }

    // --- globals: declarations at the top level ------------------------------
    const initLater = new Set();   // fragment declarations whose value is computed when main runs there
    for (const d of ast.globals) {
      for (const v of d.decls) {
        if (globalScope.has(v.name)) {
          const old = globalScope.get(v.name);
          fail(old.device ? `${v.name} is a pin the widget declares (GP${old.constValue}). Declare it in the code with a value (const uint ${v.name} = ${old.constValue};), or leave it out`
            : `${v.name} is declared twice`, v.tok);
        }
        if (v.name in SDK) fail(`${v.name} is a function of the Pico SDK, not a name for a variable`, v.tok);
        let value = zeroOf(v.type);
        if (v.init) {
          const c = constValue(v.init);
          if (c) value = convert(c.v, v.type);
          else if (hasMain) fail(`the value of the global ${v.name} must be known before the program runs (in C, a global needs a constant)`, v.init.tok);
          else initLater.add(v);
        } else if (v.isConst) fail(`${v.name} is const, so it needs a value: const … ${v.name} = …;`, v.tok);
        const sym = {kind: 'var', global: true, slot: globals.length, type: v.type, isConst: v.isConst, name: v.name, decl: v,
          constValue: v.isConst && !initLater.has(v) ? value : undefined};
        globals.push({name: v.name, type: v.type, isConst: v.isConst, value, sym, line: v.tok.line, literal: v.init && v.init.k === 'num' ? v.init.tok : null});
        globalScope.set(v.name, sym);
      }
    }
    for (const f of ast.functions) {
      if (globalScope.has(f.name)) fail(`${f.name} is declared twice`, f.tok);
      if (f.name in SDK) fail(`${f.name} is a function of the Pico SDK; give your function another name`, f.tok);
      const old = functions.get(f.name);
      if (old && !old.proto && !f.proto) fail(`the function ${f.name}() is defined twice`, f.tok);
      if (old && (old.params.length !== f.params.length || old.ret !== f.ret)) fail(`${f.name}() is declared twice in different ways`, f.tok);
      if (f.name === 'main' && f.params.length) fail('main() takes no parameters in this widget: int main(void)', f.tok);
    }

    // --- functions and statements ----------------------------------------------
    let fn = null;            // the function being compiled
    let scopes = [];          // local scopes: Map name -> sym
    let loops = [];           // {breaks: [], continues: [], cont}
    const declared = new Set();
    const lookup = name => {
      for (let k = scopes.length - 1; k >= 0; k--) if (scopes[k].has(name)) return scopes[k].get(name);
      return globalScope.get(name);
    };
    const newLocal = (v, type, isConst) => {
      if (scopes[scopes.length - 1].has(v.name)) fail(`${v.name} is declared twice here`, v.tok);
      if (v.name in SDK || functions.has(v.name)) fail(`${v.name} is a function, not a name for a variable`, v.tok);
      const sym = {kind: 'var', global: false, slot: fn.nslots++, type, isConst, name: v.name, fn, decl: v};
      scopes[scopes.length - 1].set(v.name, sym);
      fn.locals.push(sym);
      return sym;
    };

    const conv = (from, to) => { if (to.k === 'void') return; if (!(fits(from, to) && !!from.big === !!to.big)) emit(OP.CONV, {f: convOp(to)}); };
    const stmt = tok => emit(OP.STMT, {line: tok.line, unseq: null});
    const isScalar = t => t.k === 'int';
    function load(sym, tok) { emit(sym.global ? OP.LOADG : OP.LOADL, {a: sym.slot, line: tok.line, sym}); }
    function store(sym, tok) { emit(sym.global ? OP.STOREG : OP.STOREL, {a: sym.slot, line: tok.line, sym}); }
    function lvalue(e, what) {
      if (e.k !== 'id') fail(`${what} needs a variable on its left`, e.tok);
      const sym = lookup(e.name);
      if (!sym) fail(`${e.name} is not declared`, e.tok);
      if (sym.kind !== 'var') fail(`${e.name} is not a variable`, e.tok);
      if (sym.isConst) fail(`${e.name} is a constant (const); it cannot be changed`, e.tok);
      return sym;
    }
    // "(uint16_t values become int before the multiplication) … Write (uint32_t)width * height": promotions that surprise
    function promotionHint(e, ta, tb) {
      const small = [ta, tb].find(t => t.rank < 3 && !t.bool && !t.signed);
      if (!small || !['+', '-', '*'].includes(e.op)) return {};
      const what = e.op === '*' ? 'multiplication' : e.op === '+' ? 'addition' : 'subtraction';
      const names = e.a && e.b && e.a.k === 'id' && e.b.k === 'id';
      return {explain: ` (${small.name} values become int before the ${what})`,
        fix: names ? `Write (uint32_t)${e.a.name} ${e.op} ${e.b.name}` : 'Make one of them uint32_t first, e.g. with a cast: (uint32_t)'};
    }

    // expression -> code that leaves its value on the stack; returns its type
    function ex(e, used = true) {
      switch (e.k) {
        case 'num': { const t = literalType(e.tok); emit(OP.CONST, {v: convert(e.tok.value, t)}); return t; }
        case 'id': {
          const sym = lookup(e.name);
          if (sym && sym.kind === 'var') { load(sym, e.tok); return sym.type; }
          if (!sym && e.name in CONSTS) { const [t, v] = CONSTS[e.name]; emit(OP.CONST, {v: convert(v, t)}); return t; }
          if (functions.has(e.name) || e.name in SDK) fail(`${e.name} is a function: call it with ( ), e.g. ${e.name}()`, e.tok);
          fail(`${e.name} is not declared`, e.tok);
        }
        case 'un': {
          const ta = ex(e.a);
          if (!isScalar(ta)) fail(`${e.op} needs a number`, e.tok);
          if (e.op === '!') { emit(OP.UN, {f: unaryOp('!', ta)}); return T.int; }
          const t = promote(ta);
          conv(ta, t);
          if (e.op !== '+') emit(OP.UN, {f: unaryOp(e.op, t), line: e.tok.line});
          return t;
        }
        case 'pre': case 'post': {
          const sym = lvalue(e.a, e.op);
          const t = sym.type, ct = promote(t);
          load(sym, e.a.tok);
          if (e.k === 'post' && used) emit(OP.DUP);
          conv(t, ct);
          emit(OP.CONST, {v: convert(1, ct)});
          emit(OP.BIN, {f: binaryOp(e.op === '++' ? '+' : '-', ct), line: e.tok.line});
          conv(ct, t);
          store(sym, e.a.tok);
          if (e.k === 'post' && used) emit(OP.POP);
          else if (!used) emit(OP.POP);
          if (!used && e.k === 'post') return t;   // nothing left on the stack: the caller knows (used = false)
          return t;
        }
        case 'cast': {
          const ta = ex(e.a);
          if (e.type.k === 'void') { emit(OP.POP); emit(OP.CONST, {v: 0}); return T.void; }
          conv(ta, e.type);
          return e.type;
        }
        case 'bin': {
          if (e.op === '&&' || e.op === '||') {
            const ta = ex(e.a);
            if (!isScalar(ta)) fail(`${e.op} needs numbers or bools`, e.tok);
            const j1 = emit(e.op === '&&' ? OP.JZ : OP.JNZ);
            const tb = ex(e.b);
            if (!isScalar(tb)) fail(`${e.op} needs numbers or bools`, e.tok);
            const j2 = emit(e.op === '&&' ? OP.JZ : OP.JNZ);
            emit(OP.CONST, {v: e.op === '&&' ? 1 : 0});
            const j3 = emit(OP.JMP);
            j1.a = j2.a = here();
            emit(OP.CONST, {v: e.op === '&&' ? 0 : 1});
            j3.a = here();
            return T.int;
          }
          if (e.op === '<<' || e.op === '>>') {
            const ta = typeOf(e.a), tb = typeOf(e.b);
            const t = promote(ta);
            ex(e.a); conv(ta, t);
            ex(e.b);
            emit(OP.BIN, {f: shiftOp(e.op, t), line: e.tok.line});
            return t;
          }
          const ta = typeOf(e.a), tb = typeOf(e.b);
          if (!isScalar(ta) || !isScalar(tb)) fail(`${e.op} needs two numbers`, e.tok);
          const t = common(ta, tb);
          ex(e.a); conv(ta, t);
          ex(e.b); conv(tb, t);
          emit(OP.BIN, {f: binaryOp(e.op, t, promotionHint(e, ta, tb)), line: e.tok.line});
          return ['==', '!=', '<', '>', '<=', '>='].includes(e.op) ? T.int : t;
        }
        case 'cond': {
          const tc = ex(e.c);
          if (!isScalar(tc)) fail('the condition of ? : needs a number or bool', e.tok);
          const jz = emit(OP.JZ);
          const ta = typeOf(e.a), tb = typeOf(e.b);
          const t = (ta.k === 'void' || tb.k === 'void') ? T.void : common(ta, tb);
          ex(e.a); conv(ta, t);
          const j = emit(OP.JMP);
          jz.a = here();
          ex(e.b); conv(tb, t);
          j.a = here();
          return t;
        }
        case 'assign': {
          const sym = lvalue(e.a, e.op);
          const t = sym.type;
          if (e.op === '=') {
            const tb = ex(e.b);
            if (!isScalar(tb)) fail(`${sym.name} needs a value, but the right side has none (void)`, e.tok);
            conv(tb, t);
            store(sym, e.a.tok);
            if (!used) emit(OP.POP);
            return t;
          }
          const op = e.op.slice(0, -1);
          const tb = typeOf(e.b);
          load(sym, e.a.tok);
          if (op === '<<' || op === '>>') {
            const ct = promote(t);
            conv(t, ct); ex(e.b);
            emit(OP.BIN, {f: shiftOp(op, ct), line: e.tok.line});
            conv(ct, t);
          } else {
            const ct = common(t, tb);
            conv(t, ct); ex(e.b); conv(tb, ct);
            emit(OP.BIN, {f: binaryOp(op, ct, promotionHint({op}, t, tb)), line: e.tok.line});
            conv(ct, t);
          }
          store(sym, e.a.tok);
          if (!used) emit(OP.POP);
          return t;
        }
        case 'comma': { ex(e.a, false); dropIfVoid(e.a); return ex(e.b, used); }
        case 'call': return call(e, used);
      }
      throw new Error(`cannot compile ${e.k}`);
    }
    // the type of an expression without emitting code (code goes to a scratch array)
    function typeOf(e) {
      const save = code.length;
      const t = ex(e);
      code.length = save;
      return t;
    }
    // after ex(e, false): expressions that left a value anyway are popped
    function dropIfVoid(e) {
      if (!leavesNothing(e)) emit(OP.POP);
    }
    const leavesNothing = e => (e.k === 'assign' || e.k === 'pre' || e.k === 'post');
    function call(e, used) {
      const f = functions.get(e.name);
      const sdk = !f && SDK[e.name];
      if (!f && !sdk) {
        if (lookup(e.name)) fail(`${e.name} is a variable, not a function`, e.tok);
        const later = ast.functions.find(g => g.name === e.name);
        if (later) fail(`${e.name}() is called before it is declared. Define it above, or declare it first: ${typeName(later.ret)} ${e.name}(…);`, e.tok);
        fail(`${e.name}() is not a function this widget knows`, e.tok);
      }
      if (f && f !== fn && !fn.fragment && firstDecl.get(f.name) > fn.pos)
        fail(`${e.name}() is called before it is declared. Define it above, or declare it first: ${typeName(f.ret)} ${e.name}(…);`, e.tok);
      const params = f ? f.params.map(p => p.type) : sdk.params.map(ty);
      if (e.args.length !== params.length)
        fail(`${e.name}() takes ${params.length || 'no'} argument${params.length === 1 ? '' : 's'}, not ${e.args.length}`, e.tok);
      e.args.forEach((a, k) => {
        const ta = ex(a);
        if (!isScalar(ta)) fail(`argument ${k + 1} of ${e.name}() has no value`, a.tok);
        conv(ta, params[k]);
      });
      if (sdk) {
        if (sdk.ms !== undefined) { const c = constValue(e.args[0]); if (c) sdkTimes.push(Number(c.v) * sdk.ms); }
        emit(OP.SDK, {a: e.name, n: params.length, line: e.tok.line});
        return ty(sdk.ret);
      }
      emit(OP.CALL, {a: f, n: params.length, line: e.tok.line, used});
      return f.ret;
    }

    // C11 6.5p2: a variable changed twice in one expression, or changed and also read, with no
    // sequence point between (&&, ||, ?: and the comma operator are ones): undefined behaviour.
    // stop: a build error; permit: a note when the statement runs (it runs left to right, as gcc does on the Pico).
    const UNSEQ = name => `${name} is changed twice in one expression, or changed and also read: C does not say in which order, so this is undefined behaviour. Split it into two statements`;
    function unsequenced(e) {
      const none = () => ({w: new Set(), r: new Set()});
      const join = (a, b) => ({w: new Set([...a.w, ...b.w]), r: new Set([...a.r, ...b.r])});
      const clash = (a, b) => { for (const n of a.w) if (b.w.has(n) || b.r.has(n)) return n; for (const n of b.w) if (a.r.has(n)) return n; return null; };
      const conflict = (name, tok) => { const err = new Error(name); err.tok = tok; err.var = name; return err; };
      function walk(x) {
        switch (x.k) {
          case 'id': { const r = none(); r.r.add(x.name); return r; }
          case 'un': case 'cast': return walk(x.a);
          case 'pre': case 'post': { const r = walk(x.a); if (x.a.k === 'id') r.w.add(x.a.name); return r; }
          case 'bin': {
            const a = walk(x.a), b = walk(x.b);
            if (x.op !== '&&' && x.op !== '||') { const n = clash(a, b); if (n) throw conflict(n, x.tok); }
            return join(a, b);
          }
          case 'cond': return join(walk(x.c), join(walk(x.a), walk(x.b)));
          case 'comma': return join(walk(x.a), walk(x.b));
          case 'assign': {
            const b = walk(x.b), name = x.a.k === 'id' ? x.a.name : null;
            if (name && b.w.has(name)) throw conflict(name, x.tok);
            const r = join(b, none());
            if (name) { r.w.add(name); if (x.op !== '=') r.r.add(name); }
            return r;
          }
          case 'call': {
            let acc = none();
            for (const a of x.args) { const r = walk(a); const n = clash(acc, r); if (n) throw conflict(n, a.tok); acc = join(acc, r); }
            return acc;
          }
        }
        return none();
      }
      try { walk(e); return null; } catch (err) { if (!err.var) throw err; return err; }
    }
    // a full expression of the statement `ins`: checked for double changes
    function full(e, ins) {
      if (!e) return;
      const c = unsequenced(e);
      if (!c) return;
      if (opts.ub !== 'permit') fail(UNSEQ(c.var), c.tok);
      if (ins) ins.unseq = `Line ${ins.line}: ${UNSEQ(c.var)}. The widget runs it left to right, as gcc does on the Pico; the compiled program may do something else.`;
    }

    // statements
    function cond(e, what) {
      const t = ex(e);
      if (!isScalar(t)) fail(`the condition of ${what} needs a number or bool`, e.tok);
    }
    let superloop = null;     // the first endless loop of main()
    const endless = c => !c || (constValue(c) && constValue(c).v != 0);
    function st(s) {
      switch (s.k) {
        case 'empty': return;
        case 'expr': {
          full(s.e, stmt(s.tok));
          const t = ex(s.e, false);
          if (!leavesNothing(s.e)) emit(OP.POP);
          return;
        }
        case 'decl': {
          for (const v of s.decls) {
            if (fn.fragment && scopes.length === 1) {
              // a top-level declaration of a fragment: a global, set here if its value needs the program
              if (initLater.has(v)) { full(v.init, stmt(v.tok)); const sym = globalScope.get(v.name); const t = ex(v.init); conv(t, sym.type); store(sym, v.tok); emit(OP.POP); }
              continue;
            }
            if (v.isStatic) fail('static variables inside functions are not supported in this widget yet', v.tok);
            if (v.isConst && !v.init) fail(`${v.name} is const, so it needs a value`, v.tok);
            if (v.init) {
              full(v.init, stmt(v.tok));
              const t = ex(v.init);
              if (!isScalar(t)) fail(`${v.name} needs a value, but the right side has none (void)`, v.init.tok);
              const sym = newLocal(v, v.type, v.isConst);
              conv(t, v.type);
              store(sym, v.tok);
              emit(OP.POP);
            } else {
              const sym = newLocal(v, v.type, false);
              emit(OP.DECL, {a: sym.slot});
            }
          }
          return;
        }
        case 'block':
          scopes.push(new Map());
          for (const x of s.body) st(x);
          scopes.pop();
          return;
        case 'if': {
          full(s.c, stmt(s.tok)); cond(s.c, 'if');
          const jz = emit(OP.JZ);
          st(s.a);
          if (s.b) { const j = emit(OP.JMP); jz.a = here(); st(s.b); j.a = here(); }
          else jz.a = here();
          return;
        }
        case 'while': {
          const isSuper = fn.name === 'main' && !superloop && endless(s.c) && scopes.length <= 2;
          const top = here();
          full(s.c, stmt(s.tok)); cond(s.c, 'while');
          const jz = emit(OP.JZ);
          if (isSuper) { superloop = s; emit(OP.ITER); }
          const loop = {breaks: [], continues: []};
          loops.push(loop);
          st(s.body);
          loops.pop();
          emit(OP.JMP, {a: top});
          jz.a = here();
          loop.breaks.forEach(j => (j.a = here()));
          loop.continues.forEach(j => (j.a = top));
          return;
        }
        case 'do': {
          const top = here();
          const isSuper = fn.name === 'main' && !superloop && endless(s.c) && scopes.length <= 2;
          if (isSuper) { superloop = s; emit(OP.ITER); }
          const loop = {breaks: [], continues: []};
          loops.push(loop);
          st(s.body);
          loops.pop();
          const cont = here();
          full(s.c, stmt(s.ctok)); cond(s.c, 'do … while');
          emit(OP.JNZ, {a: top});
          loop.breaks.forEach(j => (j.a = here()));
          loop.continues.forEach(j => (j.a = cont));
          return;
        }
        case 'for': {
          scopes.push(new Map());
          if (s.init) st(s.init);
          const isSuper = fn.name === 'main' && !superloop && endless(s.c) && scopes.length <= 3 && !s.init;
          const top = here();
          let jz = null;
          if (s.c) { full(s.c, stmt(s.ctok)); cond(s.c, 'for'); jz = emit(OP.JZ); }
          if (isSuper) { superloop = s; emit(OP.ITER); }
          const loop = {breaks: [], continues: []};
          loops.push(loop);
          st(s.body);
          loops.pop();
          const cont = here();
          if (s.step) { full(s.step, stmt(s.stok)); ex(s.step, false); if (!leavesNothing(s.step)) emit(OP.POP); }
          if (!s.c && !s.step) stmt(s.tok);   // for (;;): the jump back takes time too, so the loop cannot stop the clock
          emit(OP.JMP, {a: top});
          if (jz) jz.a = here();
          loop.breaks.forEach(j => (j.a = here()));
          loop.continues.forEach(j => (j.a = cont));
          scopes.pop();
          return;
        }
        case 'break': case 'continue': {
          if (!loops.length) fail(`${s.k} is only allowed inside a loop`, s.tok);
          stmt(s.tok);
          loops[loops.length - 1][s.k === 'break' ? 'breaks' : 'continues'].push(emit(OP.JMP));
          return;
        }
        case 'return': {
          full(s.e, stmt(s.tok));
          if (s.e) {
            const t = ex(s.e);
            if (fn.ret.k === 'void') fail(`${fn.name}() is void, so its return has no value`, s.tok);
            conv(t, fn.ret);
          } else {
            if (fn.ret.k !== 'void' && fn.name !== 'main') fail(`${fn.name}() returns ${typeName(fn.ret)}: return needs a value`, s.tok);
            emit(OP.CONST, {v: 0});
          }
          emit(OP.RET, {line: s.tok.line});
          return;
        }
      }
      throw new Error(`cannot compile ${s.k}`);
    }

    // start: the globals are set (no time), then main() runs; when it returns, the program stops
    const start = emit(OP.CALL, {n: 0, used: false});
    emit(OP.POP);
    emit(OP.HALT);
    const defs = [];
    const firstDecl = new Map();   // name -> where the first prototype or definition starts
    for (const f of ast.functions) if (!firstDecl.has(f.name)) firstDecl.set(f.name, f.tok.pos);
    for (const f of ast.functions) {
      let info = functions.get(f.name);
      if (!info) {
        info = {name: f.name, ret: f.ret, params: f.params, entry: -1, nslots: 0, locals: [], proto: true, tok: f.tok};
        functions.set(f.name, info);
      }
      if (!f.proto) { info.proto = false; info.params = f.params; info.body = f.body; info.pos = f.tok.pos; defs.push(info); }
    }
    for (const info of functions.values()) if (info.proto && info.name !== 'main') {
      // declared and called, never defined: a link error in C
      info.missing = true;
    }
    let main = functions.get('main');
    if (!hasMain) {
      main = {name: 'main', ret: T.int, params: [], entry: -1, nslots: 0, locals: [], fragment: true, body: {k: 'block', body: ast.statements, tok: (ast.toks[0] || {line: 1})}};
      functions.set('main', main);
      defs.push(main);
    }
    for (const info of defs) {
      fn = info;
      info.entry = here();
      scopes = [new Map()];
      for (const p of info.params) newLocal(p, p.type, p.isConst);
      if (info.fragment) for (const s of info.body.body) st(s);
      else st(info.body);
      emit(OP.RETEND, {a: info, line: info.body.close ? info.body.close.line : 0});
    }
    for (const ins of code) if (ins.op === OP.CALL && ins.a !== null && typeof ins.a === 'object' && ins.a.missing && ins !== start)
      fail(`${ins.a.name}() is declared but never defined`, ins.a.tok);
    start.a = main;
    if (!ast.toks.length || (ast.statements.length === 0 && !hasMain)) fail('the program is empty');
    for (const inc of ast.includes) if (!inc.known) warnings.push(`Line ${inc.line}: #include <${inc.name}>: this widget does not know this header; it is ignored`);

    const lines = src.split('\n');
    return {code, globals, functions, main, superloop, sdkTimes, warnings, lines, ast, src,
      maxLine: lines.length, lookup: name => globalScope.get(name) || findLocal(name)};

    // a variable by name for watch: and timeline: a global, else a local of main(), else of another function
    function findLocal(name) {
      for (const f of [main, ...functions.values()]) {
        const syms = (f.locals || []).filter(s => s.name === name);
        if (syms.length) return syms[0];
      }
      return null;
    }
  }

  // A program as a C file for gcc (tests/superloop_gcc.js): the pins the widget declares as constants
  // first; in a fragment, the top-level declarations stay globals and the statements go into main().
  // A global's value that is not a number becomes an assignment at its place in main(), as the widget runs it.
  function toC(src, devices = []) {
    const ast = parse(src);
    const own = new Set(ast.globals.flatMap(d => d.decls.map(v => v.name)));
    const out = ['#include <stdint.h>', '#include <stdbool.h>', '#include <limits.h>', '#include "pico/stdlib.h"', ''];
    for (const d of devices) if (!own.has(d.name)) out.push(`const uint ${d.name} = ${d.gpio};`);
    if (ast.functions.some(f => f.name === 'main' && !f.proto)) return out.join('\n') + '\n' + src;
    const body = [];
    for (const item of ast.items) {
      const text = src.slice(item.span[0], item.span[1]);
      if (item.kind === 'function') out.push(text);
      else if (item.kind === 'statement') body.push(text);
      else {
        const later = item.node.decls.filter(v => v.init && v.init.k !== 'num' && !(v.init.k === 'un' && v.init.a.k === 'num') && !(v.init.k === 'id' && ['true', 'false'].includes(v.init.name)));
        if (!later.length) { out.push(text); continue; }
        // int x = f(); at the top: int x; there, x = f(); in main
        let t = text;
        for (const v of later.slice().reverse()) {
          const a = v.span[0] - item.span[0], b = v.span[1] - item.span[0];
          t = t.slice(0, t.lastIndexOf('=', a)).trimEnd() + t.slice(b);
          body.push(`${v.name} = ${src.slice(v.span[0], v.span[1])};`);
        }
        out.push(t);
      }
    }
    out.push('', 'int main(void) {', ...body, '}');
    return out.join('\n') + '\n';
  }

  // ========================================================================
  // The machine: one program against simulated time (ns, a JS number)
  // ========================================================================
  const US = 1e3, MS = 1e6, SEC = 1e9;
  const RUN = 0, ASLEEP = 1, BUSY = 2, WAITING = 3, STOPPED = 4;
  const CPU_NAMES = ['running', 'asleep', 'busy', 'waiting', 'stopped'];
  const SIO = 1, NGPIO = 30;

  class Stop extends Error {}

  // a small seeded generator (mulberry32): the same bounces in every build and test
  function seeded(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // The changes of a signal ({t, v}); changes closer than `gap` become a band
  // {band: true, t, end, n, on, v}: toggling n times, `on` ns at 1, then v.
  class Track {
    constructor(gap, v = 0) { this.gap = gap; this.ch = [{t: 0, v}]; this.v = v; }
    set(t, v) {
      if (v === this.v) return;
      const ch = this.ch, last = ch[ch.length - 1];
      if (last.band && t - last.end <= this.gap) {
        if (last.v === 1) last.on += t - last.end;
        last.end = t; last.n++; last.v = v;
      } else if (!last.band && ch.length > 1 && t - last.t <= this.gap) {
        ch[ch.length - 1] = {band: true, t: last.t, end: t, n: 2, on: last.v === 1 ? t - last.t : 0, v};
      } else ch.push({t, v});
      this.v = v;
    }
    // the share of [t0, t1] at level 1 (for the cpu: asleep); a band counts its `on` time, cut to the range
    share(t0, t1) {
      const ch = this.ch;
      let on = 0;
      for (let k = 0; k < ch.length; k++) {
        const e = ch[k], s = e.band ? e.end : e.t, next = k + 1 < ch.length ? ch[k + 1].t : Infinity;
        if (e.band) {
          const a = Math.max(e.t, t0), b = Math.min(e.end, t1);
          if (b > a) on += e.on * (b - a) / Math.max(1, e.end - e.t);
        }
        const a = Math.max(s, t0), b = Math.min(next, t1);
        if (b > a && e.v === 1) on += b - a;
      }
      return t1 > t0 ? on / (t1 - t0) : 0;
    }
    // forget what is older than t (keep the level at t)
    trim(t) {
      const ch = this.ch;
      let k = 0;
      while (k + 1 < ch.length && (ch[k + 1].band ? ch[k + 1].t : ch[k + 1].t) <= t && (!ch[k + 1].band || ch[k + 1].end <= t)) k++;
      if (k > 0) { const keep = ch[k]; ch.splice(0, k); if (keep.band) ch[0] = {t: keep.end, v: keep.v}; }
    }
  }
  // the moments a program read an input: intervals {t0, t1, n}, merged when closer than `gap`
  class Reads {
    constructor(gap) { this.gap = gap; this.list = []; this.total = 0; }
    add(t) {
      this.total++;
      const l = this.list, last = l[l.length - 1];
      if (last && t - last.t1 <= this.gap) { last.t1 = t; last.n++; } else l.push({t0: t, t1: t, n: 1});
    }
    trim(t) { const l = this.list; let k = 0; while (k < l.length && l[k].t1 < t) k++; if (k) l.splice(0, k); }
  }
  // an absolute_time_t variable on the timeline: time_reached(variable) as a level, and its value
  class Deadline {
    constructor(gap) { this.track = new Track(gap, 0); this.cur = 0; }
    set(t, us) {
      const v = Number(us) * US;   // 0: not set
      if (this.cur > 0 && this.cur <= t && this.track.v === 0) this.track.set(this.cur, 1);
      this.track.set(t, v > 0 && v <= t ? 1 : 0);
      this.cur = v;
    }
  }

  /*
   * new Machine(program, cfg)
   *   cfg: {lineTime (ns), ub: 'stop' | 'permit', setup: 'auto' | 'code', active: 'high' | 'low',
   *         inputs: [{name, gpio, kind}], outputs: [{name, gpio, kind, color}],
   *         params: {NAME: value}, tracked: [variable names], gap (ns), tau (ns), seed}
   */
  class Machine {
    constructor(prog, cfg) {
      this.prog = prog;
      this.cfg = cfg;
      this.code = prog.code;
      this.lineTime = cfg.lineTime || US;
      this.tau = cfg.tau || 20 * MS;
      this.reset();
    }
    reset() {
      const {prog, cfg} = this;
      const gap = cfg.gap || 50 * US;
      this.globals = prog.globals.map(g => (cfg.params && g.name in cfg.params ? convert(cfg.params[g.name], g.type) : g.value));
      this.stack = new Array(256);
      this.sp = 0; this.pc = 0;
      this.frames = []; this.frame = null;
      this.stale = new Map();
      this.time = 0; this.state = RUN; this.wakeAt = 0; this.sleepFrom = 0; this.sleepLine = 0;
      this.events = []; this.ei = 0; this.nextT = Infinity;
      this.random = seeded((cfg.seed || 1) * 7919);
      this.heat = new Float64Array(prog.maxLine + 2);
      this.iterations = 0;
      this.total = 0; this.limit = cfg.limit || Infinity;
      this.notes = []; this.noted = new Set();
      this.stopped = null; this.returned = false;
      this.stepMode = null; this.stepLeft = 0; this.paused = false;
      this.cpu = new Track(gap, RUN);
      // pins: after reset, every pad is an input with its pull-down on (RP2040 datasheet, PADS_BANK0)
      this.pins = Array.from({length: NGPIO}, () => ({func: 0, dir: 0, out: 0, pull: 'down', inDev: null, outDev: null}));
      this.inputs = {}; this.outputs = {};
      for (const d of cfg.inputs || []) {
        const pin = this.pins[d.gpio];
        const dev = {name: d.name, gpio: d.gpio, pressed: false, track: null, reads: new Reads(gap), presses: [], noted: false};
        pin.inDev = dev;
        if (cfg.setup !== 'code') { pin.func = SIO; pin.dir = 0; pin.pull = cfg.active === 'low' ? 'up' : 'down'; }
        dev.track = new Track(gap, this.inputLevel(d.gpio, true));
        this.inputs[d.name] = dev;
      }
      for (const d of cfg.outputs || []) {
        const pin = this.pins[d.gpio];
        const dev = {name: d.name, gpio: d.gpio, level: 0, track: new Track(gap, 0), ema: {b: 0, t: 0, lvl: 0}, toggles: 0};
        pin.outDev = dev;
        if (cfg.setup !== 'code') { pin.func = SIO; pin.dir = 1; pin.out = 0; }
        this.outputs[d.name] = dev;
      }
      // absolute_time_t variables on the timeline: their stores are recorded
      this.deadlines = {};
      for (const name of cfg.tracked || []) {
        const sym = prog.lookup(name);
        if (sym) this.deadlines[name] = {sym, rec: new Deadline(gap)};
      }
      this.trackBySym = new Map(Object.values(this.deadlines).map(d => [d.sym, d.rec]));
      // a goal (only on the machine of its variant): met at the first moment all its variables and outputs hold
      this.presses = 0;
      this.goal = cfg.goal ? {vars: cfg.goal.vars.map(v => ({sym: prog.lookup(v.name), value: v.value, name: v.name})),
        outputs: cfg.goal.outputs, met: null, presses: 0} : null;
      const goalSyms = new Set(this.goal ? this.goal.vars.map(v => v.sym) : []);
      for (const ins of this.code) if (ins.op === OP.STOREG || ins.op === OP.STOREL) { ins.track = this.trackBySym.get(ins.sym) || null; ins.goal = goalSyms.has(ins.sym); }
      for (const g of prog.globals) { const d = this.trackBySym.get(g.sym); if (d && g.value) d.set(0, g.value); }
      this.checkGoal();
    }

    // --- running ---------------------------------------------------------------
    // run until simulated time `until` or `budget` statements; returns the statements left
    run(until, budget) {
      CUR = this;
      try {
        while (this.time < until && budget > 0 && !this.paused) {
          if (this.state === STOPPED) { this.advance(until); break; }
          if (this.state === ASLEEP || this.state === BUSY) {
            const t = Math.min(this.wakeAt, until);
            this.advance(t);
            if (this.time < this.wakeAt) break;
            this.setCpu(RUN);
            continue;
          }
          budget = this.exec(until, budget);
          // the next statement does not fit before `until`: the next call goes on from here
          if (this.state === RUN && this.time + this.lineTime > until) break;
        }
      } catch (e) {
        if (!(e instanceof Stop)) { this.stop(`the widget failed: ${e.message}`, 0); console.error(e); }
      } finally { CUR = null; }
      return budget;
    }
    // apply the input changes up to t and move the clock there
    advance(t) {
      if (this.nextT <= t) this.applyEvents(t);
      if (t > this.time) this.time = t;
    }
    setCpu(state) { this.state = state; this.cpu.set(this.time, state); }
    stop(message, line) {
      this.stopped = {message, line};
      this.setCpu(STOPPED);
    }
    // undefined behaviour: stop, or (permit) note it once per line and go on with what a Pico does
    ub(ins, kind, msg, value) {
      const line = ins && ins.line;
      if (this.cfg.ub !== 'permit') {
        this.stop(`${line ? `Line ${line}: ` : ''}${msg}.`, line);
        throw new Stop();
      }
      const did = {overflow: 'wraps, as the processor does', shift: 'shifts as the processor does',
        div0: `returns what the Pico SDK's divider returns (${fmt(value)})`, uninit: 'uses its last value (0 at first), as gcc did in tests',
        noreturn: 'returns the first argument, as gcc\'s code does'}[kind] || 'goes on';
      this.note(`${line ? `Line ${line}: ` : ''}${msg}. The widget ${did}; the compiled program may do something else.`, line, 'ub');
      return value;
    }
    note(text, line, kind = 'note') {
      const key = `${kind}:${line}:${text.slice(0, 40)}`;
      if (this.noted.has(key)) return;
      this.noted.add(key);
      this.notes.push({text, line, kind, t: this.time});
    }

    // the interpreter: runs instructions until it must wait, reaches `until`, or uses up the budget
    exec(until, budget) {
      const code = this.code, st = this.stack, g = this.globals, lt = this.lineTime;
      let pc = this.pc, sp = this.sp;
      let fr = this.frame, slots = fr ? fr.slots : null, init = fr ? fr.init : null;
      for (;;) {
        const ins = code[pc++];
        switch (ins.op) {
          case OP.STMT:
            if (this.time + lt > until || budget <= 0) { this.pc = pc - 1; this.sp = sp; return budget; }
            if (this.stepMode === 'stmt') {
              if (this.stepLeft <= 0) { this.pc = pc - 1; this.sp = sp; this.paused = true; this.stepMode = null; return budget; }
              this.stepLeft--;
            }
            if (this.nextT <= this.time) this.applyEvents(this.time);
            if (ins.unseq) this.note(ins.unseq, ins.line, 'ub');
            this.time += lt; budget--;
            if (++this.total > this.limit) { this.stop(`The program ran ${group(this.limit)} statements; the build stops it there.`, ins.line); this.pc = pc; this.sp = sp; throw new Stop(); }
            this.heat[ins.line]++;
            break;
          case OP.ITER:
            if (this.stepMode === 'loop' && this.stepLeft <= 0) { this.pc = pc - 1; this.sp = sp; this.paused = true; this.stepMode = null; return budget; }
            if (this.stepMode === 'loop') this.stepLeft = 0;
            this.iterations++;
            break;
          case OP.CONST: st[sp++] = ins.v; break;
          case OP.LOADG: st[sp++] = g[ins.a]; break;
          case OP.LOADL:
            if (!init[ins.a]) { this.pc = pc; this.sp = sp; st[sp++] = this.ub(ins, 'uninit', `${ins.sym.name} is used before it gets a value. That is undefined behaviour in C`, slots[ins.a]); break; }
            st[sp++] = slots[ins.a]; break;
          case OP.STOREG: g[ins.a] = st[sp - 1]; if (ins.track) ins.track.set(this.time, st[sp - 1]); if (ins.goal) this.checkGoal(); break;
          case OP.STOREL: slots[ins.a] = st[sp - 1]; init[ins.a] = 1; if (ins.track) ins.track.set(this.time, st[sp - 1]); if (ins.goal) this.checkGoal(); break;
          case OP.DECL: init[ins.a] = 0; break;
          case OP.CONV: st[sp - 1] = ins.f(st[sp - 1]); break;
          case OP.UN: st[sp - 1] = ins.f(st[sp - 1], ins); break;
          case OP.BIN: { const b = st[--sp]; st[sp - 1] = ins.f(st[sp - 1], b, ins); break; }
          case OP.POP: sp--; break;
          case OP.DUP: st[sp] = st[sp - 1]; sp++; break;
          case OP.JMP: pc = ins.a; break;
          case OP.JZ: if (st[--sp] == 0) pc = ins.a; break;
          case OP.JNZ: if (st[--sp] != 0) pc = ins.a; break;
          case OP.CALL: {
            const f = ins.a, n = ins.n;
            if (this.frames.length >= 64) { this.stop(`Line ${ins.line}: the calls go more than 64 levels deep (endless recursion?).`, ins.line); throw new Stop(); }
            let s = this.stale.get(f);
            s = s ? s.slice() : f.locals.map(l => zeroOf(l.type));
            const it = new Uint8Array(f.nslots);
            for (let k = 0; k < n; k++) { s[k] = st[sp - n + k]; it[k] = 1; }
            sp -= n;
            fr = {fn: f, ret: pc, slots: s, init: it, used: ins.used, first: n ? s[0] : 0};
            this.frames.push(fr); this.frame = fr;
            slots = s; init = it;
            pc = f.entry;
            break;
          }
          case OP.RET: case OP.RETEND: {
            let v;
            if (ins.op === OP.RET) v = st[--sp];
            else {
              const f = ins.a;
              v = 0;
              if (f.ret.k !== 'void' && f.name !== 'main' && fr.used) {
                this.pc = pc; this.sp = sp;
                v = this.ub(ins, 'noreturn', `${f.name}() ends without a return, but its value is used. That is undefined behaviour in C`, convert(fr.first, f.ret));
              } else if (f.ret.k !== 'void') v = zeroOf(f.ret);
            }
            const done = this.frames.pop();
            this.stale.set(done.fn, done.slots);
            pc = done.ret;
            fr = this.frames[this.frames.length - 1] || null;
            this.frame = fr;
            slots = fr ? fr.slots : null; init = fr ? fr.init : null;
            st[sp++] = v;
            break;
          }
          case OP.SDK: {
            sp -= ins.n;
            this.pc = pc; this.sp = sp;
            const r = SDK_RUN[ins.a](this, st, sp, ins);
            st[sp++] = r === undefined ? 0 : r;
            if (this.state !== RUN) { this.pc = pc; this.sp = sp; return budget; }
            break;
          }
          case OP.HALT:
            this.returned = true;
            this.stop('main() returned. On a Pico the program stops here; the outputs keep their last value.', 0);
            this.pc = pc - 1; this.sp = sp;
            return budget;
          default: throw new Error(`bad instruction ${ins.op}`);
        }
      }
    }
    checkGoal() {
      const gl = this.goal;
      if (!gl || gl.met !== null) return;
      for (const v of gl.vars) { const x = v.sym && this.value(v.sym); if (!x || !x.init || convert(x.v, v.sym.type) != convert(v.value, v.sym.type)) return; }
      for (const o of gl.outputs) if (this.outputs[o.name].level !== (o.on ? 1 : 0)) return;
      gl.met = this.time; gl.presses = this.presses;
    }
    // step: one statement, or to the start of the next round of the superloop
    step(kind) { this.stepMode = kind; this.stepLeft = kind === 'stmt' && (this.state === ASLEEP || this.state === BUSY) ? 0 : 1; this.paused = false; }
    // the line about to run (paused) or running (asleep)
    get line() {
      const ins = this.code[this.pc];
      return this.state === ASLEEP || this.state === BUSY ? this.sleepLine : ins && ins.op === OP.STMT ? ins.line : 0;
    }
    block(state, ns, line) {
      this.wakeAt = this.time + ns; this.sleepFrom = this.time; this.sleepLine = line;
      this.setCpu(state);
    }

    // --- pins and devices ---------------------------------------------------------
    pinCheck(gpio, line) {
      if (gpio >= NGPIO) { this.stop(`Line ${line}: GPIO ${gpio} does not exist (the Pico has GPIO 0 to 29).`, line); throw new Stop(); }
      return this.pins[gpio];
    }
    // the level at an input pin: a pressed button gives the active level; else the pull decides
    inputLevel(gpio, quiet) {
      const pin = this.pins[gpio], dev = pin.inDev;
      if (dev && dev.pressed) return this.cfg.active === 'low' ? 0 : 1;
      if (pin.pull === 'up') return 1;
      if (pin.pull === 'down') return 0;
      return quiet ? 2 : (this.random() < 0.5 ? 0 : 1);   // floating
    }
    pinChanged(gpio) {
      const pin = this.pins[gpio];
      if (pin.outDev) {
        const d = pin.outDev, lvl = pin.func === SIO && pin.dir === 1 && pin.out ? 1 : 0;
        if (lvl !== d.level) {
          const e = d.ema;
          e.b = e.lvl + (e.b - e.lvl) * Math.exp(-(this.time - e.t) / this.tau);
          e.t = this.time; e.lvl = lvl;
          d.level = lvl; d.toggles++;
          d.track.set(this.time, lvl);
          if (this.goal) this.checkGoal();
        }
      }
      if (pin.inDev) pin.inDev.track.set(this.time, pin.func === SIO && pin.dir === 1 ? pin.out : this.inputLevel(gpio, true));
    }
    brightness(name) {
      const d = this.outputs[name], e = d.ema;
      return e.lvl + (e.b - e.lvl) * Math.exp(-(this.time - e.t) / this.tau);
    }
    setTau(tau) {
      for (const d of Object.values(this.outputs)) { const e = d.ema; e.b = this.brightness(d.name); e.t = this.time; }
      this.tau = tau;
    }

    // --- inputs from the board (the Runner) ---------------------------------------------
    queue(name, list) {
      for (const ev of list) {
        const e = {t: ev.t, name, pressed: ev.pressed};
        let k = this.events.length;
        while (k > this.ei && this.events[k - 1].t > e.t) k--;
        this.events.splice(k, 0, e);
      }
      this.nextT = this.ei < this.events.length ? this.events[this.ei].t : Infinity;
    }
    cancel(name, after) {
      this.events = this.events.filter((e, k) => k < this.ei || e.name !== name || e.t <= after);
      this.nextT = this.ei < this.events.length ? this.events[this.ei].t : Infinity;
    }
    applyEvents(t) {
      const ev = this.events;
      while (this.ei < ev.length && ev[this.ei].t <= t) {
        const e = ev[this.ei++];
        const dev = this.inputs[e.name];
        if (!dev) continue;
        dev.pressed = e.pressed;
        const pin = this.pins[dev.gpio];
        if (!(pin.func === SIO && pin.dir === 1)) dev.track.set(e.t, this.inputLevel(dev.gpio, true));
      }
      if (this.ei > 4096) { ev.splice(0, this.ei); this.ei = 0; }
      this.nextT = this.ei < ev.length ? ev[this.ei].t : Infinity;
    }
    pressLog(name, t, down) {
      const dev = this.inputs[name];
      if (!dev) return;
      if (down) { dev.presses.push({t0: t, t1: null}); this.presses++; }
      else { const p = dev.presses[dev.presses.length - 1]; if (p && p.t1 === null) p.t1 = t; }
    }
    // forget history older than t
    trim(t) {
      this.cpu.trim(t);
      for (const d of Object.values(this.inputs)) {
        d.track.trim(t); d.reads.trim(t);
        while (d.presses.length > 1 && d.presses[0].t1 !== null && d.presses[0].t1 < t) d.presses.shift();
      }
      for (const d of Object.values(this.outputs)) d.track.trim(t);
      for (const d of Object.values(this.deadlines)) d.rec.track.trim(t);
    }
    // the current value of a variable (watch:), or undefined when it is not in scope
    value(sym) {
      if (sym.global) return {v: this.globals[sym.slot], init: true};
      for (let k = this.frames.length - 1; k >= 0; k--) {
        const f = this.frames[k];
        if (f.fn === sym.fn) return {v: f.slots[sym.slot], init: !!f.init[sym.slot]};
      }
      return undefined;
    }
    nowUs() { return BigInt(Math.floor(this.time / US)); }
  }

  // The SDK, as on a Pico (pico/time.h, hardware/gpio.h of SDK 2.x). (machine, stack, index of the first argument, instruction)
  const sleepFor = (state, scale) => (m, st, i, ins) => {
    const ns = Number(st[i]) * scale;
    if (ns > 0) m.block(state, ns, ins.line);
  };
  function delayedBy(t, us) {
    let d = BigInt.asUintN(64, t + us);
    if (BigInt.asIntN(64, d) < 0n) d = I64_MAX;   // never later than at_the_end_of_time
    return d;
  }
  const SDK_RUN = {
    stdio_init_all: () => 0,
    tight_loop_contents: () => 0,
    gpio_init(m, st, i, ins) { const p = m.pinCheck(st[i], ins.line); p.func = SIO; p.dir = 0; p.out = 0; m.pinChanged(st[i]); },
    gpio_set_dir(m, st, i, ins) { const p = m.pinCheck(st[i], ins.line); p.dir = st[i + 1]; m.pinChanged(st[i]); },
    gpio_put(m, st, i, ins) {
      const gpio = st[i], p = m.pinCheck(gpio, ins.line);
      p.out = st[i + 1];
      if (p.outDev && !(p.func === SIO && p.dir === 1) && st[i + 1])
        m.note(p.func !== SIO
          ? `Line ${ins.line}: gpio_put(${gpio}, 1) does nothing: GP${gpio} is not set up. gpio_init(${gpio}) is missing.`
          : `Line ${ins.line}: gpio_put(${gpio}, 1) does nothing: GP${gpio} is not an output. gpio_set_dir(${gpio}, GPIO_OUT) is missing.`, ins.line, 'pin');
      m.pinChanged(gpio);
    },
    gpio_get(m, st, i, ins) {
      const gpio = st[i], p = m.pinCheck(gpio, ins.line);
      if (p.func === SIO && p.dir === 1) return p.out;
      const dev = p.inDev;
      if (dev) dev.reads.add(m.time);
      else if (p.pull === 'down') m.note(`Line ${ins.line}: gpio_get(${gpio}) reads 0: nothing is connected to GP${gpio}, and its pull-down (on since reset) pulls it to 0.`, ins.line, 'pin');
      const lvl = m.inputLevel(gpio);
      if (p.pull === 'none' && !(dev && dev.pressed)) m.note(`Line ${ins.line}: GP${gpio} has no pull resistor and nothing drives it: it floats, and gpio_get(${gpio}) reads 0 or 1 at random.`, ins.line, 'pin');
      return lvl;
    },
    gpio_pull_up(m, st, i, ins) { m.pinCheck(st[i], ins.line).pull = 'up'; m.pinChanged(st[i]); },
    gpio_pull_down(m, st, i, ins) { m.pinCheck(st[i], ins.line).pull = 'down'; m.pinChanged(st[i]); },
    gpio_disable_pulls(m, st, i, ins) { m.pinCheck(st[i], ins.line).pull = 'none'; m.pinChanged(st[i]); },
    sleep_ms: sleepFor(ASLEEP, MS),
    sleep_us: sleepFor(ASLEEP, US),
    busy_wait_ms: sleepFor(BUSY, MS),
    busy_wait_us: sleepFor(BUSY, US),
    busy_wait_us_32: sleepFor(BUSY, US),
    get_absolute_time: m => m.nowUs(),
    to_us_since_boot: (m, st, i) => st[i],
    time_us_64: m => m.nowUs(),
    time_us_32: m => Number(BigInt.asUintN(32, m.nowUs())),
    make_timeout_time_ms: (m, st, i) => delayedBy(m.nowUs(), BigInt(st[i]) * 1000n),
    make_timeout_time_us: (m, st, i) => delayedBy(m.nowUs(), st[i]),
    delayed_by_ms: (m, st, i) => delayedBy(st[i], BigInt(st[i + 1]) * 1000n),
    delayed_by_us: (m, st, i) => delayedBy(st[i], st[i + 1]),
    time_reached: (m, st, i) => (m.nowUs() >= st[i] ? 1 : 0),
    absolute_time_diff_us: (m, st, i) => BigInt.asIntN(64, st[i + 1] - st[i]),
  };

  // ========================================================================
  // The runner: every variant runs at once, on the same presses
  // ========================================================================
  class Runner {
    // variants: [{name, prog}]; cfg as for Machine, plus speed
    constructor(variants, cfg) {
      this.variants = variants;
      this.cfg = cfg;
      this.speed = cfg.speed || 1;
      this.random = cfg.random || seeded(cfg.seed || 1);
      this.reset();
    }
    reset() {
      const gl = this.cfg.goal;
      this.machines = this.variants.map((v, k) => new Machine(v.prog, Object.assign({}, this.cfg, {tau: 20 * MS * this.speed, goal: gl && gl.variant === k ? gl : null})));
      this.clock = 0;
      this.levels = {};
      this.slow = 1;
    }
    setSpeed(s) { this.speed = s; for (const m of this.machines) m.setTau(20 * MS * s); }
    get lead() { return Math.max(...this.machines.map(m => m.time)); }
    // a hold button or pin goes down/high (true) or up/low (false); a bouncy one bounces in the first 12 ms
    press(name, down, bouncy, at) {
      if (!!this.levels[name] === down) return;
      this.levels[name] = down;
      const t = at === undefined ? this.lead : at;
      const list = [{t, pressed: down}];
      if (bouncy) {
        const pairs = 2 + Math.floor(this.random() * 3);
        const times = Array.from({length: 2 * pairs}, () => 0.4 + this.random() * 11.6).sort((a, b) => a - b);
        times.forEach((dt, k) => list.push({t: t + dt * MS, pressed: k % 2 === 0 ? !down : down}));
      }
      for (const m of this.machines) { m.cancel(name, t); m.queue(name, list); m.pressLog(name, t, down); }
    }
    // a button: one click is a press of 150 ms
    click(name, bouncy) {
      const t = this.lead;
      this.press(name, true, bouncy, t);
      this.press(name, false, bouncy, t + 150 * MS);
    }
    // scripted presses (readScript); a step with a length comes back after it
    script(steps, inputs) {
      for (const st of steps) {
        const bouncy = inputs.find(d => d.name === st.name).bouncy;
        this.press(st.name, st.down, bouncy, st.at);
        if (st.len != null) this.press(st.name, !st.down, bouncy, st.at + st.len);
      }
    }
    // move every machine on by `ns` of simulated time, at most `budget` statements each
    advance(ns, budget = 40000) {
      const target = this.clock + ns;
      for (const m of this.machines) if (!m.paused) m.run(target, budget);
      const reached = Math.min(...this.machines.map(m => m.time));
      if (ns > 0) this.slow = this.slow * 0.9 + 0.1 * Math.min(1, (reached - this.clock) / ns);
      this.clock = Math.max(this.clock, reached);
      if (this.clock - (this.trimmed || 0) > 0.5 * SEC) { this.trimmed = this.clock; for (const m of this.machines) m.trim(this.clock - (this.cfg.keep || 6 * SEC)); }
    }
    // step the machine shown, then bring the others to the same time
    step(k, kind) {
      const m = this.machines[k];
      m.step(kind);
      m.run(m.time + 600 * SEC, 5e6);
      m.paused = false; m.stepMode = null;
      for (const o of this.machines) if (o !== m) o.run(m.time, 5e6);
      this.clock = m.time;
    }
  }

  // ========================================================================
  // Settings: the YAML of a ```superloop block
  // ========================================================================
  const KEYS = ['title', 'task', 'code', 'variants', 'variant', 'inputs', 'outputs', 'active', 'setup', 'uses', 'terminal',
    'enter', 'watch', 'timeline', 'window', 'params', 'show', 'controls', 'speed', 'speeds', 'line_time', 'seed', 'script',
    'run', 'print', 'goal', 'answer_script', 'answer', 'undefined_behavior', 'editable'];
  const LATER = {uses: 'a later version (the button and blinker libraries)', terminal: 'a later version (printf and a terminal)',
    enter: 'a later version (printf and a terminal)'};
  const INPUT_KINDS = ['button', 'hold button', 'pin', 'bouncy button', 'bouncy hold button', 'bouncy pin'];
  const LED_COLORS = {led: 'red', 'red led': 'red', 'green led': 'green', 'amber led': 'amber', 'yellow led': 'yellow',
    'blue led': 'blue', 'white led': 'white'};
  const isMap = v => v && typeof v === 'object' && !Array.isArray(v);
  const listOf = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const clean = v => String(v).trim().replace(/\s+/g, ' ');
  function oneOf(key, v, allowed) {
    const s = clean(v);
    if (!allowed.includes(s)) throw new Error(`${key}: "${s}" is not allowed. Write ${allowed.slice(0, -1).join(', ')} or ${allowed[allowed.length - 1]}`);
    return s;
  }
  // a time: 500 ms, 4 s, 1 us, 10 µs, 2.5s; a plain number is in seconds -> ns
  function duration(v, key) {
    const s = clean(v).replace(',', '.');
    const m = /^(\d+(?:\.\d*)?|\.\d+)\s*(ns|us|µs|ms|s)?$/.exec(s);
    if (!m) throw new Error(`${key}: "${s}" is not a time. Write a number and a unit, e.g. 500 ms, 4 s or 1 us`);
    return Number(m[1]) * {ns: 1, us: US, 'µs': US, ms: MS, s: SEC, undefined: SEC}[m[2]];
  }
  // a speed: 1 (real time), slower 1/10, 1/100, faster 2 -> the factor, 1/1000 to 100
  function speedOf(v, key) {
    const s = clean(v);
    let m, x = NaN;
    if ((m = /^1 ?\/ ?(\d+)$/.exec(s))) x = 1 / Number(m[1]);
    else if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) x = Number(s);
    if (!(x >= 0.001 && x <= 100)) throw new Error(`${key}: "${s}" is not a speed. Write 1 (real time), slower 1/10 or 1/100, faster 2 or 10`);
    return x;
  }
  function speedLabel(x) {
    if (x >= 1) return `${Number(x.toFixed(2))}×`;
    const n = Math.round(1 / x);
    return Math.abs(1 / n - x) < 1e-9 ? `1/${n}×` : `${x}×`;
  }
  // the speed buttons when the YAML has none (as the state machines choose them):
  // slower for times under 100 ms (under 20 ms, or bounces: 1/100 too), faster for long times
  function autoSpeeds(times) {
    if (!times.length) return [1];
    const min = Math.min(...times), max = Math.max(...times);
    const slower = min < 20 ? [0.01, 0.1] : min < 100 ? [0.1] : [];
    const faster = [2, 5, 10, 20, 50, 100].filter(f => max / f >= 1000).slice(-3);
    return [...slower, 1, ...faster];
  }

  // 2 s, 0.3 s, 0.152 s
  function fmtSec(ns) { return `${Number((ns / SEC).toFixed(3))} s`; }

  // a script: scripted input for the PDF, the tests and the answers
  //   BUTTON_PIN press at 300 ms for 400 ms   BUTTON_PIN press at 2 s   SWITCH high at 1 s   BUTTON_PIN release at 3 s
  function readScript(list, key, inputs, runNs) {
    if (list != null && !Array.isArray(list)) throw new Error(`${key}: write one step per line, each after a dash, e.g. - BUTTON_PIN press at 300 ms for 400 ms`);
    const steps = [], last = {};
    listOf(list).forEach((raw, k) => {
      const where = `${key}, step ${k + 1}`, text = clean(raw);
      if (/^(terminal|type)\b/.test(text)) throw new Error(`${where}: "${text}": the terminal belongs to a later version`);
      const m = /^(\S+)\s+(press|release|high|low)\s+at\s+(.+?)(?:\s+for\s+(.+))?$/.exec(text);
      if (!m) throw new Error(`${where}: "${text}" is not a step. Write e.g. BUTTON_PIN press at 300 ms for 400 ms, or SWITCH high at 1 s`);
      const dev = inputs.find(d => d.name === m[1] || d.key === m[1] || d.name === `GP${m[1]}`);
      if (!dev) throw new Error(`${where}: ${m[1]} is not an input (the inputs: ${inputs.map(d => d.name).join(', ') || 'none'})`);
      const pin = dev.kind === 'pin', level = m[2] === 'high' || m[2] === 'low';
      if (pin !== level) throw new Error(`${where}: ${dev.name} is ${pin ? 'a pin: write high or low' : `a ${dev.kind}: write press or release`}`);
      const down = m[2] === 'press' || m[2] === 'high';
      if (m[4] != null && !down) throw new Error(`${where}: "for" goes with press or high`);
      const at = duration(m[3], where);
      const len = m[4] != null ? duration(m[4], where) : dev.kind === 'button' && down ? 150 * MS : null;
      if (last[dev.name] !== undefined && at < last[dev.name]) throw new Error(`${where}: the steps of ${dev.name} must be in time order`);
      const end = len != null ? at + len : at;
      if (runNs != null && end > runNs) throw new Error(`${where}: ${fmtSec(end)} is after the end of the run (${fmtSec(runNs)}; set run: to change it)`);
      last[dev.name] = end;
      steps.push({name: dev.name, kind: dev.kind, down, at, len});
    });
    return steps;
  }
  // a script in words: BUTTON_PIN pressed at 0.3 s for 0.4 s, SWITCH high at 1 s
  function scriptWords(steps) {
    return steps.map(st => {
      if (st.kind === 'pin') return `${st.name} ${st.down ? 'high' : 'low'} at ${fmtSec(st.at)}${st.len != null ? ` for ${fmtSec(st.len)}` : ''}`;
      if (!st.down) return `${st.name} released at ${fmtSec(st.at)}`;
      if (st.kind === 'button' && st.len === 150 * MS) return `${st.name} clicked at ${fmtSec(st.at)}`;
      return `${st.name} pressed at ${fmtSec(st.at)}${st.len != null ? ` for ${fmtSec(st.len)}` : ' and held'}`;
    }).join(', ');
  }
  // a goal: {variant, vars: [{name, value}], outputs: [{name, on}], maxPresses}
  function readGoal(g, variants, outputs) {
    if (!isMap(g)) throw new Error('goal: write vars: {armed: false} and/or outputs: {LED_PIN: off}');
    for (const k of Object.keys(g)) if (!['variant', 'vars', 'outputs', 'max_presses'].includes(k)) throw new Error(`goal: "${k}" is not part of a goal (variant, vars, outputs, max_presses)`);
    let vi = 0;
    if (variants.length > 1 && g.variant == null) throw new Error(`goal: with variants, a goal names its variant, e.g. variant: ${variants[variants.length - 1].name}`);
    if (g.variant != null) {
      vi = variants.findIndex(v => v.name === clean(g.variant));
      if (vi < 0) throw new Error(`goal, variant: "${g.variant}" is not one of the variants (${variants.map(v => v.name).join(', ')})`);
    }
    const prog = variants[vi].prog, of = variants.length > 1 ? `the variant ${variants[vi].name}` : 'the program';
    if (g.vars != null && !isMap(g.vars)) throw new Error('goal, vars: write name: value, e.g. vars: {armed: false}');
    if (g.outputs != null && !isMap(g.outputs)) throw new Error('goal, outputs: write name: on or off, e.g. outputs: {LED_PIN: off}');
    const vars = Object.entries(g.vars || {}).map(([name, v]) => {
      const sym = prog.lookup(name);
      if (!sym || sym.device) throw new Error(`goal, vars: ${name} is not a variable of ${of}`);
      let value;
      if (v === true || v === false) value = v ? 1 : 0;
      else {
        const t = clean(v);
        if (!/^-?(0x[0-9a-f]+|0b[01]+|\d+)$/i.test(t)) throw new Error(`goal, vars, ${name}: "${t}" is not a number, true or false`);
        const big = t.startsWith('-') ? -BigInt(t.slice(1)) : BigInt(t);
        value = sym.type.big ? big : Number(big);
      }
      return {name, value};
    });
    const outs = Object.entries(g.outputs || {}).map(([name, v]) => {
      const dev = outputs.find(d => d.name === name || d.key === name);
      if (!dev) throw new Error(`goal, outputs: ${name} is not an output`);
      return {name: dev.name, on: oneOf(`goal, outputs, ${name}`, v === true ? 'on' : v === false ? 'off' : v, ['on', 'off']) === 'on'};
    });
    if (!vars.length && !outs.length) throw new Error('goal: it asks for nothing. Write vars: {…} or outputs: {…}');
    let maxPresses = null;
    if (g.max_presses != null) {
      maxPresses = Number(g.max_presses);
      if (!Number.isInteger(maxPresses) || maxPresses < 1) throw new Error(`goal, max_presses: a whole number from 1, not ${g.max_presses}`);
    }
    return {variant: vi, vars, outputs: outs, maxPresses};
  }
  // what the goal asks, in words: armed is false and LED_PIN is off
  const goalWords = gl => [...gl.vars.map(v => `${v.name} is ${fmtGoalValue(v.value)}`), ...gl.outputs.map(o => `${o.name} is ${o.on ? 'on' : 'off'}`)].join(' and ');
  const fmtGoalValue = v => (v === 1 || v === 0 ? (v ? 'true' : 'false') : String(v));

  // the top-level names a program declares itself, with their constant values when they have one
  function declaredNames(src) {
    try {
      const ast = parse(src);
      const out = new Map();
      for (const d of ast.globals) for (const v of d.decls) out.set(v.name, v);
      return out;
    } catch (e) { return new Map(); }
  }

  /*
   * readConfig(yaml object) -> everything the widget needs, checked; throws Error with a message for the author.
   * Compiles every variant.
   */
  function readConfig(c) {
    if (!isMap(c)) throw new Error('a superloop block is YAML with code: (or variants:), inputs: and outputs:');
    const warnings = [];
    for (const k of Object.keys(c)) {
      if (!KEYS.includes(k)) throw new Error(`"${k}" is not a setting of a superloop block`);
      if (LATER[k]) warnings.push(`${k}: belongs to ${LATER[k]}; ignored`);
    }
    if ((c.code == null) === (c.variants == null)) throw new Error('write either code: (one program) or variants: (several, as tabs)');
    let variants;
    if (c.code != null) variants = [{name: 'program', src: String(c.code)}];
    else {
      if (!isMap(c.variants) || !Object.keys(c.variants).length) throw new Error('variants: write one program per name, e.g. sleeping: | …');
      variants = Object.entries(c.variants).map(([name, src]) => ({name, src: String(src ?? '')}));
    }
    let shown = 0;
    if (c.variant != null) {
      shown = variants.findIndex(v => v.name === clean(c.variant));
      if (shown < 0) throw new Error(`variant: "${c.variant}" is not one of the variants (${variants.map(v => v.name).join(', ')})`);
    }
    const active = c.active == null ? 'high' : oneOf('active', c.active, ['high', 'low']);
    const setup = c.setup == null ? 'auto' : oneOf('setup', c.setup, ['auto', 'code']);
    const ubMode = c.undefined_behavior == null ? 'stop' : oneOf('undefined_behavior', c.undefined_behavior, ['stop', 'permit']);

    // devices: names of pin constants (or GPIO numbers: 15: red led)
    const devName = n => (/^\d+$/.test(String(n)) ? `GP${n}` : String(n));
    const inputs = [], outputs = [];
    if (c.inputs != null && !isMap(c.inputs)) throw new Error('inputs: write one input per line, e.g. BUTTON_PIN: hold button');
    if (c.outputs != null && !isMap(c.outputs)) throw new Error('outputs: write one output per line, e.g. LED_PIN: red led');
    for (const [n, kind] of Object.entries(c.inputs || {})) {
      const k = clean(kind);
      if (!INPUT_KINDS.includes(k)) throw new Error(`inputs, ${n}: "${k}" is not an input. Inputs are: ${INPUT_KINDS.join(', ')}`);
      inputs.push({name: devName(n), key: String(n), kind: k.replace('bouncy ', ''), bouncy: k.startsWith('bouncy'), gpio: /^\d+$/.test(String(n)) ? Number(n) : null});
    }
    for (const [n, kind] of Object.entries(c.outputs || {})) {
      const k = clean(kind);
      if (!(k in LED_COLORS) && k !== 'buzzer') throw new Error(`outputs, ${n}: "${k}" is not an output. Outputs are: ${[...Object.keys(LED_COLORS), 'buzzer'].join(', ')}`);
      outputs.push({name: devName(n), key: String(n), kind: k === 'buzzer' ? 'buzzer' : 'led', color: LED_COLORS[k], gpio: /^\d+$/.test(String(n)) ? Number(n) : null});
    }
    const devices = [...inputs, ...outputs];
    const names = new Set();
    for (const d of devices) { if (names.has(d.name)) throw new Error(`${d.name} is both an input and an output`); names.add(d.name); }

    // a device's GPIO: the program's constant, else the course's wiring (outputs GP15, 14, …; inputs GP16, 17, …)
    const declared = variants.map(v => declaredNames(v.src));
    for (const d of devices) {
      if (d.gpio !== null) continue;
      for (const decl of declared) {
        const v = decl.get(d.name);
        if (v && v.init && v.init.k === 'num') {
          const g = Number(v.init.tok.value);
          if (d.gpio !== null && d.gpio !== g) throw new Error(`${d.name} is GP${d.gpio} in one variant and GP${g} in another`);
          d.gpio = g; d.fromCode = true;
        }
      }
    }
    const used = new Set(devices.filter(d => d.gpio !== null).map(d => d.gpio));
    let nextOut = 15, nextIn = 16;
    for (const d of outputs) if (d.gpio === null) { while (used.has(nextOut)) nextOut--; d.gpio = nextOut; used.add(nextOut); d.byWidget = true; }
    for (const d of inputs) if (d.gpio === null) { while (used.has(nextIn)) nextIn++; d.gpio = nextIn; used.add(nextIn); d.byWidget = true; }
    const byGpio = new Map();
    for (const d of devices) {
      if (d.gpio < 0 || d.gpio >= NGPIO) throw new Error(`${d.name} is GP${d.gpio}, but the Pico has GPIO 0 to 29`);
      if (byGpio.has(d.gpio)) throw new Error(`${byGpio.get(d.gpio)} and ${d.name} are both on GP${d.gpio}`);
      byGpio.set(d.gpio, d.name);
    }

    // compile every variant; the pins the code does not declare are declared by the widget
    for (const [k, v] of variants.entries()) {
      const own = declared[k];
      const pinConsts = devices.filter(d => !own.has(d.name) && !/^GP\d+$/.test(d.name)).map(d => ({name: d.name, gpio: d.gpio}));
      try { v.prog = compile(v.src, {devices: pinConsts, ub: ubMode}); }
      catch (e) { throw new Error(`${variants.length > 1 ? `variant ${v.name}: ` : ''}${e.message}`); }
      for (const w of v.prog.warnings) warnings.push(`${variants.length > 1 ? `variant ${v.name}: ` : ''}${w}`);
      // a device's name in the code is its pin number
      for (const d of devices) {
        const sym = own.has(d.name) && v.prog.lookup(d.name);
        if (sym && !(sym.global && sym.isConst && sym.constValue !== undefined))
          throw new Error(`${variants.length > 1 ? `variant ${v.name}: ` : ''}${d.name} is the name of an ${inputs.includes(d) ? 'input' : 'output'}, so it must be a pin number: const uint ${d.name} = ${d.gpio};`);
      }
    }

    // watch:, timeline:, params: name things in the programs
    const symIn = (v, name) => v.prog.lookup(name);
    const watch = listOf(c.watch).map(w => {
      const [name, fmtx] = clean(w).split(/\s*:\s*/);
      if (fmtx && fmtx !== 'hex') throw new Error(`watch: "${w}": write a name, or name:hex`);
      const missing = variants.filter(v => !symIn(v, name));
      if (missing.length === variants.length) throw new Error(`watch: ${name} is not a variable of the program`);
      return {name, hex: fmtx === 'hex'};
    });
    const timeline = c.timeline == null ? ['cpu', ...inputs.map(d => d.name), ...outputs.map(d => d.name)] : listOf(c.timeline).map(clean);
    const lanes = timeline.map(n => {
      if (n === 'cpu') return {kind: 'cpu', name: 'cpu'};
      const dn = devName(n), dev = devices.find(d => d.name === dn);
      if (dev) return {kind: inputs.includes(dev) ? 'input' : 'output', name: dn, dev};
      const syms = variants.map(v => symIn(v, n)).filter(Boolean);
      if (!syms.length) throw new Error(`timeline: ${n} is not cpu, an input, an output or a variable of the program`);
      if (!syms.every(s => s.type.time)) throw new Error(`timeline: ${n} is not an absolute_time_t variable; only those can be on the timeline`);
      return {kind: 'deadline', name: n};
    });
    const params = [];
    const pspec = c.params == null ? [] : Array.isArray(c.params) ? c.params.map(n => [n, {}]) : isMap(c.params) ? Object.entries(c.params) : null;
    if (!pspec) throw new Error('params: write a list of constants, e.g. [DELAY_MS], or DELAY_MS: {min: 0, max: 2000}');
    for (const [n, opt] of pspec) {
      const name = clean(n);
      let orig = null;
      for (const v of variants) {
        const g = v.prog.globals.find(x => x.name === name && !x.sym.device);
        if (!g) continue;
        if (!g.isConst || !g.literal) throw new Error(`params: ${name} must be a const integer with a number as its value, e.g. const uint32_t ${name} = 500;`);
        orig = g.value;
      }
      if (orig === null) throw new Error(`params: ${name} is not a constant of the program`);
      const o = isMap(opt) ? opt : {};
      const ov = Number(orig);
      params.push({name, value: ov, min: o.min != null ? Number(o.min) : 0, max: o.max != null ? Number(o.max) : Math.max(10, 10 * ov)});
    }
    const show = listOf(c.show).map(s => oneOf('show', s, ['iterations', 'sleep']));
    const controls = c.controls == null ? ['speed'] : listOf(c.controls).map(s => oneOf('controls', s, ['speed', 'step', 'bounce']));
    const speed = c.speed == null ? 1 : speedOf(c.speed, 'speed');
    let speeds;
    if (c.speeds != null) speeds = listOf(c.speeds).map((s, k) => speedOf(s, `speeds, ${k + 1}`));
    else {
      const times = variants.flatMap(v => v.prog.sdkTimes);
      if (inputs.some(d => d.bouncy)) times.push(1);
      speeds = autoSpeeds(times);
    }
    if (!speeds.some(s => Math.abs(s - speed) < 1e-9)) speeds = [...speeds, speed].sort((a, b) => a - b);
    const lineTime = c.line_time == null ? US : duration(c.line_time, 'line_time');
    if (lineTime < 10 || lineTime > MS) throw new Error('line_time: between 10 ns and 1 ms');
    const window = c.window == null ? 4 * SEC : duration(c.window, 'window');
    if (window < 10 * US || window > 600 * SEC) throw new Error('window: between 10 us and 10 minutes');
    const run = c.run == null ? null : duration(c.run, 'run');
    if (run !== null && (run <= 0 || run > 60 * SEC)) throw new Error('run: more than 0 and at most 60 s');
    const print = c.print == null ? 'all' : oneOf('print', c.print, ['all', 'one']);
    const script = readScript(c.script, 'script', inputs, run ?? 3 * SEC);
    const goal = c.goal == null ? null : readGoal(c.goal, variants, outputs);
    const answerRun = run ?? 10 * SEC;
    const answerScript = c.answer_script == null ? null : readScript(c.answer_script, 'answer_script', inputs, answerRun);
    if (goal && (!answerScript || c.answer == null)) warnings.push('goal: it needs answer_script (presses that reach it) and answer (the text for the PDF); without them, the PDF has no exercise');
    if (!goal && (answerScript || c.answer != null)) warnings.push('answer_script and answer belong to a goal, and there is none');
    if (goal && answerScript && goal.maxPresses !== null) {
      const n = answerScript.filter(st => st.down).length;
      if (n > goal.maxPresses) warnings.push(`goal: the answer_script has ${n} presses, but max_presses is ${goal.maxPresses}`);
    }
    const tracked = lanes.filter(l => l.kind === 'deadline').map(l => l.name).concat(watch.filter(w => variants.some(v => (symIn(v, w.name) || {type: {}}).type.time)).map(w => w.name));
    return {title: c.title != null ? String(c.title) : null, task: c.task != null ? String(c.task) : null,
      variants, shown, active, setup, ub: ubMode, inputs, outputs, devices, watch, lanes, params, show, controls, speed,
      speeds, lineTime, window, seed: c.seed != null ? Number(c.seed) : 1, tracked: [...new Set(tracked)], warnings,
      run: run ?? 3 * SEC, print, script, goal, answerRun, answerScript, answer: c.answer != null ? String(c.answer) : null};
  }

  // ========================================================================
  // Drawing helpers (DOM in the browser, SVG text for the PDF)
  // ========================================================================
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(3)) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null) continue;
      if (k === 'text') el.textContent = v; else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(3)) if (kid) el.append(kid);
    return el;
  }
  const XML = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'};
  const xml = s => String(s).replace(/[&<>"]/g, ch => XML[ch]);
  class SvgText {
    constructor(tag, attrs) {
      this.tag = tag; this.attrs = tag === 'svg' ? {xmlns: SVGNS} : {}; this.kids = [];
      for (const [k, v] of Object.entries(attrs || {})) { if (v == null) continue; if (k === 'text') this.kids.push(String(v)); else this.attrs[k] = v; }
    }
    append(...kids) { for (const k of kids.flat(3)) if (k) this.kids.push(k); }
    toString() {
      const attrs = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${xml(v)}"`).join('');
      return `<${this.tag}${attrs}>${this.kids.map(k => (typeof k === 'string' ? xml(k) : k.toString())).join('')}</${this.tag}>`;
    }
  }
  function svgText(tag, attrs, ...kids) { const n = new SvgText(tag, attrs); n.append(...kids); return n; }

  let uid = 0;
  const r1 = x => Math.round(x * 10) / 10;
  // 37.2 ms, 1.20 s, 12 µs
  function fmtDur(ns) {
    ns = Math.max(0, ns);
    if (ns < US) return `${Math.round(ns)} ns`;
    if (ns < MS) return `${Number((ns / US).toPrecision(3))} µs`;
    if (ns < SEC) return `${Number((ns / MS).toPrecision(3))} ms`;
    return `${(ns / SEC).toFixed(2)} s`;
  }
  // how bright light looks: CIE lightness L* of the luminance y (0..1), as 0..1. Half the time on looks 76 % bright.
  const lightness = y => (y <= 216 / 24389 ? y * 24389 / 2700 : 1.16 * Math.cbrt(y) - 0.16);
  const group = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  // ========================================================================
  // Syntax colours: Pandoc's classes, as in the course's code blocks
  // ========================================================================
  const CF = new Set(['if', 'else', 'while', 'do', 'for', 'break', 'continue', 'return', 'switch', 'case', 'default', 'goto']);
  const DT = new Set(['int', 'char', 'short', 'long', 'void', 'bool', '_Bool', 'unsigned', 'signed', 'float', 'double']);
  // the source as lines of [text, class, token]
  function highlight(prog) {
    const src = prog.src, segs = [];
    for (const t of prog.ast.toks) {
      if (t.k === 'eof') continue;
      let cls = '';
      if (t.k === 'kw') cls = CF.has(t.v) ? 'cf' : DT.has(t.v) ? 'dt' : 'kw';
      else if (t.k === 'id' && t.v in TYPEDEFS) cls = 'dt';
      else if (t.k === 'num') cls = t.radix === 10 ? 'dv' : 'bn';
      else if (t.k === 'char') cls = 'ch';
      else if (t.k === 'op') cls = 'op';
      segs.push({pos: t.pos, end: t.end, cls, tok: t});
    }
    for (const c of prog.ast.comments) segs.push({pos: c.pos, end: c.end, cls: c.pp ? 'pp' : 'co'});
    segs.sort((a, b) => a.pos - b.pos);
    const lines = [[]];
    const push = (text, cls, tok) => {
      const parts = text.split('\n');
      parts.forEach((p, k) => { if (k) lines.push([]); if (p) lines[lines.length - 1].push([p, cls, k === 0 ? tok : null]); });
    };
    let at = 0;
    for (const s of segs) {
      if (s.pos < at) continue;
      if (s.pos > at) push(src.slice(at, s.pos), '', null);
      push(src.slice(s.pos, s.end), s.cls, s.tok);
      at = s.end;
    }
    if (at < src.length) push(src.slice(at), '', null);
    return lines;
  }
  // lines of `a` that are not in `b` (longest common subsequence, ignoring indentation)
  function changedLines(a, b) {
    const A = a.map(s => s.trim()), B = b.map(s => s.trim());
    const n = A.length, m = B.length;
    const L = Array.from({length: n + 1}, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = new Set();
    let i = 0, j = 0;
    while (i < n) {
      if (j < m && A[i] === B[j]) { i++; j++; }
      else if (j < m && L[i][j + 1] >= L[i + 1][j]) j++;
      else { if (A[i]) out.add(i + 1); i++; }
    }
    return out;
  }

  // ========================================================================
  // The timeline: the last `window` of simulated time, now at 80 % of the width
  // ========================================================================
  // pieces of a Track between ta and tb: {lvl: v, a, b} and {band, a, b, n, on}; `extra`: one more change {t, v}
  function pieces(track, ta, tb, extra) {
    let ch = track.ch;
    if (extra) ch = ch.concat([extra]);
    let lo = 0, hi = ch.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ch[mid].t <= ta) lo = mid; else hi = mid - 1; }
    const out = [];
    for (let k = lo; k < ch.length; k++) {
      const e = ch[k], next = k + 1 < ch.length ? ch[k + 1].t : Infinity;
      if (e.t >= tb) break;
      let s = e.t;
      if (e.band) {
        const a = Math.max(e.t, ta), b = Math.min(e.end, tb);
        if (b > a) out.push({band: true, a, b, n: e.n * (b - a) / Math.max(1, e.end - e.t), on: e.on * (b - a) / Math.max(1, e.end - e.t)});
        s = e.end;
      }
      const a = Math.max(s, ta), b = Math.min(next, tb);
      if (b > a) out.push({lvl: e.v, a, b});
    }
    return out;
  }
  // pieces narrower than minPx (in ns) merge into bands: what a pixel can show
  function mergeNarrow(ps, minNs) {
    const out = [];
    for (const p of ps) {
      const narrow = p.band || p.b - p.a < minNs;
      const last = out[out.length - 1];
      if (narrow) {
        const add = p.band ? {n: p.n, on: p.on} : {n: 1, on: p.lvl === 1 ? p.b - p.a : 0};
        if (last && last.band) { last.b = p.b; last.n += add.n; last.on += add.on; }
        else out.push({band: true, a: p.a, b: p.b, n: add.n, on: add.on});
      } else if (last && !last.band && last.lvl === p.lvl) last.b = p.b;
      else out.push(Object.assign({}, p));
    }
    // a band only a hair wide next to wide levels is just an edge
    return out.filter(p => !(p.band && p.n <= 1));
  }

  /*
   * drawTimeline(machine, cfg, {width, now, id, t0, t1}, make) -> an <svg> (DOM with sv, text with svgText)
   * In the browser, the last `window` with now at 80 % of the width; with t0 and t1 (the PDF), that
   * stretch of a finished run: no now, no future, no deadline flags.
   */
  function drawTimeline(m, cfg, o, make) {
    const W = o.width, LW = 132, R = 14, AX = 20;
    const x0 = LW, pw = Math.max(60, W - R - x0), x1 = x0 + pw;
    const fixed = o.t1 != null, now = o.now;
    const win = fixed ? o.t1 - o.t0 : cfg.window, t0 = fixed ? o.t0 : now - 0.8 * win, t1 = t0 + win;
    const X = t => x0 + (t - t0) / win * pw;
    const px = win / pw;            // ns per pixel
    const xNow = X(now);
    const id = o.id;
    const rows = cfg.lanes;
    const heights = rows.map(l => (l.kind === 'cpu' ? 26 : 36));
    const lanesTop = AX + 4;
    const H = lanesTop + heights.reduce((a, b) => a + b, 0) + 4;
    const kids = [make('defs', {},
      make('pattern', {id: `${id}-hatch`, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)'},
        make('line', {x1: 0, y1: 0, x2: 0, y2: 5, class: 'sl-tl-hatchline'})),
      make('pattern', {id: `${id}-sleep`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)'},
        make('rect', {x: 0, y: 0, width: 6, height: 6, class: 'sl-tl-sleepbg'}),
        make('line', {x1: 0, y1: 0, x2: 0, y2: 6, class: 'sl-tl-sleepline'})),
      make('pattern', {id: `${id}-busy`, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)'},
        make('rect', {x: 0, y: 0, width: 5, height: 5, class: 'sl-tl-busybg'}),
        make('line', {x1: 0, y1: 0, x2: 0, y2: 5, class: 'sl-tl-busyline'})),
      make('clipPath', {id: `${id}-plot`}, make('rect', {x: x0, y: 0, width: pw, height: H})))];
    const plot = [];
    // time axis: about one label per 90 px
    const raw = win / (pw / 90);
    const p10 = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map(f => f * p10).find(s => s >= raw);
    const label = t => (step >= 100 * MS || t >= SEC && step >= 10 * MS ? `${Number((t / SEC).toFixed(step >= SEC ? 0 : step >= 100 * MS ? 1 : 2))} s`
      : step >= 100 * US ? `${Number((t / MS).toFixed(step >= MS ? 0 : 1))} ms` : `${Number((t / US).toFixed(0))} µs`);
    if (!fixed) plot.push(make('rect', {x: xNow, y: AX - 2, width: x1 - xNow, height: H - AX, class: 'sl-tl-future'}));
    for (let t = Math.ceil(Math.max(0, t0) / step) * step; t <= t1; t += step) {
      const x = X(t);
      plot.push(make('line', {x1: r1(x), y1: AX - 3, x2: r1(x), y2: H, class: 'sl-tl-grid'}));
      // a label at the right edge ends there instead of running out of the picture
      if (fixed || Math.abs(x - xNow) > 24) kids.push(make('text', {x: r1(x), y: AX - 7, class: 'sl-tl-tick', text: label(t), 'text-anchor': x > W - 22 ? 'end' : null}));
    }
    if (t0 < 0) plot.push(make('rect', {x: x0, y: AX - 2, width: Math.max(0, X(0) - x0), height: H - AX, class: 'sl-tl-before'}));
    const tA = Math.max(0, t0), tN = Math.min(now, t1);

    // a level signal from pieces: one path, hatched bands where it toggles faster than a pixel shows
    function level(ps, hiY, loY, cls, rates) {
      let d = '', dz = '', prevY = null;
      for (const p of ps) {
        const xa = r1(X(p.a)), xb = r1(X(p.b));
        if (p.band) {
          plot.push(make('rect', {x: xa, y: hiY, width: Math.max(1, xb - xa), height: loY - hiY, class: `sl-tl-band ${cls}`, fill: `url(#${id}-hatch)`}));
          const hz = p.n / 2 / ((p.b - p.a) / SEC);
          if (rates && xb - xa > 96) plot.push(make('text', {x: r1((xa + xb) / 2), y: hiY - 1.5, class: 'sl-tl-bandlbl', text: `toggling at ${hz >= 1000 ? `${Number((hz / 1000).toPrecision(3))} kHz` : `${Number(hz.toPrecision(3))} Hz`}`}));
          prevY = null;
          continue;
        }
        if (p.lvl === 3) { prevY = null; continue; }    // not read yet
        if (p.lvl === 2) { dz += `M${xa} ${(hiY + loY) / 2}H${xb}`; prevY = null; continue; }
        const yy = p.lvl ? hiY : loY;
        d += prevY === null ? `M${xa} ${yy}` : `V${yy}`;
        d += `H${xb}`;
        prevY = yy;
      }
      if (d) plot.push(make('path', {d, class: `sl-tl-sig ${cls}`}));
      if (dz) plot.push(make('path', {d: dz, class: 'sl-tl-sig z'}));
    }
    // the value of a track at t
    function valueAt(track, t) {
      const ch = track.ch;
      let lo = 0, hi = ch.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ch[mid].t <= t) lo = mid; else hi = mid - 1; }
      const e = ch[lo];
      return e.band && t < e.end ? 1 : e.v;
    }
    // the moments the program read an input, on its signal: a dot for a read that stands alone; where
    // reads come closer than a dot, a highlight over the stretch the program read all the time
    function reads(dev, track, hiY, loY) {
      const runs = [];
      for (const r of dev.reads.list) {
        if (r.t1 < tA || r.t0 > tN) continue;
        const a = Math.max(r.t0, tA), b = Math.min(r.t1, tN), last = runs[runs.length - 1];
        if (last && X(a) - X(last.b) < 9) last.b = b; else runs.push({a, b});
      }
      const under = [], over = [];
      for (const run of runs) {
        if (X(run.b) - X(run.a) < 3) {
          const v = valueAt(track, run.a);
          over.push(make('circle', {cx: r1(X(run.a)), cy: v === 1 ? hiY : v === 0 ? loY : (hiY + loY) / 2, r: 3.9, class: 'sl-tl-dot'}));
          continue;
        }
        let d = '', prevY = null;
        for (const p of mergeNarrow(pieces(track, run.a, run.b), 2 * px)) {
          const pa = r1(X(p.a)), pb = r1(X(p.b));
          if (p.band) { under.push(make('rect', {x: pa, y: hiY - 4, width: Math.max(1, pb - pa), height: loY - hiY + 8, class: 'sl-tl-watchedband'})); prevY = null; continue; }
          if (p.lvl > 1) { prevY = null; continue; }
          const yy = p.lvl ? hiY : loY;
          d += prevY === null ? `M${pa} ${yy}` : `V${yy}`;
          d += `H${pb}`;
          prevY = yy;
        }
        if (d) under.push(make('path', {d, class: 'sl-tl-watched'}));
      }
      return {under, over};
    }

    let y = lanesTop;
    rows.forEach((lane, li) => {
      const lh = heights[li], hiY = y + 7, loY = y + lh - 11;
      const sub = lane.kind === 'cpu' ? 'the processor' : lane.kind === 'deadline' ? 'time_reached()' : `GP${lane.dev.gpio}, ${lane.kind}`;
      kids.push(make('text', {x: x0 - 10, y: y + lh / 2 - 1, class: `sl-tl-name ${lane.kind}`, text: lane.name}));
      kids.push(make('text', {x: x0 - 10, y: y + lh / 2 + 10, class: `sl-tl-sub ${lane.kind}`, text: sub}));
      plot.push(make('line', {x1: x0, y1: y + lh - 1, x2: x1, y2: y + lh - 1, class: 'sl-tl-sep'}));
      if (lane.kind === 'cpu') {
        for (const p of mergeNarrow(pieces(m.cpu, tA, tN), 2 * px)) {
          const xa = X(p.a), w = Math.max(0.8, X(p.b) - xa);
          const cls = p.band ? 'mixed' : CPU_NAMES[p.lvl];
          const fill = cls === 'asleep' ? `url(#${id}-sleep)` : cls === 'busy' ? `url(#${id}-busy)` : cls === 'mixed' ? `url(#${id}-hatch)` : null;
          plot.push(make('rect', {x: r1(xa), y: y + 5, width: r1(w), height: lh - 14, class: `sl-tl-cpu ${cls}`, fill}));
          if (w > 58 && !p.band) plot.push(make('text', {x: r1(xa + w / 2), y: y + lh / 2 + 0.5, class: `sl-tl-cpulbl ${cls}`, text: CPU_NAMES[p.lvl]}));
        }
      } else if (lane.kind === 'input') {
        const dev = m.inputs[lane.name];
        // presses the program never read (under the signal)
        for (const p of dev.presses) {
          if (p.t1 === null || p.t1 < tA || p.t0 > tN) continue;
          if (dev.reads.list.some(r => r.t1 >= p.t0 && r.t0 <= p.t1)) continue;
          const why = m.cpu.share(p.t0, p.t1) > 0.999 ? 'the program was asleep (sleep_ms) the whole time' : 'the program was busy elsewhere';
          const xa = X(Math.max(p.t0, t0)), xb = X(p.t1);
          plot.push(make('rect', {x: r1(xa), y: hiY - 4, width: r1(Math.max(2, xb - xa)), height: loY - hiY + 8, rx: 2, class: 'sl-tl-missed'},
            make('title', {text: `This press was never read: ${why}.`})));
        }
        // the highlight under the signal, the dots on it
        const marks = reads(dev, dev.track, hiY, loY);
        plot.push(...marks.under);
        level(mergeNarrow(pieces(dev.track, tA, tN), 2 * px), hiY, loY, 'input');
        plot.push(...marks.over);
      } else if (lane.kind === 'output') {
        level(mergeNarrow(pieces(m.outputs[lane.name].track, tA, tN), 2 * px), hiY, loY, 'output', true);
      } else {
        const rec = m.deadlines[lane.name] ? m.deadlines[lane.name].rec : null;
        if (rec) {
          const extra = rec.cur > 0 && rec.cur <= now && rec.track.v === 0 ? {t: rec.cur, v: 1} : null;
          level(mergeNarrow(pieces(rec.track, tA, tN, extra), 2 * px), hiY, loY, 'deadline');
          if (rec.cur > 0 && !fixed) {
            const xf = X(rec.cur);
            if (xf >= x0 && xf <= x1) {
              const future = rec.cur > now;
              plot.push(make('line', {x1: r1(xf), y1: y + 2, x2: r1(xf), y2: y + lh - 4, class: 'sl-tl-flagpole'}));
              plot.push(make('path', {d: `M${r1(xf)} ${y + 2}h9l-3 3.5l3 3.5h-9z`, class: 'sl-tl-flag'}));
              if (future) {
                const text = `in ${fmtDur(rec.cur - now)}`, room = xf + 14 + text.length * 6 <= x1;
                plot.push(make('text', {x: r1(room ? xf + 12 : xf - 4), y: y + 9, class: 'sl-tl-flaglbl', 'text-anchor': room ? 'start' : 'end', text}));
              }
            }
          }
        }
      }
      y += lh;
    });
    kids.push(make('g', {'clip-path': `url(#${id}-plot)`}, plot));
    if (!fixed) {
      kids.push(make('line', {x1: r1(xNow), y1: AX - 2, x2: r1(xNow), y2: H, class: 'sl-tl-now'}));
      kids.push(make('text', {x: r1(xNow), y: AX - 7, class: 'sl-tl-nowlbl', text: 'now'}));
    }
    return make('svg', {class: 'sl-tl-svg', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': `Timeline of the last ${fmtDur(win)}: ${rows.map(l => l.name).join(', ')}`}, kids);
  }

  // ========================================================================
  // The PDF form (print.js, at build time)
  // ========================================================================
  // the settings of the machines (browser and build)
  function machineCfg(c, extra) {
    return Object.assign({lineTime: c.lineTime, ub: c.ub, setup: c.setup, active: c.active, inputs: c.inputs, outputs: c.outputs,
      tracked: c.tracked, seed: c.seed, gap: c.window / 4000}, extra);
  }
  // every variant, run with scripted presses for runNs (at most 50 million statements each)
  function runScript(c, steps, runNs) {
    const r = new Runner(c.variants.map(v => ({name: v.name, prog: v.prog})),
      // the PDF draws rows of at most a window: details finer than such a row's pixels may merge
      machineCfg(c, {limit: 5e7, keep: Infinity, goal: c.goal, random: seeded(c.seed), gap: Math.min(c.window, runNs) / 4000}));
    r.script(steps, c.inputs);
    r.advance(runNs, Infinity);
    return r;
  }

  // The timeline's styles for the PDF (classes as in the browser, colours fixed: Typst has no page CSS).
  const MONO = 'DejaVu Sans Mono, monospace';
  const INK = {fg: '#494c4e', muted: '#6c757d', paper: '#ffffff', accent: '#009c82', accentDark: '#007a66', warm: '#e87511',
    bad: '#c0392b', grid: '#e4e9ec', sig: '#2f3133', hatch: '#a5b2ae', sleep: '#6c7c8c', sleepSoft: '#e6ebf0', sleepLine: '#b9c4cf',
    cpu: '#006fbf', cpuSoft: '#d9e9f6'};
  const PRINT_STYLE = [
    `.sl-tl-tick{font-size:9.5px;fill:${INK.muted};text-anchor:middle}`, `.sl-tl-grid,.sl-tl-sep{stroke:${INK.grid};stroke-width:1}`,
    `.sl-tl-before{fill:${INK.grid};opacity:.4}`,
    `.sl-tl-name{font-size:11.5px;font-weight:bold;fill:${INK.fg};text-anchor:end}`, `.sl-tl-sub{font-size:9px;fill:${INK.muted};text-anchor:end}`,
    `.sl-tl-sig{fill:none;stroke:${INK.sig};stroke-width:1.7;stroke-linejoin:round}`, `.sl-tl-sig.output{stroke:${INK.warm};stroke-width:2}`,
    `.sl-tl-sig.deadline{stroke:${INK.accentDark}}`, `.sl-tl-sig.z{stroke:${INK.muted};stroke-dasharray:3 3}`,
    `.sl-tl-band{stroke:${INK.sig};stroke-width:1}`, `.sl-tl-band.output{stroke:${INK.warm}}`, `.sl-tl-band.deadline{stroke:${INK.accentDark}}`,
    `.sl-tl-hatchline{stroke:${INK.hatch};stroke-width:1.4}`, `.sl-tl-bandlbl{font-size:9.5px;fill:${INK.fg};text-anchor:middle}`,
    `.sl-tl-dot{fill:${INK.accentDark};stroke:${INK.paper};stroke-width:1.8}`,
    `.sl-tl-watched{fill:none;stroke:${INK.accent};stroke-opacity:.34;stroke-width:9;stroke-linejoin:round}`,
    `.sl-tl-watchedband{fill:${INK.accent};fill-opacity:.2}`,
    `.sl-tl-missed{fill:${INK.bad};fill-opacity:.14;stroke:${INK.bad};stroke-width:1.2;stroke-dasharray:3 2}`,
    `.sl-tl-cpu.running{fill:${INK.cpu}}`, `.sl-tl-cpu.busy,.sl-tl-cpu.mixed{stroke:${INK.cpu};stroke-width:1}`,
    `.sl-tl-busybg{fill:${INK.cpuSoft}}`, `.sl-tl-busyline{stroke:${INK.cpu};stroke-width:1.6}`,
    '.sl-tl-cpu.waiting{fill:#7aa7d6}', '.sl-tl-cpu.stopped{fill:#7d878d}',
    `.sl-tl-sleepbg{fill:${INK.sleepSoft}}`, `.sl-tl-sleepline{stroke:${INK.sleepLine};stroke-width:1.6}`,
    `.sl-tl-cpulbl{font-size:9.5px;text-anchor:middle;dominant-baseline:middle;fill:${INK.paper};font-weight:bold}`,
    `.sl-tl-cpulbl.asleep{fill:${INK.sleep}}`, `.sl-tl-cpulbl.busy{fill:${INK.cpu}}`,
  ].join('');

  // the timeline of a finished run from 0 to runNs: rows of the block's window (at most 12) in one picture
  function timelinePicture(m, c, runNs, W, id) {
    const rowLen = Math.max(Math.min(c.window, runNs), runNs / 12);
    const n = Math.max(1, Math.ceil(runNs / rowLen - 1e-9));
    const rows = [];
    let y = 0;
    for (let k = 0; k < n; k++) {
      const a = k * rowLen, b = Math.min(runNs, a + rowLen);
      const w = k === n - 1 && n > 1 ? Math.round(146 + (W - 146) * (b - a) / rowLen) : W;
      const svg = drawTimeline(m, c, {width: w, now: runNs, id: `${id}-${k}`, t0: a, t1: n > 1 ? a + (b - a) : b}, svgText);
      svg.attrs.x = 0; svg.attrs.y = y;
      rows.push(svg);
      y += Number(svg.attrs.height) + (k < n - 1 ? 10 : 0);
    }
    const H = Math.ceil(y);
    const svg = svgText('svg', {width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'font-family': MONO}, svgText('style', {text: PRINT_STYLE}), rows);
    return {svg: svg.toString(), width: W, height: H};
  }
  // a variable's value for the caption
  function valueText(m, name, hex) {
    const sym = m.prog.lookup(name), v = sym && m.value(sym);
    if (!v) return '–';
    if (!v.init) return 'no value yet';
    if (sym.type.time) return v.v == 0 ? 'not set' : v.v >= I64_MAX ? 'at the end of time' : `${(Number(v.v) / 1e6).toFixed(4)} s`;
    if (sym.type.bool) return v.v ? 'true' : 'false';
    if (hex) return `0x${(typeof v.v === 'bigint' ? BigInt.asUintN(64, v.v) : v.v >>> 0).toString(16).toUpperCase()}`;
    return String(v.v);
  }
  // presses an input had and the ones the program never read
  function missedPresses(m) {
    let all = 0, missed = 0;
    for (const dev of Object.values(m.inputs)) for (const p of dev.presses) {
      if (p.t1 === null || p.t1 > m.time) continue;
      all++;
      if (!dev.reads.list.some(r => r.t1 >= p.t0 && r.t0 <= p.t1)) missed++;
    }
    return {all, missed};
  }
  // With the script: BUTTON_PIN pressed at 0.3 s for 0.4 s. The press was never read. At the end: armed = true.
  function caption(m, c, steps, runNs) {
    const parts = [steps.length ? `With the script: ${scriptWords(steps)}.` : `Without presses, for ${fmtSec(runNs)}.`];
    const {all, missed} = missedPresses(m);
    if (all) parts.push(missed === 0 ? (all === 1 ? 'The press was read.' : 'Every press was read.')
      : all === 1 ? 'The press was never read.' : missed === all ? `None of the ${all} presses was read.` : `${missed} of ${all} presses were never read.`);
    if (m.stopped) parts.push(m.returned ? 'main() returned.' : `The program stopped: ${m.stopped.message}`);
    if (c.watch.length) parts.push(`At the end: ${c.watch.map(w => `${w.name} = ${valueText(m, w.name, w.hex)}`).join(', ')}.`);
    return parts.join(' ');
  }
  // what a run tells the author: a crash, pins a `setup: code` program never sets up
  function runWarnings(m, c, variant) {
    const pre = variant ? `variant ${variant}: ` : '';
    const out = [];
    if (m.stopped && !m.returned) out.push(`${pre}the program stops in the scripted run: ${m.stopped.message}`);
    if (c.setup === 'code') for (const d of c.devices) if (m.pins[d.gpio].func !== SIO)
      out.push(`${pre}setup: code, but the program never sets up ${d.name} (GP${d.gpio}): gpio_init(${/^GP\d+$/.test(d.name) ? d.gpio : d.name}) is missing`);
    return out;
  }
  // the first thing the goal still waits for: armed is still true
  function goalMissing(m, gl) {
    for (const v of gl.vars) { const now = valueText(m, v.name); if (now !== fmtGoalValue(v.value)) return `${v.name} is still ${now}`; }
    for (const o of gl.outputs) if (m.outputs[o.name].level !== (o.on ? 1 : 0)) return `${o.name} is still ${o.on ? 'off' : 'on'}`;
    return 'it is not met';
  }

  /*
   * print(config) -> the PDF form of a block, or {error}:
   *   {title, task, variants: [{name, code, svg, width, height, caption}], exercise, warnings}
   * Every variant (print: one: the one shown first) runs with the script; its timeline is drawn. A goal
   * whose answer_script reaches it becomes an exercise: the code of its variant and the task, and in the
   * answer the text, the script in words and the timeline of that run.
   */
  function print(config) {
    let c;
    try { c = readConfig(config); } catch (e) { return {error: e.message, warnings: []}; }
    const warnings = c.warnings.slice(), multi = c.variants.length > 1, W = 620;   // px: about 8 pt text at the PDF's width
    const code = v => v.src.replace(/\s+$/, '');
    try {
      if (c.goal && c.answerScript && c.answer != null) {
        const r = runScript(c, c.answerScript, c.answerRun), m = r.machines[c.goal.variant];
        if (m.goal.met === null) warnings.push(`goal: the answer_script does not reach the goal (${goalMissing(m, c.goal)} after ${fmtSec(c.answerRun)})`);
        else {
          const v = c.variants[c.goal.variant];
          const end = Math.min(c.answerRun, m.goal.met + Math.max(0.1 * Math.min(c.window, c.answerRun), 50 * MS));
          const exercise = {answer: [{text: c.answer},
            {text: `(${c.answerScript.length ? scriptWords(c.answerScript) : 'No presses'}: ${goalWords(c.goal)} at ${fmtSec(m.goal.met)}.)`}],
            picture: timelinePicture(m, c, end, W, 'answer')};
          return {title: c.title, task: c.task, variants: [{name: multi ? v.name : null, code: code(v)}], exercise, warnings};
        }
      }
      const r = runScript(c, c.script, c.run);
      const which = c.print === 'one' ? [c.shown] : c.variants.map((_, k) => k);
      const variants = which.map(k => {
        const m = r.machines[k], v = c.variants[k];
        warnings.push(...runWarnings(m, c, multi ? v.name : null));
        return Object.assign({name: multi ? v.name : null, code: code(v), caption: caption(m, c, c.script, c.run)},
          timelinePicture(m, c, c.run, W, `v${k}`));
      });
      return {title: c.title, task: c.task, variants, warnings};
    } catch (e) {
      return {error: `the PDF form could not be made: ${e.message}`, warnings};
    }
  }

  // ========================================================================
  // The widget in the browser
  // ========================================================================
  const live = new Set();       // mounted widgets that run
  let lastFrame = 0;
  const reduced = hasDom && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : {matches: false};
  function frameLoop(ts) {
    const dt = lastFrame ? Math.min(100, ts - lastFrame) : 16;
    lastFrame = ts;
    for (const w of live) if (w.visible && !document.hidden) w.frame(dt, ts);
    if (live.size) requestAnimationFrame(frameLoop); else lastFrame = 0;
  }
  const io = hasDom && 'IntersectionObserver' in window
    ? new IntersectionObserver(es => { for (const e of es) if (e.target.slWidget) e.target.slWidget.visible = e.isIntersecting; }, {rootMargin: '100px'}) : null;

  /*
   * mount(host, c) builds the widget of a block's settings (readConfig) in host: {destroy()}
   */
  function mount(host, c) {
    host.replaceChildren();
    const n = ++uid, id = `sl${n}`;
    const multi = c.variants.length > 1;
    const params = Object.fromEntries(c.params.map(p => [p.name, p.value]));
    const bouncy = Object.fromEntries(c.inputs.map(d => [d.name, d.bouncy]));
    let runner, shown = c.shown, running = true, speed = c.speed;
    const W = {visible: !io, frame, destroy() { live.delete(W); if (io) io.unobserve(host); }};
    let tries = 0, answerShown = false;   // challenge: Reset after a try that did not reach the goal

    const makeRunner = () => {
      runner = new Runner(c.variants.map(v => ({name: v.name, prog: v.prog})),
        machineCfg(c, {params, keep: c.window * 1.5, speed, goal: c.goal, random: seeded(Math.floor(Math.random() * 2 ** 31))}));
    };
    makeRunner();
    const M = () => runner.machines[shown];

    // --- header, tabs ------------------------------------------------------------------
    const top = h('div', {class: 'sl'});
    if (c.title) top.append(h('div', {class: 'sl-title', text: c.title}));
    if (c.task) top.append(h('div', {class: 'sl-task'}, h('span', {class: 'sl-eyebrow', text: c.goal ? 'Challenge' : 'Try it'}), ' ', c.task));
    let tabs = null;
    if (multi) {
      tabs = h('div', {class: 'sl-tabs', role: 'tablist', 'aria-label': 'Variants of the program'},
        c.variants.map((v, k) => h('button', {class: 'sl-tab', type: 'button', role: 'tab', id: `${id}-tab${k}`, 'aria-selected': String(k === shown),
          onClick: () => show(k)}, v.name)));
      top.append(tabs);
    }

    // --- code -------------------------------------------------------------------------------
    const codeBox = h('div', {class: 'sl-code', role: multi ? 'tabpanel' : 'region', 'aria-label': 'The program'});
    let lineEls = [], heatPrev = null, heatEma = null, ubLines = new Set();
    function renderCode() {
      const v = c.variants[shown], prog = v.prog;
      const lines = highlight(prog);
      const other = multi ? (shown === 0 ? c.variants[1] : c.variants[0]) : null;
      const diff = other ? changedLines(prog.lines, other.prog.lines) : new Set();
      const paramToks = new Map(prog.globals.filter(g => g.literal && g.name in params).map(g => [g.literal.pos, g]));
      lineEls = [null];
      codeBox.replaceChildren(...lines.map((segs, k) => {
        const ln = k + 1;
        const code = h('code', {class: 'sl-src'});
        if (!segs.length) code.append('​');
        for (const [text, cls, tok] of segs) {
          if (tok && paramToks.has(tok.pos)) { code.append(paramInput(paramToks.get(tok.pos))); continue; }
          code.append(cls ? h('span', {class: cls, text}) : text);
        }
        const el = h('div', {class: `sl-line${diff.has(ln) ? ' is-diff' : ''}`, 'data-line': ln},
          h('span', {class: 'sl-gut', title: diff.has(ln) ? `This line is different in "${other.name}"` : null},
            h('span', {class: 'sl-mk', 'aria-hidden': 'true'}), h('span', {class: 'sl-ln', text: ln})),
          code, h('span', {class: 'sl-badge', hidden: true}, h('span', {class: 'sl-badge-t'}), h('span', {class: 'sl-bar'}, h('i'))));
        lineEls.push(el);
        return el;
      }));
      heatPrev = M().heat.slice();
      heatEma = new Float64Array(lineEls.length);
      ubLines = new Set();
    }
    function paramInput(g) {
      const p = c.params.find(x => x.name === g.name);
      const inp = h('input', {class: 'sl-param', type: 'text', inputmode: 'numeric', id: `${id}-p-${g.name}`, value: String(params[g.name]),
        'aria-label': `${g.name}, ${p.min} to ${p.max}`, title: `${g.name}: change it (${p.min} … ${p.max}). The program starts again.`, spellcheck: 'false'});
      inp.size = Math.max(2, String(params[g.name]).length);
      const apply = () => {
        const t = inp.value.trim();
        const v = /^\d+$/.test(t) ? Number(t) : NaN;
        if (!(v >= p.min && v <= p.max)) { inp.classList.add('is-invalid'); inp.title = `${g.name} is ${p.min} … ${p.max}`; return; }
        inp.classList.remove('is-invalid');
        if (v === params[g.name]) return;
        params[g.name] = v;
        for (const other of codeBox.querySelectorAll(`.sl-param`)) if (other !== inp && other.id === inp.id) other.value = t;
        reset();
      };
      inp.addEventListener('input', () => { inp.size = Math.max(2, inp.value.length); });
      inp.addEventListener('change', apply);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); apply(); }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const cur = Number(inp.value) || 0, stepv = Math.max(1, 10 ** Math.floor(Math.log10(Math.max(1, cur))) / (e.shiftKey ? 1 : 10));
          inp.value = String(Math.min(p.max, Math.max(p.min, Math.round(cur + (e.key === 'ArrowUp' ? stepv : -stepv)))));
          inp.size = Math.max(2, inp.value.length);
          apply();
        }
      });
      return inp;
    }

    // --- board: inputs, outputs ----------------------------------------------------------------
    const board = h('div', {class: 'sl-board'});
    const ledEls = {};
    if (c.inputs.length) board.append(h('div', {class: 'sl-group'}, h('div', {class: 'sl-cap', text: 'Inputs'}),
      h('div', {class: 'sl-inputs'}, c.inputs.map(inputView))));
    if (c.outputs.length) board.append(h('div', {class: 'sl-group'}, h('div', {class: 'sl-cap', text: 'Outputs'}),
      h('div', {class: 'sl-outputs'}, c.outputs.map(d => {
        const el = d.kind === 'buzzer'
          ? h('div', {class: 'sl-buzz', role: 'img'}, h('i'), h('span', {text: d.name}), h('small', {text: `GP${d.gpio}`}))
          : h('div', {class: `sl-led sl-${d.color}`, role: 'img'}, h('i'), h('span', {text: d.name}), h('small', {text: `GP${d.gpio}`}));
        ledEls[d.name] = el;
        return el;
      }))));
    const byWidget = c.devices.filter(d => d.byWidget);
    if (byWidget.length) board.append(h('div', {class: 'sl-pinnote', text: `${byWidget.map(d => `${d.name} is GP${d.gpio}`).join(', ')}.`}));
    function inputView(d) {
      const kind = d.kind;
      const hint = kind === 'hold button' ? 'hold down' : kind === 'button' ? 'click: a 150 ms press' : 'click: high or low';
      const btn = h('button', {class: `sl-in ${kind === 'pin' ? 'sl-pin' : 'sl-hold'}`, type: 'button', 'aria-pressed': kind === 'button' ? null : 'false'},
        h('span', {text: d.name}), h('small', {text: hint}));
      let down = false;
      const set = level => {
        if (down === level) return;
        down = level;
        btn.setAttribute('aria-pressed', String(level));
        runner.press(d.name, level, bouncy[d.name]);
      };
      if (kind === 'pin') btn.addEventListener('click', () => set(!down));
      else if (kind === 'button') btn.addEventListener('click', () => { runner.click(d.name, bouncy[d.name]); btn.classList.add('is-clicked'); setTimeout(() => btn.classList.remove('is-clicked'), 150 / speed > 600 ? 600 : 150 / Math.min(1, speed)); });
      else {
        btn.addEventListener('pointerdown', e => { if (e.button !== 0) return; e.preventDefault(); btn.focus(); btn.setPointerCapture?.(e.pointerId); set(true); });
        btn.addEventListener('pointerup', () => set(false));
        btn.addEventListener('pointercancel', () => set(false));
        btn.addEventListener('lostpointercapture', () => set(false));
        btn.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); set(true); } });
        btn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); set(false); } });
        btn.addEventListener('blur', () => set(false));
        btn.addEventListener('contextmenu', e => e.preventDefault());
      }
      btn.slRelease = () => { down = false; if (kind !== 'button') btn.setAttribute('aria-pressed', 'false'); };
      const row = h('div', {class: 'sl-inrow'}, btn);
      if (c.controls.includes('bounce')) {
        const check = h('input', {type: 'checkbox', id: `${id}-bounce-${d.name}`});
        check.checked = bouncy[d.name];
        check.addEventListener('change', () => { bouncy[d.name] = check.checked; });
        row.append(h('label', {class: 'sl-check', for: check.id}, check, 'bounces'));
      } else if (d.bouncy) row.append(h('span', {class: 'sl-check', text: 'bounces'}));
      return row;
    }

    // --- variables and counters ----------------------------------------------------------------
    const vars = c.watch.length ? h('div', {class: 'sl-vars'}, h('div', {class: 'sl-cap', text: 'Variables'})) : null;
    const varRows = c.watch.map(w => {
      const val = h('span', {class: 'sl-val'}), small = h('small', {class: 'sl-vsmall'});
      const row = h('div', {class: 'sl-var'}, h('span', {class: 'sl-vname', text: w.name}), h('span', {class: 'sl-vcell'}, val, small));
      vars.append(row);
      return {w, val, small, last: null};
    });
    const counters = c.show.length ? h('div', {class: 'sl-counters', 'aria-live': 'off'}) : null;
    const side = h('div', {class: 'sl-side'}, board, vars, counters);
    top.append(h('div', {class: 'sl-main'}, codeBox, side));

    // --- controls ----------------------------------------------------------------------------
    const resetBtn = h('button', {class: 'sl-btn', type: 'button', onClick: () => reset()}, 'Reset');
    const runBtn = h('button', {class: 'sl-btn', type: 'button', 'aria-pressed': 'false', onClick: () => setRunning(!running)}, 'Pause');
    const ctl = h('div', {class: 'sl-ctl'}, resetBtn, runBtn);
    let speedBtns = [];
    if (c.speeds.length > 1 && c.controls.includes('speed')) {
      const seg = h('div', {class: 'sl-seg', role: 'group', 'aria-label': 'Speed'});
      speedBtns = c.speeds.map(s => h('button', {type: 'button', 'aria-pressed': String(Math.abs(s - speed) < 1e-9), title: s < 1 ? `${Math.round(1 / s)} times slower` : s > 1 ? `${s} times faster` : 'real time',
        onClick: () => { speed = s; runner.setSpeed(s); speedBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(c.speeds[k] === s))); }}, speedLabel(s)));
      seg.append(...speedBtns);
      ctl.append(h('span', {class: 'sl-lbl', text: 'Speed'}), seg);
    } else if (speed !== 1) ctl.append(h('span', {class: 'sl-lbl', text: `Speed ${speedLabel(speed)}`}));
    if (c.controls.includes('step')) {
      ctl.append(h('button', {class: 'sl-btn', type: 'button', title: 'Run one statement', onClick: () => step('stmt')}, 'Step'),
        h('button', {class: 'sl-btn', type: 'button', title: 'Run to the start of the next round of the superloop', onClick: () => step('loop')}, 'Next loop'));
    }
    const slowEl = h('span', {class: 'sl-slow', hidden: true});
    const clock = h('span', {class: 'sl-clock', 'aria-live': 'off'});
    ctl.append(slowEl, clock);
    top.append(ctl);

    // --- timeline, status --------------------------------------------------------------------
    const tl = h('div', {class: 'sl-tl'});
    const keys = [];
    if (c.lanes.some(l => l.kind === 'input')) keys.push(['dot', 'the program read the input here'], ['watched', 'it read it all the time'], ['missed', 'a press it never read']);
    if (c.lanes.some(l => l.kind === 'cpu')) keys.push(['running', 'running'], ['asleep', 'asleep']);
    if (c.lanes.some(l => l.kind === 'output')) keys.push(['band', 'toggling faster than the eye can see']);
    if (c.lanes.some(l => l.kind === 'deadline')) keys.push(['flag', 'the deadline: the variable’s value']);
    const legend = h('div', {class: 'sl-legend'}, keys.map(([k, t]) => h('span', {class: 'sl-key'}, h('span', {class: `k ${k}`}), t)));
    top.append(h('div', {class: 'sl-tlbox'}, tl, legend));
    const status = h('div', {class: 'sl-status', role: 'status'});
    const notes = h('ul', {class: 'sl-notes'});
    let goalBox = null, goalText = null, answerBtn = null, answerBox = null;
    if (c.goal) {
      goalText = h('span', {class: 'sl-goaltext', role: 'status'});
      answerBox = h('div', {class: 'sl-answer', hidden: true});
      answerBtn = h('button', {class: 'sl-btn', type: 'button', hidden: true, onClick: () => {
        answerShown = true; answerBtn.hidden = true; answerBox.hidden = false;
      }}, 'Show the answer');
      if (c.answer != null) answerBox.append(h('p', {text: c.answer}));
      if (c.answerScript && c.answerScript.length) answerBox.append(h('button', {class: 'sl-btn', type: 'button', onClick: () => {
        reset(true);
        runner.script(c.answerScript, c.inputs);
        setRunning(true);
      }}, `Play it: ${scriptWords(c.answerScript)}`));
      goalBox = h('div', {class: 'sl-goal'}, goalText, answerBtn, answerBox);
    }
    top.append(goalBox, status, notes);
    host.append(top);

    // --- actions -------------------------------------------------------------------------------
    function show(k) {
      shown = k;
      if (tabs) [...tabs.children].forEach((b, j) => b.setAttribute('aria-selected', String(j === k)));
      renderCode();
      lastNotes = -1;
      redraw(true);
    }
    function reset(replay) {
      if (c.goal && !replay && runner.machines.some(m => m.presses) && !(runner.machines[c.goal.variant].goal || {}).met) tries++;
      makeRunner();
      for (const b of board.querySelectorAll('.sl-in')) b.slRelease && b.slRelease();
      renderCode();
      lastNotes = -1;
      redraw(true);
    }
    function setRunning(on) {
      running = on;
      runBtn.textContent = on ? 'Pause' : 'Run';
      runBtn.setAttribute('aria-pressed', String(!on));
      redraw(true);
    }
    function step(kind) {
      if (running) setRunning(false);
      runner.step(shown, kind);
      redraw(true);
    }

    // --- every frame -------------------------------------------------------------------------
    let lastTl = 0, lastNotes = -1;
    function frame(dt, ts) {
      if (running) runner.advance(dt * MS * speed);
      redraw(false, ts);
    }
    function redraw(force, ts = performance.now()) {
      const m = M(), now = runner.clock;
      clock.textContent = `t = ${(now / SEC).toFixed(3)} s`;
      const slow = running && runner.slow < 0.9;
      slowEl.hidden = !slow;
      if (slow) slowEl.textContent = `Running slower than real time here: ${runner.slow.toFixed(1)}×`;
      // outputs: the LED as the eye sees it
      for (const d of c.outputs) {
        const el = ledEls[d.name];
        const b = d.kind === 'buzzer' ? m.outputs[d.name].level : m.brightness(d.name);
        el.style.setProperty('--b', lightness(b).toFixed(3));
        el.classList.toggle('on', b > 0.01);
        el.setAttribute('aria-label', `${d.name}: ${b > 0.98 ? 'on' : b < 0.02 ? 'off' : `on ${Math.round(b * 100)} % of the time`}`);
      }
      // variables
      for (const r of varRows) {
        const sym = m.prog.lookup(r.w.name);
        let text = '–', small = '';
        if (!sym) small = 'not in this variant';
        else {
          const v = m.value(sym);
          if (!v) small = 'not in scope now';
          else if (!v.init) text = 'no value yet';
          else if (sym.type.time) {
            const ns = Number(v.v) * US;
            if (v.v == 0) text = 'not set';
            else if (v.v >= I64_MAX) text = 'never (the end of time)';
            else { text = ns > now ? `in ${fmtDur(ns - now)}` : `reached ${fmtDur(now - ns)} ago`; small = `= ${(ns / SEC).toFixed(4)} s`; }
          } else if (sym.type.bool) text = v.v ? 'true' : 'false';
          else if (r.w.hex) text = `0x${(typeof v.v === 'bigint' ? BigInt.asUintN(64, v.v) : v.v >>> 0).toString(16).toUpperCase()}`;
          else text = String(v.v);
        }
        const key = sym && sym.type.time ? (m.value(sym) || {}).v : text;
        if (r.val.textContent !== text) r.val.textContent = text;
        if (r.small.textContent !== small) r.small.textContent = small;
        if (r.last !== null && key !== r.last && !reduced.matches && !(sym && sym.type.time)) { r.val.classList.remove('flash'); void r.val.offsetWidth; r.val.classList.add('flash'); }
        r.last = key;
      }
      if (counters) {
        const parts = [];
        if (c.show.includes('iterations')) parts.push(h('div', {}, 'The superloop ran ', h('b', {text: group(m.iterations)}), ` time${m.iterations === 1 ? '' : 's'}.`));
        if (c.show.includes('sleep')) { const w = Math.min(c.window, now); parts.push(h('div', {}, 'Asleep ', h('b', {text: `${w > 0 ? Math.round(m.cpu.share(now - w, now) * 100) : 0} %`}), ` of the last ${fmtDur(w)}.`)); }
        counters.replaceChildren(...parts);
      }
      // the code: heat while running, the sleeping line, the next line when paused
      const heat = m.heat;
      let max = 0;
      const delta = new Float64Array(lineEls.length);
      for (let l = 1; l < lineEls.length; l++) { delta[l] = heat[l] - heatPrev[l]; if (delta[l] > max) max = delta[l]; }
      heatPrev = heat.slice();
      const asleep = m.state === ASLEEP || m.state === BUSY;
      const nextLine = !running && m.state === RUN ? lineOf(m) : 0;
      for (let l = 1; l < lineEls.length; l++) {
        const target = running && max > 0 ? delta[l] / max : 0;
        heatEma[l] = force && !running ? 0 : heatEma[l] * 0.75 + target * 0.25;
        const el = lineEls[l];
        const hv = heatEma[l] < 0.02 ? 0 : heatEma[l];
        const prev = el.slHeat || 0;
        if (Math.abs(prev - hv) > 0.02 || (hv === 0 && prev !== 0)) { el.style.setProperty('--heat', hv.toFixed(2)); el.slHeat = hv; }
        el.classList.toggle('is-next', l === nextLine);
        const isSleep = asleep && l === m.sleepLine && (m.wakeAt - m.sleepFrom) / speed >= 40 * MS;
        el.classList.toggle('is-asleep', isSleep);
        const badge = el.lastChild;
        if (isSleep) {
          badge.hidden = false;
          badge.firstChild.textContent = `${m.state === BUSY ? 'busy-waiting' : 'asleep'}: ${fmtDur(m.wakeAt - m.time)} left`;
          badge.lastChild.firstChild.style.width = `${Math.min(100, (m.time - m.sleepFrom) / (m.wakeAt - m.sleepFrom) * 100).toFixed(1)}%`;
        } else if (!badge.hidden) badge.hidden = true;
      }
      // status and notes
      if (m.stopped) {
        status.textContent = m.returned ? m.stopped.message : `The program stopped: ${m.stopped.message}`;
        status.className = `sl-status ${m.returned ? 'done' : 'bad'}`;
        if (m.stopped.line && lineEls[m.stopped.line]) lineEls[m.stopped.line].classList.add('is-stop');
      } else if (!running) { status.textContent = m.state === RUN ? `Paused before line ${lineOf(m)}.` : 'Paused.'; status.className = 'sl-status'; }
      else { status.textContent = ''; status.className = 'sl-status'; }
      if (c.goal) {
        const gm = runner.machines[c.goal.variant], gl = gm.goal, of = multi ? ` (${c.variants[c.goal.variant].name})` : '';
        let text, cls = '';
        if (gl.met === null) text = `Not yet${of}.`;
        else if (c.goal.maxPresses !== null && gl.presses > c.goal.maxPresses) {
          text = `That took ${gl.presses} presses${of}. Can you do it with ${c.goal.maxPresses}? (Reset starts again.)`; cls = 'more';
        } else {
          const first = c.goal.vars[0], o = c.goal.outputs[0];
          text = `Right!${of} ${first ? `${first.name} became ${fmtGoalValue(first.value)}` : `${o.name} went ${o.on ? 'on' : 'off'}`} at t = ${(gl.met / SEC).toFixed(3)} s.`;
          cls = 'ok';
        }
        if (goalText.textContent !== text) { goalText.textContent = text; goalText.className = `sl-goaltext ${cls}`; }
        const offer = !answerShown && (c.answer != null || (c.answerScript && c.answerScript.length)) && (tries > 0 || cls === 'more');
        if (answerBtn.hidden === offer) answerBtn.hidden = !offer;
      }
      if (m.notes.length !== lastNotes) {
        lastNotes = m.notes.length;
        notes.replaceChildren(...m.notes.slice(-4).map(nt => h('li', {class: nt.kind, text: nt.text})));
        for (const nt of m.notes) if (nt.kind === 'ub' && nt.line && lineEls[nt.line] && !ubLines.has(nt.line)) {
          ubLines.add(nt.line);
          lineEls[nt.line].classList.add('is-ub');
          lineEls[nt.line].firstChild.title = nt.text;
        }
      }
      // the timeline: every frame (10 per second with reduced motion)
      if (force || !reduced.matches || ts - lastTl > 100) {
        lastTl = ts;
        const width = Math.max(320, Math.floor(tl.clientWidth || 640));
        tl.replaceChildren(drawTimeline(m, c, {width, now, id}, sv));
      }
    }
    // the line about to run (the next STMT from the program counter)
    function lineOf(m) {
      for (let k = m.pc; k < Math.min(m.code.length, m.pc + 40); k++) { const ins = m.code[k]; if (ins.op === OP.STMT) return ins.line; if (ins.op === OP.JMP && ins.a > k) k = ins.a - 1; }
      return 0;
    }

    show(shown);
    host.slWidget = W;
    live.add(W);
    if (io) io.observe(host);
    if (live.size === 1) requestAnimationFrame(frameLoop);
    return W;
  }

  // editable: true (course preview only): the YAML under the block, to change and apply.
  // The YAML reader (js-yaml) is loaded from a CDN when it is first needed.
  const JS_YAML = 'https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js';
  let yamlReader = null;
  function readYaml() {
    yamlReader ||= new Promise((resolve, reject) => {
      if (root.jsyaml) { resolve(text => root.jsyaml.load(text)); return; }
      const script = h('script', {src: JS_YAML});
      script.onload = () => resolve(text => root.jsyaml.load(text));
      script.onerror = () => { yamlReader = null; reject(new Error('The YAML reader could not be loaded. Is there an internet connection?')); };
      document.head.append(script);
    });
    return yamlReader;
  }
  function editor(el, show, original) {
    const area = h('textarea', {class: 'sl-editor', spellcheck: 'false', 'aria-label': 'The superloop block (YAML)'});
    area.value = original;
    area.rows = Math.min(32, original.split('\n').length + 1);
    const error = h('div', {class: 'sl-error', 'aria-live': 'polite'});
    const warnings = h('ul', {class: 'sl-warnings'});
    const done = c => {
      error.textContent = '';
      warnings.replaceChildren(...c.warnings.map(w => h('li', {text: `The build warns: ${w}`})));
    };
    const apply = async () => {
      try { done(show((await readYaml())(area.value))); }
      catch (e) { error.textContent = e.message; warnings.replaceChildren(); }
    };
    const reset = () => {
      area.value = original;
      try { done(show(JSON.parse(el.getAttribute('data-config')))); }
      catch (e) { error.textContent = e.message; warnings.replaceChildren(); }
    };
    area.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); } });
    return h('details', {class: 'sl-source'}, h('summary', {text: 'The superloop (YAML): edit and apply'}), area,
      h('div', {class: 'sl-row'}, h('button', {class: 'sl-btn', type: 'button', onClick: apply}, 'Apply'),
        h('button', {class: 'sl-btn', type: 'button', onClick: reset}, 'Reset'),
        h('span', {class: 'sl-lbl', text: 'Ctrl+Enter also applies.'})), error, warnings);
  }

  // a <div class="course-superloop" data-config> of the page (filters/superloop.lua)
  function mountBlock(el) {
    const host = h('div', {class: 'sl-host'});
    el.replaceChildren(host);
    let current = null;
    // shows a configuration; throws (and keeps the block shown) if it has a mistake
    const show = config => {
      const c = readConfig(config);
      current?.destroy();
      current = mount(host, c);
      return c;
    };
    try { show(JSON.parse(el.getAttribute('data-config'))); }
    catch (e) { host.replaceChildren(h('div', {class: 'sl-error', text: `This superloop cannot be shown: ${e.message}`})); }
    if (el.hasAttribute('data-yaml')) el.append(editor(el, show, el.getAttribute('data-yaml')));
  }

  root.CourseSuperloop = {compile, readConfig, Machine, Runner, print, mount,
    // for the tests (tests/superloop.js)
    internals: {parse, lex, toC, SDK, CONSTS, drawTimeline, svgText, runScript, caption, T, TYPEDEFS, convert, common, promote, seeded, Track, OP,
      US, MS, SEC, CPU_NAMES, speedLabel, duration, lightness}};

  if (hasDom) {
    const mountAll = () => document.querySelectorAll('.course-superloop[data-config]').forEach(mountBlock);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
    else mountAll();
  }
})(globalThis);
