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
  const FONT = {name: ['bold', 13], action: ['italic', 11.5], internal: ['regular', 11.5], label: ['regular', 12]};
  const measure = (text, kind) => textWidth(text, FONT[kind][0], FONT[kind][1]);

  // ========================================================================
  // Reading the YAML: read(config) -> model, or an Error with a message for the author
  // ========================================================================
  const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const TOP_KEYS = ['title', 'task', 'direction', 'text', 'log', 'speed', 'inputs', 'outputs', 'initial', 'states', 'machines', 'editable'];
  const MACHINE_KEYS = ['title', 'direction', 'initial', 'states', 'folded'];
  const STATE_KEYS = ['entry', 'do', 'on'];
  const LEDS = ['red', 'green', 'amber', 'yellow', 'blue', 'white'];
  const WORDS = {button: ['pressed', 'released'], pin: ['high', 'low']};
  const RESERVED = ['print', 'clear', 'start', 'stop', 'send', 'blink', 'after', 'on', 'off', 'toggle'];

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

  // speed: 1, 1/4, 1/100, 0.5 -> {value, label}
  function speedOf(v) {
    const s = clean(v ?? '1');
    let m, x = NaN;
    if ((m = /^1 ?\/ ?(\d+)$/.exec(s))) x = 1 / Number(m[1]);
    else if (/^(?:0?\.\d+|1(?:\.0*)?)$/.test(s)) x = Number(s);
    if (!(x >= 0.001 && x <= 1)) fail('speed: is 1 (real time) or slower, e.g. 1/4, 1/10 or 1/100 (1/1000 at the slowest)');
    return {value: x, label: speedLabel(x)};
  }
  function speedLabel(x) {
    if (x === 1) return '1×';
    const n = Math.round(1 / x);
    return Math.abs(1 / n - x) < 1e-9 ? `1/${n}×` : `${x}×`;
  }

  // split at `sep`, but not inside "double quotes"
  function splitOutside(s, sep) {
    const out = [];
    let cur = '', quoted = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && quoted && i + 1 < s.length) { cur += ch + s[++i]; continue; }
      if (ch === '"') quoted = !quoted;
      if (ch === sep && !quoted) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function readInputs(spec, ctx) {
    if (spec == null) return;
    if (!isMap(spec)) fail('inputs: write one input per line, e.g. pressed: button');
    for (const [name, kind] of Object.entries(spec)) {
      nameOf(name, 'inputs');
      const k = clean(kind ?? '');
      const m = /^(bouncy )?(button|hold button|pin)$/.exec(k);
      if (!m) fail(`inputs, ${name}: "${k}" is not an input. Inputs are: button (a click), hold button, pin, bouncy button, bouncy pin`);
      const pin = m[2] === 'pin';
      ctx.inputs[name] = m[2] === 'button' && !m[1] ? {name, hold: false}
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
      p += m[0].length;
      out.push(makeAction(kind, m, ctx, where, isDo));
    }
  }
  function makeAction(kind, m, ctx, where, isDo) {
    if (isDo && kind !== 'blink') fail(`${where}: "${clean(m[0])}" cannot be a do activity. The only one is blink <output> <time>, e.g. blink LED 500 ms`);
    switch (kind) {
      case 'print':
        ctx.prints = true;
        return {kind, text: m[1].replace(/\\(.)/g, '$1'), src: `print "${m[1]}"`};
      case 'clear':
        ctx.prints = true;
        return {kind, src: 'clear'};
      case 'start': {
        const t = time(m[2], where);
        ctx.timers.add(m[1]);
        return {kind, timer: m[1], time: t, src: `start ${m[1]} ${t.text}`};
      }
      case 'stop': ctx.stops.add(m[1]); return {kind, timer: m[1], src: `stop ${m[1]}`};
      case 'send': ctx.sent.add(m[1]); return {kind, event: m[1], src: `send ${m[1]}`};
      case 'blink': {
        if (!isDo) fail(`${where}: blink is a do activity: write it under do:`);
        useOutput(m[1], ctx, where);
        const t = time(m[2], where, false);
        return {kind, out: m[1], period: t.min, src: `blink ${m[1]} ${t.text}`};
      }
      default:
        useOutput(m[1], ctx, where);
        return {kind: 'set', out: m[1], value: m[2], src: `${m[1]} ${m[2]}`};
    }
  }
  function notAnAction(rest, ctx, where, isDo) {
    const piece = clean(splitOutside(rest, ',')[0]);
    const shown = piece.length > 48 ? piece.slice(0, 45) + '…' : piece;
    const word = /^\S*/.exec(piece)[0];
    if (isDo) return `${where}: "${shown}" cannot be a do activity. The only one is blink <output> <time>, e.g. blink LED 500 ms`;
    if (word === 'print') return `${where}: print needs its text in double quotes: print "Ready"`;
    if (word === 'start') return `${where}: "${shown}": start needs a timer and a time: start T 10 s (or 2..5 s)`;
    if (word === 'stop' || word === 'send') return `${where}: "${shown}": ${word} needs one name: ${word} ${word === 'stop' ? 'T' : 'pressed'}`;
    if (word === 'blink') return `${where}: "${shown}": blink needs an output and a time: blink LED 500 ms`;
    if (ctx.outputs[word]) return `${where}: "${shown}": write ${word} on, ${word} off or ${word} toggle`;
    const out = Object.keys(ctx.outputs)[0] || 'LED';
    return `${where}: "${shown}" is not an action. Actions are: ${out} on, ${out} off, ${out} toggle, print "text", clear, start T 10 s, stop T, send event`;
  }

  // the left side of on: -> {kind: event|after|held, ...}
  function readTrigger(key, ctx, where) {
    const k = clean(key);
    let m;
    if (k.startsWith('[')) fail(`${where}: guards ([…]) come in a later version`);
    if ((m = /^after (.+)$/.exec(k))) {
      const t = time(m[1], where);
      return {kind: 'after', time: t, label: `after ${t.text}`};
    }
    if ((m = /^([A-Za-z_]\w*) (\w+)(?: for (.+))?$/.exec(k)) && ctx.inputs[m[1]]) {
      const input = ctx.inputs[m[1]];
      if (!input.hold) fail(`${where}: ${m[1]} is a click button: its event is just ${m[1]}. For pressed and released, make it a hold button`);
      const i = input.words.indexOf(m[2]);
      if (i < 0) fail(`${where}: ${m[1]} is a ${input.kind === 'pin' ? 'pin' : 'hold button'}: write ${m[1]} ${input.words[0]} or ${m[1]} ${input.words[1]}`);
      ctx.usedInputs.add(m[1]);
      if (m[3] != null) {
        const t = time(m[3], where, false);
        return {kind: 'held', input: m[1], level: i === 0, time: t, label: `[${m[1]} ${m[2]} for ${t.text}]`};
      }
      return {kind: 'event', event: `${m[1]} ${m[2]}`, edge: true, label: k};
    }
    if (NAME.test(k)) {
      if (ctx.inputs[k]?.hold) fail(`${where}: ${k} is a ${ctx.inputs[k].kind === 'pin' ? 'pin' : 'hold button'}: write ${k} ${ctx.inputs[k].words[0]} or ${k} ${ctx.inputs[k].words[1]}`);
      ctx.handled.add(k);
      return {kind: 'event', event: k, label: k};
    }
    fail(`${where}: "${k}" is not an event. Write an input (pressed), a timer (exit_delay), after 10 s, or for an input that is held down: KEY pressed, KEY released, KEY pressed for 1 s`);
  }

  // the right side of on: TARGET, TARGET / actions, / actions
  function readArrow(value, names, ctx, where) {
    if (value == null || typeof value === 'object' || clean(value) === '') {
      fail(`${where}: where to? Write a state (LIGHT_ON), a state and actions (LIGHT_ON / LED on), or only actions for an internal action (/ print "lap")`);
    }
    const parts = splitOutside(String(value), '/');
    const target = clean(parts[0]);
    const actions = parts.length > 1 ? readActions(parts.slice(1).join('/'), ctx, where, false) : [];
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
    const states = {};
    for (const n of names) {
      const sw = `${W}state ${n}`;
      const st = {name: n, entry: [], do: [], on: []};
      const s = raw[n];
      if (s != null) {
        if (!isMap(s)) fail(`${sw}: write entry:, do: and on: under it`);
        keysOf(s, STATE_KEYS, sw);
        st.entry = readActions(s.entry, ctx, `${sw}, entry`, false);
        st.do = readActions(s.do, ctx, `${sw}, do`, true);
        if (s.on != null) {
          if (!isMap(s.on)) fail(`${sw}: on: needs lines like pressed: LIGHT_ON`);
          for (const [key, value] of Object.entries(s.on)) {
            const tw = `${sw}, on ${clean(key)}`;
            const trigger = readTrigger(key, ctx, tw);
            const arrow = readArrow(value, names, ctx, tw);
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
    return {name, title: spec.title != null ? String(spec.title) : name, direction: dir, initial, states, folded: spec.folded === true};
  }

  function read(config) {
    if (!isMap(config)) fail('the YAML must be a mapping: title:, inputs:, outputs:, states: …');
    keysOf(config, TOP_KEYS, 'statemachine');
    const ctx = {inputs: {}, outputs: {}, timers: new Set(), stops: new Set(), sent: new Set(), handled: new Set(),
      usedOutputs: new Set(), usedInputs: new Set(), prints: false};
    readInputs(config.inputs, ctx);
    readOutputs(config.outputs, ctx);
    const text = clean(config.text ?? 'display');
    if (!['display', 'terminal'].includes(text)) fail('text: is display (a print replaces the text) or terminal (a print adds a line)');
    const log = clean(config.log ?? 'open');
    if (!['open', 'folded', 'hidden'].includes(log)) fail('log: is open, folded or hidden');
    const speed = speedOf(config.speed);
    const direction = clean(config.direction ?? 'LR');
    if (!['LR', 'TB'].includes(direction)) fail('direction: is LR (left to right) or TB (top to bottom)');
    let machines;
    if (config.machines != null) {
      if (config.states != null) fail('write states: for one machine or machines: for several, not both');
      if (config.initial != null) fail('initial: belongs in each machine under machines:');
      if (!isMap(config.machines) || !Object.keys(config.machines).length) fail('machines: needs one or more machines, each with states:');
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
    const warnings = [];
    for (const t of ctx.timers) if (!ctx.handled.has(t)) warnings.push(`timer ${t} runs out, but no state reacts to it`);
    for (const t of ctx.stops) if (!ctx.timers.has(t)) warnings.push(`stop ${t}: timer ${t} is never started`);
    for (const e of ctx.sent) if (!ctx.handled.has(e)) warnings.push(`send ${e}: no state reacts to ${e}`);
    for (const [n, i] of Object.entries(ctx.inputs)) if (!(i.hold ? ctx.usedInputs.has(n) : ctx.handled.has(n))) warnings.push(`input ${n} is not used in any state`);
    for (const o of Object.keys(ctx.outputs)) if (!ctx.usedOutputs.has(o)) warnings.push(`output ${o} is never switched`);
    for (const m of machines) {
      const seen = new Set([m.initial]), todo = [m.initial];
      while (todo.length) for (const tr of m.states[todo.pop()].on) if (tr.target && !seen.has(tr.target)) { seen.add(tr.target); todo.push(tr.target); }
      for (const n of Object.keys(m.states)) if (!seen.has(n)) warnings.push(`${machines.length > 1 ? `machine ${m.name}: ` : ''}state ${n} can never be reached`);
    }
    return {title: config.title != null ? String(config.title) : '', task: config.task != null ? String(config.task) : '',
      text, log, speed, direction, inputs: ctx.inputs, outputs: ctx.outputs, timers: [...ctx.timers],
      prints: ctx.prints, machines, warnings};
  }

  // ========================================================================
  // Running the machines
  // ========================================================================
  const fmt = ms => (ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`);

  // Simulated time in ms. advance(to) runs everything that is due, in order, so
  // the speed changes nothing but the pace. random() is Math.random unless a test
  // passes its own.
  class Sim {
    constructor(model, hooks, random) { this.model = model; this.hooks = hooks || {}; this.random = random || Math.random; this.reset(); }
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
      this.ms = M.machines.map(m => ({m, state: null, since: 0, afters: [], blinks: []}));
      for (const s of this.ms) { this.enter(s, s.m.initial); this.say({machine: s.m.name, start: true, to: s.m.initial}); }
      this.drain();
    }
    pick(t) { return Math.round(t.min + this.random() * (t.max - t.min)); }
    say(entry) { entry.t = this.t; this.hooks.log?.(entry); }
    enter(s, name) {
      const st = s.m.states[name];
      s.state = name; s.since = this.t;
      s.afters = st.on.filter(tr => tr.trigger.kind === 'after').map(tr => { const total = this.pick(tr.trigger.time); return {tr, due: this.t + total, total}; });
      s.blinks = st.do.map(a => ({a, next: this.t + a.period}));
      this.run(s, st.entry);
    }
    run(s, actions) {
      for (const a of actions) {
        if (a.kind === 'set') this.out[a.out] = a.value === 'toggle' ? !this.out[a.out] : a.value === 'on';
        else if (a.kind === 'print') {
          if (this.model.text === 'terminal') { this.lines.push(a.text); if (this.lines.length > 200) this.lines.shift(); }
          else this.display = a.text;
          this.textVersion++;
        } else if (a.kind === 'clear') { this.display = ''; this.lines = []; this.textVersion++; }
        else if (a.kind === 'start') { const total = this.pick(a.time); this.timers[a.timer] = {due: this.t + total, total}; }
        else if (a.kind === 'stop') this.timers[a.timer] = null;
        else if (a.kind === 'send') this.queue.push({name: a.event, source: 'sent'});
      }
    }
    fire(s, tr, cause) {
      const from = s.state;
      if (tr.internal) {
        this.run(s, tr.actions);
        this.say({machine: s.m.name, cause, from, internal: true, text: tr.actions.map(a => a.src).join(', ')});
      } else {
        s.afters = []; s.blinks = [];          // exit
        this.run(s, tr.actions);
        this.enter(s, tr.target);
        this.say({machine: s.m.name, cause, from, to: tr.target});
      }
      this.hooks.fired?.(s, tr);
    }
    dispatch(name, source = 'input') { this.queue.push({name, source}); this.drain(); }
    // one event at a time, to every machine; sent events queue up behind it
    drain() {
      let n = 0;
      while (this.queue.length) {
        if (++n > 500) { this.queue = []; this.say({error: 'Over 500 events in a row: do the machines send each other events in a loop?'}); return; }
        const e = this.queue.shift();
        let handled = false;
        for (const s of this.ms) {
          const tr = s.m.states[s.state].on.find(x => x.trigger.kind === 'event' && x.trigger.event === e.name);
          if (tr) { handled = true; this.fire(s, tr, e.name); }
        }
        if (!handled && !(e.source === 'edge' && e.bouncy)) {
          this.say({cause: e.name, ignored: true, source: e.source, states: this.ms.map(s => [s.m.name, s.state])});
          this.hooks.ignored?.(e, this.ms);
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
      this.queue.push({name: `${name} ${h.input.words[level ? 0 : 1]}`, source: 'edge', bouncy: h.bouncy});
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
          if (h.level === tr.trigger.level) consider(Math.max(h.since, s.since) + tr.trigger.time.min, 1, 'held', tr.trigger.label, () => { this.fire(s, tr, tr.trigger.label); this.drain(); });
        }
        for (const a of s.afters) consider(a.due, 2, 'after', a.tr.trigger.label, () => { s.afters = s.afters.filter(x => x !== a); this.fire(s, a.tr, a.tr.trigger.label); this.drain(); });
        if (blinks) for (const b of s.blinks) consider(b.next, 4, 'blink', b.a.src, () => { this.out[b.a.out] = !this.out[b.a.out]; b.next += b.a.period; });
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
      for (const a of s.afters) list.push({label: a.tr.trigger.label, left: a.due - this.t, total: a.total});
      for (const tr of s.m.states[s.state].on) if (tr.trigger.kind === 'held') {
        const h = this.holds[tr.trigger.input], total = tr.trigger.time.min;
        const counting = h.level === tr.trigger.level;
        list.push({label: tr.trigger.label, total, waiting: !counting, left: counting ? Math.max(h.since, s.since) + total - this.t : total});
      }
      return list;
    }
  }

  // ========================================================================
  // Layout (dagre) and drawing
  // ========================================================================
  // items joined with commas, wrapped at about `max` characters
  function wrapItems(prefix, items, max) {
    const lines = [];
    let cur = prefix;
    items.forEach((it, i) => {
      const piece = it + (i < items.length - 1 ? ',' : '');
      if (cur !== prefix && cur.length + piece.length > max) { lines.push(cur.trimEnd()); cur = ''; }
      cur += piece + ' ';
    });
    lines.push(cur.trimEnd());
    return lines;
  }
  // the lines in a state's box: entry and do actions, internal actions
  function stateLines(st) {
    const out = [];
    const add = (prefix, items, kind, id) => wrapItems(prefix, items, 30).forEach(text => out.push({text, kind, id}));
    if (st.entry.length) add('entry: ', st.entry.map(a => a.src), 'action');
    if (st.do.length) add('do: ', st.do.map(a => a.src), 'action');
    for (const tr of st.on) if (tr.internal) add(`${tr.trigger.label} / `, tr.actions.map(a => a.src), 'internal', tr.id);
    return out;
  }
  // the label of an arrow: the event, and its actions after a /
  function edgeLines(tr) {
    const acts = tr.actions.map(a => a.src);
    if (!acts.length) return [tr.trigger.label];
    const one = `${tr.trigger.label} / ${acts.join(', ')}`;
    return one.length <= 24 ? [one] : [tr.trigger.label, ...wrapItems('/ ', acts, 26)];
  }

  const INIT = '•init';   // not a valid state name
  const LINE = 15, LABEL_LINE = 14;
  function layoutMachine(m) {
    const g = new root.dagre.graphlib.Graph({multigraph: true});
    g.setGraph({rankdir: m.direction, nodesep: 28, ranksep: 34, edgesep: 14, marginx: 8, marginy: 8});
    g.setDefaultEdgeLabel(() => ({}));
    g.setNode(INIT, {width: 14, height: 14});
    const nodes = {};
    for (const st of Object.values(m.states)) {
      const lines = stateLines(st);
      const w = Math.ceil(Math.max(92, measure(st.name, 'name') + 28, ...lines.map(l => measure(l.text, l.kind) + 26)));
      const hh = lines.length ? 26 + 6 + lines.length * LINE + 9 : 38;
      nodes[st.name] = {name: st.name, lines, w, h: hh};
      g.setNode(st.name, {width: w, height: hh});
    }
    const labels = {};
    g.setEdge(INIT, m.initial, {width: 0, height: 0, labelpos: 'c'}, 'init');
    for (const st of Object.values(m.states)) for (const tr of st.on) {
      if (tr.internal) continue;
      const lines = edgeLines(tr);
      const lw = Math.ceil(Math.max(...lines.map(l => measure(l, 'label')))) + 12;
      const lh = lines.length * LABEL_LINE + 4;
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
    `.name{font-size:13px;font-weight:bold;fill:${INK.fg}}`,
    `.sep{stroke:${INK.sep};stroke-width:1}`,
    `.act{font-size:11.5px;font-style:italic;fill:${INK.muted}}`,
    `.act.internal{font-style:normal;fill:${INK.fg}}`,
    `.line{fill:none;stroke:${INK.edge};stroke-width:1.4}`,
    `.head{fill:${INK.edge}}`,
    `.lbl-bg{fill:${INK.paper}}`,
    `.lbl{font-size:12px;fill:${INK.fg}}`,
    `.init{fill:${INK.fg}}`,
  ].join('');

  // The picture of one machine. make: sv (browser) or svgText (PDF). Returns the
  // svg and, for the browser, the parts that light up.
  function drawMachine(geo, m, make, isStatic) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const box = (x, y, w, hh) => { x0 = Math.min(x0, x - w / 2); x1 = Math.max(x1, x + w / 2); y0 = Math.min(y0, y - hh / 2); y1 = Math.max(y1, y + hh / 2); };
    for (const n of Object.values(geo.nodes)) box(n.x, n.y, n.w, n.h);
    box(geo.init.x, geo.init.y, 14, 14);
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
        e.lines.map((line, i) => make('text', {class: 'lbl', x: r1(e.lx), y: r1(e.ly - e.lh / 2 + 13 + i * LABEL_LINE), 'text-anchor': 'middle', text: line})));
      labelLayer.append(label);
      pic.edges[e.id] = {g, label, path};
    });
    nodeLayer.append(make('circle', {class: 'init', cx: r1(geo.init.x), cy: r1(geo.init.y), r: 6.5}));
    for (const n of Object.values(geo.nodes)) {
      const x = n.x - n.w / 2, y = n.y - n.h / 2;
      const g = make('g', {class: 'sm-state'});
      g.append(make('rect', {class: 'box', x: r1(x), y: r1(y), width: n.w, height: n.h, rx: 9}));
      if (n.lines.length) {
        g.append(make('text', {class: 'name', x: r1(n.x), y: r1(y + 18), 'text-anchor': 'middle', text: n.name}));
        g.append(make('line', {class: 'sep', x1: r1(x), x2: r1(x + n.w), y1: r1(y + 26), y2: r1(y + 26)}));
        n.lines.forEach((l, i) => {
          const t = make('text', {class: l.kind === 'internal' ? 'act internal' : 'act', x: r1(x + 11), y: r1(y + 26 + 17 + i * LINE), text: l.text});
          g.append(t);
          if (l.id) (pic.lines[l.id] ||= []).push(t);
        });
      } else g.append(make('text', {class: 'name', x: r1(n.x), y: r1(n.y + 4.5), 'text-anchor': 'middle', text: n.name}));
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
  function transitionTable(m) {
    const events = [];
    for (const st of Object.values(m.states)) for (const tr of st.on) if (!events.includes(tr.trigger.label)) events.push(tr.trigger.label);
    const rows = Object.values(m.states).map(st => [st.name, ...events.map(label => {
      const tr = st.on.find(x => x.trigger.label === label);
      if (!tr) return '–';
      const acts = tr.actions.map(a => a.src).join(', ');
      return tr.internal ? `/ ${acts}` : tr.target + (acts ? ` / ${acts}` : '');
    })]);
    return {head: ['State', ...events], rows};
  }

  function print(config) {
    let model;
    try { model = read(config); } catch (e) { return {error: e.message, warnings: []}; }
    const multi = model.machines.length > 1;
    const machines = model.machines.map(m => {
      const pic = drawMachine(layoutMachine(m), m, svgText, true);
      return {title: multi ? m.title : null, svg: pic.svg.toString(), width: pic.width, height: pic.height, table: transitionTable(m)};
    });
    return {title: model.title || null, task: model.task || null, machines, warnings: model.warnings};
  }

  // ========================================================================
  // The interactive machines (browser)
  // ========================================================================
  const reduceMotion = () => root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let uid = 0;

  function machineView(m, multi) {
    const pic = drawMachine(layoutMachine(m), m, sv, false);
    const v = {m, pic, shown: null, pill: null, el: null, folded: false};
    const wrap = h('div', {class: 'sm-pic'}, pic.svg);
    if (!multi) { v.el = h('div', {class: 'sm-panel'}, wrap); return v; }
    const reacts = [], sends = [];
    for (const st of Object.values(m.states)) {
      for (const tr of st.on) {
        if (!reacts.includes(tr.trigger.label)) reacts.push(tr.trigger.label);
        for (const a of tr.actions) if (a.kind === 'send' && !sends.includes(a.event)) sends.push(a.event);
      }
      for (const a of st.entry) if (a.kind === 'send' && !sends.includes(a.event)) sends.push(a.event);
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

  const SPEEDS = [1, 0.1, 0.01];

  function mount(host, model) {
    const n = ++uid;
    const multi = model.machines.length > 1;
    let sim = null, paused = false, speed = model.speed.value, alive = true, visible = true;
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
        clicks.length ? h('div', {class: 'sm-buttons'}, clicks.map(i => h('button', {class: 'sm-ev', type: 'button', onClick: () => sim.dispatch(i.name)}, i.name))) : null,
        holdViews.map(v => v.el)));
    }
    const outEls = {};
    const outs = Object.values(model.outputs);
    if (outs.length) groups.push(h('div', {class: 'sm-group'}, h('div', {class: 'sm-cap', text: 'Outputs'}), h('div', {class: 'sm-outs'}, outs.map(o => (outEls[o.name] = outputView(o))))));
    let textEl = null;
    if (model.prints) {
      textEl = h('div', {class: model.text === 'terminal' ? 'sm-terminal' : 'sm-display', 'aria-live': 'polite'});
      groups.push(h('div', {class: 'sm-group'}, h('div', {class: 'sm-cap', text: model.text === 'terminal' ? 'Terminal' : 'Display'}), textEl));
    }
    const timed = model.timers.length || model.machines.some(m => Object.values(m.states).some(st => st.on.some(tr => tr.trigger.kind === 'after' || tr.trigger.kind === 'held')));
    let timersEl = null;
    if (timed) {
      timersEl = h('div', {class: 'sm-timers'});
      groups.push(h('div', {class: 'sm-group'}, h('div', {class: 'sm-cap', text: 'Timers'}), timersEl));
    }
    top.append(h('div', {class: 'sm-board'}, groups));

    // controls
    const pauseBtn = h('button', {class: 'sm-btn', type: 'button', 'aria-pressed': 'false', onClick: () => {
      paused = !paused;
      pauseBtn.textContent = paused ? 'Run' : 'Pause';
      pauseBtn.setAttribute('aria-pressed', String(paused));
    }}, 'Pause');
    const speeds = SPEEDS.includes(speed) ? SPEEDS : [...SPEEDS, speed].sort((a, b) => b - a);
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
    top.append(h('div', {class: 'sm-ctl'},
      h('button', {class: 'sm-btn', type: 'button', onClick: reset}, 'Reset'), pauseBtn,
      h('span', {class: 'sm-lbl', text: 'Speed'}), h('div', {class: 'sm-seg', role: 'group', 'aria-label': 'Speed'}, speedBtns),
      timed || holdViews.some(v => v.input.bouncy) ? skipBtn : null, clock));
    const statusEl = h('div', {class: 'sm-status', 'aria-live': 'polite'});
    top.append(statusEl);
    const logEl = h('div', {class: 'sm-log'});
    if (model.log !== 'hidden') top.append(h('details', {class: 'sm-logbox', open: model.log === 'open'}, h('summary', {text: 'Log'}), logEl));
    host.replaceChildren(top);

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
    function token(edge) {
      if (reduceMotion()) return;
      let len = 0;
      try { len = edge.path.getTotalLength(); } catch (e) { return; }
      if (!len) return;
      const t0 = performance.now();
      edge.anim = t0;
      if (!edge.dot) { edge.dot = sv('circle', {class: 'sm-token', r: 4.5}); edge.g.append(edge.dot); }
      const step = now => {
        if (edge.anim !== t0) return;
        const k = Math.min(1, (now - t0) / 420);
        const p = edge.path.getPointAtLength(len * k);
        edge.dot.setAttribute('cx', r1(p.x)); edge.dot.setAttribute('cy', r1(p.y));
        if (k < 1) requestAnimationFrame(step); else { edge.dot.remove(); edge.dot = null; }
      };
      requestAnimationFrame(step);
    }
    const hooks = {
      log: addLog,
      fired: (s, tr) => {
        const v = views.find(x => x.m === s.m);
        if (tr.internal) { for (const t of v.pic.lines[tr.id] || []) pulse(t, 'fired', 900); return; }
        const e = v.pic.edges[tr.id];
        if (!e) return;
        pulse(e.g, 'fired', 1000);
        pulse(e.label, 'fired', 1000);
        if (!v.folded) token(e);
      },
      ignored: (e, ms) => {
        if (e.source !== 'input' && e.source !== 'edge') return;
        const where = ms.map(s => (multi ? `${s.m.name} is in ${s.state}` : s.state)).join(', ');
        status(multi ? `${e.name} is ignored: ${where}, and none of them has an arrow for it.` : `${e.name} is ignored: ${where} has no arrow for it.`);
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
        msg = h('span', {}, h('b', {text: e.cause}), h('span', {class: 'ign', text: e.source === 'timer' ? ' ran out, ignored ' : ' ignored '}), h('span', {class: 'who', text: where}));
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
        const tm = sim.timers[name];
        rows.push({key: `T|${name}`, name, sub: 'timer', left: tm ? tm.due - sim.t : null, total: tm ? tm.total : 0, idle: !tm});
      }
      sim.ms.forEach(s => sim.pending(s).forEach(p => rows.push({key: `${s.m.name}|${s.state}|${p.label}`, name: p.label,
        sub: multi ? `${s.m.name}, ${s.state}` : s.state, left: p.left, total: p.total, waiting: p.waiting})));
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
        const frac = r.idle || r.waiting || !r.total ? 0 : Math.min(1, Math.max(0, 1 - r.left / r.total));
        tr.fill.style.width = `${(frac * 100).toFixed(1)}%`;
        tr.left.textContent = r.idle ? 'not running' : r.waiting ? 'waiting' : `${fmt(r.left)} left`;
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
        if (v.shown !== s.state) {
          if (v.shown) v.pic.states[v.shown].g.classList.remove('on', 'timed');
          v.pic.states[s.state].g.classList.add('on');
          v.shown = s.state;
          if (v.pill) v.pill.textContent = s.state;
        }
        const node = v.pic.states[s.state];
        const p = sim.pending(s).filter(x => !x.waiting).sort((a, b) => a.left - b.left)[0];
        node.g.classList.toggle('timed', !!p);
        if (p) node.bar.setAttribute('width', r1(node.w * Math.min(1, Math.max(0, 1 - p.left / p.total))));
      });
      for (const o of outs) outEls[o.name].classList.toggle('on', !!sim.out[o.name]);
      if (textEl && shownText !== sim.textVersion) {
        shownText = sim.textVersion;
        if (model.text === 'terminal') { textEl.textContent = sim.lines.join('\n'); textEl.scrollTop = textEl.scrollHeight; }
        else textEl.textContent = sim.display;
      }
      if (timersEl) paintTimers();
      holdViews.forEach(paintTrace);
      clock.textContent = `t = ${(sim.t / 1000).toFixed(3)} s`;
    }
    function reset() {
      logEl.replaceChildren();
      statusEl.textContent = '';
      holdViews.forEach(hv => hv.release());
      sim = new Sim(model, hooks);
      for (const name of Object.keys(bouncy)) sim.holds[name].bouncy = bouncy[name];
      shownText = -1;
      paint();
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
      catch (e) { error.textContent = e.message; warnings.replaceChildren(); }
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
    internals: {layoutMachine, drawMachine, selfLoop, transitionTable, textWidth, stateLines, edgeLines, svgText, speedOf}};

  if (hasDom) {
    const mountAll = () => document.querySelectorAll('.course-statemachine[data-config]').forEach(el => {
      if (!root.dagre) { el.replaceChildren(h('div', {class: 'sm-error', text: 'This state machine cannot be shown: the layout script (dagre) is missing.'})); return; }
      mountBlock(el);
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
    else mountAll();
  }
})(globalThis);
