/*
 * Course widgets: interactive widgets for bits, numbers, registers and data on
 * a wire (course-tools; see docs/authoring.md, "Widgets").
 *
 * A page writes a widget as a ```widget block with YAML. The build passes it
 * to the page as JSON: <div class="course-widget" data-config="...">.
 *
 * This file runs in two places:
 * - in the browser, where it builds the interactive widgets (`render`);
 * - at build time in Deno (`quarto run`, see print.js), where it checks every
 *   widget and draws its static form for the PDF (`print`): a picture as SVG
 *   text and, for a challenge, an exercise with its answer (`exercise`). An
 *   answer is checked with the same code that checks a student's answer in
 *   the browser before it is printed.
 *
 * A type is registered with Widget.define(name, {keys, views, controls,
 * defaults, render, print, exercise}). Nothing here belongs to a particular
 * processor: registers, fields and names come from the YAML.
 */
(function (root) {
  'use strict';

  const hasDom = typeof document !== 'undefined';

  // ========================================================================
  // Small DOM and SVG helpers
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
  let uid = 0;
  const nextId = prefix => `cw-${prefix}-${++uid}`;
  // append, skipping null/false children (Element.append would insert the text "null")
  const add = (parent, ...kids) => parent.append(...kids.flat().filter(k => k != null && k !== false));

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

  // ========================================================================
  // Bits: integer helpers on BigInt (any width, no precision problems)
  // ========================================================================
  const Bits = {
    // 42, -7, 0x2A, 0b101010, 0o52, 'A', with _ or spaces between digits and C suffixes (u, UL).
    parse(text) {
      let t = String(text).trim().replace(/^−/, '-');
      if (/^'.'$/.test(t)) return BigInt(t.charCodeAt(1));
      t = t.replace(/[_\s]/g, '').replace(/(?<=[0-9a-fA-F])[uUlL]+$/, '');
      if (!t) return null;
      let neg = false;
      if (t[0] === '-' || t[0] === '+') { neg = t[0] === '-'; t = t.slice(1); }
      let v = null;
      if (/^0x[0-9a-f]+$/i.test(t) || /^0b[01]+$/i.test(t) || /^0o[0-7]+$/i.test(t) || /^\d+$/.test(t)) v = BigInt(t);
      if (v === null) return null;
      return neg ? -v : v;
    },
    big(v) {
      if (typeof v === 'bigint') return v;
      if (typeof v === 'number') {
        if (!Number.isInteger(v)) throw new Error(`${v} is not a whole number`);
        return BigInt(v);
      }
      if (typeof v === 'boolean') return v ? 1n : 0n;
      const p = v == null ? null : Bits.parse(v);
      if (p === null) throw new Error(`"${v}" is not a number`);
      return p;
    },
    u: (v, w) => BigInt.asUintN(w, v),
    s: (v, w) => BigInt.asIntN(w, v),
    bit: (v, i) => Number((v >> BigInt(i)) & 1n),
    mask: w => (1n << BigInt(w)) - 1n,
    bin(v, w, grouped = true) {
      const t = Bits.u(v, w).toString(2).padStart(w, '0');
      return grouped ? t.replace(/\B(?=(\d{4})+(?!\d))/g, ' ') : t;
    },
    hex(v, w) { return '0x' + Bits.u(v, w).toString(16).toUpperCase().padStart(Math.ceil(w / 4), '0'); },
    ones(v) { let n = 0; for (let x = v < 0n ? -v : v; x; x >>= 1n) n += Number(x & 1n); return n; },
    fieldMask: (hi, lo) => ((1n << BigInt(hi - lo + 1)) - 1n) << BigInt(lo),
    minus: t => String(t).replace(/^-/, '−'),
  };

  // ========================================================================
  // Settings shared by several types
  // ========================================================================
  const listOf = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const has = (list, x) => listOf(list).includes(x);
  const int = v => Number(Bits.big(v));
  function widthOf(v, max = 64) {
    const w = int(v);
    if (w < 1 || w > max) throw new Error(`width must be 1 … ${max}, not ${w}`);
    return w;
  }
  // Whether a value fits in w bits, as an unsigned or a signed number
  const fits = (v, w) => v >= -(1n << BigInt(w - 1)) && v <= Bits.mask(w);
  // The weight of bit i: 1024 or, when it no longer fits a bit column, 2 with a superscript 14
  function weightOf(i) {
    return i < 14 ? String(2 ** i) : ['2', h('sup', {text: String(i)})];
  }
  // signed: false (only unsigned), true (only signed) or both (the default)
  function readings(c) {
    const s = c.signed ?? 'both';
    if (s === 'both') return {u: true, s: true, list: ['unsigned', 'signed']};
    if (s === true || s === false) return {u: !s, s, list: [s ? 'signed' : 'unsigned']};
    throw new Error(`signed is true, false or both, not "${s}"`);
  }
  // Flag names and the meaning of C after a subtraction. ARM: C = 1 means no borrow; Intel: CF = 1 means a borrow.
  function conventionOf(c) {
    const k = c.convention ?? 'arm';
    if (k === 'arm') return {key: k, C: 'C', V: 'V', N: 'N', Z: 'Z', borrowIsCarry: false};
    if (k === 'intel') return {key: k, C: 'CF', V: 'OF', N: 'SF', Z: 'ZF', borrowIsCarry: true};
    throw new Error(`convention is arm or intel, not "${k}"`);
  }
  function oneOf(value, allowed, what) {
    if (!allowed.includes(value)) throw new Error(`${what} is ${allowed.join(', ')}, not "${value}"`);
    return value;
  }
  const signedText = (v, w) => Bits.minus(Bits.s(v, w).toString());

  // ========================================================================
  // Kit: shared parts of the interactive widgets
  // ========================================================================
  const Kit = {
    status() {
      const el = h('div', {class: 'cw-status', 'aria-live': 'polite'});
      return {
        el,
        ok(msg) { el.className = 'cw-status ok'; el.textContent = '✓ ' + msg; },
        no(msg) { el.className = 'cw-status no'; el.textContent = msg; },
        info(msg) { el.className = 'cw-status'; el.textContent = msg; },
      };
    },
    // A <label> for a single field; a named group for button groups.
    control(label, input) {
      if (input.matches('input, select, textarea')) return h('label', {class: 'cw-ctl'}, label, input);
      const id = nextId('lbl');
      input.setAttribute('role', 'group');
      input.setAttribute('aria-labelledby', id);
      return h('div', {class: 'cw-ctl'}, h('span', {id, text: label}), input);
    },
    // options: [{value, label, sub?}]; sub is a second, smaller line (an instruction, for example)
    segmented(options, current, onChange) {
      const box = h('div', {class: 'cw-seg', role: 'group'});
      const anySub = options.some(o => o.sub);
      const buttons = options.map(o => {
        const b = h('button', {type: 'button', 'aria-pressed': String(o.value === current),
          onClick: () => { buttons.forEach(x => x.setAttribute('aria-pressed', String(x === b))); onChange(o.value); }},
          o.label, anySub ? h('small', {text: o.sub ? `(${o.sub})` : ' '}) : null);
        return b;
      });
      box.append(...buttons);
      return box;
    },
    select(options, current, onChange) {
      const sel = h('select', {class: 'form-select form-select-sm', id: nextId('sel'), onChange: () => onChange(options[sel.selectedIndex].value)},
        options.map(o => h('option', {text: o.label, selected: o.value === current})));
      return sel;
    },
    button(text, onClick, primary = false) {
      return h('button', {type: 'button', class: `btn btn-sm ${primary ? 'btn-primary' : 'btn-outline-secondary'}`, text, onClick});
    },
    // A row of bits, most significant on the left. Returns {el, update(value, classFor)}.
    // opts: label, onToggle(i), editable(i), cls(i) (static classes), index (show bit numbers),
    //   weights: ['unsigned'] | ['signed'] | ['unsigned', 'signed'] (one row of bit weights each),
    //   perRow: wrap after this many bits (wide values in the number widget)
    bitGrid(width, opts = {}) {
      const cols = [], weightRows = listOf(opts.weights);
      const per = opts.perRow && width > opts.perRow ? opts.perRow : width;
      // a label column when asked for, or to name the weight rows; fixed width so stacked grids line up
      const labelled = opts.label !== undefined || weightRows.length > 1;
      const grids = [];
      for (let hi = width - 1; hi >= 0; hi -= per) {
        const lo = Math.max(0, hi - per + 1);
        // a narrow spacer column between nibbles
        const gap = i => width > 4 && i % 4 === 0 && i > lo;
        const tpl = [];
        if (labelled) tpl.push(opts.labelWidth || '8.5rem');
        for (let i = hi; i >= lo; i--) { tpl.push('2rem'); if (gap(i)) tpl.push('.4rem'); }
        const grid = h('div', {class: 'cw-bitgrid', style: `grid-template-columns: ${tpl.join(' ')}`});
        const row = (lead, make) => {
          if (labelled) grid.append(lead || h('span'));
          for (let i = hi; i >= lo; i--) { grid.append(make(i)); if (gap(i)) grid.append(h('span')); }
        };
        if (opts.index !== false) row(null, i => h('span', {class: 'cw-idx', text: String(i)}));
        row(h('span', {class: 'cw-lbl', text: opts.label}), i => {
          const editable = opts.onToggle && (!opts.editable || opts.editable(i));
          const b = h('button', {type: 'button', class: 'cw-bit ' + (opts.cls ? opts.cls(i) : ''),
            'aria-label': `bit ${i}`, disabled: !editable, onClick: () => opts.onToggle(i)}, '0');
          cols[i] = b;
          return b;
        });
        for (const kind of weightRows) {
          row(weightRows.length > 1 ? h('span', {class: 'cw-lbl', text: `${kind} weight`}) : null, i => {
            const neg = kind === 'signed' && i === width - 1;
            return h('span', {class: 'cw-weight' + (neg ? ' neg' : '')}, neg ? '−' : null, weightOf(i));
          });
        }
        grids.push(grid);
      }
      return {
        el: grids.length > 1 ? h('div', {class: 'cw-bitgrids'}, grids) : grids[0],
        update(value, classFor) {
          for (let i = 0; i < width; i++) {
            const on = Bits.bit(value, i) === 1;
            cols[i].textContent = on ? '1' : '0';
            cols[i].classList.toggle('on', on);
            cols[i].setAttribute('aria-pressed', String(on));
            for (const c of ['in', 'chg', 'bad']) cols[i].classList.remove(c);
            const extra = classFor && classFor(i);
            if (extra) cols[i].classList.add(extra);
          }
        },
      };
    },
  };

  // ========================================================================
  // Pictures for the PDF, as SVG text (print)
  // ========================================================================
  const INK = {
    fg: '#494c4e', muted: '#6c757d', line: '#b8c2ca', paper: '#ffffff', accent: '#009c82', onAccent: '#ffffff',
    accentSoft: '#ecf6ee', warm: '#e87511', warmSoft: '#fdeedf', bad: '#c0392b', sig: '#2f3133', grid: '#e4e9ec',
    hatch: '#a5b2ae', field: ['#cfe6ff', '#ffdcbd', '#d4efc9', '#f2d3ee', '#fff0a8', '#d5ddff'],
  };
  const MONO = 'DejaVu Sans Mono, monospace';
  const CHAR = 0.6;   // width of a monospace character, in font sizes
  // The styles of the waveform and the wheel (classes as in the browser, colours fixed).
  const PRINT_STYLE = [
    `.cw-wv-sig{fill:none;stroke:${INK.sig};stroke-width:1.7;stroke-linejoin:round}`,
    `.cw-wv-sig.c{stroke:${INK.accent}}`, `.cw-wv-sig.t{stroke:${INK.warm}}`,
    `.cw-wv-sig.z{stroke:${INK.muted};stroke-dasharray:3 3}`, `.cw-wv-sig.dim{stroke:${INK.hatch};stroke-width:1}`,
    `.cw-wv-hatch{stroke:${INK.hatch};stroke-width:1.2}`, '.cw-wv-x{stroke:none}',
    `.cw-wv-name{font-size:12px;font-weight:bold;fill:${INK.fg};text-anchor:end}`,
    `.cw-wv-name.small{font-size:10px;font-weight:normal;fill:${INK.muted}}`,
    `.cw-wv-lbl{font-size:9.5px;fill:${INK.muted};text-anchor:middle}`,
    `.cw-wv-lbl.c{fill:${INK.accent}}`, `.cw-wv-lbl.t{fill:${INK.warm}}`, `.cw-wv-lbl.frame{fill:${INK.fg};font-size:8.5px}`,
    `.cw-wv-cond{font-size:10.5px;font-weight:bold;fill:${INK.accent};text-anchor:middle}`,
    `.cw-wv-grid{stroke:${INK.grid};stroke-width:1}`,
    `.cw-wv-group path{fill:none;stroke:${INK.muted};stroke-width:1}`,
    `.cw-wv-group text{font-size:11px;fill:${INK.fg};text-anchor:middle;font-weight:bold}`,
    `.cw-wv-sample{stroke:${INK.muted};stroke-width:1;stroke-dasharray:2 3}`, `.cw-wv-arrow{fill:${INK.warm}}`,
    '.cw-wv-hit{fill:none}', '.cw-wv-band rect{stroke:none}',
    ...INK.field.map((f, k) => `.cw-wv-band.f${k} rect{fill:${f}}`), `.cw-wv-band.fx rect{fill:${INK.grid}}`,
    `.cw-wv-band text{font-size:9px;fill:${INK.fg};text-anchor:middle}`,
    `.cw-wh-ring{fill:none;stroke:${INK.line}}`, `.cw-wh-bits{fill:${INK.fg};text-anchor:middle;dominant-baseline:middle}`,
    `.cw-wh-u{fill:${INK.muted};text-anchor:middle;dominant-baseline:middle}`,
    `.cw-wh-s{fill:${INK.accent};text-anchor:middle;dominant-baseline:middle;font-weight:bold}`,
    `.cw-wh-cur{fill:${INK.accentSoft};stroke:${INK.accent};stroke-width:2}`, `.cw-wh-ptr{stroke:${INK.accent};stroke-width:2}`,
    `.cw-wh-wrap-u{stroke:${INK.warm};stroke-width:2.5}`, `.cw-wh-wrap-s{stroke:${INK.accent};stroke-width:2.5;stroke-dasharray:5 3}`,
    `.cw-wh-center{font-size:18px;fill:${INK.fg};text-anchor:middle;font-weight:bold}`,
    `.cw-wh-center2{font-size:11px;fill:${INK.muted};text-anchor:middle}`,
  ].join('');

  // Rows of boxes, one column per bit (or per cell), with a label column on the
  // left and value columns on the right. rows: [{kind, label, cells, right}]
  //   kind 'boxes': cells [{text, fill, color, stroke, dash, bold, span}] drawn as boxes;
  //   kind 'small': cells as small text (bit numbers, weights), optionally on a fill;
  //   kind 'rule': a line under the boxes.
  // opts: gapAfter(col): true for a narrow gap after a column (nibbles), or a gap in px; cell (size)
  function drawRows(rows, columns, opts = {}) {
    const size = opts.cell || 24, pad = 3, nibble = 7, fs = 13, small = 10;
    const gapAfter = opts.gapAfter || (() => false);
    const labelW = Math.max(0, ...rows.map(r => (r.label || '').length)) * small * CHAR + (rows.some(r => r.label) ? 10 : 0);
    const xs = [];
    let x = labelW;
    for (let j = 0; j < columns; j++) {
      xs.push(x); x += size + pad;
      const gap = j < columns - 1 && gapAfter(j);
      if (gap) x += gap === true ? nibble : gap;
    }
    const bitsEnd = x - pad;
    const rightCols = Math.max(0, ...rows.map(r => (r.right || []).length));
    const rightW = [...Array(rightCols).keys()].map(k => Math.max(...rows.map(r => String((r.right || [])[k] ?? '').length)) * 12 * CHAR);
    const out = svgText('g', {});
    let y = 0;
    for (const r of rows) {
      const kind = r.kind || 'boxes';
      const height = kind === 'boxes' ? size + 4 : kind === 'rule' ? 6 : small + 6;
      if (r.label) out.append(svgText('text', {x: 0, y: y + height / 2 + small * 0.35, 'font-size': small, fill: INK.muted, text: r.label}));
      if (kind === 'rule') out.append(svgText('line', {x1: labelW, x2: bitsEnd, y1: y + 2, y2: y + 2, stroke: INK.fg, 'stroke-width': 1.6}));
      let j = 0;
      for (const cell of r.cells || []) {
        const span = cell.span || 1;
        if (j + span > columns) break;
        const x0 = xs[j], x1 = xs[j + span - 1] + size, cx = (x0 + x1) / 2;
        if (kind === 'boxes') {
          out.append(svgText('rect', {x: x0, y: y + 1, width: x1 - x0, height: size, rx: 3, fill: cell.fill || INK.paper,
            stroke: cell.stroke || INK.line, 'stroke-width': cell.stroke ? 1.6 : 1, 'stroke-dasharray': cell.dash ? '3 2' : null}));
          if (cell.text != null && cell.text !== '') out.append(svgText('text', {x: cx, y: y + 1 + size / 2 + fs * 0.35, 'font-size': fs,
            'text-anchor': 'middle', fill: cell.color || INK.fg, 'font-weight': cell.bold ? 'bold' : null, text: cell.text}));
        } else if (kind === 'small') {
          if (cell.fill) out.append(svgText('rect', {x: x0, y: y + 1, width: x1 - x0, height: small + 4, rx: 2, fill: cell.fill}));
          if (cell.text != null && cell.text !== '') {
            const max = Math.floor((x1 - x0) / (small * CHAR));
            const t = String(cell.text);
            out.append(svgText('text', {x: cx, y: y + small + 1, 'font-size': small, 'text-anchor': 'middle', fill: cell.color || INK.muted,
              'font-weight': cell.bold ? 'bold' : null, text: t.length > max && max > 1 ? t.slice(0, max - 1) + '…' : t}));
          }
        }
        j += span;
      }
      let rx = bitsEnd + 16;
      (r.right || []).forEach((t, k) => {
        rx += rightW[k];
        if (t != null && t !== '') out.append(svgText('text', {x: rx, y: y + height / 2 + 12 * 0.35, 'font-size': 12, 'text-anchor': 'end',
          fill: kind === 'small' ? INK.muted : INK.fg, text: String(t)}));
        rx += 16;
      });
      y += height + 2;
    }
    const width = bitsEnd + (rightCols ? 16 + rightW.reduce((a, b) => a + b + 16, 0) : 0);
    return {node: out, width, height: y};
  }

  // Lines of text, wrapped at `max` characters.
  function drawText(lines, opts = {}) {
    const size = opts.size || 12, max = opts.max || 90;
    const out = svgText('g', {});
    const wrapped = [];
    for (const line of listOf(lines)) {
      let rest = String(line);
      while (rest.length > max) {
        const cut = rest.lastIndexOf(' ', max);
        const at = cut > 20 ? cut : max;
        wrapped.push(rest.slice(0, at)); rest = rest.slice(at).trimStart();
      }
      wrapped.push(rest);
    }
    wrapped.forEach((t, k) => out.append(svgText('text', {x: 0, y: size * (1.1 + 1.45 * k), 'font-size': size, fill: opts.color || INK.fg, 'xml:space': 'preserve', text: t})));
    return {node: out, width: Math.max(0, ...wrapped.map(t => t.length)) * size * CHAR, height: size * (0.5 + 1.45 * wrapped.length)};
  }

  // A picture: blocks ({node, width, height}, or a number for space) stacked from the top.
  function picture(blocks) {
    let y = 0, width = 0;
    const kids = [];
    for (const b of blocks) {
      if (b == null) continue;
      if (typeof b === 'number') { y += b; continue; }
      kids.push(svgText('g', {transform: `translate(0 ${y})`}, b.node));
      y += b.height;
      width = Math.max(width, b.width);
    }
    const W = Math.ceil(width) + 4, H = Math.ceil(y) + 4;
    const svg = svgText('svg', {width: W, height: H, viewBox: `-2 -2 ${W} ${H}`, 'font-family': MONO},
      svgText('style', {text: PRINT_STYLE}), kids);
    return {svg: svg.toString(), width: W, height: H};
  }
  // A nested SVG (waveform, wheel) as a block of a picture.
  const svgBlock = node => ({node, width: Number(node.attrs.width), height: Number(node.attrs.height)});

  // Bits of a value as cells, most significant first. blank: empty boxes (an exercise to fill in).
  function bitCells(v, from, to, opts = {}) {
    const cells = [];
    for (let i = from; i >= to; i--) {
      const on = !opts.blank && Bits.bit(v, i) === 1;
      const extra = opts.cell ? opts.cell(i) : {};
      cells.push(Object.assign({text: opts.blank ? '' : String(Bits.bit(v, i)), fill: on ? INK.accent : INK.paper, color: on ? INK.onAccent : INK.fg}, extra));
    }
    return cells;
  }
  const indexCells = (from, to) => [...Array(from - to + 1).keys()].map(k => ({text: String(from - k)}));
  // A gap after every nibble of the bits from..to (column j is bit from - j)
  const nibbles = (from, to) => j => from - to + 1 > 4 && (from - j) % 4 === 0 && from - j > to;

  // ========================================================================
  // Widget registry
  // ========================================================================
  const types = {};
  const COMMON = ['type', 'view', 'title', 'task', 'controls', 'hide', 'goal', 'editable'];
  const Widget = {
    define(name, def) { types[name] = def; },
    typeOf(config) {
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('the configuration must be a mapping, starting with type: …');
      const def = types[config.type];
      if (!def) throw new Error(`unknown type "${config.type}" (${Object.keys(types).join(', ')})`);
      return def;
    },
    settings(config) {
      const def = Widget.typeOf(config);
      const c = Object.assign({}, def.defaults, config);
      if (def.views) oneOf(c.view ?? def.views[0], def.views, 'view');
      return [def, c];
    },
    mount(host, config) {
      const [def, c] = Widget.settings(config);
      const box = h('div', {class: 'cw'}, h('div', {class: 'cw-label', text: c.goal != null ? 'Challenge' : 'Try it'}));
      if (c.title) box.append(h('div', {class: 'cw-title', text: c.title}));
      if (c.task) box.append(h('div', {class: 'cw-task', text: c.task}));
      const body = h('div', {class: 'cw'});
      box.append(body);
      def.render(body, c, Kit);   // may throw: then nothing is replaced
      host.replaceChildren(box);
    },
    // Build time: check a widget and draw its form for the PDF. Never throws:
    // {error} or {svg, width, height, caption?, exercise?: {answer}, warnings}.
    print(config) {
      const warnings = [];
      try {
        const [def, c] = Widget.settings(config);
        const known = new Set([...COMMON, ...(def.keys || [])]);
        for (const k of Object.keys(config)) if (!known.has(k)) warnings.push(`unknown setting "${k}"`);
        if (c.editable != null && typeof c.editable !== 'boolean') warnings.push('editable is true or false');
        if (def.controls) {
          for (const k of listOf(c.controls)) if (!def.controls.includes(k)) warnings.push(`unknown control "${k}" (${def.controls.join(', ')})`);
        }
        let exercise = null;
        if (c.goal != null) {
          if (!def.exercise) warnings.push(`this widget has no goal${def.goalHint ? ` (${def.goalHint})` : ''}`);
          else {
            try { exercise = def.exercise(c); } catch (e) { warnings.push(`goal: ${e.message}`); }
          }
        }
        const out = def.print(c, {blank: !!exercise});
        return Object.assign({warnings, title: c.title || null, task: c.task || null}, out, exercise ? {exercise} : {});
      } catch (e) {
        return {error: e.message, warnings};
      }
    },
  };

  // The weight of bit i for the PDF: 1024, or 2¹⁴ when it no longer fits a column
  const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const printWeight = (i, neg) => (neg ? '−' : '') + (i < (neg ? 10 : 14) ? String(2 ** i) : '2' + [...String(i)].map(d => SUP[+d]).join(''));
  const weightCells = (from, to, top, kind) => [...Array(from - to + 1).keys()].map(k => {
    const i = from - k, neg = kind === 'signed' && i === top;
    return {text: printWeight(i, neg), color: neg ? INK.warm : INK.muted, bold: neg};
  });

  // ========================================================================
  // type: number (views: converter, wheel)
  // ========================================================================
  const NUMBER_GOALS = ['signed', 'unsigned', 'value'];
  // The bit pattern that a goal asks for: {signed: -46}, {unsigned: 210} or {value: 0xD2}.
  function numberTarget(c, w) {
    const g = c.goal;
    if (!g || typeof g !== 'object' || Array.isArray(g)) throw new Error('a goal is {signed: …}, {unsigned: …} or {value: …}');
    for (const k of Object.keys(g)) oneOf(k, NUMBER_GOALS, 'a goal');
    let target = null;
    for (const k of Object.keys(g)) {
      const x = Bits.big(g[k]), half = 1n << BigInt(w - 1);
      const ok = k === 'signed' ? x >= -half && x < half : k === 'unsigned' ? x >= 0n && x <= Bits.mask(w) : fits(x, w);
      if (!ok) throw new Error(`${k}: ${Bits.minus(x)} does not fit in ${w} bits`);
      if (target !== null && Bits.u(x, w) !== target) throw new Error('the goals ask for different bit patterns');
      target = Bits.u(x, w);
    }
    if (target === null) throw new Error('a goal is {signed: …}, {unsigned: …} or {value: …}');
    return target;
  }
  // Whether the bits v meet the goal (in the browser: the student's bits).
  function numberGoalMet(c, v, w) {
    const g = c.goal, checks = [];
    if (g.signed !== undefined) checks.push(Bits.s(v, w) === Bits.big(g.signed));
    if (g.unsigned !== undefined) checks.push(Bits.u(v, w) === Bits.big(g.unsigned));
    if (g.value !== undefined) checks.push(Bits.u(v, w) === Bits.u(Bits.big(g.value), w));
    return checks.length > 0 && checks.every(Boolean);
  }

  Widget.define('number', {
    keys: ['width', 'value', 'signed', 'explain', 'show'],
    views: ['converter', 'wheel'],
    controls: ['bits', 'bin', 'hex', 'unsigned', 'signed', 'char', 'width'],
    defaults: {view: 'converter', width: 8, value: 0, controls: ['bits', 'bin', 'hex', 'unsigned', 'signed'], hide: [], explain: false},
    render(root, c, kit) {
      if (c.view === 'wheel') return numberWheel(root, c, kit);
      let w = widthOf(c.width);
      let v = Bits.u(Bits.big(c.value), w);
      const rd = readings(c);
      if (c.goal) numberTarget(c, w);   // a wrong goal is an error, as at build time
      const status = kit.status();
      const top = h('div', {class: 'cw-controls'});
      if (has(c.controls, 'width')) {
        top.append(kit.control('Width', kit.segmented([4, 8, 16, 32, 64].map(n => ({value: n, label: `${n} bits`})), w, n => {
          w = n; v = Bits.u(v, w); build();
        })));
      }
      const gridBox = h('div', {class: 'cw-scroll'});
      const fieldsBox = h('div', {class: 'cw-fields'});
      const explain = h('div', {class: 'cw-explain'});
      add(root, top, gridBox, fieldsBox, c.explain ? explain : null, c.goal ? status.el : null);

      const readouts = [
        {key: 'bin', label: 'Binary', get: () => Bits.bin(v, w), parse: t => Bits.parse(/^0b/i.test(t.trim()) ? t : '0b' + t.replace(/\s/g, ''))},
        {key: 'hex', label: 'Hexadecimal', get: () => Bits.hex(v, w), parse: t => Bits.parse(/^0x/i.test(t.trim()) ? t : '0x' + t.trim())},
        {key: 'unsigned', label: 'Unsigned decimal', get: () => Bits.u(v, w).toString(), range: () => [0n, Bits.mask(w)]},
        {key: 'signed', label: "Signed decimal (two's complement)", get: () => signedText(v, w),
          range: () => [-(1n << BigInt(w - 1)), (1n << BigInt(w - 1)) - 1n]},
        {key: 'char', label: 'Character (ASCII)', get: () => { const n = Number(Bits.u(v, 8)); return n >= 32 && n < 127 ? `'${String.fromCharCode(n)}'` : '—'; }},
      ];
      let bits, inputs = [];

      function build() {
        bits = kit.bitGrid(w, {onToggle: has(c.controls, 'bits') ? i => { v ^= 1n << BigInt(i); refresh(); } : null,
          weights: c.explain ? rd.list : null, labelWidth: '7.5rem', perRow: 16});
        gridBox.replaceChildren(bits.el);
        fieldsBox.replaceChildren();
        inputs = [];
        for (const r of readouts) {
          if (has(c.hide, r.key) || (r.key === 'char' && !has(c.show, 'char'))) continue;
          if ((r.key === 'unsigned' && !rd.u) || (r.key === 'signed' && !rd.s)) continue;
          const id = nextId('num');
          const input = h('input', {type: 'text', class: 'form-control form-control-sm', id, readonly: !has(c.controls, r.key), spellcheck: 'false', autocomplete: 'off'});
          const err = h('span', {class: 'cw-err'});
          input.addEventListener('input', () => {
            const parsed = (r.parse || Bits.parse)(input.value);
            let msg = '';
            if (parsed === null) msg = 'not a number';
            else if (r.range) { const [lo, hi] = r.range(); if (parsed < lo || parsed > hi) msg = `does not fit: ${Bits.minus(lo)} … ${hi}`; }
            else if (parsed < 0n || parsed > Bits.mask(w)) msg = `does not fit in ${w} bits`;
            input.classList.toggle('is-invalid', !!msg);
            err.textContent = msg;
            if (!msg) { v = Bits.u(parsed, w); refresh(input); }
          });
          input.addEventListener('blur', () => { input.classList.remove('is-invalid'); err.textContent = ''; refresh(); });
          inputs.push({r, input});
          fieldsBox.append(h('div', {class: 'cw-field' + (r.key === 'bin' && w > 16 ? ' wide' : '')}, h('label', {for: id, text: r.label}), input, err));
        }
        refresh();
      }

      function refresh(except) {
        bits.update(v);
        for (const {r, input} of inputs) if (input !== except) input.value = r.get();
        if (c.explain) {
          const set = [];
          for (let i = w - 1; i >= 0; i--) if (Bits.bit(v, i)) set.push(i);
          const termsU = set.map(i => (2n ** BigInt(i)).toString());
          const termsS = set.map(i => (i === w - 1 ? '−' : '') + (2n ** BigInt(i)).toString());
          const sum = terms => terms.length ? terms.join(' + ').replace(/\+ −/g, '− ') : '0';
          explain.replaceChildren();
          add(explain,
            rd.u ? h('div', {}, h('b', {text: 'unsigned '}), `${sum(termsU)} = ${Bits.u(v, w)}`) : null,
            rd.s ? h('div', {}, h('b', {text: 'signed   '}), `${sum(termsS)} = ${signedText(v, w)}`) : null);
        }
        if (c.goal) {
          if (numberGoalMet(c, v, w)) status.ok('That is the right pattern.');
          else status.info(`Not yet. Current pattern: ${Bits.bin(v, w)}`);
        }
      }
      build();
    },
    exercise(c) {
      if (c.view === 'wheel') throw new Error('the wheel has no goal');
      const w = widthOf(c.width);
      const p = numberTarget(c, w);
      if (!numberGoalMet(c, p, w)) throw new Error('the answer does not meet the goal');
      return {answer: [{text: `${Bits.bin(p, w)} (${Bits.hex(p, w)})`}]};
    },
    print(c, {blank}) {
      const w = widthOf(c.width), rd = readings(c);
      const v = Bits.u(Bits.big(c.value), w);
      if (c.view === 'wheel') {
        const wheel = drawWheel(svgText, w, rd);
        wheel.set(Number(v));
        return picture([svgBlock(wheel.svg)]);
      }
      const per = w > 16 ? 16 : w, blocks = [];
      for (let hi = w - 1; hi >= 0; hi -= per) {
        const lo = Math.max(0, hi - per + 1);
        const rows = [{kind: 'small', cells: indexCells(hi, lo)}, {cells: bitCells(v, hi, lo, {blank})}];
        if (c.explain) {
          for (const kind of rd.list) rows.push({kind: 'small', label: rd.list.length > 1 ? `${kind} weight` : '', cells: weightCells(hi, lo, w - 1, kind)});
        }
        blocks.push(drawRows(rows, hi - lo + 1, {gapAfter: nibbles(hi, lo)}), 6);
      }
      if (!blank) {
        const shown = k => !has(c.hide, k);
        blocks.push(drawText([
          shown('bin') ? `binary ${Bits.bin(v, w)}` : null,
          [shown('hex') ? `hexadecimal ${Bits.hex(v, w)}` : null, rd.u && shown('unsigned') ? `unsigned ${Bits.u(v, w)}` : null,
            rd.s && shown('signed') ? `signed ${signedText(v, w)}` : null].filter(Boolean).join(' · '),
        ].filter(Boolean)));
      }
      return picture(blocks);
    },
  });

  // The wheel (an SVG, in the browser or as text for the PDF): {svg, set(v)}
  function drawWheel(make, w, rd) {
    if (w < 2 || w > 5) throw new Error('the wheel works for widths 2 to 5');
    const n = 1 << w, half = n / 2;
    const size = 360, cx = 180, cy = 180;
    const R = {u: 158, bits: 128, s: 98, ptr: 70};
    const fs = w === 5 ? 9 : 11;
    const at = (k, r) => { const a = -Math.PI / 2 + (2 * Math.PI * k) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const between = (k, r1, r2) => { const a = -Math.PI / 2 + (2 * Math.PI * (k - 0.5)) / n; return {x1: cx + r1 * Math.cos(a), y1: cy + r1 * Math.sin(a), x2: cx + r2 * Math.cos(a), y2: cy + r2 * Math.sin(a)}; };
    const svg = make('svg', {width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': `${w}-bit number wheel`});
    svg.append(make('circle', {cx, cy, r: R.bits, class: 'cw-wh-ring'}));
    if (rd.u) svg.append(make('line', Object.assign({class: 'cw-wh-wrap-u'}, between(0, 54, 172))));
    if (rd.s) svg.append(make('line', Object.assign({class: 'cw-wh-wrap-s'}, between(half, 54, 172))));
    const cur = make('circle', {r: w === 5 ? 15 : 19, class: 'cw-wh-cur'});
    const ptr = make('line', {x1: cx, y1: cy, class: 'cw-wh-ptr'});
    svg.append(ptr, cur);
    for (let k = 0; k < n; k++) {
      const [bx, by] = at(k, R.bits), [ux, uy] = at(k, R.u), [sx, sy] = at(k, R.s);
      svg.append(make('text', {x: bx, y: by, class: 'cw-wh-bits', 'font-size': fs, text: k.toString(2).padStart(w, '0')}));
      if (rd.u) svg.append(make('text', {x: ux, y: uy, class: 'cw-wh-u', 'font-size': fs, text: String(k)}));
      if (rd.s) svg.append(make('text', {x: sx, y: sy, class: 'cw-wh-s', 'font-size': fs, text: Bits.minus(String(k < half ? k : k - n))}));
    }
    const centre = make('text', {x: cx, y: cy - 2, class: 'cw-wh-center'});
    const centre2 = make('text', {x: cx, y: cy + 16, class: 'cw-wh-center2'});
    svg.append(centre, centre2);
    return {
      svg,
      set(v) {
        const [x, y] = at(v, R.bits), [px, py] = at(v, R.ptr);
        cur.setAttribute('cx', x); cur.setAttribute('cy', y);
        ptr.setAttribute('x2', px); ptr.setAttribute('y2', py);
        const label = (node, text) => { if (node.kids) node.kids = [text]; else node.textContent = text; };
        label(centre, v.toString(2).padStart(w, '0'));
        label(centre2, [rd.u ? String(v) : null, rd.s ? Bits.minus(String(v < half ? v : v - n)) : null].filter(Boolean).join(' · '));
      },
    };
  }

  function numberWheel(root, c, kit) {
    const w = int(c.width), rd = readings(c);
    const wheel = drawWheel(sv, w, rd);
    const n = 1 << w, half = n / 2;
    let v = Number(Bits.u(Bits.big(c.value), w));
    const log = h('div', {class: 'cw-log'});
    const stepBox = h('input', {type: 'text', class: 'form-control form-control-sm', id: nextId('step'), value: '3', style: 'width: 4rem', spellcheck: 'false'});
    const move = d => {
      const oldU = v, oldS = v < half ? v : v - n;
      const sumU = oldU + d, sumS = oldS + d;
      v = ((sumU % n) + n) % n;
      const newS = v < half ? v : v - n;
      const pat = x => x.toString(2).padStart(w, '0');
      const op = `${d < 0 ? '−' : '+'} ${Math.abs(d)}`;
      const lines = [h('div', {text: `${pat(oldU)} ${op} = ${pat(v)}`})];
      if (rd.u) lines.push(sumU < 0 || sumU >= n
        ? h('div', {class: 'u', text: `unsigned: ${oldU} ${op} should be ${Bits.minus(String(sumU))}, but it wraps to ${v} (carry or borrow)`})
        : h('div', {text: `unsigned: ${oldU} ${op} = ${v}`}));
      if (rd.s) lines.push(sumS < -half || sumS >= half
        ? h('div', {class: 's', text: `signed: ${Bits.minus(String(oldS))} ${op} should be ${Bits.minus(String(sumS))}, but it wraps to ${Bits.minus(String(newS))} (overflow)`})
        : h('div', {text: `signed: ${Bits.minus(String(oldS))} ${op} = ${Bits.minus(String(newS))}`}));
      log.replaceChildren(...lines);
      wheel.set(v);
    };
    const buttons = h('div', {class: 'cw-row'},
      kit.button('− 1', () => move(-1)), kit.button('+ 1', () => move(1)),
      h('span', {class: 'cw-note', text: 'add'}), stepBox,
      kit.button('Add', () => { const d = Bits.parse(stepBox.value); if (d !== null) move(Number(d)); }));
    const legend = h('div', {class: 'cw-legend'},
      rd.u ? h('span', {}, h('i', {style: 'border-color: var(--cw-muted)'}), 'outside: unsigned') : null,
      rd.s ? h('span', {}, h('i', {style: 'border-color: var(--cw-accent)'}), 'inside: signed') : null,
      rd.u ? h('span', {}, h('i', {style: 'border-color: var(--cw-warm)'}), 'unsigned wraps here') : null,
      rd.s ? h('span', {}, h('i', {style: 'border-color: var(--cw-accent); border-top-style: dashed'}), 'signed wraps here') : null);
    add(root, h('div', {class: 'cw-wheel'}, wheel.svg, h('div', {class: 'cw'}, buttons, log, legend)));
    wheel.set(v);
    // where the readings wrap: unsigned between 1…1 and 0…0, signed between 01…1 and 10…0
    const hint = [rd.s ? `0${'1'.repeat(w - 1)}` : null, rd.u ? '1'.repeat(w) : null].filter(Boolean);
    log.append(h('div', {class: 'cw-note', text: `Count up past ${hint.join(' and past ')}.`}));
  }

  // ========================================================================
  // type: arithmetic (op: add, sub)
  // ========================================================================
  // A + B, or A − B as A + ~B + 1, column by column, with the flags of the convention.
  function addSub(a, b, w, sub, cv) {
    const bb = sub ? Bits.u(~b, w) : b;
    const carries = [sub ? 1 : 0], res = [];
    for (let i = 0; i < w; i++) {
      const s = Bits.bit(a, i) + Bits.bit(bb, i) + carries[i];
      res[i] = s & 1; carries[i + 1] = s >> 1;
    }
    let r = 0n;
    res.forEach((x, i) => { if (x) r |= 1n << BigInt(i); });
    // after a subtraction, ARM's C is the carry out (1: no borrow); Intel's CF is the borrow
    const C = sub && cv.borrowIsCarry ? 1 - carries[w] : carries[w];
    return {bb, carries, res, r, flags: {C, V: carries[w] ^ carries[w - 1], N: res[w - 1], Z: r === 0n ? 1 : 0}};
  }
  // A goal: {flags: {V: 1, C: 0}} (ARM or Intel names) and/or {result: 44}. Returns [[flag, 0|1]], result.
  const FLAG_NAMES = {CF: 'C', OF: 'V', SF: 'N', ZF: 'Z', C: 'C', V: 'V', N: 'N', Z: 'Z'};
  function arithmeticGoal(c, w) {
    const g = c.goal;
    if (!g || typeof g !== 'object' || Array.isArray(g)) throw new Error('a goal is {flags: {…}} and/or {result: …}');
    for (const k of Object.keys(g)) oneOf(k, ['flags', 'result'], 'a goal');
    const flags = Object.entries(g.flags || {}).map(([k, x]) => {
      if (!FLAG_NAMES[k]) throw new Error(`unknown flag ${k} (C, V, N, Z or CF, OF, SF, ZF)`);
      if (int(x) !== 0 && int(x) !== 1) throw new Error(`flag ${k} is 0 or 1`);
      return [FLAG_NAMES[k], int(x)];
    });
    const result = g.result === undefined ? null : Bits.big(g.result);
    if (result !== null && !fits(result, w)) throw new Error(`result: ${Bits.minus(result)} does not fit in ${w} bits`);
    if (!flags.length && result === null) throw new Error('a goal is {flags: {…}} and/or {result: …}');
    return {flags, result};
  }
  function arithmeticGoalMet(goal, out, w) {
    return goal.flags.every(([k, x]) => out.flags[k] === x) && (goal.result === null || out.r === Bits.u(goal.result, w));
  }

  Widget.define('arithmetic', {
    keys: ['op', 'width', 'a', 'b', 'step', 'signed', 'convention'],
    controls: ['a', 'b', 'width'],
    defaults: {op: 'add', width: 8, a: 0, b: 0, step: false, controls: ['a', 'b']},
    render(root, c, kit) {
      oneOf(c.op, ['add', 'sub'], 'op');
      const sub = c.op === 'sub';
      const rd = readings(c), cv = conventionOf(c);
      let w = widthOf(c.width);
      let a = Bits.u(Bits.big(c.a), w), b = Bits.u(Bits.big(c.b ?? 0), w);
      const goal = c.goal ? arithmeticGoal(c, w) : null;
      const top = h('div', {class: 'cw-controls'});
      const body = h('div', {class: 'cw'});
      const status = kit.status();
      add(root, top, body, goal ? status.el : null);

      // Operands are typed in the readings shown; 0x… and 0b… are bit patterns.
      const operand = (label, get, set) => {
        const input = h('input', {type: 'text', class: 'form-control form-control-sm', id: nextId('op'), spellcheck: 'false', autocomplete: 'off', style: 'width: 9rem'});
        input.value = Bits.minus((rd.u ? Bits.u(get(), w) : Bits.s(get(), w)).toString());
        input.addEventListener('input', () => {
          const t = input.value.replace('−', '-');
          const p = Bits.parse(t);
          const pattern = /^\s*0[xbo]/i.test(t);
          const lo = pattern || !rd.s ? 0n : -(1n << BigInt(w - 1));
          const hi = pattern || rd.u ? Bits.mask(w) : (1n << BigInt(w - 1)) - 1n;
          const ok = p !== null && p >= lo && p <= hi;
          input.classList.toggle('is-invalid', !ok);
          if (ok) { set(Bits.u(p, w)); update(); }
        });
        return kit.control(label + ' (decimal, 0x… or 0b…)', input);
      };
      function controls() {
        top.replaceChildren();
        if (has(c.controls, 'a')) top.append(operand('A', () => a, x => { a = x; }));
        if (has(c.controls, 'b')) top.append(operand('B', () => b, x => { b = x; }));
        if (has(c.controls, 'width')) top.append(kit.control('Width', kit.segmented([4, 8, 16].map(n => ({value: n, label: `${n} bits`})), w, n => {
          w = n; a = Bits.u(a, w); b = Bits.u(b, w); controls(); update();
        })));
      }
      let step = c.step ? 0 : null;   // columns done, when stepping

      function update() {
        const out = addSub(a, b, w, sub, cv);
        const {bb, carries, res, r} = out, {C, V, N, Z} = out.flags;
        const done = step === null ? w : step;

        // the column table: label | bits (with nibble gaps) | one column per reading
        const colTpl = ['max-content'];
        for (let i = w - 1; i >= 0; i--) { colTpl.push('1.75rem'); if (i % 4 === 0 && i > 0) colTpl.push('.45rem'); }
        colTpl.push(...rd.list.map(() => 'max-content'));
        const grid = h('div', {class: 'cw-arith', style: `grid-template-columns: ${colTpl.join(' ')}`});
        const row = (label, cells, values, opts = {}) => {
          grid.append(h('span', {class: 'rl', text: label}));
          for (let i = w - 1; i >= 0; i--) {
            grid.append(cells(i));
            if (i % 4 === 0 && i > 0) grid.append(h('span'));
          }
          for (const x of values) grid.append(h('span', {class: opts.hdr ? 'hdr' : 'num', text: x}));
        };
        const cur = i => step !== null && i === done && done < w;
        const val = x => [rd.u ? Bits.u(x, w).toString() : null, rd.s ? signedText(x, w) : null].filter(t => t !== null);
        const blank = rd.list.map(() => '');
        row('', i => h('span', {class: 'cw-idx', text: String(i)}), rd.list, {hdr: true});
        row('carry', i => h('span', {class: 'cell carry' + (cur(i) ? ' cur' : ''),
          text: i <= done && (carries[i] || (sub && i === 0)) ? String(carries[i]) : ''}), blank);
        row('A', i => h('span', {class: 'cell b' + (cur(i) ? ' cur' : ''), text: String(Bits.bit(a, i))}), val(a));
        if (sub) {
          row('B', i => h('span', {class: 'cell b dim', text: String(Bits.bit(b, i))}), val(b));
          row('+ ~B', i => h('span', {class: 'cell b' + (cur(i) ? ' cur' : ''), text: String(Bits.bit(bb, i))}), val(bb));
          grid.append(h('span', {class: 'rl', text: '+ 1'}), h('span', {class: 'cw-note', style: `grid-column: span ${colTpl.length - 1}`, text: 'carry into bit 0'}));
        } else {
          row('+ B', i => h('span', {class: 'cell b' + (cur(i) ? ' cur' : ''), text: String(Bits.bit(b, i))}), val(b));
        }
        grid.append(h('span'), h('span', {class: 'rule', style: `grid-column: span ${colTpl.length - 1 - rd.list.length}`}), ...rd.list.map(() => h('span')));
        row(sub ? '= A − B' : '= A + B', i => h('span', {class: 'cell r' + (cur(i) ? ' cur' : ''), text: i < done ? String(res[i]) : ''}),
          done === w ? val(r) : blank);

        const parts = [h('div', {class: 'cw-scroll'}, grid)];
        if (step !== null) {
          parts.push(h('div', {class: 'cw-row'},
            h('button', {type: 'button', class: 'btn btn-sm btn-primary', text: done < w ? `Add column ${done}` : 'Done', disabled: done >= w, onClick: () => { step++; update(); }}),
            kit.button('All columns', () => { step = w; update(); }),
            kit.button('Start again', () => { step = 0; update(); }),
            done < w ? h('span', {class: 'cw-note', text: `Column ${done}: ${Bits.bit(a, done)} + ${Bits.bit(bb, done)} + carry ${carries[done]}`}) : null));
        }
        if (done === w) {
          parts.push(h('div', {class: 'cw-interp'}, interpretations(a, b, r, w, sub, rd).map(([ok, text]) => h('div', {class: ok ? 'ok' : 'bad', text}))));
          const flagBox = h('div', {class: 'cw-flags'});
          parts.push(flagBox);
          add(flagBox, ...flagTexts(out.flags, sub, rd, cv).map(([name, on, text]) =>
            h('div', {class: 'cw-flag' + (on ? ' on' : '')}, h('span', {}, h('b', {text: `${name} = ${on}`})), h('small', {text}))));
          if (goal) {
            const now = goal.flags.map(([k]) => `${cv[k]} = ${out.flags[k]}`).join(', ');
            if (arithmeticGoalMet(goal, out, w)) status.ok(`Right: ${now || `the result is ${val(r).join(' / ')}`}.`);
            else status.info(`Not yet${now ? `: ${now}` : ''}.`);
          }
        } else if (goal) status.info('');
        body.replaceChildren(...parts);
      }
      controls();
      update();
    },
    exercise(c) {
      const w = widthOf(c.width), sub = c.op === 'sub', rd = readings(c), cv = conventionOf(c);
      const goal = arithmeticGoal(c, w);
      // Look for two operands that reach the goal, checked as in the browser: special values first.
      const half = 1n << BigInt(w - 1), m = Bits.mask(w);
      const special = [0n, 1n, 2n, 3n, 5n, 7n, half / 2n, half - 1n, half, half + 1n, half + half / 2n, m - 1n, m, 100n, 200n];
      const values = [...new Set(special.map(x => Bits.u(x, w)))];
      if (w <= 8) for (let x = 0n; x <= m; x++) if (!values.includes(x)) values.push(x);
      const shown = x => `${rd.u ? Bits.u(x, w) : signedText(x, w)} (${Bits.bin(x, w)})`;
      for (const a of values) {
        for (const b of values) {
          const out = addSub(a, b, w, sub, cv);
          if (!arithmeticGoalMet(goal, out, w)) continue;
          const flags = ['C', 'V', 'N', 'Z'].map(k => `${cv[k]} = ${out.flags[k]}`).join(', ');
          return {answer: [{text: `For example A = ${shown(a)} and B = ${shown(b)}: A ${sub ? '−' : '+'} B = ${shown(out.r)}, ${flags}.`}]};
        }
      }
      throw new Error('no two operands reach it');
    },
    print(c, {blank}) {
      oneOf(c.op, ['add', 'sub'], 'op');
      const w = widthOf(c.width), sub = c.op === 'sub', rd = readings(c), cv = conventionOf(c);
      const a = Bits.u(Bits.big(c.a), w), b = Bits.u(Bits.big(c.b ?? 0), w);
      if (c.goal) arithmeticGoal(c, w);
      const out = addSub(a, b, w, sub, cv);
      const val = x => (blank ? rd.list.map(() => '') : [rd.u ? Bits.u(x, w).toString() : null, rd.s ? signedText(x, w) : null].filter(t => t !== null));
      const cells = x => bitCells(x, w - 1, 0, {blank});
      const carry = [...Array(w).keys()].map(k => {
        const i = w - 1 - k;
        return {text: !blank && (out.carries[i] || (sub && i === 0)) ? String(out.carries[i]) : '', color: INK.warm, bold: true};
      });
      const rows = [{kind: 'small', cells: indexCells(w - 1, 0), right: rd.list}, {kind: 'small', label: 'carry', cells: carry}, {label: 'A', cells: cells(a), right: val(a)}];
      if (sub) {
        rows.push({label: 'B', cells: bitCells(b, w - 1, 0, {blank, cell: i => (Bits.bit(b, i) ? {fill: INK.accentSoft, color: INK.muted} : {color: INK.muted})}), right: val(b)},
          {label: '+ ~B', cells: cells(out.bb), right: val(out.bb)},
          {kind: 'small', label: '+ 1', cells: [{text: 'carry into bit 0', span: w}]});
      } else rows.push({label: '+ B', cells: cells(b), right: val(b)});
      rows.push({kind: 'rule'}, {label: sub ? '= A − B' : '= A + B', cells: bitCells(out.r, w - 1, 0, {blank, cell: () => ({stroke: INK.fg})}), right: val(out.r)});
      const blocks = [drawRows(rows, w, {gapAfter: nibbles(w - 1, 0)})];
      if (!blank) {
        blocks.push(6, drawText(interpretations(a, b, out.r, w, sub, rd).map(([, text]) => text), {size: 11}),
          drawText(flagTexts(out.flags, sub, rd, cv).map(([name, on, text]) => `${name} = ${on}: ${text}`).join(' · '), {size: 11}));
      }
      return picture(blocks);
    },
  });

  // "Unsigned: 200 + 100 = 300, which does not fit …" per reading: [[right?, text]]
  function interpretations(a, b, r, w, sub, rd) {
    const ua = Bits.u(a, w), ub = Bits.u(b, w), sa = Bits.s(a, w), sb = Bits.s(b, w);
    const exactU = sub ? ua - ub : ua + ub, exactS = sub ? sa - sb : sa + sb;
    const op = sub ? '−' : '+';
    const fitsU = exactU >= 0n && exactU <= Bits.mask(w);
    const fitsS = exactS >= -(1n << BigInt(w - 1)) && exactS < (1n << BigInt(w - 1));
    const out = [];
    if (rd.u) out.push([fitsU, `Unsigned: ${ua} ${op} ${ub} = ${Bits.minus(exactU)}` + (fitsU ? ' ✓' : `, which does not fit in ${w} bits (0 … ${Bits.mask(w)}): the result wraps to ${Bits.u(r, w)}.`)]);
    if (rd.s) out.push([fitsS, `Signed: ${Bits.minus(sa)} ${op} ${Bits.minus(sb)} = ${Bits.minus(exactS)}` + (fitsS ? ' ✓' : `, which does not fit (${Bits.minus(-(1n << BigInt(w - 1)))} … ${(1n << BigInt(w - 1)) - 1n}): the result wraps to ${signedText(r, w)}.`)]);
    return out;
  }
  // The flags shown with their meaning: the carry belongs to the unsigned reading, overflow and sign to the signed one.
  function flagTexts(f, sub, rd, cv) {
    const cText = !sub ? (f.C ? 'carry out: the unsigned sum does not fit' : 'no carry out')
      : cv.borrowIsCarry ? (f.C ? 'borrow: A < B unsigned' : 'no borrow: A ≥ B unsigned')
      : (f.C ? 'carry out: no borrow (A ≥ B unsigned)' : 'no carry out: borrow (A < B unsigned)');
    return [
      rd.u ? [cv.C, f.C, cText] : null,
      rd.s ? [cv.V, f.V, f.V ? 'overflow: the signed result does not fit' : 'no signed overflow'] : null,
      rd.s ? [cv.N, f.N, 'the top bit of the result'] : null,
      [cv.Z, f.Z, f.Z ? 'the result is zero' : 'the result is not zero'],
    ].filter(Boolean);
  }

  // ========================================================================
  // type: shift: shifts and rotations, one bit at a time, with visible movement
  // ========================================================================
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The operations, one bit at a time; bits: array by slot, slot 0 = most significant.
  //   dir: -1 left, +1 right; out: where the leaving bit goes ('box', or 'arc' round to the other end);
  //   inFrom: where the incoming bit comes from ('box', 'clone' of the sign bit, 'arcFromBox' for the old carry).
  // arm, intel: the instruction, if the processor has one (ARM has no rotate left; rrx rotates right through C).
  const SHIFTS = {
    shl: {label: '<<', arm: 'lsl', intel: 'shl', plan: () => ({dir: -1, out: 'box', inFrom: 'box', inValue: 0})},
    shr: {label: '>> logical', arm: 'lsr', intel: 'shr', plan: () => ({dir: 1, out: 'box', inFrom: 'box', inValue: 0})},
    sar: {label: '>> arithmetic', arm: 'asr', intel: 'sar', plan: bits => ({dir: 1, out: 'box', inFrom: 'clone', inValue: bits[0]})},
    rol: {label: 'rotate left', arm: null, intel: 'rol', plan: () => ({dir: -1, out: 'arc'})},
    ror: {label: 'rotate right', arm: 'ror', intel: 'ror', plan: () => ({dir: 1, out: 'arc'})},
    rcl: {label: 'rotate left through C', arm: null, intel: 'rcl', carry: true, plan: (bits, c) => ({dir: -1, out: 'box', inFrom: 'arcFromBox', inValue: c})},
    rcr: {label: 'rotate right through C', arm: 'rrx', intel: 'rcr', carry: true, plan: (bits, c) => ({dir: 1, out: 'box', inFrom: 'arcFromBox', inValue: c})},
  };
  const ABOUT = {
    shl: 'Every bit moves one place left; a 0 comes in on the right; the leftmost bit leaves.',
    shr: 'Every bit moves one place right; a 0 comes in on the left; the rightmost bit leaves.',
    sar: 'Every bit moves one place right; the sign bit is copied in on the left, so the sign stays.',
    rol: 'Every bit moves one place left; the leftmost bit goes round to the right. Nothing is lost.',
    ror: 'Every bit moves one place right; the rightmost bit goes round to the left. Nothing is lost.',
    rcl: 'Like rotate left, but through the carry: the leftmost bit goes into C, and the old C comes in on the right.',
    rcr: 'Like rotate right, but through the carry: the rightmost bit goes into C, and the old C comes in on the left.',
  };
  const toSlots = (v, w) => [...Array(w).keys()].map(s => Bits.bit(v, w - 1 - s));
  const fromSlots = bits => bits.reduce((acc, b) => (acc << 1n) | BigInt(b), 0n);
  // One step without animation: {bits, out}
  function shiftOnce(bits, plan) {
    const outSlot = plan.dir < 0 ? 0 : bits.length - 1;
    const comingIn = plan.out === 'arc' ? bits[outSlot] : plan.inValue;
    return {bits: plan.dir < 0 ? bits.slice(1).concat([comingIn]) : [comingIn].concat(bits.slice(0, -1)), out: bits[outSlot]};
  }
  function shiftSettings(c) {
    const s = {w: widthOf(c.width), rd: readings(c), cv: conventionOf(c), ops: listOf(c.ops), op: c.op};
    for (const k of [...s.ops, s.op]) if (!SHIFTS[k]) throw new Error(`unknown shift "${k}" (${Object.keys(SHIFTS).join(', ')})`);
    if (!s.ops.includes(s.op)) s.ops.unshift(s.op);
    const v = Bits.big(c.value);
    if (!fits(v, s.w)) throw new Error(`value ${Bits.minus(v)} does not fit in ${s.w} bits`);
    s.start = Bits.u(v, s.w);
    s.amount = int(c.amount);
    if (s.amount < 1 || s.amount > s.w) throw new Error(`amount is 1 … ${s.w}`);
    s.label = k => SHIFTS[k].label.replace(/ C$/, ' ' + s.cv.C);
    return s;
  }

  // Bit tiles that can move: one row of `width` tiles, with a box on each side.
  // opts: boxes (false: no side boxes), top (y of the tiles), arcTop (y of a tile at the top of its arc), index(s)
  function shiftStage(width, opts = {}) {
    const pitch = width > 16 ? 26 : 36, size = pitch - 4;
    const boxes = opts.boxes !== false;
    const side = boxes ? 62 : 10, top = opts.top || 44;
    const W = side * 2 + width * pitch - (pitch - size);
    const stage = h('div', {class: 'cw-sh-stage' + (width > 16 ? ' small' : ''), style: `width: ${W}px; height: ${top + 46}px`});
    const x = s => side + s * pitch;
    const boxX = {left: 6, right: W - side + 10};
    const centre = 23 - size / 2;   // a tile inside a 46px box
    for (let s = 0; s < width; s++) stage.append(h('span', {class: 'cw-sh-idx', style: `left: ${x(s)}px; width: ${size}px; top: ${top - 17}px`, text: String(opts.index ? opts.index(s) : width - 1 - s)}));
    const box = {left: h('div', {class: 'cw-sh-box', style: `left: ${boxX.left}px; top: ${top - 5}px`}),
                 right: h('div', {class: 'cw-sh-box', style: `left: ${boxX.right}px; top: ${top - 5}px`})};
    if (boxes) stage.append(box.left, box.right);
    let tiles = [];
    const tile = (b, s, extra) => h('div', {class: `cw-sh-tile ${b ? 'on' : ''} ${extra || ''}`,
      style: `left: ${x(s)}px; top: ${top}px; width: ${size}px; height: ${size + 2}px`, text: String(b)});
    return {
      el: stage, x, top, W, size, pitch,
      // classes: optional extra class per slot (the SPI ring colours bits by where they came from)
      render(bits, classes) { tiles.forEach(t => t.remove()); tiles = bits.map((b, s) => tile(b, s, classes && classes[s])); stage.append(...tiles); },
      setBox(where, label, value) {
        const b = box[where];
        b.classList.toggle('empty', label == null);
        b.replaceChildren(h('span', {text: label || ''}), value != null ? h('b', {text: String(value)}) : '');
      },
      // One step of one bit; resolves with {bits, out}. plan.copyOut: a copy of the bit that goes round also drops into the box.
      async step(bits, plan, dur) {
        const w = bits.length, up = top - (opts.arcTop ?? 6);
        const o = {duration: reducedMotion() ? 0 : dur, easing: 'ease-in-out', fill: 'forwards'};
        const outSlot = plan.dir < 0 ? 0 : w - 1, inSlot = plan.dir < 0 ? w - 1 : 0;
        const exitBox = plan.dir < 0 ? boxX.left : boxX.right, entryBox = plan.dir < 0 ? boxX.right : boxX.left;
        const runs = [], temp = [];
        tiles.forEach((t, s) => {
          if (s !== outSlot) runs.push(t.animate([{transform: 'translate(0, 0)'}, {transform: `translate(${plan.dir * pitch}px, 0)`}], o).finished);
        });
        const out = tiles[outSlot];
        const intoBox = el => el.animate([{transform: 'translate(0, 0)'}, {transform: `translate(${exitBox + centre - x(outSlot)}px, 0) scale(.8)`}], o).finished;
        if (plan.out === 'arc') {
          const dx = (inSlot - outSlot) * pitch;
          runs.push(out.animate([{transform: 'translate(0, 0)', offset: 0}, {transform: `translate(0, -${up}px)`, offset: 0.25},
            {transform: `translate(${dx}px, -${up}px)`, offset: 0.75}, {transform: `translate(${dx}px, 0)`, offset: 1}], o).finished);
          if (plan.copyOut) {
            const copy = tile(bits[outSlot], outSlot, 'ghost');
            stage.append(copy); temp.push(copy);
            runs.push(intoBox(copy));
          }
        } else runs.push(intoBox(out));
        if (plan.inFrom) {
          const incoming = tile(plan.inValue, inSlot, 'new');
          stage.append(incoming); temp.push(incoming);
          if (plan.inFrom === 'box') {
            runs.push(incoming.animate([{transform: `translate(${entryBox + centre - x(inSlot)}px, 0)`, opacity: 0.4}, {transform: 'translate(0, 0)', opacity: 1}], o).finished);
          } else if (plan.inFrom === 'clone') {
            runs.push(incoming.animate([{transform: 'translate(0, -24px)', opacity: 0}, {transform: 'translate(0, 0)', opacity: 1}], o).finished);
          } else {   // the old carry goes round from the exit box to the other end
            const dx = exitBox + centre - x(inSlot);
            runs.push(incoming.animate([{transform: `translate(${dx}px, 0)`, offset: 0}, {transform: `translate(${dx}px, -${up}px)`, offset: 0.25},
              {transform: `translate(0, -${up}px)`, offset: 0.75}, {transform: 'translate(0, 0)', offset: 1}], o).finished);
          }
        }
        await Promise.all(runs);
        temp.forEach(t => t.remove());
        return shiftOnce(bits, plan);
      },
    };
  }

  function speedControl(kit, get, set) {
    return kit.control('Speed', kit.segmented([{value: 1100, label: 'slow'}, {value: 600, label: 'normal'}, {value: 250, label: 'fast'}], get(), set));
  }

  Widget.define('shift', {
    keys: ['width', 'value', 'op', 'amount', 'carry', 'ops', 'signed', 'convention'],
    defaults: {width: 8, value: 0, op: 'shl', amount: 1, carry: false, ops: ['shl', 'shr', 'sar', 'rol', 'ror']},
    goalHint: 'shifts are for exploring',
    render(root, c, kit) {
      const s = shiftSettings(c), {w, rd, cv} = s;
      let start = s.start, op = s.op, amount = s.amount;
      let bits, carry, lastOut, busy = false, speed = 600;
      const stage = shiftStage(w);
      const values = h('div', {class: 'cw-explain'});
      const about = h('div', {class: 'cw-note'});
      const valueInput = h('input', {type: 'text', class: 'form-control form-control-sm', id: nextId('shv'), spellcheck: 'false', style: 'width: 9rem'});
      valueInput.value = Bits.bin(start, w);
      valueInput.addEventListener('input', () => {
        const t = valueInput.value.trim();
        const p = /^[01\s]+$/.test(t) && t.replace(/\s/g, '').length === w ? BigInt('0b' + t.replace(/\s/g, '')) : Bits.parse(t);
        const ok = p !== null && fits(p, w);
        valueInput.classList.toggle('is-invalid', !ok);
        if (ok && !busy) { start = Bits.u(p, w); reset(); }
      });
      const amountInput = h('input', {type: 'range', class: 'form-range', id: nextId('sha'), min: 1, max: w, value: amount});
      const amountLabel = h('span');
      const opSel = kit.segmented(s.ops.map(k => ({value: k, label: s.label(k), sub: SHIFTS[k][cv.key]})), op, k => { op = k; reset(); });
      const stepBtn = kit.button('Shift 1 bit', () => run(1));
      const playBtn = kit.button('', () => run(amount), true);
      const resetBtn = kit.button('Start again', () => reset());
      const setAmount = () => {
        amountLabel.textContent = `By ${amount} bit${amount > 1 ? 's' : ''}`;
        playBtn.textContent = `Shift ${amount} bits`;
        playBtn.hidden = amount === 1;   // "Shift 1 bit" is there already
      };
      amountInput.addEventListener('input', () => { amount = +amountInput.value; setAmount(); });
      setAmount();

      // C sits on the side where the bit leaves; the other box shows what comes in
      const withC = () => c.carry || SHIFTS[op].carry;
      function plan() {
        const p = SHIFTS[op].plan(bits, carry);
        if (p.out === 'arc' && withC()) p.copyOut = true;
        return p;
      }
      function boxes() {
        const p = plan();
        const exit = p.dir < 0 ? 'left' : 'right', entry = p.dir < 0 ? 'right' : 'left';
        if (p.out === 'arc' && !withC()) { stage.setBox('left', null); stage.setBox('right', null); return; }
        stage.setBox(exit, withC() ? cv.C : 'out', withC() ? carry : lastOut);
        // the sign bit is copied in from above, the old carry comes round from C: no box for those
        stage.setBox(entry, p.inFrom === 'box' ? 'in' : null, '0');
      }
      function show() {
        const v = fromSlots(bits);
        stage.render(bits);
        boxes();
        const reads = [rd.u ? `${Bits.u(v, w)} unsigned` : null, rd.s ? `${signedText(v, w)} signed` : null, withC() ? `${cv.C} = ${carry}` : null];
        values.replaceChildren(h('div', {}, h('b', {text: 'now '}), `${Bits.bin(v, w)} = ` + reads.filter(Boolean).join(', ')));
      }
      function reset() {
        bits = toSlots(start, w); carry = 0; lastOut = '';
        about.textContent = ABOUT[op].replace(/\bC\b/g, cv.C);
        show();
      }
      async function run(n) {
        if (busy) return;
        busy = true;
        [stepBtn, playBtn, resetBtn].forEach(b => { b.disabled = true; });
        for (let k = 0; k < n; k++) {
          const r = await stage.step(bits, plan(), speed);
          bits = r.bits; lastOut = r.out;
          if (withC()) carry = r.out;
          show();
        }
        busy = false;
        [stepBtn, playBtn, resetBtn].forEach(b => { b.disabled = false; });
      }
      add(root,
        h('div', {class: 'cw-controls'}, kit.control('Value (0b…, 0x… or decimal)', valueInput), h('label', {class: 'cw-ctl'}, amountLabel, amountInput), speedControl(kit, () => speed, x => { speed = x; })),
        kit.control('Operation', opSel), about,
        h('div', {class: 'cw-scroll'}, stage.el), values,
        h('div', {class: 'cw-row'}, stepBtn, playBtn, resetBtn));
      reset();
    },
    // The PDF cannot animate: the value after every step, the bit that came in outlined.
    print(c) {
      const s = shiftSettings(c), {w, rd, cv, op} = s;
      const withC = c.carry || SHIFTS[op].carry;
      let bits = toSlots(s.start, w), carry = 0;
      const right = (v, cc) => [withC ? String(cc) : null, rd.u ? String(Bits.u(v, w)) : null, rd.s ? signedText(v, w) : null].filter(x => x !== null);
      const rows = [{kind: 'small', cells: indexCells(w - 1, 0), right: [withC ? cv.C : null, ...rd.list].filter(Boolean)},
        {label: 'start', cells: bitCells(s.start, w - 1, 0), right: right(s.start, carry)}];
      for (let k = 1; k <= s.amount; k++) {
        const plan = SHIFTS[op].plan(bits, carry);
        const r = shiftOnce(bits, plan);
        bits = r.bits;
        if (withC) carry = r.out;
        const inBit = plan.dir < 0 ? 0 : w - 1;   // the bit that came in
        const v = fromSlots(bits);
        rows.push({label: `step ${k}`, cells: bitCells(v, w - 1, 0, {cell: i => (i === inBit ? {stroke: INK.warm} : {})}), right: right(v, carry)});
      }
      const instruction = SHIFTS[op][cv.key];
      return Object.assign(picture([
        drawText(`${s.label(op)}${instruction ? ` (${instruction})` : ''}, one bit per step`, {size: 11}), 4,
        drawRows(rows, w, {gapAfter: nibbles(w - 1, 0)})]), {caption: ABOUT[op].replace(/\bC\b/g, cv.C)});
    },
  });

  // ========================================================================
  // type: register (views: map, ops, code)
  // ========================================================================
  function registerFields(c) {
    const w = widthOf(c.width);
    if (!/^[A-Za-z_]\w*$/.test(String(c.name))) throw new Error(`name "${c.name}" is not a C name`);
    const fields = listOf(c.fields).map((f, k) => {
      if (!f || typeof f !== 'object' || f.name == null) throw new Error(`field ${k + 1} needs a name and bits`);
      let hi, lo;
      // 7 or 6..5 (a list such as [6, 5] is refused: one way to write it)
      const m = typeof f.bits === 'number' ? [null, String(f.bits)] : Array.isArray(f.bits) ? null
        : String(f.bits ?? '').match(/^\s*(\d+)\s*(?:\.\.\s*(\d+))?\s*$/);
      if (!m) throw new Error(`field ${f.name}: bits "${f.bits}" should look like 7 or 6..5`);
      hi = +m[1]; lo = m[2] !== undefined ? +m[2] : hi;
      if (lo > hi) [hi, lo] = [lo, hi];
      if (hi >= w) throw new Error(`field ${f.name}: bit ${hi} does not exist in a ${w}-bit register`);
      const values = {};
      for (const [key, label] of Object.entries(f.values || {})) values[String(Bits.big(key))] = String(label);
      return {name: String(f.name), hi, lo, width: hi - lo + 1, access: oneOf(f.access ?? 'rw', ['rw', 'r', 'w'], `field ${f.name}: access`),
        values, doc: f.doc ? String(f.doc) : '', color: k % 6};
    });
    const owner = [];
    for (const f of fields) for (let i = f.lo; i <= f.hi; i++) {
      if (owner[i]) throw new Error(`bit ${i} is in both ${owner[i].name} and ${f.name}`);
      owner[i] = f;
    }
    return {w, name: String(c.name), fields, owner, byName: Object.fromEntries(fields.map(f => [f.name, f]))};
  }
  const fieldValue = (v, f) => Number((v >> BigInt(f.lo)) & ((1n << BigInt(f.width)) - 1n));
  const withField = (v, f, x) => (v & ~Bits.fieldMask(f.hi, f.lo)) | ((BigInt(x) << BigInt(f.lo)) & Bits.fieldMask(f.hi, f.lo));
  const accessText = f => (f.access === 'r' ? 'read-only' : f.access === 'w' ? 'write-only' : 'read/write');
  const bitsText = f => (f.width > 1 ? `${f.hi}..${f.lo}` : String(f.hi));
  // The suffix of an unsigned literal: 1u, or 1ull for registers over 32 bits (1u << 40 would be undefined)
  const uSuffix = w => (w > 32 ? 'ull' : 'u');

  // C for an assignment of the whole register, one term per field.
  function cAssignment(name, v, fields, w) {
    const terms = [], u = uSuffix(w);
    for (const f of [...fields].sort((x, y) => y.hi - x.hi)) {
      const x = fieldValue(v, f);
      if (!x || f.access === 'r') continue;
      const lit = f.width === 1 ? `1${u}` : `0x${x.toString(16).toUpperCase()}${u}`;
      terms.push(f.lo ? `(${lit} << ${f.lo})` : lit);
    }
    return `${name} = ${terms.join(' | ') || `0${u}`};`;
  }
  // A mask as C: runs of ones as (1u << 3) or (0x7u << 4)
  function maskExpression(mask, w) {
    const terms = [], u = uSuffix(w);
    for (let i = 0; i < w;) {
      if (!Bits.bit(mask, i)) { i++; continue; }
      let j = i;
      while (j + 1 < w && Bits.bit(mask, j + 1)) j++;
      const len = j - i + 1;
      const lit = len === 1 ? `1${u}` : `0x${((1n << BigInt(len)) - 1n).toString(16).toUpperCase()}${u}`;
      terms.unshift(i ? `(${lit} << ${i})` : lit);
      i = j + 1;
    }
    return terms;
  }
  const maskC = (mask, w) => { const t = maskExpression(mask, w); return t.length ? t.join(' | ') : `0${uSuffix(w)}`; };
  const notMaskC = (mask, w) => { const t = maskExpression(mask, w); return t.length === 1 && t[0].startsWith('(') ? `~${t[0]}` : `~(${t.join(' | ')})`; };

  // Shared: the datasheet-style diagram of a register. onToggle(i) for clickable bits.
  function registerDiagram(reg, opts) {
    const {w, owner} = reg;
    const tpl = [];
    for (let i = w - 1; i >= 0; i--) tpl.push('2rem');
    const grid = h('div', {class: 'cw-reg', style: `grid-template-columns: ${tpl.join(' ')}`});
    for (let i = w - 1; i >= 0; i--) grid.append(h('span', {class: 'cw-idx', text: String(i)}));
    // names: one cell per field (spanning) or per reserved bit
    for (let i = w - 1; i >= 0;) {
      const f = owner[i];
      if (f) { grid.append(h('span', {class: `fname cw-f${f.color}`, style: `grid-column: span ${f.width}`, title: f.doc || f.name, text: f.name})); i -= f.width; }
      else { grid.append(h('span', {class: 'fname res', text: '–', title: 'reserved'})); i--; }
    }
    const buttons = [];
    for (let i = w - 1; i >= 0; i--) {
      const f = owner[i];
      const editable = opts.onToggle && f && f.access !== 'r';
      const b = h('button', {type: 'button', class: `cw-bit ${f ? 'cw-f' + f.color : 'res'} ${f && f.access === 'r' ? 'ro' : ''}`,
        'aria-label': `bit ${i}${f ? ' of ' + f.name : ' (reserved)'}`, title: f ? (f.access === 'r' ? `${f.name}: read-only` : f.name) : 'reserved',
        disabled: !editable, onClick: () => opts.onToggle(i)}, '0');
      buttons[i] = b;
      grid.append(b);
    }
    const vals = [];
    for (let i = w - 1; i >= 0;) {
      const f = owner[i];
      const span = f ? f.width : 1;
      const cell = h('span', {class: 'fval', style: `grid-column: span ${span}`});
      if (f) vals.push([f, cell]);
      grid.append(cell);
      i -= span;
    }
    return {
      el: grid,
      update(v) {
        for (let i = 0; i < w; i++) {
          const on = Bits.bit(v, i) === 1;
          buttons[i].textContent = on ? '1' : '0';
          buttons[i].classList.toggle('on', on);
          buttons[i].setAttribute('aria-pressed', String(on));
        }
        for (const [f, cell] of vals) {
          const x = fieldValue(v, f);
          cell.textContent = f.values[String(x)] || (f.width > 1 ? String(x) : '');
        }
      },
    };
  }
  // The same diagram for the PDF, 16 bits per row; blank: no bit values (an exercise).
  function printRegister(reg, v, blank) {
    const {w, owner} = reg;
    const per = w > 16 ? 16 : w, blocks = [];
    for (let hi = w - 1; hi >= 0; hi -= per) {
      const lo = Math.max(0, hi - per + 1);
      const names = [], values = [];
      for (let i = hi; i >= lo;) {
        const f = owner[i];
        const span = f ? Math.min(i, f.hi) - Math.max(lo, f.lo) + 1 : 1;
        names.push(f ? {text: f.name, span, fill: INK.field[f.color], color: INK.fg, bold: true} : {text: '–', fill: INK.grid});
        const x = f && fieldValue(v, f);
        values.push({text: !f || blank ? '' : (f.values[String(x)] || (f.width > 1 ? String(x) : '')), span});
        i -= span;
      }
      const cells = bitCells(v, hi, lo, {blank, cell: i => {
        const f = owner[i];
        if (!f) return {fill: INK.grid, text: blank ? '' : String(Bits.bit(v, i)), color: INK.muted};
        return f.access === 'r' ? {dash: true} : {};
      }});
      blocks.push(drawRows([{kind: 'small', cells: indexCells(hi, lo)}, {kind: 'small', cells: names}, {cells},
        {kind: 'small', cells: values}], hi - lo + 1), 6);
    }
    return blocks;
  }
  // The fields as lines of text: bits, name, access, meaning
  function fieldLines(reg) {
    const width = Math.max(...reg.fields.map(f => f.name.length));
    return [...reg.fields].sort((x, y) => y.hi - x.hi).map(f => {
      const values = Object.entries(f.values).map(([k, label]) => `${k}: ${label}`).join(', ');
      return `${bitsText(f).padEnd(6)} ${f.name.padEnd(width)}  ${accessText(f).padEnd(10)}  ${[f.doc, values].filter(Boolean).join('; ')}`;
    });
  }

  // The goal of a map: {fields: {MODE: 2}} and/or {value: 0xC3}; the value a student can reach, or an error.
  function registerTarget(reg, c) {
    const g = c.goal, reset = Bits.u(Bits.big(c.reset), reg.w);
    if (!g || typeof g !== 'object' || Array.isArray(g)) throw new Error('a goal is {fields: {…}} and/or {value: …}');
    for (const k of Object.keys(g)) oneOf(k, ['fields', 'value'], 'a goal');
    let v = g.value !== undefined ? Bits.u(Bits.big(g.value), reg.w) : reset;
    for (const [n, x] of Object.entries(g.fields || {})) {
      const f = reg.byName[n];
      if (!f) throw new Error(`no field ${n}`);
      if (f.access === 'r') throw new Error(`${n} is read-only`);
      if (int(x) < 0 || int(x) >= 2 ** f.width) throw new Error(`${n} = ${x} does not fit in ${f.width} bits`);
      v = withField(v, f, int(x));
    }
    return v;
  }
  function registerGoalMet(reg, c, v) {
    const g = c.goal;
    const wrong = Object.entries(g.fields || {}).filter(([n, x]) => fieldValue(v, reg.byName[n]) !== int(x)).map(([n]) => n);
    return {ok: !wrong.length && (g.value === undefined || v === Bits.u(Bits.big(g.value), reg.w)), wrong};
  }
  // In the map, read-only and reserved bits keep their reset value.
  function settable(reg, reset, v) {
    let x = v;
    for (let i = 0; i < reg.w; i++) {
      const f = reg.owner[i];
      if (!f || f.access === 'r') x = (x & ~(1n << BigInt(i))) | (reset & (1n << BigInt(i)));
    }
    return x;
  }

  Widget.define('register', {
    keys: ['name', 'width', 'reset', 'value', 'fields', 'starter'],
    views: ['map', 'ops', 'code'],
    defaults: {view: 'map', name: 'REG', width: 8, fields: [], reset: 0},
    render(root, c, kit) {
      const reg = registerFields(c);
      if (c.view === 'map') return registerMap(root, c, kit, reg);
      if (c.view === 'ops') return registerOps(root, c, kit, reg);
      return registerCode(root, c, kit, reg);
    },
    exercise(c) {
      const reg = registerFields(c);
      if (c.view === 'map') {
        const reset = Bits.u(Bits.big(c.reset), reg.w);
        const v = registerTarget(reg, c);
        if (settable(reg, reset, v) !== v || !registerGoalMet(reg, c, v).ok) throw new Error('it needs a read-only or reserved bit changed');
        const fields = [...reg.fields].sort((x, y) => y.hi - x.hi).filter(f => f.access !== 'r')
          .map(f => { const x = fieldValue(v, f); return `${f.name} = ${x}${f.values[String(x)] ? ` (${f.values[String(x)]})` : ''}`; });
        return {answer: [{text: `${reg.name} = ${Bits.hex(v, reg.w)} (${Bits.bin(v, reg.w)}): ${fields.join(', ')}.`}]};
      }
      if (c.view === 'code') {
        const model = modelCode(reg, c);
        const result = checkCode(model, reg, c);
        if (!result.ok) throw new Error(`the model answer fails: ${result.message}`);
        return {answer: [{text: 'For example:'}, {code: model, lang: 'c'}]};
      }
      throw new Error('the ops view has no goal');
    },
    print(c, {blank}) {
      const reg = registerFields(c);
      const reset = Bits.u(Bits.big(c.reset), reg.w);
      const v = Bits.u(Bits.big(c.value ?? c.reset), reg.w);
      const fields = drawText(fieldLines(reg), {size: 10.5, max: 110});
      if (c.view === 'map') {
        if (c.goal) registerTarget(reg, c);
        return picture([...printRegister(reg, settable(reg, reset, v), blank),
          blank ? null : drawText(`${reg.name} = ${Bits.hex(settable(reg, reset, v), reg.w)};`, {size: 11}), fields]);
      }
      if (c.view === 'code') {
        if (c.goal) codeGoal(reg, c);
        return picture([...printRegister(reg, 0n, true), fields]);
      }
      const rows = [{kind: 'small', cells: indexCells(reg.w - 1, 0)}, {label: `${reg.name}`, cells: bitCells(v, reg.w - 1, 0)}];
      return picture([drawRows(rows, reg.w, {gapAfter: nibbles(reg.w - 1, 0)}), 4,
        drawText(`${reg.name} = ${Bits.hex(v, reg.w)}. Operations: |= sets, &= ~ clears, ^= toggles bits; = writes the whole register.`, {size: 11})]);
    },
  });

  function registerMap(root, c, kit, reg) {
    const {w, fields} = reg;
    const reset = Bits.u(Bits.big(c.reset), w);
    let v = settable(reg, reset, Bits.u(Bits.big(c.value ?? c.reset), w));
    if (c.goal) registerTarget(reg, c);
    const status = kit.status();
    const diagram = registerDiagram(reg, {onToggle: i => { v ^= 1n << BigInt(i); refresh(); }});
    const hexInput = h('input', {type: 'text', class: 'form-control form-control-sm', id: nextId('reg'), spellcheck: 'false', style: 'width: 10rem'});
    hexInput.addEventListener('input', () => {
      const p = Bits.parse(hexInput.value);
      const ok = p !== null && p >= 0n && p <= Bits.mask(w);
      hexInput.classList.toggle('is-invalid', !ok);
      if (!ok) return;
      v = settable(reg, reset, p);   // read-only and reserved bits keep their reset value
      refresh(hexInput);
    });
    const table = h('table', {class: 'cw-table'});
    const code = h('div', {class: 'cw-code'});
    const binOut = h('span', {class: 'cw-mono'});
    add(root, h('div', {class: 'cw-scroll'}, diagram.el),
      h('div', {class: 'cw-controls'}, kit.control(`${c.name} (hex)`, hexInput), h('span', {class: 'cw-ctl'}, 'binary', binOut)),
      h('div', {class: 'cw-scroll'}, table), code, c.goal ? status.el : null);

    function refresh(except) {
      diagram.update(v);
      if (except !== hexInput) hexInput.value = Bits.hex(v, w);
      binOut.textContent = Bits.bin(v, w);
      table.replaceChildren(h('tr', {}, h('th', {text: 'Field'}), h('th', {text: 'Bits'}), h('th', {text: 'Access'}), h('th', {text: 'Value'}), h('th', {text: 'Meaning'})));
      for (const f of [...fields].sort((x, y) => y.hi - x.hi)) {
        const x = fieldValue(v, f);
        let meaning = f.doc;
        if (Object.keys(f.values).length && f.access !== 'r') {
          const opts = Object.entries(f.values).map(([k, label]) => ({value: Number(k), label: `${k}: ${label}`}));
          meaning = kit.select(opts, x, nv => { v = withField(v, f, nv); refresh(); });
        } else if (f.values[String(x)]) meaning = f.values[String(x)];
        table.append(h('tr', {},
          h('td', {}, h('span', {class: `cw-sw cw-f${f.color}`}), f.name),
          h('td', {class: 'cw-mono', text: bitsText(f)}),
          h('td', {text: accessText(f)}),
          h('td', {class: 'cw-mono', text: f.width > 1 ? `${x} (0b${x.toString(2).padStart(f.width, '0')})` : String(x)}),
          h('td', {}, meaning)));
      }
      code.textContent = `${c.name} = ${Bits.hex(v, w)};\n${cAssignment(c.name, v, fields, w)}`;
      if (c.goal) {
        const r = registerGoalMet(reg, c, v);
        if (r.ok) status.ok(`That is the right configuration: ${c.name} = ${Bits.hex(v, w)}.`);
        else status.info(r.wrong.length ? `Not yet: check ${r.wrong.join(', ')}.` : 'Not yet.');
      }
    }
    refresh();
  }

  function registerOps(root, c, kit, reg) {
    const {w} = reg;
    const name = c.name;
    let before = Bits.u(Bits.big(c.value ?? c.reset), w);
    let mask = 0n;
    let op = 'set';
    const OPS = {
      set: {label: '|=  set', apply: (x, m) => x | m, code: e => `${name} |= ${e};`, maskLabel: 'mask'},
      clear: {label: '&= ~  clear', apply: (x, m) => x & ~m, code: e => `${name} &= ~${e.startsWith('(') && !e.includes(' | ') ? e : '(' + e + ')'};`, maskLabel: '~mask'},
      toggle: {label: '^=  toggle', apply: (x, m) => x ^ m, code: e => `${name} ^= ${e};`, maskLabel: 'mask'},
      write: {label: '=  write', apply: (x, m) => m, code: e => `${name} = ${e};`, maskLabel: 'value'},
    };
    const opSel = kit.segmented(Object.entries(OPS).map(([k, o]) => ({value: k, label: o.label})), op, x => { op = x; refresh(); });
    const beforeRow = kit.bitGrid(w, {label: `${name} before`, onToggle: i => { before ^= 1n << BigInt(i); refresh(); }});
    const maskRow = kit.bitGrid(w, {label: 'mask (click)', index: false, onToggle: i => { mask ^= 1n << BigInt(i); refresh(); }});
    const shownMask = kit.bitGrid(w, {label: '~mask', index: false});
    const afterRow = kit.bitGrid(w, {label: `${name} after`, index: false});
    const code = h('div', {class: 'cw-code'});
    const values = h('div', {class: 'cw-explain'});
    const applyBtn = kit.button('Apply', () => { before = OPS[op].apply(before, mask) & Bits.mask(w); mask = 0n; refresh(); }, true);
    add(root, kit.control('Operation', opSel),
      h('div', {class: 'cw-scroll'}, h('div', {class: 'cw'}, beforeRow.el, maskRow.el, shownMask.el, afterRow.el)),
      values, code,
      h('div', {class: 'cw-row'}, applyBtn, kit.button('Clear the mask', () => { mask = 0n; refresh(); }),
        h('span', {class: 'cw-note', text: 'Click bits of "before" to choose a starting value.'})));
    function refresh() {
      const after = Bits.u(OPS[op].apply(before, mask), w);
      beforeRow.update(before);
      maskRow.update(mask);
      shownMask.el.hidden = op !== 'clear';
      shownMask.update(Bits.u(~mask, w));
      afterRow.update(after, i => (Bits.bit(after, i) !== Bits.bit(before, i) ? 'chg' : null));
      code.textContent = OPS[op].code(maskC(mask, w));
      values.replaceChildren(
        h('div', {}, h('b', {text: 'before '}), `${Bits.hex(before, w)}   `, h('b', {text: OPS[op].maskLabel === 'value' ? 'value ' : 'mask '}), Bits.hex(mask, w), '   ', h('b', {text: 'after '}), Bits.hex(after, w)),
        h('div', {text: after === before ? 'No bit changed.' : `Changed (outlined): bit ${[...Array(w).keys()].filter(i => Bits.bit(after, i) !== Bits.bit(before, i)).reverse().join(', ')}`}));
    }
    refresh();
  }

  // --- A small C interpreter: integer expressions and assignments ---------
  const CLang = {
    tokenize(src) {
      const toks = [];
      const re = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+)[uUlL]*|([A-Za-z_]\w*)|<<=|>>=|\|=|&=|\^=|\+=|-=|<<|>>|[~!&|^+\-*/%()=;]/y;
      let i = 0;
      while (i < src.length) {
        re.lastIndex = i;
        const m = re.exec(src);
        if (!m) throw CLang.error(`"${src[i]}" is not allowed here`, src, i);
        if (!/^\s|^\/[/*]/.test(m[0])) toks.push({text: m[0], pos: i, num: m[1], id: m[2]});
        i = re.lastIndex;
      }
      return toks;
    },
    error(msg, src, pos) {
      const before = src.slice(0, pos ?? src.length);
      const line = before.split('\n').length, col = before.length - before.lastIndexOf('\n');
      return new Error(`Line ${line}, column ${col}: ${msg}`);
    },
    parse(src) {
      const toks = CLang.tokenize(src);
      let p = 0;
      const peek = () => toks[p], next = () => toks[p++];
      const fail = (msg, tok) => { throw CLang.error(msg, src, tok ? tok.pos : src.length); };
      const PREC = {'*': 9, '/': 9, '%': 9, '+': 8, '-': 8, '<<': 7, '>>': 7, '&': 5, '^': 4, '|': 3};
      function primary() {
        const k = next();
        if (!k) fail('the expression stops too early');
        if (k.num !== undefined) return {num: BigInt(k.num)};
        if (k.id !== undefined) return {id: k.id, pos: k.pos};
        if (k.text === '(') { const e = expr(0); const close = next(); if (!close || close.text !== ')') fail('a ")" is missing', close); return e; }
        if ('~!-+'.includes(k.text) && k.text.length === 1) return {un: k.text, a: primary()};
        fail(`unexpected "${k.text}"`, k);
      }
      function expr(min) {
        let left = primary();
        for (;;) {
          const k = peek();
          const prec = k && PREC[k.text];
          if (!prec || prec < min) return left;
          next();
          left = {op: k.text, a: left, b: expr(prec + 1)};
        }
      }
      const stmts = [];
      while (p < toks.length) {
        if (peek().text === ';') { next(); continue; }
        const target = next();
        if (target.id === undefined) fail('a statement starts with a name, like TIMCTRL |= …', target);
        const op = next();
        if (!op || !['=', '|=', '&=', '^=', '<<=', '>>=', '+=', '-='].includes(op.text)) fail(`expected =, |=, &= or ^= after ${target.text}`, op || target);
        const e = expr(0);
        stmts.push({target: target.text, op: op.text, e});
        const end = next();
        if (end && end.text !== ';') fail('a ";" is missing', end);
      }
      if (!stmts.length) fail('write at least one statement');
      return stmts;
    },
    run(stmts, regs, consts, width, src) {
      regs = Object.assign({}, regs);
      const ev = n => {
        if (n.num !== undefined) return n.num;
        if (n.id !== undefined) {
          if (n.id in regs) return regs[n.id];
          if (n.id in consts) return consts[n.id];
          throw CLang.error(`unknown name "${n.id}"`, src, n.pos);
        }
        if (n.un) { const a = ev(n.a); return n.un === '~' ? ~a : n.un === '!' ? (a ? 0n : 1n) : n.un === '-' ? -a : a; }
        const a = ev(n.a), b = ev(n.b);
        switch (n.op) {
          case '*': return a * b;
          case '/': if (!b) throw new Error('Division by zero'); return a / b;
          case '%': if (!b) throw new Error('Division by zero'); return a % b;
          case '+': return a + b;
          case '-': return a - b;
          case '<<': if (b < 0n || b > 64n) throw new Error(`Shift by ${b}`); return a << b;
          case '>>': if (b < 0n || b > 64n) throw new Error(`Shift by ${b}`); return a >> b;
          case '&': return a & b;
          case '^': return a ^ b;
          case '|': return a | b;
        }
      };
      for (const st of stmts) {
        if (!(st.target in regs)) throw new Error(`You can only assign to ${Object.keys(regs).join(', ')}, not to ${st.target}`);
        const r = ev(st.e);
        let v = regs[st.target];
        switch (st.op) {
          case '=': v = r; break;
          case '|=': v |= r; break;
          case '&=': v &= r; break;
          case '^=': v ^= r; break;
          case '<<=': v <<= r; break;
          case '>>=': v >>= r; break;
          case '+=': v += r; break;
          case '-=': v -= r; break;
        }
        regs[st.target] = BigInt.asUintN(width, v);
      }
      return regs;
    },
  };

  // The goal of a code challenge: {fields: {MODE: 2}, set_bits: [11], clear_bits: [10], toggle_bits: [3]}
  function codeGoal(reg, c) {
    const g = c.goal;
    if (!g || typeof g !== 'object' || Array.isArray(g)) throw new Error('a goal is {fields, set_bits, clear_bits, toggle_bits}');
    for (const k of Object.keys(g)) oneOf(k, ['fields', 'set_bits', 'clear_bits', 'toggle_bits'], 'a goal');
    const bit = (k, i) => { const n = int(i); if (n < 0 || n >= reg.w) throw new Error(`${k}: bit ${n} does not exist`); return 1n << BigInt(n); };
    const out = {set: 0n, clear: 0n, toggle: 0n, fields: []};
    for (const [n, x] of Object.entries(g.fields || {})) {
      const f = reg.byName[n];
      if (!f) throw new Error(`no field ${n}`);
      if (int(x) < 0 || int(x) >= 2 ** f.width) throw new Error(`${n} = ${x} does not fit in ${f.width} bits`);
      out.fields.push([f, int(x)]);
    }
    for (const i of listOf(g.set_bits)) out.set |= bit('set_bits', i);
    for (const i of listOf(g.clear_bits)) out.clear |= bit('clear_bits', i);
    for (const i of listOf(g.toggle_bits)) out.toggle |= bit('toggle_bits', i);
    if (!out.fields.length && !out.set && !out.clear && !out.toggle) throw new Error('the goal asks for nothing');
    return out;
  }
  // The register after correct code, from a starting value
  function codeExpected(goal, init, w) {
    let v = init;
    for (const [f, x] of goal.fields) v = withField(v, f, x);
    v = (v | goal.set) & ~goal.clear;
    return Bits.u(v ^ goal.toggle, w);
  }
  // C that reaches the goal (the model answer in the PDF): a read-modify-write per field, then the bits.
  function modelCode(reg, c) {
    const goal = codeGoal(reg, c), {w, name} = reg, u = uSuffix(w);
    const lines = [];
    for (const [f, x] of goal.fields) {
      const at = s => (f.lo ? `(${s} << ${f.lo})` : s);
      if (f.width === 1) { lines.push(x ? `${name} |= ${at(`1${u}`)};` : `${name} &= ~${at(`1${u}`)};`); continue; }
      const fieldMask = at(`0x${((1n << BigInt(f.width)) - 1n).toString(16).toUpperCase()}${u}`);
      lines.push(x ? `${name} = (${name} & ~${fieldMask}) | ${at(`0x${x.toString(16).toUpperCase()}${u}`)};` : `${name} &= ~${fieldMask};`);
    }
    if (goal.set) lines.push(`${name} |= ${maskC(goal.set, w)};`);
    if (goal.clear) lines.push(`${name} &= ${notMaskC(goal.clear, w)};`);
    if (goal.toggle) lines.push(`${name} ^= ${maskC(goal.toggle, w)};`);
    return lines.join('\n');
  }
  // Check C code like the browser's Check button: run it on many starting values.
  // {ok, tested} or {ok: false, message, init?, got?, want?}
  function checkCode(src, reg, c, consts = {}) {
    const goal = codeGoal(reg, c), {w, name} = reg;
    let stmts;
    try { stmts = CLang.parse(src); } catch (e) { return {ok: false, message: e.message}; }
    const m = Bits.mask(w);
    const inits = [0n, m, 0x5555555555555555n & m, 0xAAAAAAAAAAAAAAAAn & m, Bits.u(Bits.big(c.reset ?? 0), w)];
    // random values, 32 bits at a time so that 64-bit registers are covered too
    const random = () => { let x = 0n; for (let k = 0; k < w; k += 32) x = (x << 32n) | BigInt(Math.floor(Math.random() * 2 ** 32)); return x & m; };
    for (let k = 0; k < 15; k++) inits.push(random());
    for (const init of inits) {
      let got;
      try { got = CLang.run(stmts, {[name]: init}, consts, w, src)[name]; } catch (e) { return {ok: false, message: e.message}; }
      const want = codeExpected(goal, init, w);
      if (got !== want) {
        const touched = [...Array(w).keys()].filter(i => Bits.bit(got, i) !== Bits.bit(want, i));
        // bits the goal leaves alone: they follow the starting value (and are not toggled)
        const untouched = (codeExpected(goal, 0n, w) ^ codeExpected(goal, m, w)) & ~goal.toggle;
        const offTarget = touched.filter(i => Bits.bit(untouched, i));
        return {ok: false, init, got, want, message: offTarget.length
          ? `Not right: your code also changes bit ${offTarget.reverse().join(', ')}, which should stay as it was.`
          : `Not right: bit ${touched.reverse().join(', ')} ends up wrong.`};
      }
    }
    return {ok: true, tested: inits.length};
  }

  function registerCode(root, c, kit, reg) {
    const {w, fields} = reg;
    const name = c.name;
    // CMSIS-style names are accepted too: TIMCTRL_MODE_Pos, TIMCTRL_MODE_Msk
    const consts = {};
    for (const f of fields) {
      consts[`${name}_${f.name}_Pos`] = BigInt(f.lo);
      consts[`${name}_${f.name}_Msk`] = Bits.fieldMask(f.hi, f.lo);
    }
    if (c.goal) codeGoal(reg, c);
    const diagram = registerDiagram(reg, {});
    diagram.update(0n);
    const editor = h('textarea', {class: 'cw-editor', id: nextId('code'), spellcheck: 'false', 'aria-label': 'Your C code'});
    editor.value = c.starter || `${name} = ${name};`;
    const status = kit.status();
    const detail = h('div', {class: 'cw'});
    const check = () => {
      detail.replaceChildren();
      if (!c.goal) { status.info('This register has no goal to check.'); return; }
      const r = checkCode(editor.value, reg, c, consts);
      if (r.ok) { status.ok(`Right for all ${r.tested} starting values tested, including ${Bits.hex(0n, w)} and ${Bits.hex(Bits.mask(w), w)}.`); return; }
      status.no(r.message);
      if (r.init === undefined) return;
      const row = (label, v, bad) => { const g = kit.bitGrid(w, {label, index: label === 'before'}); g.update(v, i => (bad && Bits.bit(r.got, i) !== Bits.bit(r.want, i) ? 'bad' : null)); return g.el; };
      detail.append(h('div', {class: 'cw-note', text: `For example, when ${name} is ${Bits.hex(r.init, w)} before your code:`}),
        h('div', {class: 'cw-scroll'}, h('div', {class: 'cw'}, row('before', r.init), row('yours', r.got, true), row('expected', r.want))));
    };
    editor.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); check(); } });
    add(root, h('div', {class: 'cw-scroll'}, diagram.el), editor,
      h('div', {class: 'cw-row'}, kit.button('Check', check, true), h('span', {class: 'cw-note', text: 'Ctrl+Enter also checks.'})),
      status.el, detail);
  }

  // ========================================================================
  // Waveforms: one renderer for all protocols (an SVG, in the browser or as text)
  // spec: {ticks, unit, lanes: [{name, kind?, segs, labels, marks}], groups, samples, grid, highlight}
  //   segment: {t0, t1, level: 0|1, who?} | {t0, t1, x: true} | {t0, t1, z: true} | band {t0, t1, color, text}
  // ========================================================================
  const Wave = {
    render(spec, zoom = 1, make = sv) {
      const unit = (spec.unit || 24) * zoom;
      const LW = 58;
      const groupH = spec.groups && spec.groups.length ? 32 : 6;
      const laneH = l => (l.kind === 'band' ? 24 : 50);
      let y = groupH;
      const tops = spec.lanes.map(l => { const t = y; y += laneH(l); return t; });
      const H = y + 6, W = LW + spec.ticks * unit + 14;
      const X = t => LW + t * unit;
      const hatch = nextId('hatch');
      const svg = make('svg', {class: 'cw-wv', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': spec.alt || 'timing diagram'});
      svg.append(make('defs', {}, make('pattern', {id: hatch, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)'},
        make('line', {x1: 0, y1: 0, x2: 0, y2: 6, class: 'cw-wv-hatch'}))));
      for (const t of spec.grid || []) svg.append(make('line', {x1: X(t), x2: X(t), y1: groupH - 4, y2: H - 4, class: 'cw-wv-grid'}));
      // highlight: {t0, t1}, a time window across all lanes (the bit the SPI ring just clocked)
      const hl = spec.highlight;
      if (hl) svg.append(make('rect', {x: X(hl.t0), y: groupH - 4, width: X(hl.t1) - X(hl.t0), height: H - groupH, class: 'cw-wv-hl'}));
      for (const g of spec.groups || []) {
        const x0 = X(g.t0) + 1.5, x1 = X(g.t1) - 1.5, yb = groupH - 9;
        svg.append(make('g', {class: 'cw-wv-group'}, make('path', {d: `M${x0} ${yb + 6} V${yb} H${x1} V${yb + 6}`}),
          make('text', {x: (x0 + x1) / 2, y: yb - 5, text: g.hidden ? '?' : g.text}), g.tip && !g.hidden ? make('title', {text: g.tip}) : null));
      }
      spec.lanes.forEach((lane, li) => {
        const top = tops[li];
        if (lane.kind === 'band') {
          svg.append(make('text', {x: LW - 8, y: top + 14, class: 'cw-wv-name small', text: lane.name}));
          for (const b of lane.segs) {
            const x0 = X(b.t0), x1 = X(b.t1);
            svg.append(make('g', {class: `cw-wv-band ${b.color === null ? 'fx' : 'f' + b.color}`},
              make('rect', {x: x0 + 0.5, y: top + 3, width: Math.max(0, x1 - x0 - 1), height: 16, rx: 2}),
              b.text && x1 - x0 >= 18 ? make('text', {x: (x0 + x1) / 2, y: top + 14.5, text: b.text}) : null,
              b.tip ? make('title', {text: b.tip}) : null));
          }
          return;
        }
        const sig = top + 18, yHi = sig + 2, yLo = sig + 26, yMid = sig + 14;
        svg.append(make('text', {x: LW - 8, y: yMid + 4, class: 'cw-wv-name', text: lane.name}));
        let prev = null;
        for (const g of lane.segs) {
          const x0 = X(g.t0), x1 = X(g.t1);
          if (g.level !== undefined) {
            const yy = g.level ? yHi : yLo;
            let d = '';
            if (prev && prev.level !== undefined && prev.level !== g.level) d = `M${x0} ${prev.level ? yHi : yLo} V${yy} `;
            else if (prev && prev.level === undefined) d = `M${x0} ${yMid} V${yy} `;
            svg.append(make('path', {d: d + `M${x0} ${yy} H${x1}`, class: 'cw-wv-sig ' + (g.who || '')}));
          } else if (g.x) {
            svg.append(make('rect', {x: x0, y: yHi, width: x1 - x0, height: yLo - yHi, fill: `url(#${hatch})`, class: 'cw-wv-x'}),
              make('path', {d: `M${x0} ${yHi} H${x1} M${x0} ${yLo} H${x1}`, class: 'cw-wv-sig dim'}));
          } else if (g.z) {
            svg.append(make('path', {d: `M${x0} ${yMid} H${x1}`, class: 'cw-wv-sig z'}));
          }
          if (g.tip) svg.append(make('rect', {x: x0, y: yHi - 3, width: Math.max(1, x1 - x0), height: yLo - yHi + 6, class: 'cw-wv-hit'}, make('title', {text: g.tip})));
          prev = g;
        }
        for (const lb of lane.labels || []) {
          if (lb.hidden) continue;
          svg.append(make('text', {x: X((lb.t0 + lb.t1) / 2), y: sig - 3, class: 'cw-wv-lbl ' + (lb.cls || ''), text: lb.text}));
        }
        for (const m of lane.marks || []) svg.append(make('text', {x: X(m.t), y: sig - 3, class: 'cw-wv-cond', text: m.text}));
      });
      for (const m of spec.samples || []) {
        const x = X(m.t);
        svg.append(make('line', {x1: x, x2: x, y1: groupH, y2: H - 4, class: 'cw-wv-sample'}));
        const ym = tops[m.lane] + 18 + 14;
        svg.append(make('path', {d: m.dir === 'rise' ? `M${x - 4} ${ym + 4} L${x} ${ym - 3} L${x + 4} ${ym + 4} Z` : `M${x - 4} ${ym - 4} L${x} ${ym + 3} L${x + 4} ${ym - 4} Z`, class: 'cw-wv-arrow'}));
      }
      return svg;
    },
    // The part of a waveform between t0 and t1, as a waveform of its own.
    slice(spec, t0, t1) {
      const shifted = x => Object.assign({}, x, x.t0 !== undefined ? {t0: x.t0 - t0, t1: x.t1 - t0} : {t: x.t - t0});
      const inside = x => (x.t0 !== undefined ? x.t0 >= t0 && x.t1 <= t1 : x.t >= t0 && x.t <= t1);
      const clip = segs => segs.filter(s => s.t1 > t0 && s.t0 < t1).map(s => Object.assign({}, s, {t0: Math.max(s.t0, t0) - t0, t1: Math.min(s.t1, t1) - t0}));
      return Object.assign({}, spec, {
        ticks: t1 - t0, highlight: null,
        lanes: spec.lanes.map(l => Object.assign({}, l, {segs: clip(l.segs),
          labels: (l.labels || []).filter(inside).map(shifted), marks: (l.marks || []).filter(inside).map(shifted)})),
        groups: (spec.groups || []).filter(inside).map(shifted),
        samples: (spec.samples || []).filter(inside).map(shifted),
        grid: (spec.grid || []).filter(t => t >= t0 && t <= t1).map(t => t - t0),
      });
    },
    // For the PDF: a long waveform in rows of at most maxWidth px, cut between groups (frames, bytes).
    rows(spec, maxWidth) {
      const per = Math.max(4, Math.floor((maxWidth - 72) / spec.unit));
      const ends = [...new Set((spec.groups || []).map(g => g.t1))].sort((a, b) => a - b);
      const cuts = [0];
      while (spec.ticks - cuts[cuts.length - 1] > per) {
        const from = cuts[cuts.length - 1];
        const fit = ends.filter(e => e > from && e - from <= per);
        cuts.push(fit.length ? fit[fit.length - 1] : from + per);
      }
      if (cuts[cuts.length - 1] < spec.ticks) cuts.push(spec.ticks);
      return cuts.length > 2 ? cuts.slice(1).map((t1, k) => Wave.slice(spec, cuts[k], t1)) : [spec];
    },
  };
  // A waveform as blocks of a picture, in rows that fit the page (UART's wide bits a little narrower)
  const waveBlocks = spec => {
    const zoom = spec.unit > 20 ? 0.8 : 1;
    return Wave.rows(Object.assign({}, spec, {unit: spec.unit * zoom}), 720)
      .flatMap((s, k) => [k ? 8 : null, svgBlock(Wave.render(Object.assign({}, s, {unit: s.unit / zoom}), zoom, svgText))]);
  };

  // Turn change events {t, level, who, tip} into segments up to `end`.
  function eventsToSegs(events, end) {
    const ev = [...events].sort((a, b) => a.t - b.t);
    const segs = [];
    ev.forEach((e, k) => {
      const t1 = k + 1 < ev.length ? ev[k + 1].t : end;
      if (t1 > e.t) segs.push({t0: e.t, t1, level: e.level, who: e.who, tip: e.tip});
    });
    return segs;
  }

  const byteName = v => (v >= 32 && v < 127 ? `'${String.fromCharCode(v)}' 0x${v.toString(16).toUpperCase().padStart(2, '0')}` : `0x${v.toString(16).toUpperCase().padStart(2, '0')}`);
  const hx = (v, digits = 2) => '0x' + v.toString(16).toUpperCase().padStart(digits, '0');

  // ---- protocol encoders: settings + data → waveform spec -----------------
  const Protocols = {
    uart(c, hide) {
      const dataBits = int(c.data_bits ?? 8), parity = oneOf(c.parity ?? 'none', ['none', 'even', 'odd'], 'parity'), stops = int(c.stop_bits ?? 1);
      if (dataBits < 5 || dataBits > 9) throw new Error('data_bits is 5 … 9');
      if (stops !== 1 && stops !== 2) throw new Error('stop_bits is 1 or 2');
      const lsb = oneOf(c.bit_order ?? 'lsb', ['lsb', 'msb'], 'bit_order') === 'lsb';
      const gap = int(c.gap ?? 0);   // idle bit times between frames; a UART with data waiting sends none
      if (gap < 0 || gap > 20) throw new Error('gap is 0 … 20');
      const segs = [], labels = [], groups = [], grid = [], bitTimes = [];
      let t = 0;
      const push = (level, text, tip, cls) => { segs.push({t0: t, t1: t + 1, level, tip}); if (text) labels.push({t0: t, t1: t + 1, text, cls}); grid.push(t); t += 1; };
      segs.push({t0: 0, t1: 1, level: 1, tip: 'idle: the line is high'});
      t = 1;
      c.bytes.forEach((byte, k) => {
        const v = Number(byte) & ((1 << dataBits) - 1);
        const t0 = t;
        push(0, 'start', 'start bit: always 0', 'frame');
        const order = [...Array(dataBits).keys()];
        if (!lsb) order.reverse();
        for (const i of order) {
          const b = (v >> i) & 1;
          bitTimes.push({byte: k, pos: i, t0: t, t1: t + 1});
          push(b, 'D' + i, hide ? `D${i} = ${b}` : `D${i} = ${b}: bit ${i} of ${hx(v)}`);   // hidden: no answer on hover
        }
        if (parity !== 'none') {
          const ones = Bits.ones(BigInt(v));
          const p = parity === 'even' ? ones % 2 : 1 - (ones % 2);
          push(p, 'P', `parity bit (${parity}) = ${p}: ${ones} data bits are 1, so with the parity bit the number of 1s is ${parity}`, 'frame');
        }
        for (let s = 0; s < stops; s++) push(1, 'stop', 'stop bit: always 1', 'frame');
        groups.push({t0, t1: t, text: byteName(v), hidden: hide, tip: `frame ${k + 1}: ${byteName(v)}`});
        if (k < c.bytes.length - 1 && gap) {
          segs.push({t0: t, t1: t + gap, level: 1, tip: 'idle: the line stays high until the next start bit'});
          labels.push({t0: t, t1: t + gap, text: 'idle'});
          grid.push(t);
          t += gap;
        }
      });
      grid.push(t);
      segs.push({t0: t, t1: t + 1, level: 1, tip: 'idle'});
      t += 1;
      const baud = int(c.baud ?? 9600), us = 1e6 / baud;
      const frameBits = 1 + dataBits + (parity !== 'none' ? 1 : 0) + stops;
      return {
        ticks: t, unit: 30, lanes: [{name: c.line ?? 'TX', segs, labels}], groups, grid, bitTimes,
        caption: `${baud} baud: one bit lasts ${us.toFixed(us < 10 ? 2 : 1)} µs; one frame is ${frameBits} bits (${(frameBits * us).toFixed(0)} µs) and carries ${dataBits} data bits.`,
      };
    },

    spi(c, hide) {
      const mode = int(c.mode ?? 0);
      if (mode < 0 || mode > 3) throw new Error('SPI mode is 0, 1, 2 or 3');
      const cpol = (mode >> 1) & 1, cpha = mode & 1;
      const wb = int(c.word_bits ?? 8);
      if (wb < 1 || wb > 32) throw new Error('word_bits is 1 … 32');
      const msb = oneOf(c.bit_order ?? 'msb', ['msb', 'lsb'], 'bit_order') === 'msb';
      const mosi = c.mosiBytes, miso = c.misoBytes;
      const words = Math.max(mosi.length, miso ? miso.length : 0);
      if (!words) throw new Error('nothing to send: give mosi (and miso) bytes');
      const total = words * wb, s0 = 2, end = s0 + 2 * total, T = end + 3;
      const cs = [{t0: 0, t1: 1, level: 1, tip: 'not selected (high)'}, {t0: 1, t1: end + 1, level: 0, tip: 'selected: chip select is active low'}, {t0: end + 1, t1: T, level: 1, tip: 'not selected'}];
      const clk = [{t0: 0, t1: s0, level: cpol, tip: `idle: CPOL = ${cpol}, so the clock idles ${cpol ? 'high' : 'low'}`}];
      for (let k = 0; k < total; k++) {
        clk.push({t0: s0 + 2 * k, t1: s0 + 2 * k + 1, level: cpol});
        clk.push({t0: s0 + 2 * k + 1, t1: s0 + 2 * k + 2, level: 1 - cpol});
      }
      clk.push({t0: end, t1: T, level: cpol});
      const start = k => (cpha ? s0 + 2 * k + 1 : k === 0 ? 1 : s0 + 2 * k);
      const stop = k => (cpha ? s0 + 2 * k + 3 : s0 + 2 * k + 2);
      const bitTimes = [];
      const lane = (name, bytes, outside) => {
        const segs = [], labels = [];
        segs.push(Object.assign({t0: 0, t1: start(0), tip: outside.z ? 'not driven (high impedance)' : 'not valid yet'}, outside));
        for (let k = 0; k < total; k++) {
          const word = Math.floor(k / wb), j = k % wb, i = msb ? wb - 1 - j : j;
          const v = Number(bytes[word] ?? 0), b = (v >> i) & 1;
          segs.push({t0: start(k), t1: stop(k), level: b, tip: hide ? `${name}: D${i} = ${b}` : `${name}: bit ${i} of ${hx(v)} = ${b}`});
          labels.push({t0: start(k), t1: stop(k), text: 'D' + i});
          if (name === 'MOSI') bitTimes.push({byte: word, pos: i, t0: start(k), t1: stop(k)});
        }
        segs.push(Object.assign({t0: stop(total - 1), t1: T}, outside));
        return {name, segs, labels};
      };
      const lanes = [{name: c.cs_name ?? 'CS', segs: cs}, {name: 'SCLK', segs: clk}, lane('MOSI', mosi, {x: true})];
      if (miso) lanes.push(lane('MISO', miso, {z: true}));
      const groups = [];
      for (let wd = 0; wd < words; wd++) {
        const m = mosi[wd] !== undefined ? hx(mosi[wd], Math.ceil(wb / 4)) : '—';
        const s = miso && miso[wd] !== undefined ? hx(miso[wd], Math.ceil(wb / 4)) : null;
        groups.push({t0: start(wd * wb), t1: stop((wd + 1) * wb - 1), text: s ? `${m} / ${s}` : m, hidden: hide, tip: `MOSI ${m}${s ? `, MISO ${s}` : ''}`});
      }
      const samples = [];
      for (let k = 0; k < total; k++) {
        const t = cpha ? s0 + 2 * k + 2 : s0 + 2 * k + 1;
        const after = cpha ? cpol : 1 - cpol;   // clock level just after the sampling edge
        samples.push({t, lane: 1, dir: after ? 'rise' : 'fall'});
      }
      const grid = [];
      for (let k = 0; k <= total; k++) grid.push(s0 + 2 * k);
      const edge = (cpha ? cpol : 1 - cpol) ? 'rising' : 'falling';
      return {
        ticks: T, unit: 13, lanes, groups, samples, grid, bitTimes,
        caption: `Mode ${mode}: CPOL = ${cpol} (the clock idles ${cpol ? 'high' : 'low'}), CPHA = ${cpha} (data is sampled on the ${cpha ? 'second' : 'first'} clock edge, here the ${edge} edges, and changes on the other). ${msb ? 'Most' : 'Least'} significant bit first.`,
      };
    },

    i2c(c, hide) {
      const addr = int(c.address ?? 0x48);
      if (addr < 0 || addr > 127) throw new Error('address is a 7-bit address: 0 … 0x7F');
      const scl = [], sda = [], labels = [], groups = [], marks = [];
      const setScl = (t, level) => scl.push({t, level});
      const setSda = (t, level, who, tip) => sda.push({t, level, who, tip});
      let t = 0;
      setScl(0, 1); setSda(0, 1, 'c', 'idle: both lines high (pull-up resistors)');
      t = 2;
      const start = () => { setSda(t + 1, 0, 'c', 'START: SDA falls while SCL is high'); marks.push({t: t + 1, text: 'S'}); t += 2; };
      const restart = () => { setScl(t, 0); setSda(t + 1, 1, 'c'); setScl(t + 2, 1); setSda(t + 3, 0, 'c', 'repeated START'); marks.push({t: t + 3, text: 'Sr'}); t += 4; };
      const stop = () => { setScl(t, 0); setSda(t + 1, 0, 'c'); setScl(t + 2, 1); setSda(t + 3, 1, 'c', 'STOP: SDA rises while SCL is high'); marks.push({t: t + 3, text: 'P'}); t += 4; };
      const bit = (b, text, who, tip) => {
        setScl(t, 0); setSda(t + 1, b, who, tip); setScl(t + 2, 1);
        labels.push({t0: t + 1, t1: t + 5, text, cls: who});
        t += 4;
      };
      const byte = (v, names, who, what) => {
        const t0 = t + 1;
        for (let i = 7; i >= 0; i--) bit((v >> i) & 1, names[7 - i], who, `${what}: bit ${i} = ${(v >> i) & 1} (sent by the ${who === 'c' ? 'controller' : 'target'})`);
        return t0;
      };
      const ack = (ok, who) => bit(ok ? 0 : 1, ok ? 'ACK' : 'NACK', who, `${ok ? 'ACK: SDA pulled low' : 'NACK: SDA left high'} by the ${who === 'c' ? 'controller' : 'target'}`);
      const transfers = listOf(c.transfers);
      if (!transfers.length) throw new Error('transfers: give at least one {write: [...]} or {read: [...]}');
      start();
      transfers.forEach((tr, k) => {
        if (k > 0) restart();
        const read = tr.read !== undefined;
        if (!read && tr.write === undefined) throw new Error(`transfer ${k + 1} is {write: [...]} or {read: [...]}`);
        const data = listOf(read ? tr.read : tr.write).map(x => int(x) & 0xFF);
        const a = (addr << 1) | (read ? 1 : 0);
        const names = ['A6', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0', read ? 'R' : 'W'];
        // a bit's SDA window is [t + 1, t + 5): a byte ends one tick after t
        const t0 = byte(a, names, 'c', 'address');
        groups.push({t0, t1: t + 1, text: `${hx(addr)} + ${read ? 'R' : 'W'}`, hidden: false, tip: `address ${hx(addr)}, ${read ? 'read' : 'write'}: ${hx(a)}`});
        ack(true, 't');
        data.forEach((v, j) => {
          const d0 = byte(v, ['D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'D0'], read ? 't' : 'c', read ? 'data from the target' : 'data from the controller');
          groups.push({t0: d0, t1: t + 1, text: hx(v), hidden: hide, tip: `${read ? 'read' : 'written'}: ${hx(v)}`});
          ack(read ? j < data.length - 1 : true, read ? 'c' : 't');
        });
      });
      stop();
      const T = t + 2;
      return {
        ticks: T, unit: 7, groups,
        lanes: [{name: 'SCL', segs: eventsToSegs(scl, T)}, {name: 'SDA', segs: eventsToSegs(sda, T), labels, marks}],
        legend: [['var(--cw-accent)', 'driven by the controller'], ['var(--cw-warm)', 'driven by the target']],
        caption: 'S = start, Sr = repeated start, P = stop. Data changes while SCL is low and is read while SCL is high. 7-bit address, most significant bit first; each byte is acknowledged by the receiver.',
      };
    },
  };

  // Bytes from YAML or from a text box: [0x48, 105], "Hi", or "0x48 0x69"
  function toBytes(value, maxBits = 8) {
    if (value == null) return [];
    const m = maxBits >= 32 ? 0xFFFFFFFF : (1 << maxBits) - 1;
    if (Array.isArray(value)) return value.map(x => (int(x) & m) >>> 0);
    const text = String(value);
    if (/^\s*(0x[0-9a-f]+[\s,]*)+$/i.test(text)) return text.trim().split(/[\s,]+/).map(x => (Number(BigInt(x)) & m) >>> 0);
    return [...text].map(ch => ch.charCodeAt(0) & m);
  }
  const bytesText = list => list.map(x => hx(x)).join(' ');
  // The encoder settings of a frame: the bytes it carries, and those the student decodes.
  function frameSettings(st) {
    const s = Object.assign({}, st);
    if (s.protocol === 'uart') { s.bytes = toBytes(s.data, int(s.data_bits ?? 8)); s.decoded = s.bytes; }
    if (s.protocol === 'spi') {
      s.mosiBytes = toBytes(s.mosi ?? s.data, int(s.word_bits ?? 8));
      s.misoBytes = s.miso != null ? toBytes(s.miso, int(s.word_bits ?? 8)) : null;
      s.decoded = s.mosiBytes;
    }
    if (s.protocol === 'i2c') s.decoded = listOf(s.transfers).flatMap(tr => listOf(tr.read ?? tr.write).map(x => int(x) & 0xFF));
    return s;
  }
  const decodedText = (s, k, v) => (s.protocol === 'uart' ? `frame ${k + 1}: ${byteName(v)}` : `byte ${k + 1}: ${hx(v, Math.ceil(int(s.word_bits ?? 8) / 4))}`);

  // ========================================================================
  // type: frame (protocol: uart, spi, i2c)
  // ========================================================================
  Widget.define('frame', {
    keys: ['protocol', 'data', 'baud', 'data_bits', 'parity', 'stop_bits', 'bit_order', 'gap', 'line',
           'mode', 'mosi', 'miso', 'word_bits', 'cs_name', 'ring', 'address', 'transfers'],
    defaults: {protocol: 'uart', controls: [], ring: false},
    render(root, c, kit) {
      const st = Object.assign({}, c);
      const encoder = Protocols[st.protocol];
      if (!encoder) throw new Error(`unknown protocol "${st.protocol}" (${Object.keys(Protocols).join(', ')})`);
      if (c.goal != null && c.goal !== 'decode') throw new Error('the goal of a frame is decode');
      if (c.ring && st.protocol !== 'spi') throw new Error('ring: true is for protocol: spi');
      // ring: true: the two SPI shift registers as a ring, clocked bit by bit; the waveform marks the bit
      const ring = c.ring ? spiRing(kit, () => renderWave()) : null;
      const decode = c.goal === 'decode';
      let hidden = decode, zoom = 1;
      const top = h('div', {class: 'cw-controls'});
      const view = h('div', {class: 'cw-wave'});
      const caption = h('div', {class: 'cw-caption'});
      const legend = h('div', {class: 'cw-legend'});
      const status = kit.status();
      const decodeBox = h('div', {class: 'cw-decode'});

      const text = (label, get, set) => {
        const input = h('input', {type: 'text', class: 'form-control form-control-sm', id: nextId('fr'), spellcheck: 'false', autocomplete: 'off', style: 'width: 11rem'});
        input.value = get();
        input.addEventListener('input', () => {
          try { set(input.value); build(); input.classList.remove('is-invalid'); } catch (e) { input.classList.add('is-invalid'); }
        });
        return kit.control(label, input);
      };
      const CONTROLS = {
        data: () => text(st.protocol === 'uart' ? 'Data (text, or 0x48 0x69)' : 'Data (0x9F 0x00)', () => (typeof st.data === 'string' ? st.data : bytesText(toBytes(st.data))), x => { st.data = x; }),
        mosi: () => text('MOSI bytes', () => bytesText(toBytes(st.mosi)), x => { toBytes(x); st.mosi = x; }),
        miso: () => text('MISO bytes', () => bytesText(toBytes(st.miso)), x => { toBytes(x); st.miso = x; }),
        parity: () => kit.control('Parity', kit.select(['none', 'even', 'odd'].map(x => ({value: x, label: x})), st.parity ?? 'none', x => { st.parity = x; build(); })),
        stop_bits: () => kit.control('Stop bits', kit.segmented([1, 2].map(x => ({value: x, label: String(x)})), int(st.stop_bits ?? 1), x => { st.stop_bits = x; build(); })),
        data_bits: () => kit.control('Data bits', kit.select([5, 6, 7, 8, 9].map(x => ({value: x, label: String(x)})), int(st.data_bits ?? 8), x => { st.data_bits = x; build(); })),
        bit_order: () => kit.control('Bit order', kit.segmented([{value: 'msb', label: 'MSB first'}, {value: 'lsb', label: 'LSB first'}], st.bit_order ?? (st.protocol === 'uart' ? 'lsb' : 'msb'), x => { st.bit_order = x; build(); })),
        baud: () => kit.control('Baud rate', kit.select([1200, 9600, 115200, 1000000].map(x => ({value: x, label: String(x)})), int(st.baud ?? 9600), x => { st.baud = x; build(); })),
        mode: () => kit.control('SPI mode', kit.select([0, 1, 2, 3].map(x => ({value: x, label: `${x}: CPOL ${x >> 1}, CPHA ${x & 1}`})), int(st.mode ?? 0), x => { st.mode = x; build(); })),
        address: () => text('Address (7 bits)', () => hx(int(st.address ?? 0x48)), x => { const v = Bits.parse(x); if (v === null || v < 0n || v > 127n) throw new Error(); st.address = Number(v); }),
      };
      for (const key of listOf(c.controls)) {
        if (!CONTROLS[key]) throw new Error(`unknown control "${key}" (${Object.keys(CONTROLS).join(', ')})`);
        top.append(CONTROLS[key]());
      }
      top.append(kit.control('Zoom', h('span', {class: 'cw-row'},
        h('button', {type: 'button', class: 'btn btn-sm btn-outline-secondary', text: '−', 'aria-label': 'zoom out', onClick: () => { zoom = Math.max(0.5, zoom / 1.25); renderWave(); }}),
        h('button', {type: 'button', class: 'btn btn-sm btn-outline-secondary', text: '+', 'aria-label': 'zoom in', onClick: () => { zoom = Math.min(3, zoom * 1.25); renderWave(); }}))));

      let bytes = [], spec = null;
      function build() {
        const s = frameSettings(st);
        spec = encoder(s, hidden);   // may throw: the input that caused it is marked
        bytes = s.decoded;
        if (ring) ring.load(s);
        renderWave();
        caption.textContent = spec.caption || '';
        legend.replaceChildren(...(spec.legend || []).map(([color, label]) => h('span', {}, h('i', {style: `border-color: ${color}`}), label)));
      }
      function renderWave() {
        const clocked = ring ? ring.clocks() : 0;
        view.replaceChildren(Wave.render(clocked ? Object.assign({}, spec, {highlight: spec.bitTimes[clocked - 1]}) : spec, zoom));
      }
      add(root, top, view, legend, caption, ring ? ring.el : null);
      build();
      if (decode) {
        const inputs = bytes.map((b, k) => {
          const input = h('input', {type: 'text', class: 'form-control form-control-sm', id: nextId('dec'), spellcheck: 'false', autocomplete: 'off', placeholder: st.protocol === 'uart' ? "'A' or 0x41" : '0x41'});
          decodeBox.append(kit.control(st.protocol === 'uart' ? `Frame ${k + 1}` : `Byte ${k + 1}`, input));
          return input;
        });
        decodeBox.append(kit.button('Check', () => {
          const wrong = inputs.map((input, k) => {
            const t = input.value.trim();
            const v = t.length === 1 ? t.charCodeAt(0) : t.length === 3 && t[0] === "'" ? t.charCodeAt(1) : Number(Bits.parse(t) ?? -1n);
            return v === bytes[k] ? null : k + 1;
          }).filter(Boolean);
          if (wrong.length) {
            status.no(`Not yet: ${st.protocol === 'uart' ? 'frame' : 'byte'} ${wrong.join(' and ')} ${wrong.length > 1 ? 'are' : 'is'} wrong.`
              + (st.protocol === 'uart' ? ' Remember: the first data bit after the start bit is D0.' : ''));
          } else { status.ok('Right! The values are now shown in the diagram.'); hidden = false; build(); }
        }, true), kit.button('Show the answer', () => { hidden = false; build(); status.info('The values are shown above the diagram.'); }));
        add(root, decodeBox, status.el);
      }
    },
    exercise(c) {
      if (c.goal !== 'decode') throw new Error('the goal of a frame is decode');
      const s = frameSettings(c);
      if (!s.decoded.length) throw new Error('there is nothing to decode');
      return {answer: [{text: s.decoded.map((v, k) => decodedText(s, k, v)).join(', ') + '.'}]};
    },
    print(c, {blank}) {
      const encoder = Protocols[c.protocol];
      if (!encoder) throw new Error(`unknown protocol "${c.protocol}" (${Object.keys(Protocols).join(', ')})`);
      if (c.ring && c.protocol !== 'spi') throw new Error('ring: true is for protocol: spi');
      const spec = encoder(frameSettings(c), blank);
      const legend = (spec.legend || []).map(([color, label]) => `${color.includes('accent') ? 'green' : 'orange'}: ${label}`).join('; ');
      return Object.assign(picture(waveBlocks(spec)), {caption: [spec.caption, legend ? legend + '.' : ''].filter(Boolean).join(' ')});
    },
  });

  // The SPI ring (frame, protocol: spi, ring: true): the controller's and the target's shift registers
  // form one ring, and every clock moves it one place. Bits keep the colour of the side they started on.
  // onClock() is called after every clock (the frame marks the bit on the waveform).
  function spiRing(kit, onClock) {
    let wb = 8, msb = true, unit = 'byte', mosi = [], miso = [], words = 0;
    let bits, origin, clocks = 0, busy = false, speed = 600, stage = null, gen = 0;
    const holder = h('div', {class: 'cw-scroll'});
    const values = h('div', {class: 'cw-explain'});
    const clockBtn = kit.button('Clock 1 bit', () => run(1));
    const wordBtn = kit.button('', () => run(wb - (clocks % wb)), true);
    const resetBtn = kit.button('Start again', () => { reset(); onClock(); });

    // the controller's software has written the word to send; the target has its answer ready
    function loadWord(k) {
      bits = toSlots((BigInt(mosi[k] ?? 0) << BigInt(wb)) | BigInt(miso[k] ?? 0), 2 * wb);
      origin = bits.map((_, s) => (s < wb ? 0 : 1));
    }
    function wires(svg) {
      const {size, pitch, top} = stage;
      const xl = stage.x(0) + size / 2, xr = stage.x(2 * wb - 1) + size / 2, y = 16, ye = top - 19;   // ye: above the bit numbers
      const xa = msb ? xr : xl, mid = stage.x(wb) - (pitch - size) / 2;
      svg.append(sv('path', {d: `M${msb ? xl : xr} ${ye} V${y} H${xa} V${ye}`, class: 'cw-sh-wire'}),
        sv('path', {d: `M${xa - 4} ${ye - 7} L${xa} ${ye} L${xa + 4} ${ye - 7}`, class: 'cw-sh-wire'}),
        sv('text', {x: (xl + xr) / 2, y: y - 4, class: 'cw-sh-wire-label', text: msb ? 'MOSI: the controller’s MSB goes to the target’s LSB' : 'MISO: the target’s LSB goes to the controller’s MSB'}),
        sv('line', {x1: mid, x2: mid, y1: top, y2: top + 44, class: 'cw-sh-wire', 'stroke-dasharray': '3 3'}),
        sv('text', {x: mid, y: top + 58, class: 'cw-sh-wire-label', text: msb ? '← MISO' : 'MOSI →'}));
    }
    function show() {
      stage.render(bits, origin.map(o => 'g' + o));
      const all = fromSlots(bits), digits = Math.ceil(wb / 4);
      const ctl = hx(all >> BigInt(wb), digits), tgt = hx(all & Bits.mask(wb), digits);
      values.replaceChildren(h('div', {}, h('b', {text: 'controller '}), ctl, '   ', h('b', {text: 'target '}), tgt, `   clock ${clocks} of ${words * wb}`));
      if (clocks && clocks % wb === 0) values.append(h('div', {class: 'cw-note', text: `${unit[0].toUpperCase() + unit.slice(1)} ${clocks / wb} exchanged: the controller received ${ctl}, the target ${tgt}.`}));
      const end = clocks >= words * wb;
      clockBtn.disabled = wordBtn.disabled = busy || end;
      resetBtn.disabled = busy;
      wordBtn.textContent = clocks % wb ? `Finish the ${unit}` : `Clock ${wb} bits`;
    }
    function reset() { clocks = 0; loadWord(0); show(); }
    async function run(n) {
      if (busy) return;
      const g = gen;
      busy = true;
      for (let k = 0; k < n && clocks < words * wb; k++) {
        if (clocks && clocks % wb === 0) loadWord(clocks / wb);   // the next word
        show();
        const r = await stage.step(bits, {dir: msb ? -1 : 1, out: 'arc'}, speed);
        if (g !== gen) return;   // the frame was rebuilt meanwhile
        bits = r.bits; clocks++;
        origin = msb ? origin.slice(1).concat(origin.slice(0, 1)) : origin.slice(-1).concat(origin.slice(0, -1));
        onClock();
      }
      busy = false;
      show();
    }
    return {
      el: h('div', {class: 'cw'}, h('div', {class: 'cw-eyebrow', text: 'Inside: two shift registers in a ring'}), holder, values,
        h('div', {class: 'cw-row'}, clockBtn, wordBtn, resetBtn, speedControl(kit, () => speed, s => { speed = s; }))),
      clocks: () => clocks,
      load(s) {
        gen++; busy = false;
        wb = int(s.word_bits ?? 8); msb = (s.bit_order ?? 'msb') === 'msb'; unit = wb === 8 ? 'byte' : 'word';
        mosi = s.mosiBytes; miso = s.misoBytes || [];
        words = Math.max(mosi.length, miso.length);
        stage = shiftStage(2 * wb, {boxes: false, top: 60, arcTop: 24, index: x => wb - 1 - (x % wb)});
        const svg = sv('svg', {class: 'cw-sh-svg', width: stage.W, height: stage.top + 70});
        const group = (text, s0, colour) => h('span', {class: 'cw-sh-group', style: `left: ${stage.x(s0)}px; width: ${wb * stage.pitch - 4}px; top: ${stage.top + 40}px; color: var(${colour})`, text});
        stage.el.prepend(svg);
        stage.el.append(group('controller', 0, '--cw-accent'), group('target', wb, '--cw-warm'));
        stage.el.style.height = `${stage.top + 70}px`;
        wires(svg);
        holder.replaceChildren(stage.el);
        reset();
      },
    };
  }

  // ========================================================================
  // type: packet (fields → bytes → wire, optionally sent with a protocol)
  // ========================================================================
  function packetFields(c) {
    const fields = listOf(c.fields).map((f, k) => {
      if (!f || typeof f !== 'object' || f.name == null) throw new Error(`field ${k + 1} needs a name, bits and a value`);
      const bits = int(f.bits);
      if (bits < 1 || bits > 64) throw new Error(`field ${f.name}: bits must be 1 … 64`);
      const raw = Bits.big(f.value ?? 0);
      if (!fits(raw, bits)) throw new Error(`field ${f.name}: ${Bits.minus(raw)} does not fit in ${bits} bits`);
      return {name: String(f.name), bits, signed: !!f.signed, raw, value: Bits.u(raw, bits), color: k % 6};
    });
    if (!fields.length) throw new Error('a packet needs fields');
    return fields;
  }
  // Pack the fields into bytes: [{bits: [{v, f, fbit}] by bit position, value}]. Whole-byte fields that
  // start on a byte boundary use the byte order. Other fields are packed from the top bit of the byte
  // down (pack: msb), or from bit 0 up (pack: lsb, like C bit-fields on little-endian processors such as ARM).
  function packFields(fields, st) {
    const up = st.pack === 'lsb';
    const out = [];
    let cur = null, pos = 0;
    const push = (v, f, fbit) => {
      if (!cur) { cur = []; out.push(cur); pos = up ? 0 : 7; }
      cur[pos] = {v, f, fbit};
      pos += up ? 1 : -1;
      if (pos < 0 || pos > 7) cur = null;
    };
    // the bits of a value in packing order: bit b of a byte lands on bit b
    const order = n => (up ? [...Array(n).keys()] : [...Array(n).keys()].reverse());
    for (const f of fields) {
      if (f.bits % 8 === 0 && cur === null) {
        const bytes = [...Array(f.bits / 8).keys()];   // byte k = bits 8k+7 … 8k
        if (st.byte_order === 'big') bytes.reverse();
        for (const k of bytes) for (const b of order(8)) push(Bits.bit(f.value, 8 * k + b), f, 8 * k + b);
      } else for (const b of order(f.bits)) push(Bits.bit(f.value, b), f, b);
    }
    while (cur) push(0, null, null);
    return out.map(bits => ({bits, value: bits.reduce((acc, x, i) => acc | (x.v << i), 0)}));
  }
  function packetSettings(c) {
    const st = Object.assign({}, c);
    oneOf(st.pack, ['msb', 'lsb'], 'pack');
    oneOf(st.byte_order, ['big', 'little'], 'byte_order');
    oneOf(st.bit_order, ['msb', 'lsb'], 'bit_order');
    oneOf(st.send, ['none', 'uart', 'spi'], 'send');
    if (int(st.mode) < 0 || int(st.mode) > 3) throw new Error('SPI mode is 0, 1, 2 or 3');
    return st;
  }
  // The waveform of a packet sent with a protocol, with a band that names the field of every bit.
  function packetWave(st, bytes) {
    const values = bytes.map(b => b.value);
    const spec = st.send === 'uart'
      ? Protocols.uart({bytes: values, bit_order: st.bit_order, parity: 'none', stop_bits: 1, baud: 115200}, false)
      : Protocols.spi({mosiBytes: values, misoBytes: null, bit_order: st.bit_order, mode: int(st.mode)}, false);
    const segs = (spec.bitTimes || []).map(bt => {
      const x = bytes[bt.byte].bits[bt.pos];
      return {t0: bt.t0, t1: bt.t1, color: x.f ? x.f.color : null, text: x.f ? x.f.name.slice(0, 4) : '', tip: x.f ? `${x.f.name}[${x.fbit}]` : 'padding'};
    });
    spec.lanes.push({name: 'field', kind: 'band', segs});
    return spec;
  }
  function packetNote(fields, st) {
    const multi = fields.filter(f => f.bits > 8 && f.bits % 8 === 0);
    const small = fields.filter(f => f.bits % 8 !== 0);
    return [
      multi.length ? `${st.byte_order === 'little' ? 'Little-endian: the least significant byte' : 'Big-endian: the most significant byte'} of ${multi.map(f => f.name).join(' and ')} comes first.` : '',
      small.length ? `Fields smaller than a byte are packed ${st.pack === 'lsb' ? 'from bit 0 up: the first one gets the lowest bits (as C bit-fields do on little-endian processors such as ARM)' : 'from bit 7 down: the first one gets the highest bits'}.` : '',
      st.bit_order === 'lsb' ? 'Each byte is sent least significant bit first (as UART does).' : 'Each byte is sent most significant bit first (as SPI and I²C usually do).',
    ].filter(Boolean).join(' ');
  }

  Widget.define('packet', {
    keys: ['fields', 'byte_order', 'bit_order', 'pack', 'send', 'mode'],
    controls: ['byte_order', 'bit_order', 'pack', 'send', 'mode'],
    defaults: {byte_order: 'big', bit_order: 'msb', pack: 'msb', send: 'none', mode: 0, controls: ['byte_order', 'bit_order']},
    goalHint: 'packets are for exploring',
    render(root, c, kit) {
      const st = packetSettings(c);
      const fields = packetFields(c);
      const top = h('div', {class: 'cw-controls'});
      const CONTROLS = {
        byte_order: () => kit.control('Byte order (multi-byte fields)', kit.segmented([{value: 'big', label: 'big-endian'}, {value: 'little', label: 'little-endian'}], st.byte_order, x => { st.byte_order = x; build(); })),
        bit_order: () => kit.control('Bit order on the wire', kit.segmented([{value: 'msb', label: 'MSB first'}, {value: 'lsb', label: 'LSB first'}], st.bit_order, x => { st.bit_order = x; build(); })),
        send: () => kit.control('Send with', kit.segmented([{value: 'none', label: '—'}, {value: 'uart', label: 'UART'}, {value: 'spi', label: 'SPI'}], st.send, x => { st.send = x; build(); })),
        pack: () => kit.control('Small fields packed', kit.segmented([{value: 'msb', label: 'from bit 7 down'}, {value: 'lsb', label: 'from bit 0 up'}], st.pack, x => { st.pack = x; build(); })),
        mode: () => kit.control('SPI mode', kit.select([0, 1, 2, 3].map(x => ({value: x, label: `${x}: CPOL ${x >> 1}, CPHA ${x & 1}`})), int(st.mode), x => { st.mode = x; build(); })),
      };
      for (const key of listOf(c.controls)) {
        if (!CONTROLS[key]) throw new Error(`unknown control "${key}" (${Object.keys(CONTROLS).join(', ')})`);
        top.append(CONTROLS[key]());
      }
      const table = h('table', {class: 'cw-table'});
      const mem = h('div', {class: 'cw-mem'});
      const wire = h('div', {class: 'cw-wire'});
      const wave = h('div', {class: 'cw-wave'});
      const waveNote = h('div', {class: 'cw-caption'});
      const note = h('div', {class: 'cw-caption'});
      add(root, top, h('div', {class: 'cw-scroll'}, table), h('div', {class: 'cw-eyebrow', text: 'In memory, lowest address first'}), mem,
        h('div', {class: 'cw-eyebrow', text: 'On the wire, first bit on the left'}), wire, wave, waveNote, note);

      function build() {
        const bytes = packFields(fields, st);
        table.replaceChildren(h('tr', {}, h('th', {text: 'Field'}), h('th', {text: 'Bits'}), h('th', {text: 'Value'}), h('th', {text: 'Hex'}), h('th', {text: 'In bytes'})));
        for (const f of fields) {
          const where = bytes.map((b, k) => (b.bits.some(x => x.f === f) ? k : null)).filter(k => k !== null);
          table.append(h('tr', {}, h('td', {}, h('span', {class: `cw-sw cw-f${f.color}`}), f.name), h('td', {class: 'cw-mono', text: String(f.bits)}),
            h('td', {class: 'cw-mono', text: Bits.minus((f.signed ? Bits.s(f.value, f.bits) : f.value).toString())}),
            h('td', {class: 'cw-mono', text: Bits.hex(f.value, f.bits)}), h('td', {class: 'cw-mono', text: where.map(k => '+' + k).join(', ')})));
        }
        mem.replaceChildren(...bytes.map((b, k) => h('div', {class: 'cw-byte', title: b.bits.slice().reverse().map((x, j) => `bit ${7 - j}: ${x.f ? `${x.f.name}[${x.fbit}]` : 'padding'}`).join('\n')},
          h('span', {class: 'off', text: `+${k}`}), h('span', {class: 'hx', text: hx(b.value)}),
          h('span', {class: 'strip'}, b.bits.slice().reverse().map(x => h('span', {class: x.f ? `cw-f${x.f.color}` : 'fx', text: String(x.v)}))))));
        const wireBits = [];
        bytes.forEach((b, k) => {
          const order = st.bit_order === 'msb' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
          if (k) wireBits.push(h('span', {class: 'gap'}));
          for (const i of order) {
            const x = b.bits[i];
            wireBits.push(h('span', {class: x.f ? `cw-f${x.f.color}` : 'fx', title: `byte +${k}, bit ${i}: ${x.f ? `${x.f.name}[${x.fbit}]` : 'padding'}`, text: String(x.v)}));
          }
        });
        wire.replaceChildren(...wireBits);
        note.textContent = packetNote(fields, st);
        wave.hidden = waveNote.hidden = st.send === 'none';
        if (st.send !== 'none') {
          const spec = packetWave(st, bytes);
          waveNote.textContent = st.send === 'spi' ? spec.caption : '';
          wave.replaceChildren(Wave.render(spec, 1));
        }
      }
      build();
    },
    print(c) {
      const st = packetSettings(c), fields = packetFields(c);
      const bytes = packFields(fields, st);
      const n = bytes.length * 8;
      const color = x => (x.f ? {fill: INK.field[x.f.color]} : {fill: INK.grid, color: INK.muted});
      const byteGap = j => (j % 8 === 7 ? 12 : false);
      const width = Math.max(...fields.map(f => f.name.length), 5);
      const table = drawText([`${'field'.padEnd(width)}  bits  value   hex           in bytes`,
        ...fields.map(f => {
          const where = bytes.map((b, k) => (b.bits.some(x => x.f === f) ? '+' + k : null)).filter(Boolean).join(', ');
          return `${f.name.padEnd(width)}  ${String(f.bits).padStart(4)}  ${Bits.minus((f.signed ? Bits.s(f.value, f.bits) : f.value).toString()).padEnd(6)}  ${Bits.hex(f.value, f.bits).padEnd(12)}  ${where}`;
        })], {size: 11});
      const memory = drawRows([
        {kind: 'small', cells: bytes.map((b, k) => ({text: `+${k}`, span: 8}))},
        {kind: 'small', cells: bytes.map(b => ({text: hx(b.value), span: 8, color: INK.fg, bold: true}))},
        {cells: bytes.flatMap(b => [7, 6, 5, 4, 3, 2, 1, 0].map(i => Object.assign({text: String(b.bits[i].v)}, color(b.bits[i]))))},
      ], n, {gapAfter: byteGap, cell: 18});
      const order = st.bit_order === 'msb' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
      const wire = drawRows([{cells: bytes.flatMap(b => order.map(i => Object.assign({text: String(b.bits[i].v)}, color(b.bits[i]))))}], n, {gapAfter: byteGap, cell: 18});
      const blocks = [table, 8, drawText('In memory, lowest address first', {size: 10, color: INK.muted}), memory, 6,
        drawText('On the wire, first bit on the left', {size: 10, color: INK.muted}), wire];
      let caption = packetNote(fields, st);
      if (st.send !== 'none') {
        const spec = packetWave(st, bytes);
        blocks.push(8, ...waveBlocks(spec));
        if (st.send === 'spi') caption += ' ' + spec.caption;
      }
      return Object.assign(picture(blocks), {caption});
    },
  });

  // ========================================================================
  // Start: build the widgets of the page (browser); the build uses `print`.
  // ========================================================================
  root.CourseWidgets = {
    Widget, Bits, Protocols, CLang, print: config => Widget.print(config),
    // for the tests (tests/widgets.js)
    internals: {addSub, numberTarget, numberGoalMet, arithmeticGoal, arithmeticGoalMet, conventionOf, registerFields, registerTarget,
      registerGoalMet, settable, checkCode, modelCode, codeGoal, packFields, packetFields, frameSettings, toSlots, fromSlots, shiftOnce, SHIFTS},
  };
  // editable: true: the widget's YAML under it, to change and apply (a playground, or a gallery for authors).
  // The YAML reader (js-yaml) is loaded from a CDN when it is first needed.
  const JS_YAML = 'https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js';
  let yamlReader = null;
  function readYaml() {
    yamlReader ||= new Promise((resolve, reject) => {
      const script = h('script', {src: JS_YAML});
      script.onload = () => {
        const y = root.jsyaml, int = y.types.int;
        // integers beyond 2^53 stay exact as text, which the widgets read as numbers (as the build does)
        const exactInt = new y.Type('tag:yaml.org,2002:int', {kind: 'scalar', resolve: int.resolve,
          construct: data => { const n = int.construct(data); return Number.isSafeInteger(n) ? n : data.replace(/_/g, ''); },
          predicate: int.predicate, represent: int.represent, defaultStyle: int.defaultStyle});
        const schema = new y.Schema({implicit: [y.types.null, y.types.bool, exactInt, y.types.float],
          explicit: [y.types.str, y.types.seq, y.types.map]});
        resolve(text => y.load(text, {schema}));
      };
      script.onerror = () => { yamlReader = null; reject(new Error('The YAML reader could not be loaded. Is there an internet connection?')); };
      document.head.append(script);
    });
    return yamlReader;
  }
  function editor(el, host, original) {
    const area = h('textarea', {class: 'cw-editor', spellcheck: 'false', 'aria-label': 'Configuration of the widget (YAML)'});
    area.value = original;
    area.rows = Math.min(24, original.split('\n').length + 1);
    const error = h('div', {class: 'cw-error', 'aria-live': 'polite'});
    const apply = async () => {
      try { Widget.mount(host, (await readYaml())(area.value)); error.textContent = ''; }
      catch (e) { error.textContent = e.message; }
    };
    const reset = () => { area.value = original; Widget.mount(host, JSON.parse(el.getAttribute('data-config'))); error.textContent = ''; };
    area.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); } });
    return h('details', {class: 'cw-source'}, h('summary', {text: 'Configuration (YAML): edit and apply'}), area,
      h('div', {class: 'cw-row'}, Kit.button('Apply', apply, true), Kit.button('Reset', reset),
        h('span', {class: 'cw-note', text: 'Ctrl+Enter also applies.'})), error);
  }

  if (hasDom) {
    const mountAll = () => document.querySelectorAll('.course-widget[data-config]').forEach(el => {
      const host = h('div', {class: 'cw-host'});
      el.replaceChildren(host);
      try { Widget.mount(host, JSON.parse(el.getAttribute('data-config'))); }
      catch (e) { host.replaceChildren(h('div', {class: 'cw-error', text: `This widget cannot be shown: ${e.message}`})); }
      if (el.hasAttribute('data-yaml')) el.append(editor(el, host, el.getAttribute('data-yaml')));
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
    else mountAll();
  }
})(globalThis);
