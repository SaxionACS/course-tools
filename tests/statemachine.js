// Tests of the state machines (assets/statemachine/statemachine.js), run by scripts/check.py:
//
//     quarto run tests/statemachine.js
//
// Machines are run with a fixed random generator and their states, outputs and
// timers compared at chosen times. Mistakes in the YAML must be reported with
// a message that names the mistake. Every layout is checked: no state box,
// arrow label or self-loop overlaps another, no arrow runs through a state it
// does not belong to, and the picture contains everything.
const here = new URL('.', import.meta.url);
const dir = new URL('../src/course_tools/assets/statemachine/', here);
(0, eval)(await Deno.readTextFile(new URL('dagre.min.js', dir)) + '\nglobalThis.dagre = dagre;');
(0, eval)(await Deno.readTextFile(new URL('statemachine.js', dir)));
const {read, Sim, print, internals: I} = globalThis.CourseStatemachines;

let passed = 0;
const failed = [];
function ok(condition, what, detail = '') {
  if (condition) passed++;
  else failed.push(`${what}${detail ? `: ${detail}` : ''}`);
}
// A small deterministic random generator, so that a failure can be repeated.
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const copy = x => JSON.parse(JSON.stringify(x));

// ---- the machines --------------------------------------------------------
const EX = {
  switch: {title: 'The light switch', inputs: {pressed: 'button'}, outputs: {LED: 'amber led'}, initial: 'LIGHT_OFF',
    states: {LIGHT_OFF: {on: {pressed: 'LIGHT_ON / LED on'}}, LIGHT_ON: {on: {pressed: 'LIGHT_OFF / LED off'}}}},
  staircase: {title: 'The staircase light', inputs: {pressed: 'button'}, outputs: {LED: 'amber led'},
    states: {LIGHT_OFF: {entry: 'LED off', on: {pressed: 'LIGHT_ON'}},
      LIGHT_ON: {entry: 'LED on', on: {pressed: 'LIGHT_ON', 'after 10 s': 'LIGHT_OFF'}}}},
  // as YAML reads lines without dashes: one line
  staircase2: {title: 'The staircase light', inputs: {pressed: 'button'}, outputs: {LED: 'amber led'},
    states: {LIGHT_OFF: {entry: 'LED off', on: {pressed: 'LIGHT_ON'}},
      LIGHT_ON: {entry: 'LED on start light_off_delay 10 s', on: {pressed: 'LIGHT_ON', light_off_delay: 'LIGHT_OFF'}}}},
  alarm: {title: 'The burglar alarm', direction: 'TB', inputs: {arm_pressed: 'button', door_opened: 'button'}, outputs: {LED: 'red led'},
    states: {DISARMED: {entry: 'LED off', on: {arm_pressed: 'ARMING'}},
      ARMING: {entry: 'start exit_delay 10 s', do: 'blink LED 500 ms', on: {arm_pressed: 'DISARMED', exit_delay: 'ARMED'}},
      ARMED: {entry: 'LED on', on: {door_opened: 'ALARM', arm_pressed: 'DISARMED'}},
      ALARM: {do: 'blink LED 100 ms', on: {arm_pressed: 'DISARMED'}}}},
  button: {title: 'The button and the light switch', speed: '1/100', inputs: {pin: 'bouncy pin'}, outputs: {LED: 'amber led'},
    machines: {
      button: {title: 'btn_just_pressed()', states: {RELEASED: {on: {'pin high for 50 ms': 'PRESSED / send pressed'}},
        PRESSED: {on: {'pin low for 50 ms': 'RELEASED'}}}},
      switch: {title: 'light switch', states: {LIGHT_OFF: {on: {pressed: 'LIGHT_ON / LED on'}}, LIGHT_ON: {on: {pressed: 'LIGHT_OFF / LED off'}}}}}},
  side: {title: 'One superloop, three machines', inputs: {pressed: 'button'}, outputs: {SLOW: 'green led', FAST: 'red led', LIGHT: 'amber led'},
    machines: {
      slow: {states: {SLOW_ON: {entry: 'SLOW on', on: {'after 1000 ms': 'SLOW_OFF'}}, SLOW_OFF: {entry: 'SLOW off', on: {'after 1000 ms': 'SLOW_ON'}}}},
      fast: {states: {FAST_ON: {entry: 'FAST on', on: {'after 150 ms': 'FAST_OFF'}}, FAST_OFF: {entry: 'FAST off', on: {'after 150 ms': 'FAST_ON'}}}},
      switch: {states: {LIGHT_OFF: {on: {pressed: 'LIGHT_ON / LIGHT on'}}, LIGHT_ON: {on: {pressed: 'LIGHT_OFF / LIGHT off'}}}}}},
  stopwatch: {title: 'The stopwatch', direction: 'TB', text: 'terminal', inputs: {START: 'button', LAP: 'button'}, outputs: {LED: 'green led'},
    states: {SW_RESET: {entry: 'LED off, print "reset"', on: {START: 'SW_RUNNING'}},
      SW_RUNNING: {entry: 'print "running"', do: 'blink LED 250 ms', on: {START: 'SW_STOPPED', LAP: '/ print "lap"'}},
      SW_STOPPED: {entry: 'LED on, print "stopped"', on: {START: 'SW_RUNNING', LAP: 'SW_RESET'}}}},
  long: {title: 'Short and long presses', inputs: {KEY: 'hold button'}, outputs: {LED: 'green led', BUZZER: 'buzzer'},
    states: {IDLE: {on: {'KEY pressed': 'DOWN'}}, DOWN: {on: {'KEY released': 'IDLE / LED toggle', 'KEY pressed for 1 s': 'LONG'}},
      LONG: {entry: 'BUZZER on', on: {'KEY released': 'IDLE / BUZZER off'}}}},
  kitchen: {title: 'A kitchen timer', text: 'display', inputs: {START: 'button', CANCEL: 'button'}, outputs: {LED: 'green led', BUZZER: 'buzzer'},
    states: {IDLE: {entry: 'BUZZER off, LED off, print "Ready"', on: {START: 'COOKING'}},
      COOKING: {entry: ['LED on', 'print "Cooking, wait..."', 'start egg 3..6 s'], on: {egg: 'RINGING', CANCEL: 'IDLE / stop egg'}},
      RINGING: {entry: 'BUZZER on, print "Done!"', do: 'blink LED 200 ms', on: {CANCEL: 'IDLE', 'after 5 s': 'IDLE'}}}},
  // a bigger one: many arrows between few states, both ways, and two self-loops
  traffic: {title: 'Traffic light', direction: 'LR', inputs: {request: 'button', fault: 'button', repair: 'button'},
    outputs: {RED: 'red led', AMBER: 'amber led', GREEN: 'green led'},
    states: {RED: {entry: 'RED on, AMBER off, GREEN off', on: {'after 4 s': 'GREEN', request: 'RED', fault: 'FAULT'}},
      GREEN: {entry: 'RED off, GREEN on', on: {request: 'AMBER', 'after 8 s': 'AMBER', fault: 'FAULT'}},
      AMBER: {entry: 'GREEN off, AMBER on', on: {'after 1.5 s': 'RED', fault: 'FAULT', request: 'AMBER'}},
      FAULT: {entry: 'RED off, GREEN off', do: 'blink AMBER 500 ms', on: {repair: 'RED / print "repaired"'}}}},
};
const run = (id, config = EX[id]) => {
  const log = [];
  const sim = new Sim(read(config), {log: e => log.push(e)}, rnd);
  return {sim, log, st: (k = 0) => sim.ms[k].state};
};

// ---- reading -------------------------------------------------------------
for (const [id, config] of Object.entries(EX)) {
  let model = null, error = '';
  try { model = read(copy(config)); } catch (e) { error = e.message; }
  ok(model && !model.warnings.length, `${id}: read without mistakes or warnings`, error || model?.warnings.join('; '));
}
{
  const m = read(EX.staircase2).machines[0].states.LIGHT_ON.entry.map(a => a.src);
  ok(m.join('|') === 'LED on|start light_off_delay 10 s', 'actions one after another, without commas (YAML lines without dashes)', m.join('|'));
  const k = read(EX.kitchen).machines[0].states;
  ok(k.COOKING.entry.map(a => a.kind).join() === 'set,print,start' && k.COOKING.entry[1].text === 'Cooking, wait...',
    'a list of actions; a comma inside a print', JSON.stringify(k.COOKING.entry));
  const q = read({outputs: {L: 'led'}, states: {A: {entry: 'print "say \\"hi\\"" L on,,L off'}}}).machines[0].states.A.entry;
  ok(q.length === 3 && q[0].text === 'say "hi"', 'quotes in a print; empty items are skipped', JSON.stringify(q));
  const t = read({inputs: {b: 'button'}, states: {A: {on: {b: 'A / start T 2..5s', T: 'A'}}}}).machines[0].states.A.on[0].actions[0];
  ok(t.time.min === 2000 && t.time.max === 5000 && t.src === 'start T 2..5 s', 'a random time, written without a space', JSON.stringify(t));
  ok(read(EX.button).speed === 0.01, 'speed 1/100');
  ok(I.speedOf(0.5, 'speed') === 0.5 && I.speedOf('1', 'speed') === 1 && I.speedOf(10, 'speed') === 10, 'speed 0.5, 1 and 10');
  ok(['1/100', 0.5, 1, 2, 2.5].map(v => I.speedLabel(I.speedOf(v, 'speed'))).join() === '1/100×,1/2×,1×,2×,2.5×', 'speed labels');
  // the speed buttons: from the times of the machine, or from speeds:
  const auto = Object.fromEntries(Object.keys(EX).map(id => [id, read(EX[id]).speeds.map(I.speedLabel).join(' ')]));
  const want = {switch: '1×', staircase: '1× 2× 5× 10×', staircase2: '1× 2× 5× 10×', alarm: '1× 2× 5× 10×', button: '1/100× 1/10× 1×',
    side: '1×', stopwatch: '1×', long: '1×', kitchen: '1× 2× 5×', traffic: '1× 2× 5×'};
  ok(JSON.stringify(auto) === JSON.stringify(want), 'speed buttons: slower for short times and bounces, faster for long times', JSON.stringify(auto));
  ok(I.autoSpeeds([50]).join() === '0.1,1' && I.autoSpeeds([60000]).join() === '1,10,20,50' && I.autoSpeeds([1500, 2500]).join() === '1,2',
    'speed buttons: 1/10 under 100 ms, up to three speed-ups', [I.autoSpeeds([50]), I.autoSpeeds([60000]), I.autoSpeeds([1500, 2500])].join(' / '));
  const sp = c => { const m = read(Object.assign(copy(EX.switch), c)); return `${m.speeds.map(I.speedLabel).join(' ')} @${I.speedLabel(m.speed)}`; };
  ok(sp({speeds: [1, 2, 10]}) === '1× 2× 10× @1×' && sp({speeds: ['1/10', 1], speed: 5}) === '1/10× 1× 5× @5×' && sp({speeds: [2, 10]}) === '2× 10× @2×'
    && sp({speed: '1/4'}) === '1/4× 1× @1/4×', 'speeds: by hand; the start speed is one of them', [sp({speeds: [1, 2, 10]}), sp({speeds: ['1/10', 1], speed: 5}), sp({speeds: [2, 10]}), sp({speed: '1/4'})].join(' / '));
  ok(read(Object.assign(copy(EX.switch), {log: 'hidden'})).log === 'hidden' && read(EX.switch).log === 'open', 'log: hidden; open by default');
  const clocks = ['switch', 'staircase', 'staircase2', 'alarm', 'button', 'stopwatch', 'long', 'kitchen'].map(id => read(EX[id]).clock);
  ok(clocks.join() === 'false,true,true,true,true,true,true,true', 'the clock and its controls only for machines that use time (after, timers, blink, held, bounces)', clocks.join());
  ok(read(Object.assign(copy(EX.switch), {clock: true})).clock === true && read(Object.assign(copy(EX.staircase), {clock: false})).clock === false,
    'clock: true and clock: false override that');
  const bar = read({inputs: {b: 'button'}, outputs: {L: 'led'}, states: {A: {on: {b: 'B | L on, send x'}}, B: {on: {b: '| L off', x: 'A'}}}}).machines[0].states;
  ok(bar.A.on[0].target === 'B' && bar.A.on[0].actions.map(a => a.src).join() === 'L on,send x' && bar.B.on[0].internal && bar.B.on[0].actions[0].src === 'L off',
    '| separates the state from the actions, as / does', JSON.stringify(bar.A.on[0]));
  const slash = read({inputs: {b: 'button'}, outputs: {L: 'led'}, states: {A: {on: {b: 'A / print "a/b|c"'}}}}).machines[0].states.A.on[0];
  ok(slash.target === 'A' && slash.actions[0].text === 'a/b|c', '/ and | inside a print are text', JSON.stringify(slash.actions));
  // a list of actions over several lines: the lines after the first start under its first item
  const box = read({inputs: {b: 'button'}, outputs: {L: 'led', M: 'led', N: 'led'},
    states: {A: {entry: 'L on, M on, N on, print "a long text here"', do: 'blink L 500 ms, blink M 1 s, blink N 2 s',
      on: {b: '| L toggle, M toggle, N toggle, print "x"'}}}}).machines[0].states.A;
  const lines = I.stateLines(box);
  let prefix = null, starts = 0, aligned = true;
  for (const l of lines) {
    const p = ['entry: ', 'do: ', 'b | '].find(x => l.text.startsWith(x));
    if (p) { prefix = p; starts++; aligned &&= l.indent === 0; }
    else aligned &&= l.indent === I.measure(prefix, l.kind) && !l.text.startsWith(' ');
  }
  ok(starts === 3 && lines.length >= 6 && aligned, 'entry, do and internal actions over several lines: the next lines start under the first item',
    lines.map(l => `${Math.round(l.indent)}:${l.text}`).join(' / '));
  const tr = v => read(Object.assign(copy(EX.switch), v == null ? {} : {transition: v})).transition;
  ok([tr(), tr('600 ms'), tr('1.5 s'), tr(0), tr('0 ms'), tr('5 s')].join() === '420,600,1500,0,0,5000',
    'transition: the time of the dot, 420 ms unless set; 0 for none', [tr(), tr('600 ms'), tr('1.5 s'), tr(0), tr('0 ms'), tr('5 s')].join());
}

// ---- mistakes are reported, with what to write instead -------------------
function bad(config, pattern, what) {
  let message = '';
  try { read(config); } catch (e) { message = e.message; }
  ok(pattern.test(message), `mistake reported: ${what}`, message || 'no error');
}
const alarm = () => copy(EX.alarm);
let c = alarm(); c.states.ARMING.on = {arm_pressed: 'DISARMED', exit_dalay: 'ARMED'};
bad(c, /state ARMING, on exit_dalay: exit_dalay is not an input, a timer or an event/, 'a timer with a typo');
c = alarm(); c.states.ARMED.entry = 'LDE on'; bad(c, /state ARMED, entry: there is no output LDE \(outputs: LED\)/, 'an output with a typo');
c = alarm(); c.states.ARMED.on.door_opened = 'ALRAM'; bad(c, /there is no state ALRAM/, 'a state with a typo');
c = alarm(); c.states.ARMING.do = 'LED on'; bad(c, /"LED on" cannot be a do activity/, 'an action under do:');
c = alarm(); c.states.ARMED.entry = 'blink LED 1 s'; bad(c, /blink is a do activity/, 'blink under entry:');
c = alarm(); c.states.ARMED.entry = 'LED on start exit_delay'; bad(c, /start needs a timer and a time/, 'start without a time');
c = alarm(); c.states.ARMED.entry = 'LED on print Ready'; bad(c, /print needs its text in double quotes/, 'print without quotes');
c = alarm(); c.states.ARMED.entry = 'LED onn'; bad(c, /write LED on, LED off or LED toggle/, 'on with a typo');
c = alarm(); c.states.ARMED.entry = 'beep'; bad(c, /"beep" is not an action. Actions are: LED on/, 'an unknown action');
c = alarm(); c.states.ARMED.on.door_opened = 'ALARM LED on'; bad(c, /write the state, then \/ and the actions/, 'actions without a /');
c = alarm(); c.states.ARMED.on.door_opened = 'ALARM / LED on / LED off'; bad(c, /one \/ per arrow/, 'two / on one arrow');
c = copy(EX.long); c.states.IDLE.on = {KEY: 'DOWN'}; bad(c, /KEY is a hold button: write KEY pressed or KEY released/, 'a hold button without pressed or released');
c = copy(EX.switch); c.states.LIGHT_OFF.on = {'pressed released': 'LIGHT_ON'}; bad(c, /click button/, 'released of a click button');
c = copy(EX.switch); c.outputs = {LED: 'purple led'}; bad(c, /"purple led" is not an output/, 'an LED colour that does not exist');
c = copy(EX.switch); c.inputs = {start: 'button'}; bad(c, /"start" is a word of the state machine language/, 'an input named like an action');
c = copy(EX.switch); c.speed = '200'; bad(c, /speed: "200" is not a speed/, 'speed above 100');
c = copy(EX.switch); c.speeds = []; bad(c, /speeds: is a list of 1 to 8 speeds/, 'speeds: empty');
c = copy(EX.switch); c.speeds = [1, 'fast']; bad(c, /speeds: "fast" is not a speed/, 'speeds: a word');
c = copy(EX.switch); c.transition = 600; bad(c, /transition: "600" is not a time for the dot along an arrow. Write 600 ms/, 'transition: a time without a unit');
c = copy(EX.switch); c.transition = '10 s'; bad(c, /transition: "10 s" is not a time .*up to 5 s/, 'transition: over 5 s');
c = copy(EX.switch); c.log = 'closed'; bad(c, /log: is open, folded or hidden/, 'log: closed');
c = copy(EX.switch); c.colour = 'red'; bad(c, /unknown key "colour"/, 'an unknown key');
c = copy(EX.staircase); c.states.LIGHT_ON.on = {'after 10': 'LIGHT_OFF'}; bad(c, /"10" is not a time/, 'a time without a unit');
c = copy(EX.staircase); c.states.LIGHT_ON.on = {'[t > 10]': 'LIGHT_OFF'}; bad(c, /guards .* come in a later version/, 'a guard');
c = copy(EX.button); c.machines.button.states.RELEASED.on = {'pin high for 10..50 ms': 'PRESSED'}; bad(c, /a random time .* is not possible here/, 'a random held time');
{
  const m = read({inputs: {b: 'button', x: 'button'}, outputs: {L: 'led', Q: 'buzzer'},
    states: {A: {entry: 'start T 1 s, stop U, send e', on: {b: 'A'}}, B: {}}});
  const w = m.warnings.join('\n');
  ok(['timer T runs out, but no state reacts', 'stop U: timer U is never started', 'send e: no state reacts to e', 'input x is not used',
    'output L is never switched', 'output Q is never switched', 'state B can never be reached'].every(s => w.includes(s)), 'warnings', w);
}

// ---- running -------------------------------------------------------------
{ const {sim, st} = run('switch');
  sim.dispatch('pressed'); ok(st() === 'LIGHT_ON' && sim.out.LED, 'switch: on');
  sim.dispatch('pressed'); ok(st() === 'LIGHT_OFF' && !sim.out.LED, 'switch: off'); }
for (const id of ['staircase', 'staircase2']) {
  const {sim, st} = run(id);
  sim.dispatch('pressed'); sim.advance(9000); ok(st() === 'LIGHT_ON', `${id}: still on at 9 s`);
  sim.dispatch('pressed'); sim.advance(18500); ok(st() === 'LIGHT_ON', `${id}: the arrow back into LIGHT_ON starts the 10 s again`);
  sim.advance(19100); ok(st() === 'LIGHT_OFF' && !sim.out.LED, `${id}: off 10 s after the second press`);
}
{ const {sim, st, log} = run('alarm');
  sim.dispatch('door_opened'); ok(log.at(-1).ignored, 'alarm: door ignored in DISARMED');
  sim.dispatch('arm_pressed'); ok(st() === 'ARMING', 'alarm: arming');
  sim.advance(600); ok(sim.out.LED === true, 'alarm: blinked on after 500 ms');
  sim.advance(1100); ok(sim.out.LED === false, 'alarm: blinked off after 1000 ms');
  sim.dispatch('arm_pressed'); ok(st() === 'DISARMED' && sim.timers.exit_delay, 'alarm: disarmed, exit_delay still running');
  sim.advance(10100); ok(log.some(e => e.ignored && e.cause === 'exit_delay' && e.source === 'timer'), 'alarm: exit_delay ran out, ignored');
  sim.dispatch('arm_pressed'); const t = sim.t; const to = sim.skip();
  ok(to.kind === 'timer' && to.what === 'exit_delay' && st() === 'ARMED' && sim.out.LED && sim.t === t + 10000, 'alarm: skip goes past the blinking, to ARMED after exactly 10 s');
  sim.dispatch('door_opened'); ok(st() === 'ALARM', 'alarm: alarm'); }
{ const {sim, st, log} = run('button');
  sim.press('pin', true); sim.advance(40); ok(st(0) === 'RELEASED', 'button: no press within the bounces + 40 ms');
  sim.advance(70); ok(st(0) === 'PRESSED' && st(1) === 'LIGHT_ON' && sim.out.LED, 'button: press reported, light on');
  const lastUp = sim.holds.pin.trace.filter(p => p.level).at(-1).t;
  const pressAt = log.find(e => e.to === 'PRESSED').t;
  ok(Math.abs(pressAt - (lastUp + 50)) < 1e-6, 'button: pressed exactly 50 ms after the last bounce up', `${pressAt} vs ${lastUp}`);
  sim.press('pin', false); sim.advance(sim.t + 80); ok(st(0) === 'RELEASED' && st(1) === 'LIGHT_ON', 'button: released, light stays on');
  ok(!log.some(e => e.ignored), 'button: bounces are not logged as ignored');
  sim.press('pin', true); sim.advance(sim.t + 30); sim.press('pin', false); sim.advance(sim.t + 100);
  ok(st(0) === 'RELEASED' && st(1) === 'LIGHT_ON', 'button: a 30 ms press does not count');
  // skip ahead: every bounce, then the 50 ms
  sim.press('pin', true);
  const kinds = [];
  for (let k = 0; k < 12 && st(0) === 'RELEASED'; k++) kinds.push(sim.skip());
  const flips = kinds.filter(k => k.kind === 'bounce');
  ok(flips.length >= 4 && flips.length % 2 === 0 && flips.every((f, i) => f.what === (i % 2 ? 'pin high' : 'pin low'))
    && kinds.at(-1).what === '[pin high for 50 ms]' && st(0) === 'PRESSED', 'button: skip ahead stops at every bounce, then at the press', JSON.stringify(kinds)); }
{ const {sim, st, log} = run('side');
  sim.advance(3000);
  const n = id => log.filter(e => e.machine === id && e.to && !e.start).length;
  ok(n('slow') === 3 && n('fast') === 20, 'side by side: both blinkers keep their pace', `slow ${n('slow')}, fast ${n('fast')}`);
  sim.dispatch('pressed'); ok(st(2) === 'LIGHT_ON' && sim.out.LIGHT, 'side by side: the switch alongside'); }
{ const {sim, st} = run('stopwatch');
  sim.dispatch('START'); sim.advance(600); const led = sim.out.LED; sim.dispatch('LAP');
  ok(st() === 'SW_RUNNING' && sim.lines.join('|') === 'reset|running|lap' && sim.out.LED === led, 'stopwatch: an internal action prints, no exit or entry', sim.lines.join('|'));
  sim.advance(sim.t + 250); ok(sim.out.LED !== led, 'stopwatch: the blinking goes on after the internal action');
  sim.dispatch('START'); sim.dispatch('LAP'); ok(st() === 'SW_RESET' && sim.lines.at(-1) === 'reset', 'stopwatch: LAP resets when stopped'); }
{ const {sim, st} = run('long');
  sim.press('KEY', true); sim.advance(300); sim.press('KEY', false); ok(st() === 'IDLE' && sim.out.LED, 'long press: a short press toggles the LED');
  sim.press('KEY', true); sim.advance(sim.t + 1200); ok(st() === 'LONG' && sim.out.BUZZER, 'long press: buzzes after 1 s');
  sim.press('KEY', false); ok(st() === 'IDLE' && !sim.out.BUZZER && sim.out.LED, 'long press: release stops the buzzer'); }
{ const {sim, st} = run('kitchen');
  ok(sim.display === 'Ready', 'kitchen: display Ready');
  const times = [];
  for (let k = 0; k < 20; k++) { sim.dispatch('START'); times.push(sim.timers.egg.due - sim.t); sim.dispatch('CANCEL'); }
  ok(times.every(t => t >= 3000 && t <= 6000) && new Set(times).size > 10, 'kitchen: a random time 3..6 s, new at every start', times.join());
  ok(st() === 'IDLE' && sim.timers.egg === null, 'kitchen: cancel stops the timer');
  sim.dispatch('START'); sim.advance(sim.t + 6001); ok(st() === 'RINGING' && sim.display === 'Done!' && sim.out.BUZZER, 'kitchen: rings');
  sim.advance(sim.t + 5001); ok(st() === 'IDLE' && !sim.out.BUZZER, 'kitchen: back to IDLE after 5 s'); }
// what the page hears: changes to outputs and text, where they come from, and a move before its actions
{ const heard = [];
  const say = (s, what) => heard.push(`${s.m.name}:${what}`);
  const sim = new Sim(read(EX.stopwatch), {
    leave: (s, tr) => say(s, `leave ${tr.id}`),
    effect: (s, fx, phase) => say(s, `${phase} ${fx.text ? fx.text.text : `${fx.out}=${fx.value}`}`),
  }, rnd);
  ok(heard.join('|') === 'machine:entry LED=false|machine:entry reset', 'the page hears the entry actions of the first state', heard.join('|'));
  heard.length = 0;
  sim.dispatch('START'); sim.advance(260); sim.dispatch('LAP'); sim.dispatch('START');
  const want = ['leave', 'entry running', 'do LED=true', 'leave', 'arrow lap', 'leave', 'entry LED=true', 'entry stopped'];
  ok(heard.map(x => x.replace(/^machine:/, '').replace(/^leave .*/, 'leave')).join('|') === want.join('|'),
    'effects in order: entry, blinking (do), an internal action (arrow); leave comes first', heard.join('|')); }
{ const {sim, st} = run('staircase');
  ok(sim.soonest(sim.ms[0]) === Infinity, 'soonest: nothing is due in LIGHT_OFF');
  sim.dispatch('pressed'); sim.advance(4000);
  ok(st() === 'LIGHT_ON' && sim.soonest(sim.ms[0]) === 6000, 'soonest: the after 10 s of LIGHT_ON, 4 s in', sim.soonest(sim.ms[0])); }
{ const {sim} = run('staircase2');
  sim.dispatch('pressed'); sim.advance(2500);
  ok(sim.soonest(sim.ms[0]) === 7500, 'soonest: a named timer that LIGHT_ON has an arrow for', sim.soonest(sim.ms[0])); }
{ const {sim} = run('button');
  ok(sim.soonest(sim.ms[0]) === Infinity, 'soonest: a held time does not count while the pin is low');
  sim.press('pin', true); sim.advance(sim.t + 20);
  ok(sim.soonest(sim.ms[0]) <= 50 && sim.soonest(sim.ms[0]) > 0, 'soonest: the held time counts while the pin is high', sim.soonest(sim.ms[0])); }
{ const {sim, log} = run('loop', {inputs: {go: 'button'}, machines: {a: {states: {A: {on: {go: 'A / send x', x: 'A / send y'}}}},
  b: {states: {B: {on: {y: 'B / send x'}}}}}});
  sim.dispatch('go'); ok(log.some(e => e.error && /Over 500 events/.test(e.error)), 'machines that send each other events forever are stopped'); }

// ---- layout --------------------------------------------------------------
const overlap = (a, b, gap = 0) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
const rect = (x, y, w, hh) => ({x0: x - w / 2, x1: x + w / 2, y0: y - hh / 2, y1: y + hh / 2});
// does the segment p-q cross the inside of r (shrunk by 2 px)?
function crosses(p, q, r) {
  const s = {x0: r.x0 + 2, x1: r.x1 - 2, y0: r.y0 + 2, y1: r.y1 - 2};
  for (let k = 0; k <= 20; k++) {
    const x = p.x + (q.x - p.x) * k / 20, y = p.y + (q.y - p.y) * k / 20;
    if (x > s.x0 && x < s.x1 && y > s.y0 && y < s.y1) return true;
  }
  return false;
}
for (const [id, config] of Object.entries(EX)) {
  for (const m of read(config).machines) {
    const geo = I.layoutMachine(m), where = `layout ${id}${m.name !== 'machine' ? '/' + m.name : ''}`;
    const nodes = Object.values(geo.nodes).map(n => ({n, r: rect(n.x, n.y, n.w, n.h)}));
    const labels = geo.edges.filter(e => !e.init).map(e => ({e, r: rect(e.lx, e.ly, e.lw, e.lh)}));
    const problems = [];
    nodes.forEach((a, i) => nodes.slice(i + 1).forEach(b => { if (overlap(a.r, b.r, 4)) problems.push(`${a.n.name} and ${b.n.name}`); }));
    for (const l of labels) for (const a of nodes) if (overlap(l.r, a.r)) problems.push(`label "${l.e.lines[0]}" on ${a.n.name}`);
    labels.forEach((a, i) => labels.slice(i + 1).forEach(b => { if (overlap(a.r, b.r)) problems.push(`labels "${a.e.lines[0]}" and "${b.e.lines[0]}"`); }));
    for (const e of geo.edges) {
      if (e.self) {
        const loop = I.selfLoop(geo.nodes[e.from], e).curve;
        const box = {x0: Math.min(...loop.map(p => p.x)), x1: Math.max(...loop.map(p => p.x)), y0: Math.min(...loop.map(p => p.y)), y1: Math.max(...loop.map(p => p.y))};
        for (const a of nodes) if (a.n.name !== e.from && overlap(box, a.r)) problems.push(`self-loop of ${e.from} on ${a.n.name}`);
        continue;
      }
      for (let k = 1; k < e.points.length; k++) {
        for (const a of nodes) if (a.n.name !== e.from && a.n.name !== e.to && crosses(e.points[k - 1], e.points[k], a.r)) problems.push(`arrow ${e.from} -> ${e.to} through ${a.n.name}`);
      }
      const end = e.points.at(-1), to = e.init ? null : nodes.find(a => a.n.name === e.to).r;
      if (to && !(end.x >= to.x0 - 1 && end.x <= to.x1 + 1 && end.y >= to.y0 - 1 && end.y <= to.y1 + 1)) problems.push(`arrow ${e.from} -> ${e.to} ends away from its state`);
    }
    for (const a of nodes) for (const l of a.n.lines) {
      if (l.indent + I.measure(l.text, l.kind) + 24 > a.n.w) problems.push(`text "${l.text}" wider than ${a.n.name}`);
    }
    ok(!problems.length, `${where}: nothing overlaps`, problems.join('; '));
    const pic = I.drawMachine(geo, m, I.svgText, true);
    const [vx, vy, vw, vh] = pic.svg.attrs.viewBox.split(' ').map(Number);
    const all = [...nodes.map(a => a.r), ...labels.map(l => l.r)];
    ok(all.every(r => r.x0 >= vx && r.y0 >= vy && r.x1 <= vx + vw && r.y1 <= vy + vh), `${where}: the picture contains every state and label`);
  }
}
{
  // a direction per machine; TB is taller than wide, LR wider than tall
  const tb = I.layoutMachine(read(EX.alarm).machines[0]), lr = I.layoutMachine(read(Object.assign(copy(EX.alarm), {direction: 'LR'})).machines[0]);
  const size = g => { const ns = Object.values(g.nodes); return {w: Math.max(...ns.map(n => n.x)) - Math.min(...ns.map(n => n.x)), h: Math.max(...ns.map(n => n.y)) - Math.min(...ns.map(n => n.y))}; };
  ok(size(tb).h > size(tb).w && size(lr).w > size(lr).h, 'direction: TB goes down, LR goes right', JSON.stringify([size(tb), size(lr)]));
}

// ---- the PDF form --------------------------------------------------------
{
  const r = print(EX.alarm);
  ok(!r.error && r.title === 'The burglar alarm' && r.machines.length === 1 && r.machines[0].title === null, 'print: one machine', r.error);
  const svg = r.machines[0].svg;
  ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && svg.includes('font-family="Lato"') && svg.includes('<style>')
    && ['DISARMED', 'ARMING', 'ARMED', 'ALARM', 'entry: start exit_delay 10 s', 'do: blink LED 500 ms', 'exit_delay'].every(t => svg.includes(`>${t}<`)),
  'print: an SVG with the states, their actions and the arrows');
  ok(!/class="bar/.test(svg) && !svg.includes('NaN') && !svg.includes('undefined'), 'print: no progress bars, no NaN');
  const t = r.machines[0].table;
  ok(t.head.join('|') === 'State|arm_pressed|exit_delay|door_opened'
    && t.rows.map(row => row.join('|')).join('\n') === 'DISARMED|ARMING|–|–\nARMING|DISARMED|ARMED|–\nARMED|DISARMED|–|ALARM\nALARM|DISARMED|–|–',
  'print: the transition table', JSON.stringify(t));
  const s = print(EX.stopwatch).machines[0].table.rows.find(row => row[0] === 'SW_RUNNING');
  ok(JSON.stringify(s) === JSON.stringify(['SW_RUNNING', 'SW_STOPPED', '| print "lap"']), 'print: an internal action in the table', JSON.stringify(s));
  ok(print(EX.stopwatch).machines[0].svg.includes('>LAP | print &quot;lap&quot;<') && print(EX.switch).machines[0].svg.includes('>pressed | LED on<')
    && JSON.stringify(print(EX.switch).machines[0].table.rows[0]) === JSON.stringify(['LIGHT_OFF', 'LIGHT_ON | LED on']),
  'print: | between the event and the actions, in the boxes, on the arrows and in the table');
  const b = print(EX.button);
  ok(b.machines.map(x => x.title).join('|') === 'btn_just_pressed()|light switch' && b.machines[0].svg.includes('>[pin high for 50 ms]<')
    && b.machines[0].svg.includes('>| send pressed<'), 'print: machines side by side, each with its title; a held condition in brackets');
  ok(print({states: {A: {entry: 'X on'}}}).error === 'state A, entry: there is no output X. Add it under outputs:, e.g. outputs: {X: red led}',
    'print: a mistake is the error, with no picture');
  ok(print(EX.kitchen).machines[0].svg.includes('print &quot;Cooking, wait...&quot;'), 'print: quotes in the SVG are escaped');
}

console.log(failed.length ? `FAILED:\n  ${failed.join('\n  ')}` : '');
console.log(`${passed} ok, ${failed.length} failed`);
if (failed.length) Deno.exit(1);
