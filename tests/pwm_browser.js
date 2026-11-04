// The PWM widgets in a browser, run by scripts/check.py after the build:
//
//     quarto run tests/pwm_browser.js CHROME PAGE [SHOTS]
//
// CHROME is Chrome Headless Shell (from `course setup`), PAGE the built page:
// lessons/week_02/lesson6.html of the test course, or references/pwm.html of the
// course template (`course preview`), which has the same first eleven widgets. The
// page is driven over the DevTools protocol: the challenges are worked as a student
// works them (typing, buttons), levels are dragged with real mouse and touch events,
// and the status, the picture and the LEDs are read back. Errors in the page's
// scripts fail the test. With SHOTS (a folder), screenshots go there.
const [chrome, page, shots] = Deno.args;

let passed = 0;
const failed = [];
function ok(condition, what, detail = '') {
  if (condition) passed++;
  else failed.push(`${what}${detail ? `: ${detail}` : ''}`);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const profile = await Deno.makeTempDir({prefix: 'course-chrome-'});
const proc = new Deno.Command(chrome, {
  args: ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--window-size=1100,900', 'about:blank'],
  stdout: 'null', stderr: 'piped',
}).spawn();

// Chrome says where it listens on stderr: DevTools listening on ws://127.0.0.1:PORT/devtools/browser/...
async function browserUrl() {
  const reader = proc.stderr.pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const {value, done} = await reader.read();
    if (done) break;
    text += value;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(text);
    if (m) { reader.releaseLock(); proc.stderr.cancel().catch(() => {}); return m[1]; }
  }
  throw new Error(`Chrome did not start: ${text.trim().split('\n').slice(-3).join(' ')}`);
}

// One DevTools session on one page.
async function open(url) {
  const port = new URL(await browserUrl()).port;
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURI(url)}`, {method: 'PUT'})).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const waiting = new Map(), errors = [];
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise(resolve => { const k = ++id; waiting.set(k, resolve); ws.send(JSON.stringify({id: k, method, params})); });
  await send('Runtime.enable');
  await send('Page.enable');
  // run statements in the page (they may await, and return a value)
  const js = async code => {
    const r = await send('Runtime.evaluate', {expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true});
    if (r.result?.exceptionDetails) throw new Error(`${code.slice(0, 70)}: ${r.result.exceptionDetails.exception?.description || 'evaluation failed'}`);
    return r.result?.result?.value;
  };
  return {js, send, errors, close: () => ws.close()};
}

// Helpers in the page, again after a reload: a widget by its name, typing in a box, pressing a button, reading back.
const HELPERS = `
  const names = ['explorer', 'lesson', 'ch10k', 'ch10klive', 'ch100', 'ch1k', 'chbright', 'decode1', 'decode2', 'flicker', 'margin'];
  window.T = {
    names,
    w: name => document.querySelectorAll('.course-widget')[names.indexOf(name)],
    show: async name => { T.w(name).querySelector('.cw-wave').scrollIntoView({block: 'center', behavior: 'instant'}); await new Promise(r => setTimeout(r, 300)); },
    box(name, label) {
      const l = [...T.w(name).querySelectorAll('label')].find(x => x.textContent.trim() === label);
      return l.htmlFor ? document.getElementById(l.htmlFor) : l.querySelector('input');
    },
    type(name, label, value) { const input = T.box(name, label); input.value = value; input.dispatchEvent(new Event('input', {bubbles: true})); },
    press(name, text) { [...T.w(name).querySelectorAll('button')].find(b => b.textContent.trim() === text).click(); },
    status: name => T.w(name).querySelector('.cw-status').textContent,
    text: (name, sel) => T.w(name).querySelector(sel)?.textContent || '',
    labels: (name, sel = 'text') => [...T.w(name).querySelectorAll('svg.cw-pwm-plot ' + sel)].map(t => t.textContent),
    rect(el) { const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; },
    b: (name, k) => Number(T.w(name).querySelectorAll('.cw-led')[k].style.getPropertyValue('--b')),
    x: name => Number(T.w(name).querySelector('.cw-pwm-nowline').getAttribute('x1')),
  };`;

let session = null;
try {
  const path = (await Deno.realPath(page)).replace(/\\/g, '/');
  session = await open(new URL(`file://${path.startsWith('/') ? '' : '/'}${path}`).href);
  const {js, send} = session;
  const metrics = (width, height = 900, mobile = false) => send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile});
  const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', {type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1});
  await metrics(1100);
  for (let k = 0; k < 100 && (await js(`return document.querySelectorAll('svg.cw-pwm-plot').length`)) < 11; k++) await sleep(100);
  await sleep(300);
  await js(HELPERS);

  ok(await js(`return T.names.every(n => T.w(n).querySelector('svg.cw-pwm-plot') && ![...T.w(n).querySelectorAll('.cw-error')].some(e => e.textContent))`), 'eleven widgets with a picture, and no mistakes');

  // every line of the picture has its label; the settings are apart from the result
  const labels = await js(`return T.labels('explorer')`);
  for (const want of ['wrap = 3', 'level A = 1', 'level B = 3', 'output A', 'output B', 'counter']) ok(labels.includes(want), `the label "${want}"`, labels.slice(0, 12).join(' | '));
  const heads = await js(`return T.labels('explorer', '.cw-pwm-section')`);
  ok(heads.length === 2 && /^SETTINGS/.test(heads[0]) && /^RESULT/.test(heads[1]), 'the two sections are named', heads.join(' | '));
  const y = await js(`const at = t => Number([...T.w('explorer').querySelectorAll('svg.cw-pwm-plot text')].find(x => x.textContent === t).getAttribute('y'));
    return [at('level A = 1'), Number(T.w('explorer').querySelector('.cw-pwm-divider').getAttribute('y1')), at('output A')]`);
  ok(y[0] < y[1] && y[1] < y[2], 'the levels above the line, the outputs below it', y.join(' '));

  // dragging a level with the mouse: on its line, and on its handle
  await js(`await T.show('explorer')`);
  ok(await js(`return T.w('explorer').querySelectorAll('.cw-pwm-handle').length`) === 2, 'a handle on each level');
  const grab = await js(`const r = T.rect(T.w('explorer').querySelector('.cw-pwm-grab[data-ch="A"]')); return {...r, hit: document.elementFromPoint(r.x, r.y).getAttribute('class')}`);
  ok(/cw-pwm-grab/.test(grab.hit || ''), 'a level line can be hit with the mouse', grab.hit);
  await mouse('mouseMoved', grab.x, grab.y);
  await mouse('mousePressed', grab.x, grab.y, 1);
  for (let k = 1; k <= 6; k++) { await mouse('mouseMoved', grab.x, grab.y - k * 8, 1); await sleep(15); }
  await mouse('mouseReleased', grab.x, grab.y - 48);
  await sleep(100);
  const dragged = Number(await js(`return T.box('explorer', 'Level A').value`));
  ok(dragged > 1, 'dragging a level line up raises the level', `level A = ${dragged}`);
  ok((await js(`return T.labels('explorer')`)).includes(`level A = ${dragged}`), 'the picture follows the drag');
  const handle = await js(`return T.rect(T.w('explorer').querySelector('.cw-pwm-handle[data-ch="B"]'))`);
  await mouse('mouseMoved', handle.x, handle.y);
  await mouse('mousePressed', handle.x, handle.y, 1);
  for (let k = 1; k <= 4; k++) { await mouse('mouseMoved', handle.x, handle.y + k * 8, 1); await sleep(15); }
  await mouse('mouseReleased', handle.x, handle.y + 32);
  await sleep(100);
  ok(Number(await js(`return T.box('explorer', 'Level B').value`)) < 3, 'dragging a handle down lowers the level', await js(`return T.box('explorer', 'Level B').value`));
  await js(`T.type('explorer', 'Level A', '1'); T.type('explorer', 'Level B', '3')`);
  const tip = await js(`const r = T.rect(T.w('explorer').querySelector('.cw-wv-hit')); return document.elementFromPoint(r.x, r.y).getAttribute('class')`);
  ok(/cw-wv-hit/.test(tip || ''), 'the outputs have their tooltips', tip);

  // the slider: the arrow keys move by one, and the level's range ends at wrap + 1
  await js(`T.w('explorer').querySelectorAll('.cw-range')[1].dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}))`);
  ok(await js(`return T.box('explorer', 'Level A').value`) === '2', 'an arrow key moves a level by one');
  await js(`T.type('explorer', 'Level A', '1')`);

  // slow motion: the playhead moves, the badge says by how much; a widget off the screen stands still
  const x0 = await js(`return T.x('explorer')`);
  await sleep(700);
  const x1 = await js(`return T.x('explorer')`);
  ok(x1 !== x0, 'the playhead moves', `${x0} → ${x1}`);
  ok(/SLOW MOTION · 50 000 000 × slower/.test(await js(`return T.text('explorer', '.cw-pwm-badge text')`)), 'the badge of figure 105', await js(`return T.text('explorer', '.cw-pwm-badge text')`));
  ok(/one tick \(8 ns\) takes 400 ms here/.test(await js(`return T.text('explorer', '.cw-pwm-play .cw-note')`)), 'the slow-motion note');
  await js(`T.press('explorer', 'slow')`);
  ok(/one tick \(8 ns\) takes 1 s here/.test(await js(`return T.text('explorer', '.cw-pwm-play .cw-note')`)), 'the speed buttons', await js(`return T.text('explorer', '.cw-pwm-play .cw-note')`));
  await js(`T.press('explorer', 'normal')`);
  const offscreen = await js(`const a = T.x('flicker'); await new Promise(r => setTimeout(r, 300)); return [a, T.x('flicker')]`);
  ok(offscreen[0] === offscreen[1], 'a widget off the screen stands still', offscreen.join(' → '));
  // Pause and Next tick: the counter moves by one, and the readout says what the channels do
  await js(`T.press('explorer', 'Pause')`);
  const before = await js(`return Number(T.text('explorer', '.cw-pwm-now b'))`);
  await js(`T.press('explorer', 'Next tick')`);
  ok(await js(`return Number(T.text('explorer', '.cw-pwm-now b'))`) === (before + 1) % 4, 'Next tick: the counter moves by one');
  ok(/A: \d < 1\? (yes, high|no, low)/.test(await js(`return T.text('explorer', '.cw-pwm-now')`)), 'the readout compares the counter with the level', await js(`return T.text('explorer', '.cw-pwm-now')`));
  await js(`T.press('explorer', 'Play')`);
  // the level's range follows the wrap, and so do the numbers
  await js(`T.type('explorer', 'Wrap', '9')`);
  ok(await js(`return T.w('explorer').querySelectorAll('.cw-range')[1].max`) === '10', 'the level slider ends at wrap + 1');
  ok(/Period: T = \(wrap \+ 1\) · Δt = \(9 \+ 1\) · 8 ns = 80 ns, so the frequency is 12\.5 MHz/.test(await js(`return T.text('explorer', '.cw-pwm-numbers')`)), 'the numbers follow the wrap', await js(`return T.text('explorer', '.cw-pwm-numbers')`));
  await js(`T.type('explorer', 'Wrap', '3')`);

  // a large wrap: Next change lands on the output's falling edge
  await js(`await T.show('lesson')`);
  await js(`T.press('lesson', 'Pause')`);
  const edge = await js(`const w = T.w('lesson'); for (let k = 0; k < 4; k++) { T.press('lesson', 'Next change'); if (Number(T.text('lesson', '.cw-pwm-now b')) === 13107) return true; } return T.text('lesson', '.cw-pwm-now')`);
  ok(edge === true, 'Next change: the counter stops where it reaches the level', edge);
  // the LED at real speed looks as bright as 20 % on looks; the LED in slow motion blinks
  await js(`T.press('lesson', 'Play')`);
  await sleep(100);
  ok(Math.abs(await js(`return T.b('lesson', 1)`) - 0.5168) < 0.01, 'the real-speed LED looks 52 % bright at 20 %', String(await js(`return T.b('lesson', 1)`)));

  // check: button; one tick is always given
  ok(/One tick: Δt = 1 \/ 125 MHz = 8 ns/.test(await js(`return T.text('ch10k', '.cw-pwm-given')`)), 'button: the length of a tick is given', await js(`return T.text('ch10k', '.cw-pwm-given')`));
  ok(/numbers appear when your answer is right/.test(await js(`return T.text('ch10k', '.cw-pwm-numbers')`)), 'button: the numbers are hidden');
  ok(/ticks$/.test(await js(`return [...T.w('ch10k').querySelectorAll('.cw-pwm-axis')].map(t => t.textContent).pop()`)), 'button: the time axis counts ticks');
  ok(/far slower/.test(await js(`return T.text('ch10k', '.cw-pwm-badge text')`)), 'button: the badge does not give the period away');
  await js(`T.type('ch10k', 'Wrap', '12500'); T.type('ch10k', 'Level A', '3125'); T.press('ch10k', 'Check')`);
  ok(await js(`return T.status('ch10k')`) === 'Not yet: the frequency is not 10 kHz. Close: wrap = 12500 gives wrap + 1 = 12501 ticks per period, because the counter also counts 0. 10 kHz needs 12500 ticks.', 'button: the hint for one tick too many', await js(`return T.status('ch10k')`));
  ok(await js(`return [...T.w('ch10k').querySelectorAll('button')].some(b => b.textContent === 'Show the answer' && !b.hidden)`), 'button: Show the answer after a wrong Check');
  await js(`T.type('ch10k', 'Wrap', '12499'); T.press('ch10k', 'Check')`);
  ok(await js(`return T.status('ch10k')`) === '✓ Right! wrap = 12499, level A = 3125: 10 kHz, a duty of 25 %.', 'button: right', await js(`return T.status('ch10k')`));
  ok(/Duty A: level \/ \(wrap \+ 1\) = 3125 \/ 12500 = 25 %/.test(await js(`return T.text('ch10k', '.cw-pwm-numbers')`)), 'button: the numbers appear');
  ok((await js(`return T.w('ch10k').textContent.match(/One tick/g).length`)) === 1, 'button: one tick is shown once');
  await js(`T.type('ch10k', 'Level A', '3000')`);
  ok(/Check again/.test(await js(`return T.status('ch10k')`)), 'button: a change after Right asks for a new Check');

  // check: live
  await js(`T.type('ch10klive', 'Wrap', '12499')`);
  ok(/^Not yet: the duty of channel A is 0 %\. The goal is 25 %\./.test(await js(`return T.status('ch10klive')`)), 'live: names the duty', await js(`return T.status('ch10klive')`));
  await js(`T.type('ch10klive', 'Level A', '3125')`);
  ok(/^✓ Right!/.test(await js(`return T.status('ch10klive')`)), 'live: right');

  // 100 %: the start is not right; Show the answer
  await js(`T.press('ch100', 'Check')`);
  ok(/The largest level is 65535/.test(await js(`return T.status('ch100')`)), '100 %: the hint at the start', await js(`return T.status('ch100')`));
  await js(`T.press('ch100', 'Show the answer')`);
  ok(/One answer: wrap = 65534, level A = 65535/.test(await js(`return T.status('ch100')`)), '100 %: Show the answer', await js(`return T.status('ch100')`));
  ok(await js(`return T.box('ch100', 'Wrap').value`) === '65534', '100 %: the controls show the answer');

  // the divider: the tick follows it; one tick too many is explained in numbers
  await js(`T.type('ch1k', 'Clock divider', '2.5'); T.type('ch1k', 'Wrap', '50000'); T.press('ch1k', 'Check')`);
  ok(/Δt = clkdiv \/ clock = 2\.5 \/ 125 MHz = 20 ns/.test(await js(`return T.text('ch1k', '.cw-pwm-given')`)), 'the divider: the tick follows it', await js(`return T.text('ch1k', '.cw-pwm-given')`));
  ok(/Close: wrap = 50000 gives wrap \+ 1 = 50001 ticks per period, because the counter also counts 0\. 1 kHz needs 50000 ticks\./.test(await js(`return T.status('ch1k')`)), 'the divider: one tick too many is explained', await js(`return T.status('ch1k')`));
  await js(`T.type('ch1k', 'Clock divider', '1.3')`);
  ok(/multiple of 1\/16/.test(await js(`return T.w('ch1k').textContent`)), 'the divider: a value that is not a multiple of 1/16 is marked');

  // brightness
  await js(`T.type('chbright', 'Level A', '32768'); T.press('chbright', 'Check')`);
  ok(/looks too bright\. An LED that is on 50 % of the time looks brighter than that: 76\.1 %/.test(await js(`return T.status('chbright')`)), 'brightness: the hint for 50 %', await js(`return T.status('chbright')`));
  await js(`T.type('chbright', 'Level A', '12075'); T.press('chbright', 'Check')`);
  ok(/^✓ Right!.*looks 50/.test(await js(`return T.status('chbright')`)), 'brightness: right', await js(`return T.status('chbright')`));
  ok(await js(`return [...T.w('chbright').querySelectorAll('.cw-led small')].some(s => s.textContent === 'goal')`), 'brightness: a goal LED');

  // decode
  ok(await js(`return T.w('decode1').querySelectorAll('.cw-pwm-stair').length`) === 0, 'decode: no counter before the answer');
  ok(!/wrap = 4|level A = 3/.test((await js(`return T.labels('decode1')`)).join('|')), 'decode: the picture does not give the answer away');
  ok(/One tick: Δt = 1 \/ 125 MHz = 8 ns/.test(await js(`return T.text('decode1', '.cw-pwm-given')`)), 'decode: the length of a tick is given');
  await js(`T.type('decode1', 'Wrap', '5'); T.type('decode1', 'Level A', '3'); T.press('decode1', 'Check')`);
  ok(/counter also counts 0/.test(await js(`return T.status('decode1')`)), 'decode: the hint for ticks', await js(`return T.status('decode1')`));
  await js(`T.type('decode1', 'Wrap', '4'); T.press('decode1', 'Check')`);
  ok(/^✓ Right! wrap = 4, level A = 3/.test(await js(`return T.status('decode1')`)), 'decode: right');
  ok(await js(`return T.w('decode1').querySelectorAll('.cw-pwm-stair').length`) === 1, 'decode: the counter after the answer');
  await js(`T.press('decode2', 'Check')`);
  ok(/Fill in the wrap/.test(await js(`return T.status('decode2')`)), 'decode: an empty box is asked for');

  // a slow PWM flickers at real speed (read at uneven moments: a screen shows it at 60 frames per second)
  await js(`await T.show('flicker')`);
  const fl = [];
  for (let k = 0; k < 24; k++) { fl.push(await js(`return T.b('flicker', 1)`)); await sleep(5 + (k * 7) % 19); }
  ok(Math.max(...fl) - Math.min(...fl) > 0.08, 'clkdiv 64: the real-speed LED flickers (a steady one has no spread at all)', JSON.stringify(fl));
  ok(/slow enough for your eye to see it flicker/.test(await js(`return T.w('flicker').textContent`)), 'clkdiv 64: the note says it flickers');
  await js(`T.type('flicker', 'Clock divider', '8')`);
  await sleep(100);
  const steady = [];
  for (let k = 0; k < 8; k++) { steady.push(await js(`return T.b('flicker', 1)`)); await sleep(9); }
  ok(Math.max(...steady) === Math.min(...steady), 'clkdiv 8 (238 Hz): the real-speed LED looks steady', JSON.stringify(steady));

  // a margin in Hz, as written in the YAML
  await js(`T.type('margin', 'Wrap', '12700'); T.press('margin', 'Check')`);
  ok(/^Not yet: the frequency is not 10 kHz ± 100 Hz\./.test(await js(`return T.status('margin')`)), 'margin: outside it', await js(`return T.status('margin')`));
  await js(`T.type('margin', 'Wrap', '12400'); T.press('margin', 'Check')`);
  ok(await js(`return T.status('margin')`) === '✓ Right! wrap = 12400: 10.08 kHz.', 'margin: inside it', await js(`return T.status('margin')`));

  // the YAML editor of `course preview` (the template's gallery page; its YAML reader comes from a CDN)
  const edited = await js(`const w = T.w('margin'), area = w.querySelector('textarea.cw-editor');
    if (!area) return 'no editor';
    const old = T.box('margin', 'Wrap');
    area.value = area.value.replace('10 kHz +/- 100 Hz', '20 kHz +/- 100 Hz');
    [...w.querySelectorAll('button')].find(b => b.textContent === 'Apply').click();
    for (let k = 0; k < 100 && T.box('margin', 'Wrap') === old; k++) {
      const message = w.querySelector('.cw-source .cw-error').textContent;
      if (message) return message;
      await new Promise(r => setTimeout(r, 100));
    }
    T.type('margin', 'Wrap', '6249'); T.press('margin', 'Check');
    return T.status('margin');`);
  if (edited === 'no editor') ok(!page.endsWith('references/pwm.html'), 'the gallery has its YAML editors');
  else if (/could not be loaded/.test(edited)) console.log(`skipped: the YAML editor (${edited})`);
  else {
    ok(edited === '✓ Right! wrap = 6249: 20 kHz.', 'the YAML editor: a margin with +/- through Apply', edited);
    await js(`const w = T.w('margin'); const old = T.box('margin', 'Wrap'); [...w.querySelectorAll('button')].find(b => b.textContent === 'Reset').click()`);
    await sleep(100);
    ok(await js(`return T.box('margin', 'Wrap').value`) === '65535', 'the YAML editor: Reset brings back the original');
  }

  // dragging by touch, on a phone
  await metrics(400, 900, true);
  await send('Emulation.setTouchEmulationEnabled', {enabled: true});
  await sleep(500);
  await js(`await T.show('explorer')`);
  const level0 = Number(await js(`return T.box('explorer', 'Level A').value`));
  const touch = await js(`const r = T.rect(T.w('explorer').querySelector('.cw-pwm-handle[data-ch="A"]')); return {...r, hit: !!document.elementFromPoint(r.x, r.y)?.closest('.cw-pwm-handle')}`);
  ok(touch.hit, 'at phone width, the handle of a level can be reached', JSON.stringify(touch));
  await send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: touch.x, y: touch.y}]});
  for (let k = 1; k <= 5; k++) { await send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: touch.x, y: touch.y - k * 8}]}); await sleep(30); }
  await send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await sleep(100);
  const level1 = Number(await js(`return T.box('explorer', 'Level A').value`));
  ok(level1 > level0, 'dragging a handle by touch raises the level', `${level0} → ${level1}`);
  await send('Emulation.setTouchEmulationEnabled', {enabled: false});

  // at phone width: nothing wider than the page; the times on an axis do not touch
  for (const [name, width] of [['small phone', 340], ['phone', 400], ['desktop', 1100]]) {
    await metrics(width, 900, width < 500);
    await sleep(500);
    const W = await js(`return Math.max(...T.names.map(n => T.w(n).getBoundingClientRect().right))`);
    ok(W <= width, `${name}: the widgets fit the page`, `${W} > ${width}`);
    const wide = await js(`return T.names.filter(n => { const v = T.w(n).querySelector('.cw-wave'); return v.scrollWidth > v.clientWidth; })`);
    ok(wide.length === 0, `${name}: the pictures fit their boxes`, wide.join(' '));
    const touching = await js(`return [...document.querySelectorAll('svg.cw-pwm-plot')].flatMap(svg => { const r = [...svg.querySelectorAll('text.cw-pwm-axis.start, text.cw-pwm-axis.middle, text.cw-pwm-axis.end')].map(t => t.getBoundingClientRect()); return r.slice(1).filter((b, k) => b.left < r[k].right + 2); }).length`);
    ok(touching === 0, `${name}: the times on the axes do not touch`, String(touching));
    if (shots) {
      const H = await js(`window.scrollTo(0, 0); return document.documentElement.scrollHeight`);
      await metrics(width, Math.min(H, 16000), width < 500);
      await sleep(800);
      const part = width < 500 ? 2400 : 1600;
      for (let top = 0, k = 0; top < H; top += part, k++) {
        const shot = await send('Page.captureScreenshot', {format: 'png', clip: {x: 0, y: top, width, height: Math.min(part, H - top), scale: 1}});
        await Deno.writeFile(`${shots}/${name.replace(' ', '-')}-${k}.png`, Uint8Array.from(atob(shot.result.data), ch => ch.charCodeAt(0)));
      }
    }
  }
  await metrics(1100);
  ok(!session.errors.length, 'no script errors in the page', session.errors.join('\n'));

  // reduced motion: nothing moves until asked; the LEDs show the average
  await send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
  await send('Page.reload');
  await sleep(1500);
  await js(HELPERS);
  await js(`await T.show('flicker')`);
  ok(await js(`return [...T.w('flicker').querySelectorAll('button')].some(b => b.textContent === 'Play')`), 'reduced motion: the widget starts paused');
  const still = await js(`const a = T.x('flicker'), b = T.b('flicker', 1); await new Promise(r => setTimeout(r, 400)); return [a, T.x('flicker'), b, T.b('flicker', 1)]`);
  ok(still[0] === still[1] && still[2] === still[3], 'reduced motion: no playhead and no flicker', still.join(' '));
  await js(`T.press('flicker', 'Play'); await new Promise(r => setTimeout(r, 300))`);
  ok(await js(`return T.x('flicker')`) !== still[0], 'reduced motion: Play still plays');
  ok(!session.errors.length, 'no script errors in the page', session.errors.join('\n'));
} catch (e) {
  failed.push(`the browser test could not run: ${e.message}`);
} finally {
  session?.close();
  try { proc.kill(); } catch { /* already gone */ }
  await proc.status;
  await Deno.remove(profile, {recursive: true}).catch(() => {});
}

console.log(failed.length ? `FAILED:\n  ${failed.join('\n  ')}` : '');
console.log(`${passed} ok, ${failed.length} failed`);
if (failed.length) Deno.exit(1);
