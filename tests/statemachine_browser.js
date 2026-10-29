// The state machines of the test course in a browser, run by scripts/check.py
// after the build:
//
//     quarto run tests/statemachine_browser.js CHROME PAGE
//
// CHROME is Chrome Headless Shell (from `course setup`), PAGE the built
// lessons/week_02/lesson4.html. The page is driven over the DevTools protocol:
// buttons are clicked as a student clicks them, and the states, outputs, text
// and log are read back. Errors in the page's scripts fail the test.
const [chrome, page] = Deno.args;

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
    '--window-size=1100,2000', 'about:blank'],
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
  const send = (method, params = {}) => new Promise(resolve => { waiting.set(++id, resolve); ws.send(JSON.stringify({id, method, params})); });
  await send('Runtime.enable');
  // evaluate an expression in the page (it may await)
  const js = async expr => {
    const r = await send('Runtime.evaluate', {expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true});
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluation failed');
    return r.result?.result?.value;
  };
  return {js, errors, close: () => ws.close()};
}

let session = null;
try {
  const path = (await Deno.realPath(page)).replace(/\\/g, '/');
  session = await open(new URL(`file://${path.startsWith('/') ? '' : '/'}${path}`).href);
  const {js} = session;
  for (let k = 0; k < 100 && !(await js(`document.querySelectorAll('.course-statemachine .sm-svg').length`)); k++) await sleep(100);

  // helpers in the page: the n-th block, a click on a button by its text, the state of a machine
  await js(`(window.T = {
    block: n => document.querySelectorAll('.course-statemachine')[n],
    // a click, then two frames: the page paints in requestAnimationFrame
    click: async (n, text) => {
      const b = [...T.block(n).querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text));
      b.click();
      for (let k = 0; k < 2; k++) await new Promise(resolve => requestAnimationFrame(resolve));
      return true;
    },
    state: (n, k = 0) => T.block(n).querySelectorAll('.sm-svg')[k].querySelector('.sm-state.on .name')?.textContent,
    pill: (n, k) => T.block(n).querySelectorAll('.sm-pill')[k]?.textContent,
    led: (n, name) => [...T.block(n).querySelectorAll('.sm-led')].find(l => l.textContent === name)?.classList.contains('on'),
    text: n => T.block(n).querySelector('.sm-terminal, .sm-display')?.textContent,
    log: n => T.block(n).querySelector('.sm-log')?.textContent,
    status: n => T.block(n).querySelector('.sm-status')?.textContent,
  }, true)`);

  ok(await js(`document.querySelectorAll('.course-statemachine').length`) === 6, 'a block for every ```statemachine on the page');
  ok(await js(`document.querySelectorAll('.course-statemachine .sm-svg').length`) === 5,
    'every machine is drawn: one, two side by side, one, and the one with warnings');
  ok(await js(`T.block(3).querySelector('.sm-error')?.textContent`) === 'This state machine cannot be shown: state A, on presed: presed is not an input, a timer or an event that a machine sends. A button? Add it under inputs:, e.g. inputs: {presed: button}',
    'a machine with a mistake shows the mistake');
  ok(await js(`T.block(5).querySelector('.sm-error')?.textContent.startsWith('This state machine cannot be shown: the YAML cannot be read')`),
    'unreadable YAML is reported on the page');

  // the switch: states ON and OFF, a click button
  ok(await js(`T.state(0)`) === 'OFF' && await js(`T.led(0, 'LED')`) === false, 'switch: starts in OFF, LED off');
  await js(`T.click(0, 'pressed')`);
  ok(await js(`T.state(0)`) === 'ON' && await js(`T.led(0, 'LED')`) === true && (await js(`T.log(0)`)).includes('pressed: OFF -> ON'),
    'switch: a click moves it to ON, the LED goes on, the log says so', await js(`T.log(0)`));
  ok(await js(`!!T.block(0).querySelector('.sm-source textarea')`) === false, 'switch: no YAML editor on the published site');

  // the debouncer: a bouncy pin, skip ahead through the bounces to the press; the folded switch reacts
  ok(await js(`T.block(1).querySelectorAll('.sm-panel.folded').length`) === 1 && await js(`!T.block(1).querySelector('.sm-log')?.isConnected`),
    'side by side: folded: true folds the switch; log: hidden has no log');
  ok(await js(`T.block(1).querySelector('.sm-seg [aria-pressed="true"]').textContent`) === '1/100×', 'side by side: starts at 1/100 speed');
  await js(`T.click(1, 'Pause')`);
  await js(`T.click(1, 'pin')`);
  ok(await js(`T.block(1).querySelector('.sm-tracecap').textContent.startsWith('pin high')`), 'side by side: a click sets the pin high');
  const kinds = [];
  for (let k = 0; k < 14 && await js(`T.pill(1, 0)`) !== 'PRESSED'; k++) {
    await js(`T.click(1, 'Skip ahead')`);
    kinds.push(await js(`T.status(1)`));
  }
  ok(await js(`T.pill(1, 0)`) === 'PRESSED' && await js(`T.pill(1, 1)`) === 'LIGHT_ON' && await js(`T.led(1, 'LED')`) === true,
    'side by side: skip ahead through the bounces to the press; the light switch gets pressed', `${kinds.length} skips`);
  ok(kinds.filter(s => /^A bounce: pin (low|high)\.$/.test(s)).length >= 4 && kinds.at(-1) === 'Skipped to [pin high for 50 ms].',
    'side by side: skip ahead stops at every bounce, then at the press', kinds.join(' | '));

  // the stopwatch: terminal, internal action, ignored event
  ok(await js(`T.text(2)`) === 'reset' && await js(`T.state(2)`) === 'RESET', 'stopwatch: prints reset on entry');
  await js(`T.click(2, 'LAP')`);
  ok(await js(`T.status(2)`) === 'LAP is ignored: RESET has no arrow for it.' && (await js(`T.log(2)`)).includes('LAP ignored in RESET'),
    'stopwatch: an ignored event is shown and logged', await js(`T.status(2)`));
  await js(`T.click(2, 'START')`);
  await js(`T.click(2, 'LAP')`);
  ok(await js(`T.text(2)`) === 'reset\nrunning\nlap' && await js(`T.state(2)`) === 'RUNNING', 'stopwatch: an internal action prints and stays', await js(`T.text(2)`));
  ok((await js(`T.block(2).querySelector('.sm-timers').textContent`)).includes('limit'), 'stopwatch: the timer limit is shown');
  await js(`T.click(2, 'START')`);
  ok(await js(`T.state(2)`) === 'STOPPED' && await js(`T.text(2)`) === 'reset\nrunning\nlap\nstopped' && await js(`T.led(2, 'LED')`) === true,
    'stopwatch: entry actions on lines without dashes all run', await js(`T.text(2)`));
  await sleep(300);
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
