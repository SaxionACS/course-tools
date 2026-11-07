/*
 * Course state machines: ```statemachine blocks (course-tools; see
 * docs/statemachines.md).
 *
 * A page writes a machine as a ```statemachine block with YAML. The build
 * passes it to the page as JSON: <div class="course-statemachine" data-config="...">.
 *
 * This file runs in two places:
 * - in the browser, where it draws the machines and runs them (inputs,
 *   outputs, timers, log);
 * - at build time in Deno (`quarto run`, see print.js), where it checks every
 *   machine and draws its static form for the PDF (`print`): a picture as SVG
 *   text and a transition table.
 *
 * dagre (dagre.min.js, MIT) places the states and arrows; it is loaded before
 * this file. Text is measured with the widths of Lato, the font of the pages
 * and the PDFs, so that a machine has the same layout everywhere.
 */
(function (root) {
  'use strict';

  const hasDom = typeof document !== 'undefined';

  // ========================================================================
  // Small DOM and SVG helpers (as in widgets.js)
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
  // SVG as text, for the PDF (there is no DOM at build time). Same calls as sv().
  const XML = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'};
  const xml = s => String(s).replace(/[&<>"]/g, ch => XML[ch]);
  class SvgText {
    constructor(tag, attrs) {
      this.tag = tag; this.attrs = tag === 'svg' ? {xmlns: SVGNS} : {}; this.kids = [];
      for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null) continue;
        if (k === 'text') this.kids.push(String(v)); else this.attrs[k] = v;
      }
    }
    append(...kids) { for (const k of kids.flat(3)) if (k) this.kids.push(k); }
    setAttribute(k, v) { this.attrs[k] = v; }
    toString() {
      const attrs = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${xml(v)}"`).join('');
      return `<${this.tag}${attrs}>${this.kids.map(k => (typeof k === 'string' ? xml(k) : k.toString())).join('')}</${this.tag}>`;
    }
  }
  function svgText(tag, attrs, ...kids) {
    const node = new SvgText(tag, attrs);
    node.append(...kids);
    return node;
  }
  const r1 = v => Math.round(v * 10) / 10;

  // ========================================================================
  // Text widths: Lato's advance widths of ' ' to '~', in 1/1000 em
  // (assets/fonts/Lato-*.ttf), without kerning, which only makes text narrower.
  // ========================================================================
  const LATO = {
    regular: [256, 269, 370, 580, 580, 802, 712, 204, 267, 267, 425, 580, 227, 372, 236, 452, 580, 580, 580, 580, 580, 580, 580, 580,
      580, 580, 250, 262, 580, 580, 580, 448, 836, 677, 646, 668, 760, 578, 566, 730, 764, 280, 422, 662, 514, 928, 764, 800, 600, 800,
      626, 542, 590, 736, 677, 1036, 649, 624, 602, 306, 452, 306, 580, 459, 400, 497, 560, 478, 560, 528, 350, 520, 558, 240, 240, 508,
      236, 822, 558, 567, 560, 560, 364, 433, 358, 558, 516, 786, 498, 516, 452, 301, 250, 301, 580],
    bold: [243, 281, 396, 580, 580, 820, 724, 212, 274, 274, 425, 580, 234, 373, 238, 466, 580, 580, 580, 580, 580, 580, 580, 580, 580,
      580, 258, 270, 580, 580, 580, 460, 844, 694, 658, 662, 760, 575, 566, 726, 770, 296, 430, 686, 520, 945, 770, 808, 619, 808, 643,
      548, 600, 742, 694, 1051, 670, 648, 606, 314, 466, 314, 580, 466, 400, 508, 568, 482, 568, 534, 358, 528, 564, 254, 254, 534, 248,
      838, 564, 574, 568, 568, 373, 440, 372, 564, 528, 802, 522, 528, 460, 306, 261, 306, 580],
    italic: [234, 252, 348, 580, 580, 744, 657, 194, 258, 258, 395, 580, 224, 351, 234, 418, 580, 580, 580, 580, 580, 580, 534, 580,
      580, 580, 248, 260, 580, 580, 580, 418, 768, 631, 602, 624, 708, 538, 530, 680, 710, 266, 400, 618, 476, 862, 710, 746, 562, 746,
      584, 508, 546, 685, 630, 955, 609, 582, 556, 290, 414, 290, 580, 444, 368, 511, 528, 454, 529, 478, 320, 484, 530, 230, 229, 474,
      225, 787, 530, 519, 528, 512, 342, 400, 354, 530, 479, 723, 464, 480, 424, 284, 258, 284, 580],
  };
  const LATO_MORE = {'–': 580, '—': 800, '…': 772, '·': 274, '×': 580, '’': 220, '‘': 220, '“': 386, '”': 386, '°': 416, 'µ': 660};
  function textWidth(text, style, size) {
    const table = LATO[style];
    let w = 0;
    for (const ch of String(text)) {
      const c = ch.codePointAt(0);
      w += c >= 32 && c < 127 ? table[c - 32] : LATO_MORE[ch] ?? (c > 0x2e80 ? 1000 : 640);
    }
    return w * size / 1000;
  }
  // the text of the diagrams: [style, size in px]
  const FONT = {name: ['bold', 15], action: ['italic', 13], internal: ['regular', 13], label: ['regular', 14]};
  const measure = (text, kind) => textWidth(text, FONT[kind][0], FONT[kind][1]);

  // ========================================================================
  // Reading the YAML: read(config) -> model, or an Error with a message for the author
  // ========================================================================
  const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const TOP_KEYS = ['title', 'task', 'direction', 'text', 'log', 'speed', 'speeds', 'clock', 'transition', 'inputs', 'outputs', 'variables', 'initial', 'states', 'machines', 'editable'];
  const MACHINE_KEYS = ['title', 'direction', 'initial', 'variables', 'states', 'folded'];
  const STATE_KEYS = ['entry', 'do', 'exit', 'on'];
  const LEDS = ['red', 'green', 'amber', 'yellow', 'blue', 'white'];
  const WORDS = {button: ['pressed', 'released'], pin: ['high', 'low']};
  const RESERVED = ['print', 'clear', 'start', 'stop', 'send', 'blink', 'after', 'on', 'off', 'toggle'];
  // no variable or parameter can have these names, or those of RESERVED
  const VALUE_WORDS = ['true', 'false', 'now', 'ms', 's'];

  const fail = msg => { throw new Error(msg); };
  const isMap = v => v != null && typeof v === 'object' && !Array.isArray(v);
  const clean = s => String(s).replace(/\s+/g, ' ').trim();
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  function keysOf(obj, allowed, where) {
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail(`${where}: unknown key "${k}" (known keys: ${allowed.join(', ')})`);
  }
  function nameOf(name, what) {
    if (!NAME.test(name)) fail(`${what}: "${name}" is not a name (letters, digits and _, not starting with a digit)`);
    if (RESERVED.includes(name)) fail(`${what}: "${name}" is a word of the state machine language (${RESERVED.join(', ')}): choose another name`);
  }

  // 500 ms, 10 s, 1.5 s, 2..5 s (random) -> {min, max} in ms, and the text as it is drawn
  const TIME = String.raw`\d+(?:\.\d+)?(?:\s*\.\.\s*\d+(?:\.\d+)?)?\s*(?:ms|s)`;
  function time(text, where, range = true) {
    const t = clean(text);
    const m = /^(\d+(?:\.\d+)?)(?: ?\.\. ?(\d+(?:\.\d+)?))? ?(ms|s)$/.exec(t);
    if (!m) fail(`${where}: "${t}" is not a time (write 500 ms or 10 s${range ? ', or 2..5 s for a random time' : ''})`);
    if (m[2] != null && !range) fail(`${where}: a random time (${t}) is not possible here`);
    const f = m[3] === 's' ? 1000 : 1;
    const min = Number(m[1]) * f, max = m[2] != null ? Number(m[2]) * f : min;
    if (!(min > 0) || max < min) fail(`${where}: "${t}" must be longer than 0, with the shorter time first`);
    return {min, max, text: `${m[1]}${m[2] != null ? `..${m[2]}` : ''} ${m[3]}`};
  }

  // the time of the dot along an arrow: 600 ms, 1 s, or 0 for no dot -> ms, up to 5 s
  const TRANSITION = 420;
  function transitionOf(v) {
    const s = clean(v);
    if (/^0(?:\.0*)?(?: ?m?s)?$/.test(s)) return 0;
    const m = /^(\d+(?:\.\d+)?) ?(ms|s)$/.exec(s);
    const ms = m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : NaN;
    if (!(ms <= 5000)) fail(`transition: "${s}" is not a time for the dot along an arrow. Write 600 ms or 1 s (up to 5 s), or 0 for no dot`);
    return ms;
  }

  // a speed: 1 (real time), slower 1/4, 1/100, 0.5, faster 2, 10 -> the factor, 1/1000 to 100
  function speedOf(v, where) {
    const s = clean(v);
    let m, x = NaN;
    if ((m = /^1 ?\/ ?(\d+)$/.exec(s))) x = 1 / Number(m[1]);
    else if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) x = Number(s);
    if (!(x >= 0.001 && x <= 100)) fail(`${where}: "${s}" is not a speed. Write 1 (real time), slower 1/10 or 1/100, faster 2 or 10 (1/1000 to 100)`);
    return x;
  }
  function speedLabel(x) {
    if (x >= 1) return `${Number(x.toFixed(2))}×`;
    const n = Math.round(1 / x);
    return Math.abs(1 / n - x) < 1e-9 ? `1/${n}×` : `${x}×`;
  }
  // The speed buttons when the YAML has no speeds: slower for times under 100 ms
  // (under 20 ms, bounces: 1/100 too), faster for long times, up to three speeds
  // at which the longest time still takes a second or more.
  function autoSpeeds(times) {
    if (!times.length) return [1];
    const min = Math.min(...times), max = Math.max(...times);
    const slower = min < 20 ? [0.01, 0.1] : min < 100 ? [0.1] : [];
    const faster = [2, 5, 10, 20, 50, 100].filter(f => max / f >= 1000).slice(-3);
    return [...slower, 1, ...faster];
  }

  // split at any of `seps`, but not inside "double quotes"
  function splitOutside(s, seps) {
    const out = [];
    let cur = '', quoted = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && quoted && i + 1 < s.length) { cur += ch + s[++i]; continue; }
      if (ch === '"') quoted = !quoted;
      if (seps.includes(ch) && !quoted) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  // ========================================================================
  // Variables and expressions: whole numbers and true/false, with C's operators
  // in C's order. A value is a number or a boolean; time values are in ms.
  // ========================================================================
  const BINARY = [['||'], ['&&'], ['==', '!='], ['<=', '>=', '<', '>'], ['+', '-'], ['*', '/', '%']];
  const typeName = type => (type === 'int' ? 'a number' : 'true or false');
  function valueName(name, what) {
    nameOf(name, what);
    if (VALUE_WORDS.includes(name)) fail(`${what}: "${name}" is a word of the state machine language (${VALUE_WORDS.join(', ')}): choose another name`);
  }
  function readVariables(spec, ctx, where) {
    if (spec == null) return {};
    if (!isMap(spec)) fail(`${where}: write one variable per line, e.g. lap: 1`);
    for (const [name, value] of Object.entries(spec)) {
      valueName(name, where);
      if (ctx.inputs[name] || ctx.outputs[name]) fail(`${where}: ${name} is ${ctx.inputs[name] ? 'an input' : 'an output'} too: give them different names`);
      if (!Number.isSafeInteger(value) && typeof value !== 'boolean') fail(`${where}, ${name}: "${value}" is not a value. A variable starts as a whole number or as true or false (times are numbers of ms)`);
    }
    return spec;
  }
  function useVariable(name, ctx, where) {
    const own = Object.hasOwn(ctx.own, name);
    if (!own && !Object.hasOwn(ctx.shared, name)) {
      const other = Object.entries(ctx.privates).find(([, vars]) => Object.hasOwn(vars, name));
      if (other) fail(`${where}: ${name} is a variable of machine ${other[0]}. A machine sees only its own variables and those at the top of the block`);
      const known = [...Object.keys(ctx.own), ...Object.keys(ctx.shared)];
      fail(known.length ? `${where}: there is no variable ${name} (variables: ${known.join(', ')})`
        : `${where}: there is no variable ${name}. Add it under variables:, e.g. variables: {${name}: 0}`);
    }
    ctx.usedVars.add(own ? `${ctx.machine}.${name}` : name);
    return {k: 'var', name, shared: !own, type: typeof (own ? ctx.own : ctx.shared)[name] === 'boolean' ? 'bool' : 'int', src: name};
  }
  // Reads an expression from `start` as far as it goes -> {expr, end}. What follows
  // may be the next action ("lap = lap + 1 LED on"), a unit or a closing bracket.
  function parseExpr(text, start, ctx, where) {
    let p = start;
    const space = () => { while (/\s/.test(text[p] ?? '')) p++; };
    const opAt = ops => {
      space();
      return ops.find(op => {
        if (!text.startsWith(op, p)) return false;
        // lap += 1 and lap++ are actions, not operators
        return !('+-*/%'.includes(op) && (text[p + 1] === '=' || (text[p + 1] === op && '+-'.includes(op))));
      });
    };
    const span = (node, from) => { node.src = clean(text.slice(from, p)); return node; };
    function primary() {
      space();
      const from = p;
      if (text[p] === '(') {
        p++;
        const e = level(0);
        space();
        if (text[p] !== ')') fail(`${where}: "${clean(text.slice(from))}": a ) is missing`);
        p++;
        return span(e, from);
      }
      const rest = text.slice(p);
      let m;
      if ((m = /^\d+/.exec(rest))) {
        p += m[0].length;
        if (/^\.\d/.test(text.slice(p))) fail(`${where}: "${clean(rest)}": a value is a whole number here. Count in ms: 1500, not 1.5`);
        return span({k: 'num', v: Number(m[0])}, from);
      }
      if ((m = /^[A-Za-z_]\w*/.exec(rest))) {
        const word = m[0];
        if (RESERVED.includes(word) || word === 'ms' || word === 's') fail(`${where}: "${word}" is not a value. A value is a number, a variable, true, false or now`);
        p += word.length;
        if (word === 'true' || word === 'false') return span({k: 'bool', v: word === 'true'}, from);
        if (word === 'now') { ctx.usesNow = true; return span({k: 'now'}, from); }
        if (ctx.param?.name === word) return span({k: 'param', name: word, event: ctx.param.event}, from);
        return useVariable(word, ctx, where);
      }
      fail(`${where}: "${clean(rest)}" is not a value. A value is a number, a variable, true, false or now`);
    }
    function unary() {
      space();
      const from = p;
      if (text[p] === '!' && text[p + 1] !== '=') { p++; return span({k: 'not', a: unary()}, from); }
      if (text[p] === '-' && text[p + 1] !== '=' && text[p + 1] !== '-') { p++; return span({k: 'neg', a: unary()}, from); }
      return primary();
    }
    function level(i) {
      if (i === BINARY.length) return unary();
      space();
      const from = p;
      let a = level(i + 1);
      for (;;) {
        const op = opAt(BINARY[i]);
        if (!op) return a;
        p += op.length;
        const b = level(i + 1);
        a = span({k: 'bin', op, a, b}, from);
      }
    }
    const expr = level(0);
    return {expr, end: p};
  }
  // the type of an expression; a mistake if its parts do not fit together
  function typeOf(e, ctx, where) {
    const need = (sub, type, op) => {
      const t = typeOf(sub, ctx, where);
      if (t !== type) fail(`${where}: "${e.src}": ${op} works on ${type === 'int' ? 'numbers' : 'true or false'}, and ${sub.src} is ${typeName(t)}`);
    };
    switch (e.k) {
      case 'num': case 'now': return 'int';
      case 'bool': return 'bool';
      case 'var': return e.type;
      case 'param': return eventType(e.event, ctx);
      case 'not': need(e.a, 'bool', '!'); return 'bool';
      case 'neg': need(e.a, 'int', '-'); return 'int';
      default:
    }
    if (e.op === '&&' || e.op === '||') { need(e.a, 'bool', e.op); need(e.b, 'bool', e.op); return 'bool'; }
    if (e.op === '==' || e.op === '!=') {
      const a = typeOf(e.a, ctx, where), b = typeOf(e.b, ctx, where);
      if (a !== b) fail(`${where}: "${e.src}": ${e.op} compares two values of one kind, and ${e.a.src} is ${typeName(a)}, ${e.b.src} is ${typeName(b)}`);
      return 'bool';
    }
    need(e.a, 'int', e.op); need(e.b, 'int', e.op);
    return e.op === '<' || e.op === '<=' || e.op === '>' || e.op === '>=' ? 'bool' : 'int';
  }
  // the kind of value an event has: from its input's list, or from what is sent
  function eventType(event, ctx) {
    if (Object.hasOwn(ctx.eventTypes, event)) return ctx.eventTypes[event];
    ctx.eventTypes[event] = 'int';           // a machine that sends its own parameter on
    const input = ctx.inputs[event], send = ctx.sends.find(s => s.event === event && s.arg);
    if (input?.values) ctx.eventTypes[event] = input.type;
    else if (send) ctx.eventTypes[event] = typeOf(send.arg, ctx, send.where);
    return ctx.eventTypes[event];
  }
  const usesNow = e => e.k === 'now' || (e.a && usesNow(e.a)) || (e.b && usesNow(e.b));
  // the value of a time at the start, for the speed buttons; null if not known then
  function startValue(e, ctx) {
    if (e.k === 'num') return e.v;
    if (e.k === 'var') { const v = (e.shared ? ctx.shared : ctx.own)[e.name]; return typeof v === 'number' ? v : null; }
    if (e.k !== 'bin' || !'+-*'.includes(e.op)) return null;
    const a = startValue(e.a, ctx), b = startValue(e.b, ctx);
    if (a == null || b == null) return null;
    return e.op === '+' ? a + b : e.op === '-' ? a - b : a * b;
  }
  // a time from an expression: start T interval ms
  function exprTime(expr, unit, ctx, where) {
    const factor = unit === 's' ? 1000 : 1;
    ctx.later.push(() => {
      const t = typeOf(expr, ctx, where);
      if (t !== 'int') fail(`${where}: "${expr.src} ${unit}": a time is a number, and ${expr.src} is true or false`);
    });
    const v = startValue(expr, ctx);
    if (v > 0) ctx.times.push(v * factor);
    return {expr, factor, text: `${expr.src} ${unit}`};
  }
  // a time on the left side of on: 500 ms, 2..5 s or interval ms
  function triggerTime(text, ctx, where) {
    const t = clean(text);
    const m = /^(.*\S) (ms|s)$/.exec(t);
    if (!m || /^[\d. ]+$/.test(m[1])) return time(t, where);
    const {expr, end} = parseExpr(m[1], 0, ctx, where);
    if (end < m[1].length) fail(`${where}: "${t}" is not a time (write 500 ms or 10 s, 2..5 s for a random time, or interval ms with a variable)`);
    return exprTime(expr, m[2], ctx, where);
  }
  // The text of a print: {expression} is a value, {expression:s} a time in ms, in seconds.
  function printParts(raw, ctx, where) {
    const parts = [];
    let text = '', i = 0;
    while (i < raw.length) {
      if (raw[i] === '\\' && i + 1 < raw.length) { text += raw[i + 1]; i += 2; continue; }
      if (raw[i] !== '{') { text += raw[i++]; continue; }
      if (!raw.includes('}', i)) fail(`${where}: print: { starts a value and needs a }, as in print "Lap {lap}". For the character { itself, write \\{`);
      const {expr, end} = parseExpr(raw, i + 1, ctx, where);
      const m = /^\s*(:s)?\s*\}/.exec(raw.slice(end));
      if (!m) fail(`${where}: print: "${clean(raw.slice(i))}": after the value comes a } (or :s}, for a time in seconds)`);
      if (m[1]) ctx.later.push(() => { if (typeOf(expr, ctx, where) !== 'int') fail(`${where}: print: {${expr.src}:s}: only a number can be a time`); });
      else ctx.later.push(() => typeOf(expr, ctx, where));
      if (text) parts.push(text);
      text = '';
      parts.push({expr, seconds: !!m[1]});
      i = end + m[0].length;
    }
    if (text || !parts.length) parts.push(text);
    return parts;
  }
  // 1730 ms as 1.73 s: cut off, not rounded, as C's integer division does
  const inSeconds = ms => {
    const h = Math.abs(Math.trunc(ms / 10));
    return `${ms < 0 && h ? '-' : ''}${Math.trunc(h / 100)}.${String(h % 100).padStart(2, '0')} s`;
  };

  // the values of a button: [100, 500, 1000] or [true, false]
  function inputValues(list, name) {
    const where = `inputs, ${name}`;
    const items = list.split(',').map(clean);
    if (!list.trim()) fail(`${where}: the list of values is empty: write ${name}: button [100, 500, 1000]`);
    const values = items.map(s => {
      if (s === 'true' || s === 'false') return s === 'true';
      if (!/^-?\d+$/.test(s)) fail(`${where}: "${s}" is not a value. Values are whole numbers or true and false`);
      return Number(s);
    });
    const type = typeof values[0] === 'boolean' ? 'bool' : 'int';
    if (values.some(v => (typeof v === 'boolean' ? 'bool' : 'int') !== type)) fail(`${where}: all values are numbers, or all are true and false`);
    if (new Set(values).size < values.length) fail(`${where}: a value appears twice in [${list}]`);
    return {values, type};
  }

  function readInputs(spec, ctx) {
    if (spec == null) return;
    if (!isMap(spec)) fail('inputs: write one input per line, e.g. pressed: button');
    for (const [name, kind] of Object.entries(spec)) {
      nameOf(name, 'inputs');
      const k = clean(kind ?? '');
      const m = /^(bouncy )?(button|hold button|pin)(?: ?\[(.*)\])?$/.exec(k);
      if (!m) fail(`inputs, ${name}: "${k}" is not an input. Inputs are: button (a click), button [100, 500] (a click with a value), hold button, pin, bouncy button, bouncy pin`);
      if (m[3] != null && (m[1] || m[2] !== 'button')) fail(`inputs, ${name}: only a button can send a value: ${name}: button [100, 500, 1000]`);
      const pin = m[2] === 'pin';
      ctx.inputs[name] = m[2] === 'button' && !m[1] ? {name, hold: false, ...(m[3] != null ? inputValues(m[3], name) : {})}
        : {name, hold: true, kind: pin ? 'pin' : 'button', bouncy: !!m[1], words: WORDS[pin ? 'pin' : 'button']};
    }
  }

  function readOutputs(spec, ctx) {
    if (spec == null) return;
    if (!isMap(spec)) fail('outputs: write one output per line, e.g. LED: red led');
    for (const [name, kind] of Object.entries(spec)) {
      nameOf(name, 'outputs');
      if (ctx.inputs[name]) fail(`outputs: ${name} is an input too: give them different names`);
      const k = clean(kind ?? '');
      const m = /^(?:(\w+) )?led$/.exec(k);
      if (k === 'buzzer') ctx.outputs[name] = {name, kind: 'buzzer'};
      else if (m && (!m[1] || LEDS.includes(m[1]))) ctx.outputs[name] = {name, kind: 'led', color: m[1] || 'red'};
      else fail(`outputs, ${name}: "${k}" is not an output. Outputs are: led, ${LEDS.map(c => c + ' led').join(', ')}, buzzer`);
    }
  }

  function useOutput(name, ctx, where) {
    if (!Object.hasOwn(ctx.outputs, name)) {
      const known = Object.keys(ctx.outputs);
      fail(known.length ? `${where}: there is no output ${name} (outputs: ${known.join(', ')})`
        : `${where}: there is no output ${name}. Add it under outputs:, e.g. outputs: {${name}: red led}`);
    }
    ctx.usedOutputs.add(name);
  }

  // Actions follow each other, with or without commas: YAML joins the lines of
  // a value without dashes into one line ("LED on start T 10 s").
  const ID = '[A-Za-z_]\\w*', END = '(?=[\\s,]|$)';
  const ACTIONS = [
    ['print', new RegExp(`print\\s+"((?:[^"\\\\]|\\\\.)*)"`, 'y')],
    ['clear', new RegExp(`clear${END}`, 'y')],
    ['start', new RegExp(`start\\s+(${ID})\\s+(${TIME})${END}`, 'y')],
    ['stop', new RegExp(`stop\\s+(${ID})${END}`, 'y')],
    ['send', new RegExp(`send\\s+(${ID})${END}`, 'y')],
    ['blink', new RegExp(`blink\\s+(${ID})\\s+(${TIME})${END}`, 'y')],
    ['set', new RegExp(`(${ID})\\s+(on|off|toggle)${END}`, 'y')],
    // these go on with an expression
    ['startExpr', new RegExp(`start\\s+(${ID})\\s+`, 'y')],
    ['blinkExpr', new RegExp(`blink\\s+(${ID})\\s+`, 'y')],
    ['sendValue', new RegExp(`send\\s+(${ID})\\s*\\(`, 'y')],
    ['assign', new RegExp(`(${ID})\\s*(\\+\\+|--|[-+*/%]=|=(?!=))`, 'y')],
  ];
  function readActions(value, ctx, where, isDo) {
    if (value == null) return [];
    const out = [];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item == null || typeof item === 'object') fail(`${where}: write actions as text, e.g. LED on, start T 1 s`);
      out.push(...readActionText(String(item), ctx, where, isDo));
    }
    return out;
  }
  function readActionText(text, ctx, where, isDo) {
    const out = [], gap = /[\s,]*/y;
    let p = 0;
    for (;;) {
      gap.lastIndex = p;
      gap.exec(text);
      p = gap.lastIndex;
      if (p >= text.length) return out;
      let m = null, kind;
      for ([kind, m] of ACTIONS.map(([k, re]) => { re.lastIndex = p; return [k, re.exec(text)]; })) if (m) break;
      if (!m) fail(notAnAction(text.slice(p), ctx, where, isDo));
      const from = p;
      p += m[0].length;
      if (kind === 'startExpr' || kind === 'blinkExpr' || kind === 'sendValue' || kind === 'assign') {
        const made = exprAction(kind, m, text, p, ctx, where, isDo);
        if (!made) fail(notAnAction(text.slice(from), ctx, where, isDo));
        out.push(made.action);
        p = made.end;
      } else out.push(makeAction(kind, m, ctx, where, isDo));
    }
  }
  const noDo = (m, where, isDo) => { if (isDo) fail(`${where}: "${clean(m[0])}" cannot be a do activity. The only one is blink <output> <time>, e.g. blink LED 500 ms`); };
  // an action with an expression, which starts at p -> {action, end}; null if there is none
  function exprAction(kind, m, text, p, ctx, where, isDo) {
    if (kind === 'startExpr' || kind === 'blinkExpr') {
      // start T print "x": a time is missing, and print is no variable
      const word = /^\s*([A-Za-z_]\w*)/.exec(text.slice(p));
      if (word && RESERVED.includes(word[1])) return null;
      const {expr, end} = parseExpr(text, p, ctx, where);
      const unit = new RegExp(`\\s*(ms|s)${END}`, 'y');
      unit.lastIndex = end;
      const u = unit.exec(text);
      if (!u) return null;
      const t = exprTime(expr, u[1], ctx, where);
      if (kind === 'startExpr') {
        noDo(m, where, isDo);
        ctx.timers.add(m[1]);
        return {action: {kind: 'start', timer: m[1], time: t, src: `start ${m[1]} ${t.text}`}, end: unit.lastIndex};
      }
      if (!isDo) fail(`${where}: blink is a do activity: write it under do:`);
      useOutput(m[1], ctx, where);
      return {action: {kind: 'blink', out: m[1], time: t, src: `blink ${m[1]} ${t.text}`}, end: unit.lastIndex};
    }
    noDo(m, where, isDo);
    if (kind === 'sendValue') {
      const {expr, end} = parseExpr(text, p, ctx, where);
      const close = /^\s*\)/.exec(text.slice(end));
      if (!close) fail(`${where}: "${clean(m[0] + text.slice(p))}": a ) is missing`);
      ctx.sent.add(m[1]);
      ctx.sends.push({event: m[1], arg: expr, where});
      return {action: {kind: 'send', event: m[1], arg: expr, src: `send ${m[1]}(${expr.src})`}, end: end + close[0].length};
    }
    // lap++, lap = 1, lap += 2
    const target = useVariable(m[1], ctx, where);
    if (m[2] === '++' || m[2] === '--') {
      ctx.later.push(() => { if (target.type !== 'int') fail(`${where}: "${m[1]}${m[2]}": ${m[1]} is true or false, not a number`); });
      return {action: {kind: 'assign', target, op: `${m[2][0]}=`, expr: {k: 'num', v: 1, src: '1'}, src: `${m[1]}${m[2]}`}, end: p};
    }
    const {expr, end} = parseExpr(text, p, ctx, where);
    const src = `${m[1]} ${m[2]} ${expr.src}`;
    ctx.later.push(() => {
      const t = typeOf(expr, ctx, where);
      if (m[2] !== '=' && (target.type !== 'int' || t !== 'int')) fail(`${where}: "${src}": ${m[2]} works on numbers`);
      if (t !== target.type) fail(`${where}: "${src}": ${m[1]} is ${typeName(target.type)}, and ${expr.src} is ${typeName(t)}`);
    });
    return {action: {kind: 'assign', target, op: m[2], expr, src}, end};
  }
  function makeAction(kind, m, ctx, where, isDo) {
    if (kind !== 'blink') noDo(m, where, isDo);
    switch (kind) {
      case 'print': {
        ctx.prints = true;
        const parts = printParts(m[1], ctx, where);
        const a = {kind, src: `print "${m[1]}"`};
        if (parts.some(x => typeof x !== 'string')) a.parts = parts;
        else a.text = parts.join('');
        return a;
      }
      case 'clear':
        ctx.prints = true;
        return {kind, src: 'clear'};
      case 'start': {
        const t = time(m[2], where);
        ctx.timers.add(m[1]);
        ctx.times.push(t.min, t.max);
        return {kind, timer: m[1], time: t, src: `start ${m[1]} ${t.text}`};
      }
      case 'stop': ctx.stops.add(m[1]); return {kind, timer: m[1], src: `stop ${m[1]}`};
      case 'send':
        ctx.sent.add(m[1]);
        ctx.sends.push({event: m[1], arg: null, where});
        return {kind, event: m[1], src: `send ${m[1]}`};
      case 'blink': {
        if (!isDo) fail(`${where}: blink is a do activity: write it under do:`);
        useOutput(m[1], ctx, where);
        const t = time(m[2], where, false);
        ctx.times.push(t.min);
        return {kind, out: m[1], time: t, src: `blink ${m[1]} ${t.text}`};
      }
      default:
        useOutput(m[1], ctx, where);
        return {kind: 'set', out: m[1], value: m[2], src: `${m[1]} ${m[2]}`};
    }
  }
  function notAnAction(rest, ctx, where, isDo) {
    if (/^[|/]/.test(rest)) return `${where}: one / per arrow, between the state and its actions; separate the actions with commas`;
    const piece = clean(splitOutside(rest, ',|/')[0]);
    const shown = piece.length > 48 ? piece.slice(0, 45) + '…' : piece;
    const word = /^\S*/.exec(piece)[0];
    if (isDo) return `${where}: "${shown}" cannot be a do activity. The only one is blink <output> <time>, e.g. blink LED 500 ms`;
    if (word === 'print') return `${where}: print needs its text in double quotes: print "Ready"`;
    if (word === 'start') return `${where}: "${shown}": start needs a timer and a time: start T 10 s (or 2..5 s)`;
    if (word === 'stop' || word === 'send') return `${where}: "${shown}": ${word} needs one name: ${word} ${word === 'stop' ? 'T' : 'pressed'}`;
    if (word === 'blink') return `${where}: "${shown}": blink needs an output and a time: blink LED 500 ms`;
    if (ctx.outputs[word]) return `${where}: "${shown}": write ${word} on, ${word} off or ${word} toggle`;
    const out = Object.keys(ctx.outputs)[0] || 'LED';
    return `${where}: "${shown}" is not an action. Actions are: ${out} on, ${out} off, ${out} toggle, print "text", clear, start T 10 s, stop T, send event, n = 1, n++`;
  }

  // the left side of on: -> {kind: event|after|held, label, base (the label
  // without the guard), guard, guardSrc, and for an event its parameter}
  function readTrigger(key, ctx, where) {
    const full = clean(key);
    if (full.startsWith('[')) fail(`${where}: a guard needs an event in front of it: pressed [count < 3]. An arrow with only a guard is not possible yet`);
    const g = /^(.*\S) ?\[(.*)\]$/.exec(full);
    const t = readEvent(g ? g[1] : full, ctx, where);
    t.base = t.label;
    if (g) {
      ctx.param = t.param ? {name: t.param, event: t.event} : null;
      const {expr, end} = parseExpr(g[2], 0, ctx, where);
      ctx.param = null;
      if (end < g[2].length) fail(`${where}: the guard [${clean(g[2])}] cannot be read after "${expr.src}"`);
      ctx.later.push(() => {
        // such a guard could turn true at any moment, between two frames of the page
        if ((t.kind !== 'event' || ctx.timers.has(t.event)) && usesNow(expr)) fail(`${where}: the guard [${expr.src}] uses now, on an event that waits for its guard. Use a timer instead`);
        const type = typeOf(expr, ctx, where);
        if (type !== 'bool') fail(`${where}: the guard [${expr.src}] is a number, and a guard is true or false. Write for example [${expr.src} > 0]`);
      });
      t.guard = expr;
      t.guardSrc = clean(g[2]);
      t.label = `${t.base} [${t.guardSrc}]`;
    }
    return t;
  }
  function readEvent(k, ctx, where) {
    let m;
    if ((m = /^after (.+)$/.exec(k))) {
      const t = triggerTime(m[1], ctx, where);
      if (!t.expr) ctx.times.push(t.min, t.max);
      return {kind: 'after', time: t, label: `after ${t.text}`};
    }
    // an event with a value: the arrow names it
    if ((m = /^([A-Za-z_]\w*) ?\( ?([A-Za-z_]\w*) ?\)$/.exec(k))) {
      valueName(m[2], where);
      if (Object.hasOwn(ctx.own, m[2]) || Object.hasOwn(ctx.shared, m[2])) fail(`${where}: the parameter ${m[2]} has the name of a variable: give them different names`);
      if (ctx.inputs[m[1]]?.hold) fail(`${where}: ${m[1]} is a ${ctx.inputs[m[1]].kind === 'pin' ? 'pin' : 'hold button'}: only a button can have a value`);
      ctx.handled.add(m[1]);
      ctx.named.push({event: m[1], param: m[2], where});
      return {kind: 'event', event: m[1], param: m[2], label: `${m[1]}(${m[2]})`};
    }
    if ((m = /^([A-Za-z_]\w*) (\w+)(?: for (.+))?$/.exec(k)) && ctx.inputs[m[1]]) {
      const input = ctx.inputs[m[1]];
      if (!input.hold) fail(`${where}: ${m[1]} is a click button: its event is just ${m[1]}. For pressed and released, make it a hold button`);
      const i = input.words.indexOf(m[2]);
      if (i < 0) fail(`${where}: ${m[1]} is a ${input.kind === 'pin' ? 'pin' : 'hold button'}: write ${m[1]} ${input.words[0]} or ${m[1]} ${input.words[1]}`);
      ctx.usedInputs.add(m[1]);
      if (m[3] != null) {
        const t = time(m[3], where, false);
        ctx.times.push(t.min);
        return {kind: 'held', input: m[1], level: i === 0, time: t, label: `[${m[1]} ${m[2]} for ${t.text}]`};
      }
      return {kind: 'event', event: `${m[1]} ${m[2]}`, edge: true, label: k};
    }
    if (NAME.test(k)) {
      if (ctx.inputs[k]?.hold) fail(`${where}: ${k} is a ${ctx.inputs[k].kind === 'pin' ? 'pin' : 'hold button'}: write ${k} ${ctx.inputs[k].words[0]} or ${k} ${ctx.inputs[k].words[1]}`);
      ctx.handled.add(k);
      return {kind: 'event', event: k, label: k};
    }
    fail(`${where}: "${k}" is not an event. Write an input (pressed), a timer (exit_delay), after 10 s, or for an input that is held down: KEY pressed, KEY released, KEY pressed for 1 s. Then optionally a guard: pressed [count < 3]`);
  }

  // the right side of on: TARGET, TARGET / actions, / actions. | works as / too; the
  // diagram shows |. The first / or | outside quotes ends the target.
  function readArrow(value, names, ctx, where) {
    if (value == null || typeof value === 'object' || clean(value) === '') {
      fail(`${where}: where to? Write a state (LIGHT_ON), a state and actions (LIGHT_ON / LED on), or only actions for an internal action (/ print "lap")`);
    }
    const text = String(value);
    const parts = splitOutside(text, '|/');
    const target = clean(parts[0]);
    const actions = parts.length > 1 ? readActions(text.slice(parts[0].length + 1), ctx, where, false) : [];
    if (target && !names.includes(target)) {
      fail(/\s/.test(target) ? `${where}: "${target}": write the state, then / and the actions: LIGHT_ON / LED on`
        : `${where}: there is no state ${target} (states: ${names.join(', ')})`);
    }
    if (!target && parts.length < 2) fail(`${where}: where to?`);
    return {target: target || null, actions};
  }

  function readMachine(name, spec, ctx, direction, where) {
    const W = where ? `${where}: ` : '';
    if (!isMap(spec)) fail(`${where}: write title:, initial: and states: under it`);
    keysOf(spec, MACHINE_KEYS, where || 'statemachine');
    const raw = spec.states;
    if (!isMap(raw) || !Object.keys(raw).length) fail(`${W}states: needs one or more states`);
    const names = Object.keys(raw);
    for (const n of names) if (!NAME.test(n)) fail(`${W}"${n}" is not a state name (letters, digits and _)`);
    ctx.machine = name;
    ctx.own = ctx.privates[name] ?? {};
    const states = {};
    for (const n of names) {
      const sw = `${W}state ${n}`;
      const st = {name: n, entry: [], do: [], exit: [], on: []};
      const s = raw[n];
      if (s != null) {
        if (!isMap(s)) fail(`${sw}: write entry:, do:, exit: and on: under it`);
        keysOf(s, STATE_KEYS, sw);
        st.entry = readActions(s.entry, ctx, `${sw}, entry`, false);
        st.do = readActions(s.do, ctx, `${sw}, do`, true);
        st.exit = readActions(s.exit, ctx, `${sw}, exit`, false);
        if (s.on != null) {
          if (!isMap(s.on)) fail(`${sw}: on: needs lines like pressed: LIGHT_ON`);
          for (const [key, value] of Object.entries(s.on)) {
            const tw = `${sw}, on ${clean(key)}`;
            const trigger = readTrigger(key, ctx, tw);
            ctx.param = trigger.param ? {name: trigger.param, event: trigger.event} : null;
            const arrow = readArrow(value, names, ctx, tw);
            ctx.param = null;
            if (!arrow.target && trigger.kind === 'held') fail(`${tw}: ${trigger.label} must lead to a state`);
            st.on.push({id: `${name}|${n}|${clean(key)}`, machine: name, from: n, trigger, target: arrow.target,
              actions: arrow.actions, internal: !arrow.target, where: tw});
          }
        }
      }
      states[n] = st;
    }
    const initial = spec.initial != null ? clean(spec.initial) : names[0];
    if (!names.includes(initial)) fail(`${W}initial: ${initial} is not one of the states (${names.join(', ')})`);
    const dir = spec.direction != null ? clean(spec.direction) : direction;
    if (!['LR', 'TB'].includes(dir)) fail(`${W}direction: is LR or TB`);
    if (spec.folded != null && typeof spec.folded !== 'boolean') fail(`${W}folded: is true or false`);
    return {name, title: spec.title != null ? String(spec.title) : name, direction: dir, initial, variables: ctx.own, states, folded: spec.folded === true};
  }

  // What needs all machines read first: who gives an event its value, and whether
  // the values fit where they are used.
  function checkValues(ctx) {
    for (const {event, param, where} of ctx.named) {
      const input = ctx.inputs[event];
      if (input && !input.values) fail(`${where}: ${event} has no value to call ${param}. Give the button its values: ${event}: button [100, 500, 1000]`);
      if (ctx.timers.has(event)) fail(`${where}: ${event} is a timer: it has no value to call ${param}`);
      if (!input) {
        const bare = ctx.sends.find(s => s.event === event && !s.arg);
        if (bare) fail(`${bare.where}: send ${event} has no value, but ${where} calls it ${param}. Write send ${event}(1)`);
      }
    }
    for (const s of ctx.sends) if (s.arg) {
      const t = typeOf(s.arg, ctx, s.where);
      if (t !== eventType(s.event, ctx)) fail(`${s.where}: send ${s.event}(${s.arg.src}): the values of ${s.event} are ${typeName(eventType(s.event, ctx))}, and ${s.arg.src} is ${typeName(t)}`);
    }
    for (const check of ctx.later) check();
  }

  function read(config) {
    if (!isMap(config)) fail('the YAML must be a mapping: title:, inputs:, outputs:, states: …');
    keysOf(config, TOP_KEYS, 'statemachine');
    const ctx = {inputs: {}, outputs: {}, timers: new Set(), stops: new Set(), sent: new Set(), handled: new Set(),
      usedOutputs: new Set(), usedInputs: new Set(), prints: false, times: [],
      shared: {}, own: {}, privates: {}, machine: null, param: null, usedVars: new Set(), usesNow: false,
      sends: [], named: [], eventTypes: {}, later: []};
    readInputs(config.inputs, ctx);
    readOutputs(config.outputs, ctx);
    ctx.shared = readVariables(config.variables, ctx, 'variables');
    const text = clean(config.text ?? 'display');
    if (!['display', 'terminal'].includes(text)) fail('text: is display (a print replaces the text) or terminal (a print adds a line)');
    const log = clean(config.log ?? 'open');
    if (!['open', 'folded', 'hidden'].includes(log)) fail('log: is open, folded or hidden');
    if (config.clock != null && typeof config.clock !== 'boolean') fail('clock: is true or false');
    const direction = clean(config.direction ?? 'LR');
    if (!['LR', 'TB'].includes(direction)) fail('direction: is LR (left to right) or TB (top to bottom)');
    let machines;
    if (config.machines != null) {
      if (config.states != null) fail('write states: for one machine or machines: for several, not both');
      if (config.initial != null) fail('initial: belongs in each machine under machines:');
      if (!isMap(config.machines) || !Object.keys(config.machines).length) fail('machines: needs one or more machines, each with states:');
      // all first: a mistake can then name the machine a variable belongs to
      for (const [name, spec] of Object.entries(config.machines)) if (isMap(spec)) {
        const vars = readVariables(spec.variables, ctx, `machine ${name}, variables`);
        for (const v of Object.keys(vars)) if (Object.hasOwn(ctx.shared, v)) fail(`machine ${name}, variables: ${v} is under the variables of the block too: give them different names`);
        ctx.privates[name] = vars;
      }
      machines = Object.entries(config.machines).map(([name, spec]) => {
        if (!NAME.test(name)) fail(`machines: "${name}" is not a name (letters, digits and _)`);
        return readMachine(name, spec, ctx, direction, `machine ${name}`);
      });
    } else {
      if (config.states == null) fail('states: is missing');
      machines = [readMachine('machine', {states: config.states, initial: config.initial}, ctx, direction, null)];
    }
    // every event must come from somewhere
    for (const m of machines) for (const st of Object.values(m.states)) for (const tr of st.on) {
      const e = tr.trigger;
      if (e.kind !== 'event' || e.edge) continue;
      const input = !!ctx.inputs[e.event], timer = ctx.timers.has(e.event), sent = ctx.sent.has(e.event);
      if (input && (timer || sent)) fail(`${e.event} is an input and ${timer ? 'a timer' : 'an event that a machine sends'}: give them different names`);
      if (!input && !timer && !sent) {
        fail(`${tr.where}: ${e.event} is not an input, a timer or an event that a machine sends. A button? Add it under inputs:, e.g. inputs: {${e.event}: button}`);
      }
    }
    for (const t of ctx.timers) if (ctx.outputs[t]) fail(`${t} is a timer and an output: give them different names`);
    for (const t of ctx.timers) if (Object.hasOwn(ctx.shared, t) || Object.values(ctx.privates).some(vars => Object.hasOwn(vars, t))) fail(`${t} is a timer and a variable: give them different names`);
    checkValues(ctx);
    const warnings = [];
    for (const t of ctx.timers) if (!ctx.handled.has(t)) warnings.push(`timer ${t} runs out, but no state reacts to it`);
    for (const t of ctx.stops) if (!ctx.timers.has(t)) warnings.push(`stop ${t}: timer ${t} is never started`);
    for (const e of ctx.sent) if (!ctx.handled.has(e)) warnings.push(`send ${e}: no state reacts to ${e}`);
    for (const [n, i] of Object.entries(ctx.inputs)) if (!(i.hold ? ctx.usedInputs.has(n) : ctx.handled.has(n))) warnings.push(`input ${n} is not used in any state`);
    for (const o of Object.keys(ctx.outputs)) if (!ctx.usedOutputs.has(o)) warnings.push(`output ${o} is never switched`);
    for (const v of Object.keys(ctx.shared)) if (!ctx.usedVars.has(v)) warnings.push(`variable ${v} is not used in any state`);
    for (const [name, vars] of Object.entries(ctx.privates)) for (const v of Object.keys(vars)) if (!ctx.usedVars.has(`${name}.${v}`)) warnings.push(`machine ${name}: variable ${v} is not used in any state`);
    for (const i of Object.values(ctx.inputs)) if (i.values && !ctx.named.some(n => n.event === i.name)) warnings.push(`input ${i.name} has values, but no arrow gives its value a name: write ${i.name}(value): …`);
    for (const m of machines) for (const st of Object.values(m.states)) {
      st.on.forEach((tr, k) => {
        if (tr.internal && tr.trigger.kind === 'after') warnings.push(`${tr.where}: an internal action on after runs only once, because nothing starts the time again. To repeat it, use a named timer: tick: / …, start tick ${tr.trigger.time.text}`);
        // an arrow back into the state: its entry actions run right after the arrow's
        if (tr.target === st.name) for (const a of tr.actions) if (a.kind === 'set') {
          const later = st.entry.filter(x => x.kind === 'set' && x.out === a.out).at(-1);
          if (later && (later.value === 'toggle' ? a.value === 'toggle' : a.value !== later.value)) {
            warnings.push(`${tr.where}: this arrow goes back into ${st.name}, so its entry action ${later.src} runs right after ${a.src}, and the change never shows. `
              + (tr.trigger.kind === 'after' ? `To repeat it, use a named timer: tick: / ${a.src}, start tick ${tr.trigger.time.text}` : `To change ${a.out} and stay, use an internal action: ${tr.trigger.base}: / ${a.src}`));
          }
        }
        // the first arrow that may fire does: nothing gets past one without a guard
        const random = tr.trigger.time && tr.trigger.time.min !== tr.trigger.time.max;   // each arrow draws its own time
        const before = random ? null : st.on.slice(0, k).find(x => !x.trigger.guard && x.trigger.kind === tr.trigger.kind && (x.trigger.event ?? x.trigger.base) === (tr.trigger.event ?? tr.trigger.base));
        if (before) warnings.push(`${tr.where}: this arrow can never fire, because the arrow for ${before.trigger.base} above it has no guard`);
      });
    }
    for (const m of machines) {
      const seen = new Set([m.initial]), todo = [m.initial];
      while (todo.length) for (const tr of m.states[todo.pop()].on) if (tr.target && !seen.has(tr.target)) { seen.add(tr.target); todo.push(tr.target); }
      for (const n of Object.keys(m.states)) if (!seen.has(n)) warnings.push(`${machines.length > 1 ? `machine ${m.name}: ` : ''}state ${n} can never be reached`);
    }
    // the speed buttons, and the speed at the start (also a button)
    if (Object.values(ctx.inputs).some(i => i.bouncy)) ctx.times.push(1);   // bounces: within 12 ms
    let speeds;
    if (config.speeds != null) {
      if (!Array.isArray(config.speeds) || !config.speeds.length || config.speeds.length > 8) fail('speeds: is a list of 1 to 8 speeds, e.g. [1, 2, 10] or [1/100, 1/10, 1]');
      speeds = config.speeds.map(v => speedOf(v, 'speeds'));
    } else speeds = autoSpeeds(ctx.times);
    const speed = config.speed != null ? speedOf(config.speed, 'speed') : speeds.includes(1) ? 1 : speeds[0];
    speeds = [...new Set([...speeds, speed])].sort((a, b) => a - b);
    // the clock and its controls (pause, speed, skip ahead): for machines that use time, unless clock: says otherwise
    const timed = ctx.timers.size > 0 || ctx.usesNow || Object.values(ctx.inputs).some(i => i.bouncy) || machines.some(m => Object.values(m.states).some(st =>
      st.do.length || st.on.some(tr => tr.trigger.kind === 'after' || tr.trigger.kind === 'held')));
    const transition = config.transition != null ? transitionOf(config.transition) : TRANSITION;
    return {title: config.title != null ? String(config.title) : '', task: config.task != null ? String(config.task) : '',
      text, log, speed, speeds, clock: config.clock ?? timed, transition, direction, inputs: ctx.inputs, outputs: ctx.outputs, timers: [...ctx.timers],
      variables: ctx.shared, prints: ctx.prints, machines, warnings};
  }

  // ========================================================================
  // Running the machines
  // ========================================================================
  const fmt = ms => (ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`);
  // an event as the log and the status line show it: pressed, or set_blinking(500)
  const eventText = e => (e.value === undefined ? e.name : `${e.name}(${e.value})`);
  // print or clear on t: a display (one text) or a terminal (lines, the last 200)
  function write(t, a, terminal) {
    if (a.kind === 'clear') { t.display = ''; t.lines = []; }
    else if (terminal) { t.lines.push(a.text); if (t.lines.length > 200) t.lines.shift(); }
    else t.display = a.text;
  }

  // Simulated time in ms. advance(to) runs everything that is due, in order, so
  // the speed changes nothing but the pace. random() is Math.random unless a test
  // passes its own.
  class Sim {
    constructor(model, hooks, random) {
      this.model = model; this.hooks = hooks || {}; this.random = random || Math.random;
      // the level changes of hold buttons and pins that some state has an arrow for
      this.heard = new Set(model.machines.flatMap(m => Object.values(m.states).flatMap(st => st.on.filter(tr => tr.trigger.edge).map(tr => tr.trigger.event))));
      this.reset();
    }
    reset() {
      const M = this.model;
      this.t = 0;
      this.out = {};
      for (const o of Object.keys(M.outputs)) this.out[o] = false;
      this.timers = {};
      for (const t of M.timers) this.timers[t] = null;
      this.holds = {};
      for (const i of Object.values(M.inputs)) if (i.hold) this.holds[i.name] = {input: i, level: false, since: 0, flips: [], trace: [{t: 0, level: false}], bouncy: i.bouncy};
      this.display = ''; this.lines = []; this.textVersion = 0;
      this.queue = [];
      this.warned = new Set();
      this.shared = {...M.variables};
      this.ms = M.machines.map(m => ({m, state: null, since: 0, afters: [], blinks: [], late: new Set(), vars: {...m.variables}}));
      for (const s of this.ms) { this.enter(s, s.m.initial); this.say({machine: s.m.name, start: true, to: s.m.initial}); }
      this.drain();
    }
    // the time of a timer in ms; a time from an expression must be longer than 0
    pick(t, s, arg) {
      if (!t.expr) return Math.round(t.min + this.random() * (t.max - t.min));
      const ms = this.value(t.expr, s, arg) * t.factor;
      if (ms > 0) return ms;
      this.mistake(`${t.text} is not longer than 0 (it is ${ms} ms). The machine uses 1 ms.`);
      return 1;
    }
    say(entry) { entry.t = this.t; this.hooks.log?.(entry); }
    // a mistake that shows only while running, in the log; once per kind until a reset
    mistake(text) { if (!this.warned.has(text)) { this.warned.add(text); this.say({error: text}); } }
    // the value of an expression; arg: the value of the event of the arrow
    value(e, s, arg) {
      switch (e.k) {
        case 'num': case 'bool': return e.v;
        case 'now': return Math.floor(this.t);
        case 'var': return (e.shared ? this.shared : s.vars)[e.name];
        case 'param': return arg;
        case 'not': return !this.value(e.a, s, arg);
        case 'neg': return 0 - this.value(e.a, s, arg);
        default:
      }
      const a = this.value(e.a, s, arg);
      if (e.op === '&&') return a && this.value(e.b, s, arg);
      if (e.op === '||') return a || this.value(e.b, s, arg);
      return this.calc(e.op, a, this.value(e.b, s, arg), e.src);
    }
    calc(op, a, b, src) {
      switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': case '%':
          if (b === 0) { this.mistake(`${src}: a division by zero. The machine uses 0.`); return 0; }
          return op === '/' ? Math.trunc(a / b) : a % b;
        case '==': return a === b;
        case '!=': return a !== b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        default: return a >= b;
      }
    }
    // may this arrow fire? Its guard, if it has one, is true.
    open(s, tr, arg) { return !tr.trigger.guard || this.value(tr.trigger.guard, s, arg); }
    // all variables, as the page shows them: name, or machine.name for one machine's own
    values() {
      const out = {...this.shared};
      for (const s of this.ms) for (const [name, v] of Object.entries(s.vars)) out[`${s.m.name}.${name}`] = v;
      return out;
    }
    enter(s, name) {
      const st = s.m.states[name];
      s.state = name; s.since = this.t;
      s.afters = []; s.blinks = []; s.late.clear();
      this.run(s, st.entry, 'entry');
      // now, because the entry actions may set a variable that a time reads
      s.afters = st.on.filter(tr => tr.trigger.kind === 'after').map(tr => { const total = this.pick(tr.trigger.time, s); return {tr, due: this.t + total, total}; });
      s.blinks = st.do.map(a => { const period = this.pick(a.time, s); return {a, period, next: this.t + period}; });
    }
    // The page hears of every change to an output, a variable or the text
    // (hooks.effect) and where it comes from: 'exit', 'arrow', 'entry' or 'do' (blinking).
    run(s, actions, phase, arg) {
      for (const a of actions) {
        if (a.kind === 'set') {
          this.out[a.out] = a.value === 'toggle' ? !this.out[a.out] : a.value === 'on';
          this.hooks.effect?.(s, {out: a.out, value: this.out[a.out]}, phase);
        } else if (a.kind === 'print' || a.kind === 'clear') {
          const text = a.parts ? {kind: a.kind, text: a.parts.map(p => this.part(p, s, arg)).join('')} : a;
          write(this, text, this.model.text === 'terminal');
          this.textVersion++;
          this.hooks.effect?.(s, {text}, phase);
        } else if (a.kind === 'assign') {
          const store = a.target.shared ? this.shared : s.vars, v = this.value(a.expr, s, arg);
          store[a.target.name] = a.op === '=' ? v : this.calc(a.op[0], store[a.target.name], v, a.src);
          this.hooks.effect?.(s, {variable: a.target.shared ? a.target.name : `${s.m.name}.${a.target.name}`, value: store[a.target.name]}, phase);
        } else if (a.kind === 'start') {
          const total = this.pick(a.time, s, arg);
          this.timers[a.timer] = {due: this.t + total, total};
          for (const x of this.ms) x.late.delete(a.timer);
        } else if (a.kind === 'stop') {
          this.timers[a.timer] = null;
          for (const x of this.ms) x.late.delete(a.timer);
        } else if (a.kind === 'send') this.queue.push({name: a.event, source: 'sent', value: a.arg ? this.value(a.arg, s, arg) : undefined});
      }
    }
    part(p, s, arg) {
      if (typeof p === 'string') return p;
      const v = this.value(p.expr, s, arg);
      return p.seconds ? inSeconds(v) : String(v);
    }
    fire(s, tr, cause, arg) {
      const from = s.state;
      this.hooks.leave?.(s, tr);
      if (tr.internal) {
        this.run(s, tr.actions, 'arrow', arg);
        this.say({machine: s.m.name, cause, from, internal: true, text: tr.actions.map(a => a.src).join(', ')});
      } else {
        s.afters = []; s.blinks = []; s.late.clear();          // exit
        this.run(s, s.m.states[from].exit, 'exit');
        this.run(s, tr.actions, 'arrow', arg);
        this.enter(s, tr.target);
        this.say({machine: s.m.name, cause, from, to: tr.target});
      }
      this.hooks.fired?.(s, tr);
    }
    dispatch(name, source = 'input', value = undefined) { this.queue.push({name, source, value}); this.drain(); }
    // One event at a time, to every machine; sent events queue up behind it. In a
    // state, the first arrow for the event whose guard is true fires. If all guards
    // are false, an input or a sent event is lost, but a timer that ran out waits
    // (s.late), as time_reached() stays true in C: see next().
    drain() {
      let n = 0;
      while (this.queue.length) {
        if (++n > 500) { this.queue = []; this.say({error: 'Over 500 events in a row: do the machines send each other events in a loop?'}); return; }
        const e = this.queue.shift();
        const cause = eventText(e), guards = [];
        let handled = false;
        for (const s of this.ms) {
          const arrows = s.m.states[s.state].on.filter(x => x.trigger.kind === 'event' && x.trigger.event === e.name);
          const tr = arrows.find(x => this.open(s, x, e.value));
          if (tr) { handled = true; this.fire(s, tr, cause, e.value); }
          else if (arrows.length && e.source === 'timer') {
            handled = true;
            s.late.add(e.name);
            this.say({machine: s.m.name, cause, waiting: true, guards: arrows.map(x => x.trigger.guardSrc)});
          } else guards.push(...arrows.map(x => x.trigger.guardSrc));
        }
        if (!handled && !e.quiet) {
          this.say({cause, ignored: true, source: e.source, states: this.ms.map(s => [s.m.name, s.state]), guards});
          this.hooks.ignored?.(e, this.ms, guards);
        }
      }
    }
    // a hold button or pin goes down/high (true) or up/low (false); a bouncy one
    // flips a few times in the first 12 ms
    press(name, level) {
      const h = this.holds[name];
      if (!h) return;
      h.flips = [];
      this.flip(name, level);
      if (h.bouncy) {
        const pairs = 2 + Math.floor(this.random() * 3);
        const times = Array.from({length: 2 * pairs}, () => 0.4 + this.random() * 11.6).sort((a, b) => a - b);
        h.flips = times.map((dt, i) => ({t: this.t + dt, level: i % 2 === 0 ? !level : level}));
      }
    }
    flip(name, level) {
      const h = this.holds[name];
      if (h.level === level) return;
      h.level = level; h.since = this.t;
      h.trace.push({t: this.t, level});
      while (h.trace.length > 2 && h.trace[1].t < this.t - 120000) h.trace.shift();
      // A signal may change with nobody listening (only `pin high for 50 ms` watches
      // it): that is no lost event. Nor are bounces worth a message each.
      const event = `${name} ${h.input.words[level ? 0 : 1]}`;
      this.queue.push({name: event, source: 'edge', quiet: h.bouncy || !this.heard.has(event)});
      this.drain();
    }
    // The next thing that is due: bounces, held conditions, after timeouts, named
    // timers, blinking (in that order at equal times). Without blinks: what
    // skip() jumps to.
    next(blinks = true) {
      let best = null;
      const consider = (t, prio, kind, what, run) => {
        t = Math.max(t, this.t);
        if (!best || t < best.t || (t === best.t && prio < best.prio)) best = {t, prio, kind, what, run};
      };
      for (const [name, h] of Object.entries(this.holds)) {
        if (h.flips.length) consider(h.flips[0].t, 0, 'bounce', `${name} ${h.input.words[h.flips[0].level ? 0 : 1]}`, () => { const f = h.flips.shift(); this.flip(name, f.level); });
      }
      for (const s of this.ms) {
        for (const tr of s.m.states[s.state].on) if (tr.trigger.kind === 'held') {
          const h = this.holds[tr.trigger.input];
          if (h.level === tr.trigger.level && this.open(s, tr)) consider(Math.max(h.since, s.since) + tr.trigger.time.min, 1, 'held', tr.trigger.label, () => { this.fire(s, tr, tr.trigger.label); this.drain(); });
        }
        for (const a of s.afters) {
          if (this.open(s, a.tr)) consider(a.due, 2, 'after', a.tr.trigger.label, () => { s.afters = s.afters.filter(x => x !== a); this.fire(s, a.tr, a.tr.trigger.label); this.drain(); });
          else if (!a.late) consider(a.due, 2.5, 'after', a.tr.trigger.label, () => {     // the time is up: from now on it waits for the guard (behind an arrow that may fire)
            a.late = true;
            this.say({machine: s.m.name, cause: a.tr.trigger.base, waiting: true, guards: [a.tr.trigger.guardSrc]});
          });
        }
        // a named timer that ran out and waits for a guard to turn true
        for (const name of s.late) {
          const tr = s.m.states[s.state].on.find(x => x.trigger.kind === 'event' && x.trigger.event === name && this.open(s, x));
          if (tr) consider(this.t, 3, 'timer', name, () => { s.late.delete(name); this.fire(s, tr, name); this.drain(); });
        }
        if (blinks) for (const b of s.blinks) consider(b.next, 4, 'blink', b.a.src, () => {
          this.out[b.a.out] = !this.out[b.a.out];
          b.next += b.period;
          this.hooks.effect?.(s, {out: b.a.out, value: this.out[b.a.out]}, 'do');
        });
      }
      for (const [name, tm] of Object.entries(this.timers)) if (tm) consider(tm.due, 3, 'timer', name, () => { this.timers[name] = null; this.queue.push({name, source: 'timer'}); this.drain(); });
      return best;
    }
    advance(to) {
      for (let i = 0; i < 20000; i++) {
        const c = this.next();
        if (!c || c.t > to) break;
        this.t = c.t;
        c.run();
      }
      if (to > this.t) this.t = to;
    }
    // jump to the next bounce or timeout (blinking goes on on the way): {kind, what}, or null
    skip() { const c = this.next(false); if (!c) return null; this.advance(c.t); return {kind: c.kind, what: c.what}; }
    // what the current state of a machine waits for in time
    pending(s) {
      const list = [];
      // blocked: the time is up, but the guard is false
      for (const a of s.afters) {
        const left = a.due - this.t;
        list.push({label: a.tr.trigger.label, left, total: a.total, blocked: left <= 0 && !this.open(s, a.tr)});
      }
      for (const tr of s.m.states[s.state].on) if (tr.trigger.kind === 'held') {
        const h = this.holds[tr.trigger.input], total = tr.trigger.time.min;
        const counting = h.level === tr.trigger.level;
        const left = counting ? Math.max(h.since, s.since) + total - this.t : total;
        list.push({label: tr.trigger.label, total, waiting: !counting, left, blocked: counting && left <= 0 && !this.open(s, tr)});
      }
      return list;
    }
    // how long until a machine moves by itself (after, held, a timer it has an arrow for); Infinity if nothing is due
    soonest(s) {
      let left = Infinity;
      for (const p of this.pending(s)) if (!p.waiting && !p.blocked) left = Math.min(left, p.left);
      for (const tr of s.m.states[s.state].on) {
        const tm = tr.trigger.kind === 'event' && this.timers[tr.trigger.event];
        if (tm) left = Math.min(left, tm.due - this.t);
      }
      return left;
    }
  }

  // ========================================================================
  // Layout (dagre) and drawing
  // ========================================================================
  // items joined with commas, wrapped at about `max` characters
  // With `hang`, the lines after the first go under the first item, so they have
  // the prefix's length less room.
  function wrapItems(prefix, items, max, hang = false) {
    const lines = [];
    let cur = prefix;
    items.forEach((it, i) => {
      const piece = it + (i < items.length - 1 ? ',' : '');
      const room = hang && lines.length ? max - prefix.length : max;
      if (cur !== prefix && cur.length + piece.length > room) { lines.push(cur.trimEnd()); cur = ''; }
      cur += piece + ' ';
    });
    lines.push(cur.trimEnd());
    return lines;
  }
  // the lines in a state's box: entry and do actions, internal actions. A line
  // after the first of its list starts `indent` px in, under the first item.
  function stateLines(st) {
    const out = [];
    const add = (prefix, items, kind, id) => wrapItems(prefix, items, 30, true).forEach((text, i) =>
      out.push({text, kind, id, indent: i ? measure(prefix, kind) : 0}));
    if (st.entry.length) add('entry: ', st.entry.map(a => a.src), 'action', 'entry');
    if (st.do.length) add('do: ', st.do.map(a => a.src), 'action');
    if (st.exit.length) add('exit: ', st.exit.map(a => a.src), 'action', 'exit');
    for (const tr of st.on) if (tr.internal) add(`${tr.trigger.label} | `, tr.actions.map(a => a.src), 'internal', tr.id);
    return out;
  }
  // the label of an arrow: the event, its guard (on a line of its own if it is long), and its actions after a |
  function edgeLines(tr) {
    const t = tr.trigger, acts = tr.actions.map(a => a.src);
    const head = t.guard && t.label.length > 26 ? [t.base, `[${t.guardSrc}]`] : [t.label];
    if (!acts.length) return head;
    const one = `${t.label} | ${acts.join(', ')}`;
    return one.length <= 24 ? [one] : [...head, ...wrapItems('| ', acts, 26)];
  }

  const INIT = '•init';   // not a valid state name
  // sizes in px: the name area of a box, a line of actions, a line of an arrow's label
  const HEAD = 30, LINE = 17, LABEL_LINE = 16;
  function layoutMachine(m) {
    const g = new root.dagre.graphlib.Graph({multigraph: true});
    g.setGraph({rankdir: m.direction, nodesep: 30, ranksep: 36, edgesep: 16, marginx: 8, marginy: 8});
    g.setDefaultEdgeLabel(() => ({}));
    g.setNode(INIT, {width: 16, height: 16});
    const nodes = {};
    for (const st of Object.values(m.states)) {
      const lines = stateLines(st);
      const w = Math.ceil(Math.max(100, measure(st.name, 'name') + 32, ...lines.map(l => l.indent + measure(l.text, l.kind) + 28)));
      const hh = lines.length ? HEAD + 9 + lines.length * LINE + 7 : 42;
      nodes[st.name] = {name: st.name, lines, w, h: hh};
      g.setNode(st.name, {width: w, height: hh});
    }
    const labels = {};
    g.setEdge(INIT, m.initial, {width: 0, height: 0, labelpos: 'c'}, 'init');
    for (const st of Object.values(m.states)) for (const tr of st.on) {
      if (tr.internal) continue;
      const lines = edgeLines(tr);
      const lw = Math.ceil(Math.max(...lines.map(l => measure(l, 'label')))) + 14;
      const lh = lines.length * LABEL_LINE + 6;
      labels[tr.id] = {tr, lines, lw, lh};
      g.setEdge(st.name, tr.target, {width: lw, height: lh, labelpos: 'c'}, tr.id);
    }
    root.dagre.layout(g);
    for (const n of Object.values(nodes)) { const p = g.node(n.name); n.x = p.x; n.y = p.y; }
    const init = g.node(INIT);
    const edges = [];
    for (const e of g.edges()) {
      const d = g.edge(e);
      if (e.name === 'init') { edges.push({id: 'init', init: true, from: INIT, to: e.w, points: d.points}); continue; }
      edges.push(Object.assign({id: e.name, self: e.v === e.w, from: e.v, to: e.w, points: d.points, lx: d.x, ly: d.y}, labels[e.name]));
    }
    return {nodes, init: {x: init.x, y: init.y}, edges};
  }

  // a B-spline through dagre's points (d3's curveBasis)
  function basisPath(P) {
    if (P.length < 3) return 'M' + P.map(p => `${r1(p.x)},${r1(p.y)}`).join('L');
    let d = '', x0, y0, x1, y1, k = 0;
    const bez = (x, y) => { d += `C${r1((2 * x0 + x1) / 3)},${r1((2 * y0 + y1) / 3)} ${r1((x0 + 2 * x1) / 3)},${r1((y0 + 2 * y1) / 3)} ${r1((x0 + 4 * x1 + x) / 6)},${r1((y0 + 4 * y1 + y) / 6)}`; };
    for (const {x, y} of P) {
      if (k === 0) { d += `M${r1(x)},${r1(y)}`; k = 1; }
      else if (k === 1) k = 2;
      else { if (k === 2) { d += `L${r1((5 * x0 + x1) / 6)},${r1((5 * y0 + y1) / 6)}`; k = 3; } bez(x, y); }
      x0 = x1; x1 = x; y0 = y1; y1 = y;
    }
    bez(x1, y1);
    return d + `L${r1(x1)},${r1(y1)}`;
  }
  function route(P) {
    const pts = P.map(p => ({x: p.x, y: p.y}));
    const n = pts.length, tip = pts[n - 1], prev = pts[n - 2];
    let dx = tip.x - prev.x, dy = tip.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const back = Math.min(7, len * 0.8);
    pts[n - 1] = {x: tip.x - dx * back, y: tip.y - dy * back};
    return {d: basisPath(pts), tip, dir: {x: dx, y: dy}};
  }
  // a loop from a state back to itself, reaching out to the label dagre placed beside the state
  function selfLoop(n, e) {
    const sideways = Math.abs(e.lx - n.x) / (n.w / 2) >= Math.abs(e.ly - n.y) / (n.h / 2);
    let s, c1, c2, tip;
    if (sideways) {
      const sg = Math.sign(e.lx - n.x) || 1, x0 = n.x + sg * n.w / 2;
      const reach = Math.max(16, Math.abs(e.lx - sg * e.lw / 2 - x0) - 3), k = reach / 0.75, a = Math.min(11, n.h / 2 - 5);
      s = {x: x0, y: n.y - a}; tip = {x: x0, y: n.y + a};
      c1 = {x: x0 + sg * k, y: n.y - a - 8}; c2 = {x: x0 + sg * k, y: n.y + a + 8};
    } else {
      const sg = Math.sign(e.ly - n.y) || 1, y0 = n.y + sg * n.h / 2;
      const reach = Math.max(16, Math.abs(e.ly - sg * e.lh / 2 - y0) - 3), k = reach / 0.75, a = Math.min(16, n.w / 2 - 8);
      s = {x: n.x - a, y: y0}; tip = {x: n.x + a, y: y0};
      c1 = {x: n.x - a - 8, y: y0 + sg * k}; c2 = {x: n.x + a + 8, y: y0 + sg * k};
    }
    let dx = tip.x - c2.x, dy = tip.y - c2.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const end = {x: tip.x - dx * 7, y: tip.y - dy * 7};
    return {d: `M${r1(s.x)},${r1(s.y)}C${r1(c1.x)},${r1(c1.y)} ${r1(c2.x)},${r1(c2.y)} ${r1(end.x)},${r1(end.y)}`, tip, dir: {x: dx, y: dy},
      curve: [s, c1, c2, end]};
  }
  function arrowHead(tip, u) {
    const bx = tip.x - u.x * 9, by = tip.y - u.y * 9, vx = -u.y * 4.5, vy = u.x * 4.5;
    return `M${r1(tip.x)},${r1(tip.y)}L${r1(bx + vx)},${r1(by + vy)}L${r1(bx - vx)},${r1(by - vy)}Z`;
  }

  // The colours of the PDF picture (the page styles the same classes in saxion.scss).
  const INK = {fg: '#494c4e', muted: '#6c757d', box: '#9aa6ad', sep: '#cdd5dc', edge: '#7d878d', paper: '#ffffff'};
  const PRINT_STYLE = [
    `.box{fill:${INK.paper};stroke:${INK.box};stroke-width:1.3}`,
    `.name{font-size:15px;font-weight:bold;fill:${INK.fg}}`,
    `.sep{stroke:${INK.sep};stroke-width:1}`,
    `.act{font-size:13px;font-style:italic;fill:${INK.muted}}`,
    `.act.internal{font-style:normal;fill:${INK.fg}}`,
    `.line{fill:none;stroke:${INK.edge};stroke-width:1.4}`,
    `.head{fill:${INK.edge}}`,
    `.lbl-bg{fill:${INK.paper}}`,
    `.lbl{font-size:14px;fill:${INK.fg}}`,
    `.init{fill:${INK.fg}}`,
  ].join('');

  // The picture of one machine. make: sv (browser) or svgText (PDF). Returns the
  // svg and, for the browser, the parts that light up.
  function drawMachine(geo, m, make, isStatic) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const box = (x, y, w, hh) => { x0 = Math.min(x0, x - w / 2); x1 = Math.max(x1, x + w / 2); y0 = Math.min(y0, y - hh / 2); y1 = Math.max(y1, y + hh / 2); };
    for (const n of Object.values(geo.nodes)) box(n.x, n.y, n.w, n.h);
    box(geo.init.x, geo.init.y, 16, 16);
    const routes = geo.edges.map(e => (e.self ? selfLoop(geo.nodes[e.from], e) : route(e.points)));
    geo.edges.forEach((e, k) => {
      if (!e.init) box(e.lx, e.ly, e.lw, e.lh);
      for (const p of e.self ? routes[k].curve : e.points) box(p.x, p.y, 4, 4);
    });
    x0 -= 6; y0 -= 6; x1 += 6; y1 += 6;
    const W = Math.ceil(x1 - x0), H = Math.ceil(y1 - y0);
    // on the page, a wide picture shrinks to the column, down to 75 % (saxion.scss); then it scrolls
    const svg = make('svg', {class: 'sm-svg', viewBox: `${r1(x0)} ${r1(y0)} ${W} ${H}`, width: W, height: H, role: 'img',
      'aria-label': `State diagram: ${m.title}`, 'font-family': isStatic ? 'Lato' : null, style: isStatic ? null : `--sm-w: ${W}px`});
    if (isStatic) svg.append(make('style', {text: PRINT_STYLE}));
    const pic = {svg, width: W, height: H, states: {}, edges: {}, lines: {}};
    // arrows, then their labels (no arrow crosses a label), then the states
    const edgeLayer = make('g', {}), labelLayer = make('g', {}), nodeLayer = make('g', {});
    geo.edges.forEach((e, k) => {
      const {d, tip, dir} = routes[k];
      const path = make('path', {class: 'line', d});
      const g = make('g', {class: 'sm-edge'}, path, make('path', {class: 'head', d: arrowHead(tip, dir)}));
      edgeLayer.append(g);
      if (e.init) return;
      const label = make('g', {class: 'sm-edge'},
        make('rect', {class: 'lbl-bg', x: r1(e.lx - e.lw / 2), y: r1(e.ly - e.lh / 2), width: e.lw, height: e.lh, rx: 3}),
        e.lines.map((line, i) => make('text', {class: 'lbl', x: r1(e.lx), y: r1(e.ly - e.lh / 2 + 15.5 + i * LABEL_LINE), 'text-anchor': 'middle', text: line})));
      labelLayer.append(label);
      pic.edges[e.id] = {g, label, path};
    });
    nodeLayer.append(make('circle', {class: 'init', cx: r1(geo.init.x), cy: r1(geo.init.y), r: 7}));
    for (const n of Object.values(geo.nodes)) {
      const x = n.x - n.w / 2, y = n.y - n.h / 2;
      const g = make('g', {class: 'sm-state'});
      g.append(make('rect', {class: 'box', x: r1(x), y: r1(y), width: n.w, height: n.h, rx: 9}));
      if (n.lines.length) {
        g.append(make('text', {class: 'name', x: r1(n.x), y: r1(y + 20.5), 'text-anchor': 'middle', text: n.name}));
        g.append(make('line', {class: 'sep', x1: r1(x), x2: r1(x + n.w), y1: r1(y + HEAD), y2: r1(y + HEAD)}));
        n.lines.forEach((l, i) => {
          const t = make('text', {class: l.kind === 'internal' ? 'act internal' : 'act', x: r1(x + 12 + l.indent), y: r1(y + HEAD + 18 + i * LINE), text: l.text});
          g.append(t);
          if (l.id) (pic.lines[l.id === 'entry' || l.id === 'exit' ? `${n.name}|${l.id}` : l.id] ||= []).push(t);   // an internal action's lines, or the entry or exit lines
        });
      } else g.append(make('text', {class: 'name', x: r1(n.x), y: r1(n.y + 5.3), 'text-anchor': 'middle', text: n.name}));
      const st = {g, w: n.w - 16};
      if (!isStatic) {
        g.append(make('rect', {class: 'bar-bg', x: r1(x + 8), y: r1(y + n.h - 6), width: n.w - 16, height: 3, rx: 1.5}));
        st.bar = make('rect', {class: 'bar', x: r1(x + 8), y: r1(y + n.h - 6), width: 0, height: 3, rx: 1.5});
        g.append(st.bar);
      }
      pic.states[n.name] = st;
      nodeLayer.append(g);
    }
    svg.append(edgeLayer, labelLayer, nodeLayer);
    return pic;
  }

  // ========================================================================
  // The PDF: a picture and a transition table per machine (print.js)
  // ========================================================================
  // A row per state, a column per event; a dash: the state ignores the event.
  // Arrows for one event with different guards share a cell.
  function transitionTable(m) {
    const events = [];
    for (const st of Object.values(m.states)) for (const tr of st.on) if (!events.includes(tr.trigger.base)) events.push(tr.trigger.base);
    const cell = tr => {
      const acts = tr.actions.map(a => a.src).join(', ');
      return (tr.trigger.guard ? `[${tr.trigger.guardSrc}] ` : '') + (tr.internal ? `| ${acts}` : tr.target + (acts ? ` | ${acts}` : ''));
    };
    const rows = Object.values(m.states).map(st => [st.name, ...events.map(label => {
      const arrows = st.on.filter(x => x.trigger.base === label);
      return arrows.length ? arrows.map(cell).join('; ') : '–';
    })]);
    return {head: ['State', ...events], rows};
  }
  const variablesText = vars => {
    const list = Object.entries(vars).map(([name, v]) => `${name} = ${v}`);
    return list.length ? `Variables: ${list.join(', ')}.` : null;
  };

  function print(config) {
    let model;
    try { model = read(config); } catch (e) { return {error: e.message, warnings: []}; }
    const multi = model.machines.length > 1;
    const machines = model.machines.map(m => {
      const pic = drawMachine(layoutMachine(m), m, svgText, true);
      return {title: multi ? m.title : null, svg: pic.svg.toString(), width: pic.width, height: pic.height, table: transitionTable(m), note: variablesText(m.variables)};
    });
    // what the diagrams do not show: the values variables start with, and the values of the buttons
    const notes = [variablesText(model.variables),
      ...Object.values(model.inputs).filter(i => i.values).map(i => `Values of ${i.name}: ${i.values.join(', ')}.`)].filter(Boolean);
    return {title: model.title || null, task: model.task || null, notes, machines, warnings: model.warnings};
  }

  // ========================================================================
  // The interactive machines (browser)
  // ========================================================================
  const reduceMotion = () => root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let uid = 0;

  function machineView(m, multi) {
    const pic = drawMachine(layoutMachine(m), m, sv, false);
    // at: the state the page shows (the source, while the dot is on its way); shown: the one drawn lit
    const v = {m, pic, at: null, shown: null, flight: null, buf: [], pill: null, el: null, folded: false};
    const wrap = h('div', {class: 'sm-pic'}, pic.svg);
    if (!multi) { v.el = h('div', {class: 'sm-panel'}, wrap); return v; }
    const reacts = [], sends = [];
    for (const st of Object.values(m.states)) {
      for (const tr of st.on) {
        if (!reacts.includes(tr.trigger.base)) reacts.push(tr.trigger.base);
        for (const a of tr.actions) if (a.kind === 'send' && !sends.includes(a.event)) sends.push(a.event);
      }
      for (const a of [...st.entry, ...st.exit]) if (a.kind === 'send' && !sends.includes(a.event)) sends.push(a.event);
    }
    v.pill = h('span', {class: 'sm-pill'});
    const fold = h('button', {class: 'sm-fold', type: 'button', 'aria-expanded': 'true'}, 'Fold');
    v.el = h('div', {class: 'sm-panel'}, h('div', {class: 'sm-head'}, h('span', {class: 'sm-mname', text: m.title}), v.pill, fold), wrap,
      h('div', {class: 'sm-folded', text: `Reacts to ${reacts.join(', ') || 'nothing'}. Sends ${sends.join(', ') || 'nothing'}.`}));
    const toggle = () => {
      v.folded = v.el.classList.toggle('folded');
      fold.textContent = v.folded ? 'Unfold' : 'Fold';
      fold.setAttribute('aria-expanded', String(!v.folded));
    };
    fold.addEventListener('click', toggle);
    if (m.folded) toggle();
    return v;
  }

  function outputView(o) {
    if (o.kind === 'led') return h('div', {class: `sm-led sm-${o.color}`, title: `${o.color} LED`}, h('i'), h('span', {text: o.name}));
    const icon = sv('svg', {viewBox: '0 0 32 24', 'aria-hidden': 'true'},
      sv('path', {class: 'body', d: 'M3 8h5l7-6v20l-7-6H3z'}),
      sv('path', {class: 'wave', d: 'M19.5 8.5q2.5 3.5 0 7'}),
      sv('path', {class: 'wave w2', d: 'M23.5 5q5 7 0 14'}));
    return h('div', {class: 'sm-buzz', title: 'buzzer (no sound)'}, icon, h('span', {text: o.name}));
  }

  function mount(host, model) {
    const n = ++uid;
    const multi = model.machines.length > 1;
    let sim = null, paused = false, speed = model.speed, alive = true, visible = true;
    // The outputs and the text as the page shows them. The machines move at once,
    // but while a dot travels along an arrow, the source stays lit and what the
    // target's entry actions (and blinking) change waits for the dot.
    let shown = null;
    const bouncy = {};
    const views = model.machines.map(m => machineView(m, multi));
    const top = h('div', {class: 'sm'});
    if (model.title) top.append(h('div', {class: 'sm-title', text: model.title}));
    if (model.task) top.append(h('div', {class: 'sm-task', text: model.task}));
    top.append(h('div', {class: 'sm-machines' + (multi ? ' multi' : '')}, views.map(v => v.el)));

    // inputs, outputs, text, timers
    const groups = [];
    const inputs = Object.values(model.inputs);
    const holdViews = inputs.filter(i => i.hold).map(holdView);
    const clicks = inputs.filter(i => !i.hold);
    if (inputs.length) {
      groups.push(h('div', {class: 'sm-group'}, h('div', {class: 'sm-cap', text: 'Inputs'}),
        clicks.length ? h('div', {class: 'sm-buttons'}, clicks.map(clickView)) : null,
        holdViews.map(v => v.el)));
    }
    const outEls = {};
    const outs = Object.values(model.outputs);
    if (outs.length) groups.push(h('div', {class: 'sm-group'}, h('div', {class: 'sm-cap', text: 'Outputs'}), h('div', {class: 'sm-outs'}, outs.map(o => (outEls[o.name] = outputView(o))))));
    // the variables: those of the block, then each machine's own
    const varRows = [];
    const varRow = (key, name, sub) => {
      const val = h('span', {class: 'val'});
      varRows.push({key, val, el: h('div', {class: 'sm-var'}, h('span', {class: 'nm'}, name, sub ? h('small', {text: sub}) : null), val)});
    };
    for (const name of Object.keys(model.variables)) varRow(name, name, multi ? 'all machines' : null);
    for (const m of model.machines) for (const name of Object.keys(m.variables)) varRow(`${m.name}.${name}`, name, m.title);
    const varsGroup = varRows.length ? h('div', {class: 'sm-group'}, h('div', {class: 'sm-cap', text: 'Variables'}), h('div', {class: 'sm-vars'}, varRows.map(r => r.el))) : null;
    if (varsGroup) groups.push(varsGroup);
    let textEl = null;
    if (model.prints) {
      textEl = h('div', {class: model.text === 'terminal' ? 'sm-terminal' : 'sm-display', 'aria-live': 'polite'});
      groups.push(h('div', {class: 'sm-group'}, h('div', {class: 'sm-cap', text: model.text === 'terminal' ? 'Terminal' : 'Display'}), textEl));
    }
    const timed = model.timers.length || model.machines.some(m => Object.values(m.states).some(st => st.on.some(tr => tr.trigger.kind === 'after' || tr.trigger.kind === 'held')));
    let timersEl = null;
    if (timed) {
      timersEl = h('div', {class: 'sm-timers'});
      const timersGroup = h('div', {class: 'sm-group'}, h('div', {class: 'sm-cap', text: 'Timers'}), timersEl);
      // with variables, the timers go right under them, in one column of the board
      if (varsGroup) groups[groups.indexOf(varsGroup)] = h('div', {class: 'sm-stack'}, varsGroup, timersGroup);
      else groups.push(timersGroup);
    }
    top.append(h('div', {class: 'sm-board'}, groups));

    // controls
    const pauseBtn = h('button', {class: 'sm-btn', type: 'button', 'aria-pressed': 'false', onClick: () => {
      paused = !paused;
      pauseBtn.textContent = paused ? 'Run' : 'Pause';
      pauseBtn.setAttribute('aria-pressed', String(paused));
    }}, 'Pause');
    const speeds = model.speeds;
    const speedBtns = speeds.map(value => h('button', {type: 'button', 'aria-pressed': String(value === speed), onClick: () => {
      speed = value;
      speedBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(speeds[k] === value)));
    }}, speedLabel(value)));
    const skipBtn = h('button', {class: 'sm-btn', type: 'button', title: 'Jump to the next bounce or timeout', onClick: () => {
      const to = sim.skip();
      if (!to) status('Nothing is waiting for a time right now.');
      else status(to.kind === 'bounce' ? `A bounce: ${to.what}.` : to.kind === 'timer' ? `Skipped to the end of timer ${to.what}.` : `Skipped to ${to.what}.`);
    }}, 'Skip ahead');
    const clock = h('span', {class: 'sm-clock'});
    const resetBtn = h('button', {class: 'sm-btn', type: 'button', onClick: () => reset(true)}, 'Reset');
    top.append(h('div', {class: 'sm-ctl'}, model.clock ? [resetBtn, pauseBtn,
      speeds.length > 1 ? [h('span', {class: 'sm-lbl', text: 'Speed'}), h('div', {class: 'sm-seg', role: 'group', 'aria-label': 'Speed'}, speedBtns)] : null,
      timed || holdViews.some(v => v.input.bouncy) ? skipBtn : null, clock] : resetBtn));
    // without a log under it, an empty status line takes no space (saxion.scss)
    const statusEl = h('div', {class: model.log === 'hidden' ? 'sm-status sm-last' : 'sm-status', 'aria-live': 'polite'});
    top.append(statusEl);
    const logEl = h('div', {class: 'sm-log'});
    if (model.log !== 'hidden') top.append(h('details', {class: 'sm-logbox', open: model.log === 'open'}, h('summary', {text: 'Log'}), logEl));
    host.replaceChildren(top);

    // A click button; one with values has a list next to it, and sends what is chosen there.
    function clickView(i) {
      if (!i.values) return h('button', {class: 'sm-ev', type: 'button', onClick: () => sim.dispatch(i.name)}, i.name);
      const list = h('select', {class: 'sm-val', 'aria-label': `The value of ${i.name}`}, i.values.map(v => h('option', {text: String(v)})));
      return h('div', {class: 'sm-evval'},
        h('button', {class: 'sm-ev', type: 'button', onClick: () => sim.dispatch(i.name, 'input', i.values[list.selectedIndex])}, i.name), list);
    }
    // A hold button is down while it is held (mouse, touch, Space or Enter); a pin
    // is a switch: a click sets it high or low.
    function holdView(i) {
      let down = false;
      bouncy[i.name] = i.bouncy;
      const pin = i.kind === 'pin';
      const btn = h('button', {class: pin ? 'sm-pin' : 'sm-hold', type: 'button', 'aria-pressed': 'false'},
        h('span', {text: i.name}), h('small', {text: pin ? 'click: high or low' : 'hold down'}));
      const set = level => {
        if (down === level) return;
        down = level;
        btn.setAttribute('aria-pressed', String(level));
        sim.press(i.name, level);
      };
      if (pin) btn.addEventListener('click', () => set(!down));
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
      const check = h('input', {type: 'checkbox', id: `sm${n}-bounce-${i.name}`});
      check.checked = i.bouncy;
      check.addEventListener('change', () => { bouncy[i.name] = check.checked; sim.holds[i.name].bouncy = check.checked; });
      const path = sv('path', {});
      const trace = sv('svg', {class: 'sm-trace', viewBox: '0 0 240 34', preserveAspectRatio: 'none', 'aria-hidden': 'true'}, path);
      const level = h('span'), span = h('span');
      return {input: i, path, level, span,
        el: h('div', {class: 'sm-holdrow'}, h('div', {class: 'sm-row2'}, btn, h('label', {class: 'sm-check', for: check.id}, check, 'bounces')), trace, h('div', {class: 'sm-tracecap'}, level, span)),
        release: () => { down = false; btn.setAttribute('aria-pressed', 'false'); }};
    }

    let statusTimer = 0;
    function status(msg) {
      statusEl.textContent = msg;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 4000);
    }
    function pulse(el, cls, ms) {
      clearTimeout(el._smTimer);
      el.classList.remove(cls);
      void el.getBoundingClientRect();
      el.classList.add(cls);
      el._smTimer = setTimeout(() => el.classList.remove(cls), ms);
    }
    // lines in a box (entry actions, an internal action) light up for a moment
    function glow(v, key) {
      const lines = v.pic.lines[key];
      if (!lines || v.folded || reduceMotion()) return;
      lines.forEach(t => pulse(t, 'glow', 1300));
    }
    // the dot along the arrow of a move, `ms` long; false if there is none (reduced motion)
    function token(v, f, ms) {
      const edge = f.edge;
      if (reduceMotion()) return false;
      let len = 0;
      try { len = edge.path.getTotalLength(); } catch (e) { return false; }
      if (!len) return false;
      const t0 = performance.now();
      edge.anim = t0;
      // on top of everything: half-way, an arrow runs under its label
      if (!edge.dot) { edge.dot = sv('circle', {class: 'sm-token', r: 4.5}); v.pic.svg.append(edge.dot); }
      const step = now => {
        if (edge.anim !== t0) return;
        const k = Math.min(1, (now - t0) / ms);
        const p = edge.path.getPointAtLength(len * k);
        edge.dot.setAttribute('cx', r1(p.x)); edge.dot.setAttribute('cy', r1(p.y));
        if (k < 1) requestAnimationFrame(step);
        else { edge.dot.remove(); edge.dot = null; if (v.flight === f) land(v); }
      };
      requestAnimationFrame(step);
      return true;
    }
    // the dot arrives, or the machine moves on before it does: the target lights
    // up and what its entry actions change shows
    function land(v) {
      const f = v.flight;
      if (!f) return;
      v.flight = null;
      stopDot(f);
      f.fx.forEach(show);
      v.at = f.target;
      glow(v, `${f.target}|entry`);
      if (!views.some(x => x.flight)) resync();
    }
    function stopDot(f) {
      if (f?.edge?.dot) { f.edge.anim = null; f.edge.dot.remove(); f.edge.dot = null; }
    }
    function show(fx) {
      if (fx.text) { write(shown, fx.text, model.text === 'terminal'); shown.version++; }
      else if (fx.variable) shown.vars[fx.variable] = fx.value;
      else shown.out[fx.out] = fx.value;
    }
    // with no dot on its way, the page shows the machines as they are
    function resync() {
      shown = {out: {...sim.out}, vars: sim.values(), display: sim.display, lines: sim.lines.slice(), version: (shown?.version ?? 0) + 1};
    }
    const viewOf = s => views.find(x => x.m === s.m);
    const hooks = {
      log: addLog,
      leave: (s, tr) => {
        const v = viewOf(s);
        land(v);
        if (!tr.internal) glow(v, `${s.state}|exit`);
      },
      effect: (s, fx, phase) => {
        const v = viewOf(s);
        if (phase === 'entry') v.buf.push(fx);              // for the move that follows (fired)
        else if (phase === 'do' && v.flight) v.flight.fx.push(fx);
        else if (shown) show(fx);
      },
      fired: (s, tr) => {
        const v = viewOf(s);
        if (!sim) return;                                    // starting (reset)
        if (tr.internal) { glow(v, tr.id); return; }
        // the dot arrives before the machine moves on by itself, at this speed
        const ms = Math.min(model.transition, 0.8 * sim.soonest(s) / speed);
        const f = v.flight = {target: tr.target, fx: v.buf, edge: v.pic.edges[tr.id]};
        v.buf = [];
        if (f.edge) { pulse(f.edge.g, 'fired', Math.max(1000, ms + 600)); pulse(f.edge.label, 'fired', Math.max(1000, ms + 600)); }
        if (!(f.edge && !v.folded && ms >= 40 && token(v, f, ms))) land(v);
      },
      ignored: (e, ms, guards = []) => {
        if (e.source !== 'input' && e.source !== 'edge') return;
        const where = ms.map(s => (multi ? `${s.m.name} is in ${s.state}` : s.state)).join(', '), name = eventText(e);
        if (guards.length) status(`${name} is ignored: ${guards.map(g => `[${g}]`).join(' and ')} ${guards.length > 1 ? 'are' : 'is'} false.`);
        else status(multi ? `${name} is ignored: ${where}, and none of them has an arrow for it.` : `${name} is ignored: ${where} has no arrow for it.`);
        for (const v of views) if (v.shown) pulse(v.pic.states[v.shown].g, 'ignored', 800);
      },
    };
    function addLog(e) {
      if (model.log === 'hidden') return;
      const who = multi && e.machine ? h('span', {class: 'who', text: `${e.machine}: `}) : null;
      let msg;
      if (e.error) msg = h('span', {class: 'bad', text: e.error});
      else if (e.start) msg = h('span', {}, who, `-> ${e.to}`);
      else if (e.ignored) {
        const where = e.states.map(([m, s]) => (multi ? `${m} in ${s}` : `in ${s}`)).join(', ');
        const why = e.guards?.length ? ` (${e.guards.map(g => `[${g}]`).join(' and ')} false)` : '';
        msg = h('span', {}, h('b', {text: e.cause}), h('span', {class: 'ign', text: e.source === 'timer' ? ' ran out, ignored ' : ' ignored '}), h('span', {class: 'who', text: where + why}));
      } else if (e.waiting) {
        msg = h('span', {}, who, h('b', {text: e.cause}), h('span', {class: 'ign', text: ` time is up, waits: ${e.guards.map(g => `[${g}]`).join(' and ')} false`}));
      } else if (e.internal) msg = h('span', {}, who, h('b', {text: e.cause}), ` in ${e.from}: ${e.text || 'nothing'}`);
      else msg = h('span', {}, who, h('b', {text: e.cause}), `: ${e.from} -> ${e.to}`);
      const stick = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 6;
      logEl.append(h('div', {class: 'sm-row'}, h('span', {class: 't', text: `${(e.t / 1000).toFixed(speed < 0.1 ? 4 : 3)} s`}), msg));
      while (logEl.childElementCount > 300) logEl.firstElementChild.remove();
      if (stick) logEl.scrollTop = logEl.scrollHeight;
    }

    let shownText = -1, timerSig = null, timerRows = [];
    function paintTimers() {
      const rows = [];
      for (const name of model.timers) {
        const tm = sim.timers[name], late = sim.ms.some(s => s.late.has(name));
        rows.push({key: `T|${name}`, name, sub: 'timer', left: tm ? tm.due - sim.t : null, total: tm ? tm.total : 0, idle: !tm && !late, blocked: late});
      }
      sim.ms.forEach(s => sim.pending(s).forEach(p => rows.push({key: `${s.m.name}|${s.state}|${p.label}`, name: p.label,
        sub: multi ? `${s.m.name}, ${s.state}` : s.state, left: p.left, total: p.total, waiting: p.waiting, blocked: p.blocked})));
      const sig = rows.map(r => r.key).join('\n');
      if (sig !== timerSig) {
        timerSig = sig;
        timerRows = rows.map(r => {
          const left = h('span', {class: 'left'}), fill = h('div', {class: 'fill'});
          const el = h('div', {class: 'sm-timer'}, h('span', {class: 'nm'}, r.name, h('small', {text: r.sub})), left, h('div', {class: 'track'}, fill));
          return {el, left, fill};
        });
        timersEl.replaceChildren(...(timerRows.length ? timerRows.map(r => r.el) : [h('div', {class: 'sm-none', text: 'Nothing is timed in this state.'})]));
      }
      rows.forEach((r, k) => {
        const tr = timerRows[k];
        const frac = r.blocked ? 1 : r.idle || r.waiting || !r.total ? 0 : Math.min(1, Math.max(0, 1 - r.left / r.total));
        tr.fill.style.width = `${(frac * 100).toFixed(1)}%`;
        tr.left.textContent = r.blocked ? 'guard is false' : r.idle ? 'not running' : r.waiting ? 'waiting' : `${fmt(r.left)} left`;
      });
    }
    // the level of a hold input over the last 8 s of real time
    function paintTrace(hv) {
      const hs = sim.holds[hv.input.name], W = 8000 * speed, t0 = sim.t - W;
      const y = l => (l ? 6 : 28);
      let lvl = hs.trace[0].level;
      for (const p of hs.trace) if (p.t <= t0) lvl = p.level;
      let d = `M0,${y(lvl)}`;
      for (const p of hs.trace) if (p.t > t0) d += `H${((p.t - t0) / W * 240).toFixed(1)}V${y(p.level)}`;
      hv.path.setAttribute('d', d + 'H240');
      hv.level.textContent = `${hv.input.name} ${hs.input.words[hs.level ? 0 : 1]}`;
      hv.span.textContent = `last ${fmt(W)}`;
    }
    function paint() {
      views.forEach((v, k) => {
        const s = sim.ms[k];
        if (v.shown !== v.at) {
          if (v.shown) v.pic.states[v.shown].g.classList.remove('on', 'timed');
          v.pic.states[v.at].g.classList.add('on');
          v.shown = v.at;
          if (v.pill) v.pill.textContent = v.at;
        }
        const node = v.pic.states[v.at];
        const p = !v.flight && v.at === s.state ? sim.pending(s).filter(x => !x.waiting && !x.blocked).sort((a, b) => a.left - b.left)[0] : null;
        node.g.classList.toggle('timed', !!p);
        if (p) node.bar.setAttribute('width', r1(node.w * Math.min(1, Math.max(0, 1 - p.left / p.total))));
      });
      for (const o of outs) outEls[o.name].classList.toggle('on', !!shown.out[o.name]);
      for (const r of varRows) {
        const text = String(shown.vars[r.key]);
        if (r.val.textContent === text) continue;
        if (r.val.textContent) pulse(r.el, 'changed', 700);
        r.val.textContent = text;
      }
      if (textEl && shownText !== shown.version) {
        shownText = shown.version;
        if (model.text === 'terminal') { textEl.textContent = shown.lines.join('\n'); textEl.scrollTop = textEl.scrollHeight; }
        else textEl.textContent = shown.display;
      }
      if (timersEl) paintTimers();
      holdViews.forEach(paintTrace);
      clock.textContent = `t = ${(sim.t / 1000).toFixed(3)} s`;
    }
    // back to the start; after a click on Reset, the entry actions of the first states light up
    function reset(clicked = false) {
      logEl.replaceChildren();
      statusEl.textContent = '';
      holdViews.forEach(hv => hv.release());
      views.forEach(v => { stopDot(v.flight); v.flight = null; });
      sim = shown = null;                                    // the hooks keep still while the machines start
      sim = new Sim(model, hooks);
      for (const name of Object.keys(bouncy)) sim.holds[name].bouncy = bouncy[name];
      views.forEach((v, k) => { v.buf = []; v.at = sim.ms[k].state; });
      resync();
      shownText = -1;
      paint();
      if (clicked) views.forEach(v => glow(v, `${v.at}|entry`));
    }
    reset();

    const io = new IntersectionObserver(es => { visible = es[es.length - 1].isIntersecting; });
    io.observe(top);
    let last = performance.now();
    function frame(now) {
      if (!alive) return;
      const dt = Math.min(now - last, 100);
      last = now;
      if (visible) {
        if (!paused) sim.advance(sim.t + dt * speed);
        paint();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return {destroy() { alive = false; io.disconnect(); }};
  }

  // editable: true (course preview only): the YAML under the machine, to change
  // and apply. The YAML reader (js-yaml) is loaded from a CDN when it is first needed.
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
  // YAML reads a value that starts with | as a block of text: `LAP: | print "lap"` cannot be read
  const barHint = text => (/:[ \t]*\|[ \t]*[^\s#|>+\-\d]/m.test(text)
    ? `\nAn arrow that starts with | needs quotes: LAP: '| print "lap"' (or write / print "lap").` : '');
  function editor(el, show, original) {
    const area = h('textarea', {class: 'sm-editor', spellcheck: 'false', 'aria-label': 'The state machine (YAML)'});
    area.value = original;
    area.rows = Math.min(32, original.split('\n').length + 1);
    const error = h('div', {class: 'sm-error', 'aria-live': 'polite'});
    const warnings = h('ul', {class: 'sm-warnings'});
    const done = model => {
      error.textContent = '';
      warnings.replaceChildren(...model.warnings.map(w => h('li', {text: `The build warns: ${w}`})));
    };
    const apply = async () => {
      try { done(show((await readYaml())(area.value))); }
      catch (e) { error.textContent = e.message + (e.name === 'YAMLException' ? barHint(area.value) : ''); warnings.replaceChildren(); }
    };
    const reset = () => {
      area.value = original;
      try { done(show(JSON.parse(el.getAttribute('data-config')))); }
      catch (e) { error.textContent = e.message; warnings.replaceChildren(); }
    };
    area.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); } });
    return h('details', {class: 'sm-source'}, h('summary', {text: 'The state machine (YAML): edit and apply'}), area,
      h('div', {class: 'sm-row2'}, h('button', {class: 'sm-btn', type: 'button', onClick: apply}, 'Apply'),
        h('button', {class: 'sm-btn', type: 'button', onClick: reset}, 'Reset'),
        h('span', {class: 'sm-note', text: 'Ctrl+Enter also applies.'})), error, warnings);
  }

  function mountBlock(el) {
    const host = h('div', {class: 'sm-host'});
    el.replaceChildren(host);
    let current = null;
    // shows a configuration; throws (and keeps the machine shown) if it has a mistake
    const show = config => {
      const model = read(config);
      current?.destroy();
      current = mount(host, model);
      return model;
    };
    try { show(JSON.parse(el.getAttribute('data-config'))); }
    catch (e) { host.replaceChildren(h('div', {class: 'sm-error', text: `This state machine cannot be shown: ${e.message}`})); }
    if (el.hasAttribute('data-yaml')) el.append(editor(el, show, el.getAttribute('data-yaml')));
  }

  root.CourseStatemachines = {read, Sim, print, fmt,
    // for the tests (tests/statemachine.js)
    internals: {layoutMachine, drawMachine, selfLoop, transitionTable, textWidth, measure, stateLines, edgeLines, svgText, speedOf, speedLabel, autoSpeeds, inSeconds}};

  if (hasDom) {
    const mountAll = () => document.querySelectorAll('.course-statemachine[data-config]').forEach(el => {
      if (!root.dagre) { el.replaceChildren(h('div', {class: 'sm-error', text: 'This state machine cannot be shown: the layout script (dagre) is missing.'})); return; }
      mountBlock(el);
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
    else mountAll();
  }
})(globalThis);
