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
  // an internal action on a named timer, and an exit action
  blinker: {title: 'The blinker', inputs: {led_set_on: 'button', led_set_off: 'button', led_set_blinking: 'button'}, outputs: {LED: 'amber led'},
    states: {BLINKER_OFF: {entry: 'LED off', on: {led_set_on: 'BLINKER_ON', led_set_blinking: 'BLINKER_BLINKING'}},
      BLINKER_ON: {entry: 'LED on', on: {led_set_off: 'BLINKER_OFF', led_set_blinking: 'BLINKER_BLINKING'}},
      BLINKER_BLINKING: {entry: 'LED on, start next_toggle 500 ms', exit: 'stop next_toggle',
        on: {led_set_off: 'BLINKER_OFF', led_set_on: 'BLINKER_ON', led_set_blinking: 'BLINKER_BLINKING', next_toggle: '/ LED toggle, start next_toggle 500 ms'}}}},
  // an event with a value, kept in a variable, which a time reads
  adjustable: {title: 'The adjustable blinker', inputs: {led_set_on: 'button', led_set_blinking: 'button [100, 500, 1000]'}, outputs: {LED: 'amber led'},
    variables: {interval: 500},
    states: {BLINKER_ON: {entry: 'LED on', on: {'led_set_blinking(period)': 'BLINKER_BLINKING / interval = period'}},
      BLINKER_BLINKING: {entry: 'LED on, start next_toggle interval ms', exit: 'stop next_toggle',
        on: {led_set_on: 'BLINKER_ON', 'led_set_blinking(period)': 'BLINKER_BLINKING / interval = period', next_toggle: '/ LED toggle, start next_toggle interval ms'}}}},
  // lesson 2's stopwatch, with its numbers
  numbers: {title: 'The stopwatch', direction: 'TB', text: 'terminal', inputs: {START: 'button', LAP: 'button'}, outputs: {LED: 'green led'},
    variables: {stored: 0, run_start: 0, lap: 1},
    states: {SW_RESET: {entry: 'stored = 0, lap = 1, LED off, print "reset"', on: {START: 'SW_RUNNING'}},
      SW_RUNNING: {entry: 'run_start = now', do: 'blink LED 250 ms', exit: 'stored += now - run_start',
        on: {START: 'SW_STOPPED', LAP: '/ print "Lap {lap}: {stored + now - run_start:s}", lap++'}},
      SW_STOPPED: {entry: 'LED on, print "Stopped at {stored:s}"', on: {START: 'SW_RUNNING', LAP: 'SW_RESET'}}}},
  // two arrows for one timeout, chosen by guards
  rounds: {title: 'Rounds', inputs: {pressed: 'button'}, variables: {attempt: 0}, text: 'terminal',
    states: {READY: {entry: 'print "Attempt {attempt + 1} of 3"', on: {pressed: 'RESULT / attempt++'}},
      RESULT: {on: {'after 2 s [attempt < 3]': 'READY', 'after 2 s [attempt == 3]': 'SUMMARY'}},
      SUMMARY: {entry: 'print "done"', on: {pressed: 'READY / attempt = 0'}}}},
  // a timeout that waits for its guard: the minimum green of a pedestrian crossing
  crossing: {title: 'The crossing', inputs: {pressed: 'button', withdrawn: 'button'}, outputs: {WAIT: 'amber led'}, variables: {request: false},
    states: {GREEN: {on: {pressed: '/ request = true, WAIT on', withdrawn: '/ request = false, WAIT off', 'after 8 s [request]': 'AMBER'}},
      AMBER: {on: {'after 2 s': 'GREEN / request = false, WAIT off'}}}},
  // guards on one event: a count instead of a state per count; the last arrow has no guard
  lock: {title: 'Three presses', inputs: {pressed: 'button'}, outputs: {LED: 'green led'}, variables: {count: 0},
    states: {LOCKED: {entry: 'LED off', on: {'pressed [count < 2]': '/ count++', pressed: 'OPEN / count = 0'}},
      OPEN: {entry: 'LED on', on: {'after 3 s': 'LOCKED'}}}},
  // each machine has its own n; total is shared; a machine sends a value to the other
  pair: {title: 'Two machines', inputs: {go: 'button'}, variables: {total: 0},
    machines: {
      a: {variables: {n: 0}, states: {A: {on: {go: '/ n++, total++, send add(n * 10)'}}}},
      b: {variables: {n: 100}, states: {B: {on: {'add(x) [x < 30]': '/ n += x, total += 1', 'add(x)': 'C / n = x'}}, C: {}}}}},
  door: {title: 'The burglar alarm, with a door', direction: 'TB', log: 'hidden', inputs: {btn_pressed: 'button', door: 'pin [open, closed]'}, outputs: {LED: 'red led'},
    states: {DISARMED: {entry: 'LED off', on: {btn_pressed: 'ARMING'}},
      ARMING: {entry: 'LED on, start exit_delay 10 s', do: 'blink LED 500 ms', on: {btn_pressed: 'DISARMED', 'exit_delay [door closed]': 'ARMED', 'exit_delay [door open]': 'RINGING'}},
      ARMED: {entry: 'LED on', on: {'door open': 'RINGING', btn_pressed: 'DISARMED'}},
      RINGING: {entry: 'LED on', do: 'blink LED 100 ms', on: {btn_pressed: 'DISARMED'}}}},
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
    side: '1×', stopwatch: '1×', long: '1×', kitchen: '1× 2× 5×', traffic: '1× 2× 5×', blinker: '1×', adjustable: '1×', numbers: '1×', rounds: '1× 2×',
    crossing: '1× 2× 5×', lock: '1× 2×', pair: '1×', door: '1× 2× 5× 10×'};
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
c = copy(EX.staircase); c.states.LIGHT_ON.on = {'[t > 10]': 'LIGHT_OFF'}; bad(c, /a guard needs an event in front of it/, 'a guard without an event');
c = copy(EX.button); c.machines.button.states.RELEASED.on = {'pin high for 10..50 ms': 'PRESSED'}; bad(c, /a random time .* is not possible here/, 'a random held time');
// variables, guards and values
const vm = (variables, A, more = {}) => Object.assign({inputs: {b: 'button'}, variables, states: {A}}, more);
bad(vm({n: 0}, {on: {b: '/ m++'}}), /there is no variable m \(variables: n\)/, 'a variable with a typo');
bad({inputs: {b: 'button'}, states: {A: {entry: 'n = 1', on: {b: 'A'}}}}, /there is no variable n. Add it under variables:/, 'a variable that is not declared');
bad(vm({n: 1.5}, {}), /"1.5" is not a value. A variable starts as a whole number or as true or false/, 'a variable that starts as a fraction');
bad(vm({n: '500 ms'}, {}), /"500 ms" is not a value/, 'a variable that starts as a time');
bad(vm({now: 0}, {}), /"now" is a word of the state machine language/, 'a variable named now');
bad(vm({start: 0}, {}), /"start" is a word of the state machine language/, 'a variable named like an action');
bad(vm({b: 0}, {}), /b is an input too/, 'a variable named like an input');
bad(vm({n: 0}, {entry: 'start n 1 s', on: {b: 'A'}}), /n is a timer and a variable/, 'a variable named like a timer');
bad(vm({n: 0}, {on: {'b [n]': 'A'}}), /the guard \[n\] is a number, and a guard is true or false. Write for example \[n > 0\]/, 'a guard that is a number');
bad(vm({n: true}, {on: {'b [n > 0]': 'A'}}), /"n > 0": > works on numbers, and n is true or false/, 'a boolean compared as a number');
bad(vm({n: 0, f: true}, {on: {'b [n == f]': 'A'}}), /== compares two values of one kind/, 'a number compared with a boolean');
bad(vm({n: 0}, {on: {'b [n && true]': 'A'}}), /&& works on true or false, and n is a number/, 'a number in a logical and');
bad(vm({f: true}, {entry: 'f++', on: {b: 'A'}}), /"f\+\+": f is true or false, not a number/, '++ on a boolean');
bad(vm({n: 0}, {entry: 'n = true', on: {b: 'A'}}), /"n = true": n is a number, and true is true or false/, 'a boolean in a number');
bad(vm({f: true}, {entry: 'f += 1', on: {b: 'A'}}), /"f \+= 1": \+= works on numbers/, '+= on a boolean');
bad(vm({n: 0}, {entry: 'n = 1.5', on: {b: 'A'}}), /a value is a whole number here. Count in ms: 1500, not 1.5/, 'a fraction in an expression');
bad(vm({n: 0}, {entry: 'n = (1 + 2', on: {b: 'A'}}), /a \) is missing/, 'a bracket that is not closed');
bad(vm({n: 0}, {entry: 'n = ', on: {b: 'A'}}), /"" is not a value/, 'an assignment without a value');
bad(vm({n: 0}, {on: {'b [n > ]': 'A'}}), /"" is not a value/, 'a guard that stops halfway');
bad(vm({n: 0}, {on: {'b [n > 0 n]': 'A'}}), /the guard \[n > 0 n\] cannot be read after "n > 0"/, 'a guard with something behind it');
bad(vm({n: 0}, {entry: 'print "{n"', on: {b: 'A'}}), /print: \{ starts a value and needs a \}/, 'a print with a value that is not closed');
bad(vm({n: 0}, {entry: 'print "{m}"', on: {b: 'A'}}), /there is no variable m/, 'a print with a variable that does not exist');
bad(vm({f: true}, {entry: 'print "{f:s}"', on: {b: 'A'}}), /only a number can be a time/, 'a boolean as a time');
bad(vm({f: true}, {entry: 'start T f ms', on: {b: 'A', T: 'A'}}), /a time is a number, and f is true or false/, 'a boolean as a time of a timer');
bad(vm({n: 0}, {entry: 'start T n', on: {b: 'A', T: 'A'}}), /start needs a timer and a time/, 'a time from a variable without a unit');
bad(vm({n: 0}, {on: {'after n': 'A', b: 'A'}}), /"n" is not a time/, 'an after from a variable without a unit');
bad(vm({n: 0}, {on: {'after 1 s [now > 5]': 'A', b: 'A'}}), /uses now, on an event that waits for its guard/, 'a timeout with a guard on now');
bad(vm({n: 0}, {entry: 'start T 1 s', on: {'T [now > 5]': 'A', b: 'A'}}), /uses now, on an event that waits for its guard/, 'a timer with a guard on now');
bad({inputs: {b: 'button'}, outputs: {L: 'led'}, variables: {n: 0}, states: {A: {do: 'n = 1', on: {b: 'A'}}}}, /"n =" cannot be a do activity/, 'an assignment under do:');
bad({inputs: {b: 'button'}, outputs: {L: 'led'}, variables: {n: 1}, states: {A: {entry: 'blink L n ms', on: {b: 'A'}}}}, /blink is a do activity/, 'blink with a variable under entry:');
bad({inputs: {b: 'button'}, machines: {x: {variables: {n: 0}, states: {A: {on: {b: 'A'}}}}, y: {states: {B: {entry: 'n = 1'}}}}}, /n is a variable of machine x. A machine sees only its own/, 'a variable of another machine');
bad({inputs: {b: 'button'}, variables: {n: 0}, machines: {x: {variables: {n: 0}, states: {A: {on: {b: 'A'}}}}}}, /n is under the variables of the block too/, 'a name for a shared and an own variable');
bad({inputs: {b: 'button [1, 2]'}, states: {A: {on: {'b(x)': '/ y = x'}}}}, /there is no variable y/, 'an arrow that assigns to something undeclared');
bad({inputs: {b: 'button [1, 2]'}, variables: {y: 0}, states: {A: {entry: 'y = x', on: {'b(x)': 'A'}}}}, /there is no variable x/, 'a parameter outside its arrow');
bad({inputs: {b: 'button'}, states: {A: {on: {'b(x)': 'A'}}}}, /b has no value to call x. Give the button its values/, 'a parameter of a button without values');
bad({inputs: {b: 'button'}, states: {A: {entry: 'start T 1 s', on: {b: 'A', 'T(x)': 'A'}}}}, /T is a timer: it has no value to call x/, 'a parameter of a timer');
bad({inputs: {b: 'button'}, states: {A: {on: {b: 'A / send e', 'e(x)': 'A'}}}}, /send e has no value, but .* calls it x. Write send e\(1\)/, 'a parameter of a send without a value');
bad({inputs: {k: 'hold button'}, states: {A: {on: {'k(x)': 'A'}}}}, /k is a hold button: only a button can have a value/, 'a parameter of a hold button');
bad({inputs: {b: 'button [1, 2]'}, variables: {x: 0}, states: {A: {on: {'b(x)': 'A'}}}}, /the parameter x has the name of a variable/, 'a parameter named like a variable');
bad({inputs: {b: 'button [1, 2]'}, variables: {f: true}, states: {A: {on: {'b(x)': '/ f = x'}}}}, /"f = x": f is true or false, and x is a number/, 'a number parameter in a boolean');
bad({inputs: {b: 'button'}, states: {A: {on: {b: '/ send e(1), send e(true)', 'e(x)': 'A'}}}}, /send e\(true\): the values of e are a number, and true is true or false/, 'two kinds of values for one event');
bad({inputs: {b: 'button [1, true]'}, states: {A: {on: {'b(x)': 'A'}}}}, /all values are numbers, or all are true and false/, 'values of two kinds');
bad({inputs: {b: 'button [1, 1]'}, states: {A: {on: {'b(x)': 'A'}}}}, /a value appears twice/, 'a value twice');
bad({inputs: {b: 'button [one]'}, states: {A: {on: {'b(x)': 'A'}}}}, /"one" is not a value/, 'a value that is a word');
bad({inputs: {b: 'button []'}, states: {A: {on: {b: 'A'}}}}, /the list of values is empty/, 'an empty list of values');
bad({inputs: {b: 'hold button [1]'}, states: {A: {}}}, /only a button can send a value/, 'values on a hold button');
// the level of an input, and a pin's own words
const lv = (guard, door = 'pin') => ({inputs: {b: 'button', door}, states: {A: {on: {[`b [${guard}]`]: 'A'}}}});
bad(lv('door'), /door has a level: write door high or door low/, 'a guard with the name of a pin and no level');
bad(lv('door up'), /door has a level: write door high or door low/, 'a guard with a word the pin does not have');
bad(lv('door high', 'pin [open, closed]'), /door has a level: write door open or door closed/, 'own words replace high and low in a guard');
bad(lv('door'), /state A, on b \[door\]/, 'a mistake in a level says where it is');
bad(lv('door', 'hold button'), /door has a level: write door pressed or door released/, 'a guard with the name of a hold button and no level');
bad(lv('b'), /b is a click button: it has no level, only an event. For a level, make it a hold button or a pin/, 'a click button has no level');
bad(lv('b pressed'), /b is a click button: it has no level/, 'a click button has no level, whatever the word');
bad(lv('door high > 0'), /> works on numbers, and door high is true or false/, 'a level is true or false, not a number');
bad(lv('door high + 1'), /\+ works on numbers/, 'a level is no number in a sum');
bad(lv('door high for 1 s'), /the guard \[door high for 1 s\] cannot be read after "door high"/, 'a guard reads a level, not a held condition');
bad({inputs: {b: 'button', door: 'pin [open, closed]'}, states: {A: {on: {'door high': 'A', b: 'A'}}}}, /door is a pin: write door open or door closed/, 'own words replace high and low in an event');
bad({inputs: {b: 'button', door: 'pin [open, closed]'}, states: {A: {on: {'door low for 1 s': 'A', b: 'A'}}}}, /door is a pin: write door open or door closed/, 'own words replace high and low in a held condition');
bad({inputs: {b: 'button', door: 'pin'}, variables: {n: 0}, states: {A: {on: {b: 'A / n = door high'}}}}, /n is a number, and door high is true or false/, 'a level does not fit in a number');
bad({inputs: {b: 'button', door: 'pin'}, states: {A: {on: {b: 'A / start T door high ms', T: 'A'}}}}, /a time is a number, and door high is true or false/, 'a level is no time');
bad({inputs: {b: 'button', door: 'pin'}, states: {A: {entry: 'print "{door high:s}"', on: {b: 'A'}}}}, /only a number can be a time/, 'a level printed as a time');
for (const [words, what] of [['[a]', 'one word'], ['[a, a]', 'the same word twice'], ['[a, b, c]', 'three words'], ['[1, 2]', 'numbers'], ['[a, for]', 'the word for'], ['[]', 'no words']]) {
  bad({inputs: {p: `pin ${words}`}, states: {A: {on: {'p high': 'A'}}}}, /a pin can have two words of its own, for high and for low/, `a pin with ${what}`);
}
bad({inputs: {p: 'bouncy pin [a]'}, states: {A: {}}}, /a pin can have two words of its own/, 'a bouncy pin with one word');
bad({inputs: {b: 'bouncy button [a, b]'}, states: {A: {}}}, /only a button can send a value/, 'no own words on a bouncy button');
bad({inputs: {b: 'hold button [a, b]'}, states: {A: {}}}, /only a button can send a value/, 'no own words on a hold button');
{
  const w = read({inputs: {b: 'button [1, 2]', c: 'button'}, outputs: {L: 'led'}, variables: {unused: 0, used: 0},
    states: {A: {on: {b: 'A', 'after 1 s': '/ L toggle', c: 'A', 'c [used > 0]': 'A'}}}}).warnings.join('\n');
  ok(['variable unused is not used in any state', 'input b has values, but no arrow gives its value a name',
    'state A, on after 1 s: an internal action on after runs only once', 'tick: / …, start tick 1 s',
    'state A, on c [used > 0]: this arrow can never fire, because the arrow for c above it has no guard'].every(s => w.includes(s)), 'warnings about variables, values, guards and an internal after', w);
  const quiet = read({inputs: {b: 'button'}, machines: {x: {variables: {n: 0}, states: {A: {on: {b: 'A', 'after 1..2 s': 'A', 'after 1..2 s [n > 0]': 'A'}}}}}}).warnings.join('\n');
  ok(!/never fire/.test(quiet), 'no warning for random times, which each arrow draws by itself', quiet);
  // an arrow back into the state, whose entry actions undo what the arrow did
  const self = (arrow, entry, more = {}) => read({inputs: {b: 'button'}, outputs: {L: 'led', M: 'led'}, states: {A: {entry, on: {b: 'A', ...arrow}}, ...more}}).warnings.filter(x => /goes back into/.test(x));
  const trap = self({'after 500 ms': 'A / L toggle'}, 'L on, M on');
  ok(trap.length === 1 && trap[0].includes('state A, on after 500 ms: this arrow goes back into A, so its entry action L on runs right after L toggle, and the change never shows.')
    && trap[0].includes('use a named timer: tick: / L toggle, start tick 500 ms'), 'warning: an arrow back into the state whose entry undoes its toggle', trap.join());
  const press = read({inputs: {b: 'button'}, outputs: {L: 'led'}, states: {A: {entry: 'L on', on: {b: 'A / L off'}}}}).warnings.join();
  ok(press.includes('its entry action L on runs right after L off') && press.includes('use an internal action: b: / L off'), 'warning: for an event, it proposes an internal action', press);
  ok(self({'after 1 s': 'A / L toggle'}, 'L toggle').length === 1, 'warning: two toggles cancel each other out');
  ok(self({'after 1 s': 'A / L on, L toggle'}, 'L off').length === 2, 'warning: for every action on that output that differs');
  for (const [what, arrow, entry, more] of [
    ['no entry action on that output: this blinks', {'after 500 ms': 'A / L toggle'}, 'M on'],
    ['no entry actions', {'after 500 ms': 'A / L toggle'}, undefined],
    ['the same value', {'after 1 s': 'A / L on'}, 'L on'],
    ['an entry toggle after an arrow that sets the value: the arrow decides', {'after 1 s': 'A / L on'}, 'L toggle'],
    ['an internal action: no entry actions run', {'after 500 ms': '/ L toggle'}, 'L on'],
    ['an arrow to another state', {'after 500 ms': 'B / L toggle'}, 'L on', {B: {entry: 'L off'}}],
  ]) ok(self(arrow, entry, more).length === 0, `no such warning: ${what}`, self(arrow, entry, more).join());
  ok(read(EX.blinker).warnings.length === 0, 'no warning for the blinker with an internal action on a named timer');
  const unusedOwn = read({inputs: {b: 'button'}, machines: {x: {variables: {n: 0}, states: {A: {on: {b: 'A'}}}}}}).warnings.join('\n');
  ok(unusedOwn.includes('machine x: variable n is not used in any state'), 'a warning for a machine\'s own variable', unusedOwn);
}
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
// A signal may change with nobody listening: a level change is reported as ignored
// only if some state, of any machine, has an arrow for it. `ignored` is what the page
// turns into the status line and the flash.
const watch = config => {
  const log = [], ignored = [];
  const sim = new Sim(read(config), {log: e => log.push(e), ignored: e => ignored.push(e.name)}, rnd);
  return {sim, log, ignored, st: (k = 0) => sim.ms[k].state};
};
{ const {sim, st, log, ignored} = watch(EX.button);
  sim.holds.pin.bouncy = false;     // the checkbox unticked
  sim.press('pin', true); sim.advance(sim.t + 60);
  ok(st(0) === 'PRESSED' && st(1) === 'LIGHT_ON', 'bouncing off: the debouncer still reacts, 50 ms after the press');
  sim.press('pin', false); sim.advance(sim.t + 60);
  ok(st(0) === 'RELEASED', 'bouncing off: the debouncer still reacts, 50 ms after the release');
  ok(!ignored.length && !log.some(e => e.ignored), 'bouncing off: a level change that only a "for" condition watches is not reported', ignored.join()); }
{ const {sim, st, log, ignored} = watch({inputs: {KEY: 'hold button'}, states: {A: {on: {'KEY pressed for 1 s': 'B'}}, B: {on: {'KEY released for 1 s': 'A'}}}});
  sim.press('KEY', true); sim.advance(sim.t + 1100); sim.press('KEY', false); sim.advance(sim.t + 1100); sim.press('KEY', true);
  ok(st() === 'A' && !ignored.length && !log.some(e => e.ignored), 'a hold button with only "for" conditions: nothing is reported', ignored.join()); }
{ const {sim, st, log, ignored} = watch({inputs: {KEY: 'bouncy button', back: 'button'}, states: {A: {on: {'KEY pressed': 'B'}}, B: {on: {back: 'A'}}}});
  sim.holds.KEY.bouncy = false;     // the checkbox unticked
  sim.press('KEY', true); sim.press('KEY', false);
  ok(st() === 'B' && !ignored.length, 'KEY released, which no state has an arrow for, is not reported', ignored.join());
  sim.press('KEY', true);
  ok(ignored.join() === 'KEY pressed' && log.at(-1).ignored && log.at(-1).cause === 'KEY pressed', 'KEY pressed, in a state without an arrow for it, is reported and logged', ignored.join());
  sim.press('KEY', false); ignored.length = 0;
  sim.holds.KEY.bouncy = true;      // the checkbox ticked again
  sim.press('KEY', true); sim.advance(sim.t + 20);
  ok(!ignored.length, 'a bouncing input stays silent, also for a level change that some state has an arrow for', ignored.join()); }
// the level of an input in a guard: what counts is the level when the time is up
for (const [what, steps, want] of [
  ['the door stays closed', [[0, 'b']], 'ARMED'],
  ['the door is open when the time is up', [[0, 'b'], [3000, 'open']], 'RINGING'],
  ['the door was opened and closed again', [[0, 'b'], [3000, 'open'], [5000, 'closed']], 'ARMED'],
  ['the door was open before arming', [[0, 'open'], [1000, 'b']], 'RINGING'],
]) {
  const {sim, st} = run('door');
  for (const [t, what2] of steps) { sim.advance(t); if (what2 === 'b') sim.dispatch('btn_pressed'); else sim.press('door', what2 === 'open'); }
  sim.advance(12000);
  ok(st() === want && !sim.ms[0].late.size, `door: ${what}: ${want}, and nothing waits`, st());
}
{ const {sim, st} = run('door');
  sim.dispatch('btn_pressed'); sim.advance(10000); ok(st() === 'ARMED', 'door: ARMED when the time is up with the door closed', st());
  sim.press('door', true); ok(st() === 'RINGING', 'door: the event door open works next to guards that read the same input', st());
  sim.reset(); ok(st() === 'DISARMED' && sim.holds.door.level === false, 'door: reset brings the pin back to its second word'); }
{ const {sim, st, log} = run('door', Object.assign(copy(EX.door), {states: {...copy(EX.door).states,
    ARMING: {entry: 'start exit_delay 10 s', on: {'exit_delay [door closed]': 'ARMED'}}}}));
  sim.press('door', true); sim.dispatch('btn_pressed'); sim.advance(sim.t + 60000);
  ok(st() === 'ARMING' && log.some(e => e.waiting), 'one guard on a timer: it waits, while the door is open', st());
  sim.press('door', false); sim.advance(sim.t + 1);
  ok(st() === 'ARMED', 'one guard on a timer: it fires when the door closes', st()); }
{ const c = {inputs: {KEY: 'hold button', p: 'pin', go: 'button'}, states: {A: {on: {'after 1 s [KEY released]': 'B', 'go [p low && KEY pressed]': 'C'}}, B: {}, C: {}}};
  const {sim, st} = run(null, c);
  sim.press('KEY', true); sim.advance(2000); ok(st() === 'A', 'a timeout waits for the level of a hold button', st());
  sim.dispatch('go'); ok(st() === 'C', 'levels with && in a guard: pin low and KEY pressed', st());
  const r = run(null, c); r.sim.press('KEY', true); r.sim.advance(2000); r.sim.press('KEY', false); r.sim.advance(2001); ok(r.st() === 'B', 'after waits until the hold button is released', r.st()); }
{ const {sim, st} = run(null, {inputs: {KEY: 'hold button', p: 'pin [on, off]'}, states: {A: {on: {'p on for 50 ms [!(KEY pressed)]': 'B'}}, B: {}}});
  sim.press('KEY', true); sim.press('p', true); sim.advance(100); ok(st() === 'A', 'a held condition waits for a level in its guard', st());
  sim.press('KEY', false); sim.advance(sim.t + 1); ok(st() === 'B', 'a held condition fires when the level in its guard turns true; on and off can be a pin\'s words', st()); }
// a level is a value like any other, in every expression
{ const c = {text: 'terminal', inputs: {p: 'pin [open, closed]', go: 'button'}, outputs: {L: 'led'}, variables: {was: false, same: false},
    states: {A: {entry: 'was = p open', on: {go: 'A / same = p open == was, print "open: {p open}, closed: {!(p open)}" L on'}}}};
  const sim = new Sim(read(c), {}, rnd);
  ok(sim.shared.was === false, 'a level in an entry action, at the very start');
  sim.press('p', true); sim.dispatch('go');
  ok(sim.lines.at(-1) === 'open: true, closed: false' && sim.shared.was === true && sim.shared.same === false && sim.out.L === true,
    'a level in an assignment, a comparison and a print; the next action follows without a comma', `${sim.lines.at(-1)} ${JSON.stringify(sim.shared)}`); }
ok(!read({inputs: {p: 'pin', b: 'button'}, states: {A: {on: {'b [p high]': 'A'}}}}).warnings.length, 'an input that only a guard reads is used');
ok(!read({inputs: {p: 'pin', b: 'button'}, variables: {v: false}, states: {A: {on: {b: 'A / v = p high'}}}}).warnings.some(w => /input p/.test(w)), 'an input that only an action reads is used');
// a pin or a hold button never bounces; a bouncy one does, and a guard sees it
{ const m = read({inputs: {a: 'pin', b: 'pin [x, y]', c: 'bouncy pin', d: 'bouncy pin [x, y]', e: 'hold button', f: 'bouncy button'}, states: {A: {on: {'a high': 'A', 'b x': 'A', 'c high': 'A', 'd x': 'A', 'e pressed': 'A', 'f pressed': 'A'}}}});
  ok(Object.values(m.inputs).map(i => `${i.kind} ${i.bouncy} ${i.words}`).join('|') === 'pin false high,low|pin false x,y|pin true high,low|pin true x,y|button false pressed,released|button true pressed,released',
    'the kinds of inputs: bouncy or not, with their words', Object.values(m.inputs).map(i => `${i.kind} ${i.bouncy} ${i.words}`).join('|')); }
{ const c = kind => ({clock: true, inputs: {p: kind, go: 'button'}, variables: {n: 0}, states: {A: {on: {'go [p high]': '/ n++'}}}});
  const plain = new Sim(read(c('pin')), {}, rnd);
  plain.press('p', true);
  ok(plain.next(false) === null && plain.holds.p.trace.length === 2, 'a pin does not bounce: one change, nothing to skip to');
  const raw = new Sim(read(c('bouncy pin')), {}, rnd);
  raw.press('p', true);
  ok(raw.next(false)?.kind === 'bounce', 'a bouncy pin bounces');
  let lows = 0;
  for (let k = 0; k < 20 && raw.holds.p.flips.length; k++) { raw.advance(raw.holds.p.flips[0].t); if (!raw.holds.p.level) { lows++; raw.dispatch('go'); } }
  ok(lows > 0 && raw.shared.n === 0, 'a guard reads a bouncy pin as it is at that moment, bounces included, as gpio_get() does', `${lows} low, n = ${raw.shared.n}`);
  raw.dispatch('go');
  ok(raw.shared.n === 1, 'and high again after the bounces', `n = ${raw.shared.n}`);
  ok(read({inputs: {p: 'pin', b: 'button'}, states: {A: {on: {b: 'A', 'p high': 'A'}}}}).clock === false, 'a pin does not make a machine use time; a bouncy pin does');
  ok(read({inputs: {p: 'bouncy pin', b: 'button'}, states: {A: {on: {b: 'A', 'p high': 'A'}}}}).clock === true, 'a bouncy pin makes a machine use time'); }
// is a change reported as ignored? Only if some state has an arrow for it, and no current state reads the level
{ const {sim, st, ignored} = watch(EX.door);
  sim.press('door', true);
  ok(ignored.join() === 'door open', 'door open in DISARMED is reported: ARMED has an arrow for it, and nothing here reads the door', ignored.join());
  sim.press('door', false); ok(ignored.join() === 'door open', 'door closed is not reported: no state has an arrow for it', ignored.join());
  ignored.length = 0;
  sim.dispatch('btn_pressed'); ok(st() === 'ARMING');
  sim.press('door', true); sim.press('door', false);
  ok(!ignored.length, 'door open in ARMING is not reported: a guard there reads the door', ignored.join()); }
{ const {sim, ignored} = watch({inputs: {p: 'pin', go: 'button'}, machines: {a: {states: {A: {on: {'p high': 'B'}}, B: {on: {go: 'A'}}}}, b: {states: {C: {on: {'go [!(p high)]': 'C'}}}}}});
  sim.press('p', true); sim.press('p', false); sim.press('p', true);
  ok(!ignored.length, 'a guard in a current state of another machine reads the level too', ignored.join()); }
{ const {sim, ignored, log} = watch({inputs: {p: 'pin', go: 'button'}, variables: {f: false}, states: {A: {on: {'p high [f]': 'A', 'go [p high]': 'A'}}}});
  sim.press('p', true);
  ok(ignored.join() === 'p high' && log.at(-1).guards.join() === 'f', 'a false guard on the event itself is still reported, next to a guard that reads the level', ignored.join()); }
{ const {sim, st, ignored} = watch({inputs: {KEY: 'hold button'}, machines: {a: {states: {A: {on: {'KEY pressed': 'B'}}, B: {}}}, b: {states: {C: {}}}}});
  sim.press('KEY', true); sim.press('KEY', false);
  ok(st(0) === 'B' && !ignored.length, 'two machines: the arrow of one machine moves it, nothing is reported', ignored.join());
  sim.press('KEY', true);
  ok(ignored.join() === 'KEY pressed', 'two machines: an arrow in any machine makes the level change count', ignored.join()); }
{ const {sim, log, ignored} = watch({inputs: {KEY: 'hold button'}, variables: {f: false}, states: {A: {on: {'KEY pressed [f]': 'B'}}, B: {}}});
  sim.press('KEY', true);
  ok(ignored.join() === 'KEY pressed' && log.at(-1).guards.join() === 'f', 'a level change with a false guard is reported, with the guard', JSON.stringify(log.at(-1))); }
// A "for" arrow of a current state watches the input: a change starts or cancels its
// count, so it is no lost event, whatever arrows other states have.
{ const {sim, st, log, ignored} = watch({inputs: {KEY: 'hold button', go: 'button'},
    states: {A: {on: {'KEY pressed': 'A', 'KEY released': 'A', go: 'B'}}, B: {on: {'KEY pressed for 1 s': 'C'}}, C: {}}});
  sim.dispatch('go'); sim.press('KEY', true);
  ok(st() === 'B' && !ignored.length && !log.some(e => e.ignored), 'a "for" arrow in the current state: the press that starts its count is not reported', ignored.join());
  sim.advance(sim.t + 500); sim.press('KEY', false);
  ok(st() === 'B' && !ignored.length && !log.some(e => e.ignored), 'a "for" arrow in the current state: the release that cancels its count is not reported', ignored.join());
  sim.press('KEY', true); sim.advance(sim.t + 1100);
  ok(st() === 'C', 'a "for" arrow in the current state: it still fires after the whole time');
  sim.press('KEY', false);
  ok(ignored.join() === 'KEY released' && log.at(-1).cause === 'KEY released', 'in a state without the "for" arrow, the level change is reported again', ignored.join()); }
{ const {sim, st, ignored} = watch({inputs: {KEY: 'hold button', go: 'button'}, machines: {
    a: {states: {A: {on: {'KEY pressed for 1 s': 'A2'}}, A2: {}}},
    b: {states: {B: {on: {go: 'B2'}}, B2: {on: {'KEY pressed': 'B'}}}}}});
  sim.press('KEY', true);
  ok(st(0) === 'A' && !ignored.length, 'two machines: a "for" arrow of the other machine watches the input', ignored.join());
  sim.advance(sim.t + 1100); sim.press('KEY', false); sim.press('KEY', true);
  ok(st(0) === 'A2' && ignored.join() === 'KEY pressed', 'two machines: once no current state has a "for" arrow, the level change is reported', ignored.join()); }
{ const {sim, log, ignored} = watch({inputs: {KEY: 'hold button'}, variables: {f: false}, states: {A: {on: {'KEY pressed [f]': 'B', 'KEY pressed for 1 s': 'C'}}, B: {}, C: {}}});
  sim.press('KEY', true);
  ok(ignored.join() === 'KEY pressed' && log.at(-1).guards.join() === 'f', 'next to a "for" arrow, a false guard is still reported', JSON.stringify(log.at(-1))); }
{ const {sim, st, ignored} = watch({inputs: {KEY: 'hold button', go: 'button'}, variables: {f: false}, states: {A: {on: {'KEY pressed': 'A', go: 'B'}}, B: {on: {'KEY pressed for 1 s [f]': 'C'}}, C: {}}});
  sim.dispatch('go'); sim.press('KEY', true);
  ok(st() === 'B' && !ignored.length, 'a "for" arrow with a false guard still watches the input', ignored.join()); }
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

// ---- exit actions --------------------------------------------------------
{ // the order: exit, arrow, entry. An internal action runs none of them; an arrow back to the state runs both.
  const {sim} = run('order', {text: 'terminal', inputs: {b: 'button', i: 'button', s: 'button'},
    states: {A: {entry: 'print "A entry"', exit: 'print "A exit"', on: {b: 'B / print "arrow"', i: '/ print "internal"', s: 'A / print "self"'}}, B: {entry: 'print "B entry"'}}});
  sim.lines.length = 0;
  sim.dispatch('i'); ok(sim.lines.join('|') === 'internal', 'exit: an internal action runs no exit or entry', sim.lines.join('|'));
  sim.lines.length = 0;
  sim.dispatch('s'); ok(sim.lines.join('|') === 'A exit|self|A entry', 'exit: an arrow back to the state runs exit, the arrow and entry', sim.lines.join('|'));
  sim.lines.length = 0;
  sim.dispatch('b'); ok(sim.lines.join('|') === 'A exit|arrow|B entry', 'exit: exit, then the arrow, then entry', sim.lines.join('|')); }
{ // the page hears where a change comes from, and leave comes first
  const heard = [];
  const sim = new Sim(read({inputs: {b: 'button'}, outputs: {L: 'led'}, variables: {n: 0}, states: {A: {exit: 'L on, n = 5', on: {b: 'B / n++'}}, B: {entry: 'n *= 2'}}}), {
    leave: () => heard.push('leave'), effect: (s, fx, phase) => heard.push(`${phase} ${fx.out ?? fx.variable}=${fx.value}`)}, rnd);
  sim.dispatch('b');
  ok(heard.join('|') === 'leave|exit L=true|exit n=5|arrow n=6|entry n=12', 'exit: the page hears exit, arrow and entry, with outputs and variables', heard.join('|')); }
{ const {sim, st, log} = run('blinker');
  sim.dispatch('led_set_blinking'); ok(st() === 'BLINKER_BLINKING' && sim.out.LED, 'blinker: on at the start of BLINKING');
  sim.advance(600); ok(!sim.out.LED, 'blinker: an internal action on a named timer toggles at 500 ms');
  sim.advance(1100); ok(sim.out.LED && st() === 'BLINKER_BLINKING', 'blinker: and again at 1000 ms, without leaving the state');
  sim.advance(1600); ok(!sim.out.LED, 'blinker: and at 1500 ms');
  sim.dispatch('led_set_off'); ok(st() === 'BLINKER_OFF' && sim.timers.next_toggle === null, 'blinker: exit: stop next_toggle');
  sim.advance(3000); ok(!log.some(e => e.ignored), 'blinker: with the exit action, no timer runs out in another state'); }
// ---- values of events ----------------------------------------------------
{ const {sim, st, log} = run('adjustable');
  ok(sim.shared.interval === 500, 'adjustable: a variable starts with its value');
  sim.dispatch('led_set_blinking', 'input', 100);
  ok(st() === 'BLINKER_BLINKING' && sim.shared.interval === 100, 'adjustable: the value of the event, in a variable');
  ok(log.at(-1).cause === 'led_set_blinking(100)', 'adjustable: the log shows the value', log.at(-1).cause);
  sim.advance(150); ok(!sim.out.LED, 'adjustable: toggles after 100 ms');
  sim.advance(250); ok(sim.out.LED, 'adjustable: and after 200 ms');
  sim.dispatch('led_set_blinking', 'input', 1000);
  ok(sim.shared.interval === 1000 && sim.timers.next_toggle.total === 1000, 'adjustable: a new value, while blinking; the timer starts over', JSON.stringify(sim.timers.next_toggle));
  sim.reset(); ok(sim.shared.interval === 500 && st() === 'BLINKER_ON', 'adjustable: a reset brings back the first value'); }
{ const {sim, st, log} = run('pair');
  sim.dispatch('go');
  ok(sim.ms[0].vars.n === 1 && sim.ms[1].vars.n === 110 && sim.shared.total === 2, 'pair: each machine has its own n; total is shared; a value is sent', JSON.stringify([sim.values()]));
  ok(JSON.stringify(sim.values()) === '{"total":2,"a.n":1,"b.n":110}', 'pair: the variables as the page sees them', JSON.stringify(sim.values()));
  sim.dispatch('go'); ok(sim.ms[1].vars.n === 130 && st(1) === 'B', 'pair: a guard reads the value of the event');
  sim.dispatch('go'); ok(sim.ms[1].vars.n === 30 && st(1) === 'C', 'pair: the next arrow, without a guard, when the guard is false');
  ok(log.some(e => e.cause === 'add(30)'), 'pair: the log shows the value of a sent event'); }
// ---- guards --------------------------------------------------------------
{ const {sim, st} = run('lock');
  sim.dispatch('pressed'); sim.dispatch('pressed'); ok(st() === 'LOCKED' && sim.shared.count === 2, 'lock: the guard is true twice: internal actions');
  sim.dispatch('pressed'); ok(st() === 'OPEN' && sim.shared.count === 0 && sim.out.LED, 'lock: then the arrow without a guard'); }
{ const {sim, st, log} = run('rounds');
  for (let k = 0; k < 3; k++) { ok(st() === 'READY', `rounds: attempt ${k + 1}`); sim.dispatch('pressed'); sim.advance(sim.t + 2100); }
  ok(st() === 'SUMMARY' && sim.lines.join('|') === 'Attempt 1 of 3|Attempt 2 of 3|Attempt 3 of 3|done', 'rounds: guards choose between two arrows for one timeout', sim.lines.join('|'));
  ok(!log.some(e => e.waiting), 'rounds: one of the guards is always true, so nothing waits');
  sim.dispatch('pressed'); ok(st() === 'READY' && sim.shared.attempt === 0 && sim.lines.at(-1) === 'Attempt 1 of 3', 'rounds: the arrow starts a new round'); }
{ // a press with a false guard is lost: it is true for one iteration, as in C
  const {sim, st, log} = run('gate', {inputs: {b: 'button', open: 'button'}, variables: {f: false}, states: {A: {on: {'b [f]': 'B', open: '/ f = true'}}, B: {}}});
  sim.dispatch('b'); ok(st() === 'A' && log.at(-1).ignored && log.at(-1).guards.join() === 'f', 'guard: a press with a false guard is ignored; the log says why', JSON.stringify(log.at(-1)));
  sim.dispatch('open'); sim.advance(sim.t + 1000); ok(st() === 'A', 'guard: a press that was lost does not come back when the guard turns true');
  sim.dispatch('b'); ok(st() === 'B', 'guard: a press with a true guard'); }
// A timeout waits for its guard, as time_reached() stays true: `if (request && time_reached(t))`
{ const {sim, st} = run('crossing');
  sim.advance(1000); sim.dispatch('pressed'); sim.advance(7900); ok(st() === 'GREEN', 'crossing: true before the deadline: not yet');
  sim.advance(8100); ok(st() === 'AMBER' && sim.t === 8100, 'crossing: true at the deadline: it fires'); }
{ const {sim, st, log} = run('crossing');
  sim.advance(10000); ok(st() === 'GREEN' && log.some(e => e.waiting && e.t === 8000 && e.cause === 'after 8 s'), 'crossing: false at the deadline: it waits, and the log says when', JSON.stringify(log.at(-1)));
  ok(sim.pending(sim.ms[0])[0].blocked && sim.soonest(sim.ms[0]) === Infinity, 'crossing: the page sees that it waits for the guard, and no time is due');
  sim.dispatch('pressed'); sim.advance(sim.t); ok(st() === 'AMBER' && sim.t === 10000, 'crossing: the moment the guard turns true, it fires', `${st()} at ${sim.t}`); }
{ // true from 1 to 7 s, false at the deadline: it must not fire. Earlier true values do not count.
  const {sim, st} = run('crossing');
  sim.advance(1000); sim.dispatch('pressed'); sim.advance(7000); sim.dispatch('withdrawn');
  sim.advance(9000); ok(st() === 'GREEN', 'crossing: true before the deadline, false at it: it does not fire');
  sim.dispatch('pressed'); sim.advance(sim.t); ok(st() === 'AMBER', 'crossing: and it still waits for the guard'); }
{ // the time starts over when the machine enters the state again
  const {sim, st} = run('crossing');
  sim.advance(8500); sim.dispatch('pressed'); sim.advance(sim.t); ok(st() === 'AMBER', 'crossing: to AMBER');
  sim.advance(sim.t + 2100); ok(st() === 'GREEN' && !sim.shared.request, 'crossing: back in GREEN');
  sim.dispatch('pressed'); sim.advance(sim.t + 7000); ok(st() === 'GREEN', 'crossing: the new 8 s are not over'); }
{ // a named timer waits for its guard as long as the machine stays in the state
  const config = {inputs: {arm: 'button', go: 'button', other: 'button'}, variables: {f: false},
    states: {A: {entry: 'start T 1 s', on: {'T [f]': 'B', arm: '/ f = true', go: 'A', other: 'C'}}, B: {}, C: {on: {'T': 'B', arm: '/ f = true'}}}};
  let {sim, st, log} = run('late', config);
  sim.advance(2000); ok(st() === 'A' && log.some(e => e.waiting && e.cause === 'T') && !log.some(e => e.ignored), 'named timer: ran out, the guard is false: it waits, and is not ignored');
  sim.dispatch('arm'); sim.advance(sim.t); ok(st() === 'B', 'named timer: fires when the guard turns true');
  ({sim, st, log} = run('late', config));
  sim.advance(2000); sim.dispatch('go'); sim.dispatch('arm'); sim.advance(sim.t + 500);
  ok(st() === 'A', 'named timer: start T ends the waiting, the time starts over');
  sim.advance(sim.t + 600); ok(st() === 'B', 'named timer: and it runs out again');
  ({sim, st, log} = run('late', config));
  sim.advance(2000); sim.dispatch('other'); sim.advance(sim.t + 100); ok(st() === 'C', 'named timer: leaving the state ends the waiting'); }
{ // a held condition waits for its guard too
  const {sim, st} = run('held', {inputs: {KEY: 'hold button', arm: 'button'}, variables: {f: false}, states: {A: {on: {'KEY pressed for 1 s [f]': 'B', arm: '/ f = true'}}, B: {}}});
  sim.press('KEY', true); sim.advance(1500); ok(st() === 'A', 'held: the time is over, the guard is false');
  sim.dispatch('arm'); sim.advance(sim.t); ok(st() === 'B', 'held: fires when the guard turns true'); }
{ // Skip ahead stops at the deadline of a guarded timeout once, and then has nothing to do
  const {sim, st} = run('crossing');
  const to = sim.skip(); ok(to.what === 'after 8 s [request]' && sim.t === 8000 && st() === 'GREEN', 'skip: to the deadline of a guarded timeout', JSON.stringify(to));
  ok(sim.skip() === null, 'skip: then nothing is waiting for a time'); }
// ---- expressions, in C's order and with C's whole numbers ------------------
{ const value = (expr, variables = {}) => {
    const {sim} = run('expr', {inputs: {b: 'button'}, variables: {r: 0, ...variables}, states: {A: {entry: `r = ${expr}`, on: {b: 'A'}}}});
    return sim.shared.r;
  };
  for (const [expr, want] of [['2 + 3 * 4', 14], ['(2 + 3) * 4', 20], ['7 / 2', 3], ['-7 / 2', -3], ['7 % 3', 1], ['-7 % 3', -1], ['10 - 2 - 3', 5], ['2 * 3 % 4', 2], ['- 3 + 5', 2]]) {
    ok(Object.is(value(expr) + 0, want + 0), `expression: ${expr} is ${want}`, String(value(expr)));
  }
  const truth = (expr, variables = {}) => {
    const {sim} = run('truth', {inputs: {b: 'button'}, variables: {r: false, ...variables}, states: {A: {entry: `r = ${expr}`, on: {b: 'A'}}}});
    return sim.shared.r;
  };
  for (const [expr, want] of [['1 < 2 && 2 < 3', true], ['1 > 2 || 2 > 3', false], ['true || false && false', true], ['!true || true', true], ['1 + 1 == 2', true], ['1 != 1', false], ['2 <= 2', true], ['2 >= 3', false], ['!(1 == 2)', true]]) {
    ok(truth(expr) === want, `expression: ${expr} is ${want}`, String(truth(expr)));
  }
  const {sim, log} = run('div', {inputs: {b: 'button'}, variables: {n: 7, z: 0, f: false, r: 0, g: false},
    states: {A: {entry: 'g = f && 1 / z == 0', on: {b: '/ r = n / z, r = n % z, n /= z'}}}});
  ok(!log.some(e => e.error), 'expression: && stops at the first false, so 1 / z is not worked out');
  sim.dispatch('b');
  ok(sim.shared.r === 0 && sim.shared.n === 0 && log.filter(e => e.error).length === 3 && /division by zero/.test(log.find(e => e.error).error), 'expression: a division by zero gives 0 and a message', JSON.stringify(log.filter(e => e.error)));
  sim.dispatch('b'); ok(log.filter(e => e.error).length === 3, 'expression: the same message only once');
  const ops = run('ops', {inputs: {b: 'button'}, variables: {n: 10}, states: {A: {on: {b: '/ n++, n += 4, n -= 3, n *= 2, n /= 5, n %= 3, n--'}}}});
  ops.sim.dispatch('b'); ok(ops.sim.shared.n === 0, 'expression: every kind of assignment', String(ops.sim.shared.n));
  const twoLines = read({outputs: {L: 'led'}, variables: {n: 0}, inputs: {b: 'button'}, states: {A: {entry: 'n = n + 1 L on start T n * 2 + 1 ms stop T n++', on: {b: 'A', T: 'A'}}}}).machines[0].states.A.entry.map(a => a.src);
  ok(twoLines.join('|') === 'n = n + 1|L on|start T n * 2 + 1 ms|stop T|n++', 'expressions: actions one after another, without commas (YAML lines without dashes)', twoLines.join('|')); }
// ---- print with values; now; times from variables ------------------------
{ ok([[1730, '1.73 s'], [12340, '12.34 s'], [5, '0.00 s'], [1999, '1.99 s'], [-1500, '-1.50 s'], [0, '0.00 s'], [60000, '60.00 s']].every(([ms, s]) => I.inSeconds(ms) === s),
    ':s: a time in ms in seconds, cut off to hundredths, as lesson 2\'s stopwatch prints it');
  const p = read({inputs: {b: 'button'}, variables: {n: 3}, states: {A: {entry: 'print "\\{n\\} is {n}, {n * 2}!"', on: {b: 'A'}}}});
  const {sim} = run('print', {inputs: {b: 'button'}, variables: {n: 3, f: true}, states: {A: {entry: 'print "\\{n} is {n}, {n * 2}, {f}!"', on: {b: 'A'}}}});
  ok(sim.display === '{n} is 3, 6, true!', 'print: values, and \\{ for the character', sim.display);
  ok(p.machines[0].states.A.entry[0].parts.length > 1, 'print: a print with values is in parts'); }
{ const {sim, st} = run('numbers');
  ok(sim.lines.at(-1) === 'reset' && sim.shared.lap === 1, 'numbers: reset');
  sim.dispatch('START'); ok(st() === 'SW_RUNNING' && sim.shared.run_start === 0, 'numbers: running from 0 ms');
  sim.advance(1730); sim.dispatch('LAP');
  ok(sim.lines.at(-1) === 'Lap 1: 1.73 s' && sim.shared.lap === 2 && st() === 'SW_RUNNING', 'numbers: lap time, as the lesson prints it, an internal action', sim.lines.at(-1));
  sim.advance(3100); sim.dispatch('LAP'); ok(sim.lines.at(-1) === 'Lap 2: 3.10 s', 'numbers: lap 2', sim.lines.at(-1));
  sim.advance(4020); sim.dispatch('START');
  ok(st() === 'SW_STOPPED' && sim.shared.stored === 4020 && sim.lines.at(-1) === 'Stopped at 4.02 s', 'numbers: stopped; the exit action adds the run before the entry action prints', sim.lines.at(-1));
  sim.advance(9000); sim.dispatch('START'); sim.advance(11530); sim.dispatch('START');
  ok(sim.shared.stored === 6550 && sim.lines.at(-1) === 'Stopped at 6.55 s', 'numbers: resume, and the time goes on where it stopped', sim.lines.at(-1));
  sim.dispatch('LAP'); ok(st() === 'SW_RESET' && sim.shared.stored === 0 && sim.shared.lap === 1, 'numbers: LAP resets when stopped');
  ok(read(EX.numbers).clock, 'numbers: a machine that uses now has a clock');
  ok(read({inputs: {b: 'button'}, variables: {t: 0}, states: {A: {on: {b: '/ t = now'}}}}).clock, 'now alone gives a machine a clock');
  ok(!read({inputs: {b: 'button'}, variables: {t: 0}, states: {A: {on: {b: '/ t++'}}}}).clock, 'a variable alone does not'); }
{ const {sim, st} = run('times', {inputs: {b: 'button'}, outputs: {L: 'led'}, variables: {wait: 2000},
    states: {A: {on: {b: 'B / wait = 500'}}, B: {entry: 'wait = wait * 2', do: 'blink L wait ms', on: {'after wait ms': 'C', b: '/ start T 1 s'}}, C: {on: {b: '/ start T wait s', T: 'A'}}}});
  sim.dispatch('b'); ok(st() === 'B' && sim.ms[0].afters[0].total === 1000 && sim.ms[0].blinks[0].period === 1000, 'times: after and blink read a variable after the entry actions', JSON.stringify(sim.ms[0].afters[0].total));
  sim.advance(1100); ok(st() === 'C', 'times: after from a variable');
  sim.dispatch('b'); ok(sim.timers.T.total === 1000000, 'times: a variable in seconds', String(sim.timers.T.total)); }
{ const {sim, log} = run('zero', {inputs: {b: 'button'}, variables: {t: 0}, states: {A: {on: {b: '/ start T t ms', T: 'B'}}, B: {}}});
  sim.dispatch('b'); ok(log.some(e => e.error && /t ms is not longer than 0/.test(e.error)) && sim.timers.T.total === 1, 'times: 0 from a variable: 1 ms and a message', JSON.stringify(log.at(-1))); }
ok(read({inputs: {b: 'button'}, variables: {t: 60000}, states: {A: {on: {b: '/ start T t ms', T: 'A'}}}}).speeds.join() === '1,10,20,50', 'times: the speed buttons follow the first value of a variable');

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
  // guards, exit actions, values and variables
  const rt = print(EX.rounds).machines[0].table;
  ok(rt.head.join('|') === 'State|pressed|after 2 s' && rt.rows[1].join('|') === 'RESULT|–|[attempt < 3] READY; [attempt == 3] SUMMARY',
    'print: arrows for one event with different guards share a column and a cell', JSON.stringify(rt));
  const n = print(EX.numbers);
  ok(n.notes.join('|') === 'Variables: stored = 0, run_start = 0, lap = 1.' && n.machines[0].note === null, 'print: the variables and what they start with', JSON.stringify(n.notes));
  ok(n.machines[0].svg.includes('>exit: stored += now - run_start<'), 'print: an exit action in its box');
  const a = print(EX.adjustable);
  ok(a.notes.includes('Values of led_set_blinking: 100, 500, 1000.') && a.machines[0].svg.includes('led_set_blinking(period)')
    && a.machines[0].table.head.includes('led_set_blinking(period)'), 'print: an event with a value', JSON.stringify(a.notes));
  ok(print(EX.pair).machines.map(m => m.note).join('|') === 'Variables: n = 0.|Variables: n = 100.' && print(EX.pair).notes.join() === 'Variables: total = 0.', 'print: each machine\'s own variables, and the shared ones');
  ok(print(EX.crossing).machines[0].svg.includes('after 8 s [request]'), 'print: a guard on an arrow');
  const dp = print(EX.door).machines[0];
  ok(dp.table.head.join('|') === 'State|btn_pressed|exit_delay|door open' && dp.table.rows[1].join('|') === 'ARMING|DISARMED|[door closed] ARMED; [door open] RINGING|–'
    && dp.svg.includes('exit_delay [door closed]') && dp.svg.includes('exit_delay [door open]'), 'print: a pin\'s own words and a level in a guard', JSON.stringify(dp.table));
  const long = read({inputs: {set_interval: 'button [1, 2]'}, variables: {current_value: 0}, states: {A: {on: {'set_interval(x) [x > current_value]': 'A / current_value = x'}}}}).machines[0].states.A.on[0];
  ok(I.edgeLines(long).join('|') === 'set_interval(x)|[x > current_value]|| current_value = x', 'a long guard has a line of its own', I.edgeLines(long).join('|'));
}

console.log(failed.length ? `FAILED:\n  ${failed.join('\n  ')}` : '');
console.log(`${passed} ok, ${failed.length} failed`);
if (failed.length) Deno.exit(1);
