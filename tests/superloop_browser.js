// The superloop blocks of the test course in a browser, run by scripts/check.py
// after the build:
//
//     quarto run tests/superloop_browser.js CHROME PAGE
//
// CHROME is Chrome Headless Shell (from `course setup`), PAGE the built
// lessons/week_02/lesson5.html. The page is driven over the DevTools protocol:
// buttons are pressed as a student presses them (the keyboard: Space down and
// up), keys are typed into the terminal, and the variables, the challenge's
// status, the timeline, the terminal and the notes are read back. Errors in
// the page's scripts fail the test.
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
  for (let k = 0; k < 100 && (await js(`document.querySelectorAll('.course-superloop .sl-tl-svg').length`)) < 5; k++) await sleep(100);

  // helpers in the page: the n-th block (scrolled into view, so that it runs), a press of its input, its variables
  await js(`(window.T = {
    block: n => document.querySelectorAll('.course-superloop')[n],
    show: async n => { T.block(n).scrollIntoView({block: 'center'}); await new Promise(r => setTimeout(r, 300)); return true; },
    press: async (n, ms) => {
      const b = T.block(n).querySelector('.sl-in');
      b.dispatchEvent(new KeyboardEvent('keydown', {key: ' ', bubbles: true}));
      await new Promise(r => setTimeout(r, ms));
      b.dispatchEvent(new KeyboardEvent('keyup', {key: ' ', bubbles: true}));
      return true;
    },
    click: async (n, text) => {
      [...T.block(n).querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text)).click();
      for (let k = 0; k < 3; k++) await new Promise(r => requestAnimationFrame(r));
      return true;
    },
    tab: async (n, k) => { T.block(n).querySelectorAll('.sl-tab')[k].click(); await new Promise(r => setTimeout(r, 100)); return true; },
    vars: n => [...T.block(n).querySelectorAll('.sl-var')].map(v => v.querySelector('.sl-vname').textContent + '=' + v.querySelector('.sl-val').textContent).join(' '),
    goal: n => T.block(n).querySelector('.sl-goaltext')?.textContent,
    count: (n, sel) => T.block(n).querySelectorAll(sel).length,
    // the terminal: type (as the keyboard does: text, or Enter), its screen
    type: async (n, text) => {
      const i = T.block(n).querySelector('.sl-term-input');
      if (text === '\\r') i.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      else { i.value = text; i.dispatchEvent(new InputEvent('input', {bubbles: true, data: text})); }
      await new Promise(r => setTimeout(r, 300));
      return true;
    },
    screen: n => T.block(n).querySelector('.sl-term-screen').textContent.replace(/\\s+$/, ''),
  }, true)`);

  ok(await js(`document.querySelectorAll('.course-superloop').length`) === 9 && await js(`document.querySelectorAll('.course-superloop .sl').length`) === 7,
    'a block for every ```superloop on the page; seven run');
  ok(await js(`T.block(7).querySelector('.sl-error')?.textContent`) === 'This superloop cannot be shown: "flavour" is not a setting of a superloop block',
    'a block with a mistake shows the mistake');
  ok((await js(`T.block(8).querySelector('.sl-error')?.textContent`) || '').startsWith('This superloop cannot be shown: the YAML cannot be read'),
    'unreadable YAML is reported on the page');
  ok(await js(`[...document.querySelectorAll('.course-superloop .sl')].every(b => ![...b.childNodes].some(k => k.nodeType === 3 && k.textContent.trim()))`),
    'no stray text in the blocks (2.7.0 showed "null" under blocks without a goal)');
  ok(!await js(`!!document.querySelector('.sl-source')`), 'no YAML editor on the published site');

  // the alarm: one short press, two variants on the same press
  await js(`T.show(0)`);
  ok(await js(`T.count(0, '.sl-tab')`) === 2 && await js(`T.count(0, '.sl-line.is-diff')`) > 5, 'variants: two tabs, the lines that differ marked');
  await sleep(500);
  await js(`T.press(0, 150)`);
  await sleep(400);
  ok(await js(`T.vars(0)`) === 'armed=true', 'the sleeping alarm missed the short press', await js(`T.vars(0)`));
  ok(await js(`T.count(0, '.sl-tl-missed')`) === 1, 'the timeline marks the press it never read');
  await js(`T.tab(0, 1)`);
  ok(await js(`T.vars(0)`) === 'armed=false', 'the checking alarm, on the same press, is disarmed', await js(`T.vars(0)`));
  ok(await js(`T.count(0, '.sl-tl-watched')`) >= 1 && await js(`T.count(0, '.sl-tl-missed')`) === 0, 'checking: the button read all the time (highlighted), nothing missed');

  // the challenge: one press reaches it; two are too many, and the answer is offered
  await js(`T.show(1)`);
  ok(await js(`T.goal(1)`) === 'Not yet.' && await js(`T.block(1).querySelector('.sl-eyebrow').textContent`) === 'Challenge', 'challenge: Not yet.');
  await js(`T.press(1, 150)`);
  await sleep(200);
  ok(/^Right! armed became false at t = \d+\.\d{3} s\.$/.test(await js(`T.goal(1)`)), 'challenge: one press, Right!', await js(`T.goal(1)`));
  ok(await js(`T.block(1).querySelector('.sl-goal button').hidden`), 'challenge: no answer offered when it was right');
  await js(`T.click(1, 'Reset')`);
  await js(`T.press(1, 20)`);
  await sleep(80);
  await js(`T.press(1, 150)`);
  await sleep(200);
  ok(await js(`T.goal(1)`) === 'That took 2 presses. Can you do it with 1? (Reset starts again.)', 'challenge: max_presses', await js(`T.goal(1)`));
  await js(`T.click(1, 'Show the answer')`);
  ok((await js(`T.block(1).querySelector('.sl-answer').textContent`)).includes('SL-ANSWER') && !await js(`T.block(1).querySelector('.sl-answer').hidden`),
    'challenge: the answer, after a try that took too many presses');

  // a whole program: pause and step
  await js(`T.show(2)`);
  await js(`T.click(2, 'Pause')`);
  await js(`T.click(2, 'Step')`);
  ok(/^Paused before line (1[2-6])\.$/.test(await js(`T.block(2).querySelector('.sl-status').textContent`)) && await js(`T.count(2, '.sl-line.is-next')`) === 1,
    'step: paused before a line of the loop, marked', await js(`T.block(2).querySelector('.sl-status').textContent`));
  ok((await js(`T.block(2).querySelector('.sl-counters').textContent`)).startsWith('The superloop ran '), 'show: iterations');

  // bounces: slowed down, the bounces switch
  await js(`T.show(3)`);
  ok(await js(`T.block(3).querySelector('.sl-seg').textContent`) === '1/100×1/10×1×' && await js(`T.block(3).querySelector('.sl-seg [aria-pressed="true"]').textContent`) === '1/10×'
    && await js(`!!T.block(3).querySelector('.sl-check input')`), 'speeds, speed: 1/10, the bounces switch');

  // undefined behaviour, permitted: a note, and the line marked
  await js(`T.show(4)`);
  await sleep(300);
  ok(/Line 4: 2147\d+ \+ 100000 does not fit in an int\. Signed overflow is undefined behaviour in C\. The widget wraps, as the processor does; the compiled program may do something else\./.test(await js(`T.block(4).querySelector('.sl-notes').textContent`))
    && await js(`T.count(4, '.sl-line.is-ub')`) === 1, 'permit: the overflow is noted, its line marked', await js(`T.block(4).querySelector('.sl-notes').textContent`));

  // the terminal: the prompt printed before it opened is lost; both variants get the same keys
  await js(`T.show(5)`);
  await sleep(400);
  ok(await js(`T.block(5).querySelector('.sl-term-state').textContent`) === 'closed' && await js(`T.count(5, '.sl-line.is-waiting')`) === 1
    && await js(`T.block(5).querySelector('.sl-line.is-waiting .sl-badge').textContent`) === 'waiting for a key', 'terminal: closed at the start; getchar() waits for a key');
  await js(`T.type(5, '5')`);
  ok(await js(`T.block(5).querySelector('.sl-term-msg').textContent`) === 'The terminal is closed: open it to type.', 'terminal: a closed terminal takes no keys');
  await js(`T.click(5, 'Open')`);
  await sleep(200);
  ok(await js(`T.block(5).querySelector('.sl-term-state').textContent`) === 'open' && await js(`T.screen(5)`) === '', 'terminal: open, and the first prompt is not there', JSON.stringify(await js(`T.screen(5)`)));
  await js(`T.type(5, '5')`);
  ok(await js(`T.screen(5)`) === '\nPlaying 5 beeps.\nEnter a number (1-9):', 'terminal: a key typed, the program answers', JSON.stringify(await js(`T.screen(5)`)));
  await js(`T.type(5, '\\r')`);   // ('\\r' here is '\r' in the page)
  ok((await js(`T.screen(5)`)).endsWith('Invalid input.\nEnter a number (1-9):'), 'terminal: Enter sends \\r, which is no digit', JSON.stringify(await js(`T.screen(5)`)));
  ok(await js(`T.count(5, '.sl-tl-dropx')`) >= 1 && await js(`T.count(5, '.sl-tl-key')`) === 2 && await js(`T.count(5, '.sl-tl-usb.open')`) >= 1,
    'terminal lane: the dropped prompt, the keys, the open terminal');
  await js(`T.tab(5, 1)`);
  ok((await js(`T.screen(5)`)).startsWith('Enter a number (1-9): \nPlaying 5 beeps.'), 'terminal: the program that waits for the terminal shows its first prompt, after the same keys', JSON.stringify(await js(`T.screen(5)`)));
  await js(`T.click(5, 'Close')`);
  await sleep(200);
  ok(await js(`T.block(5).querySelector('.sl-term-state').textContent`) === 'closed', 'terminal: closed again');

  // terminal: open, a goal on its text, \r updating a line
  await js(`T.show(6)`);
  await sleep(1600);
  ok(/^t = \d\.\d{3} s$/.test(await js(`T.screen(6)`)), 'terminal: open connects by itself; \\r updates the line in place', JSON.stringify(await js(`T.screen(6)`)));
  ok(/^Right! the terminal showed "t = 1\.0" at t = 1\.0\d\d s\.$/.test(await js(`T.goal(6)`)), 'a goal on the terminal\'s text', await js(`T.goal(6)`));
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
