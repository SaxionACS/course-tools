# State machines

A ```` ```statemachine ```` block draws a state diagram from YAML, and on the
website students can run it: they press the input buttons and watch the
current state, the LEDs, the display, the timers and a log of every event. In
the PDF the block becomes a picture with a transition table.

This page describes everything a state machine can do. The
[authoring guide](authoring.md#state-machines) has the short version.

- [A first machine](#a-first-machine)
- [The YAML at a glance](#the-yaml-at-a-glance)
- [Inputs](#inputs)
- [Outputs](#outputs)
- [States](#states)
- [Events: the left side of `on:`](#events-the-left-side-of-on)
- [Arrows: the right side of `on:`](#arrows-the-right-side-of-on)
- [Actions](#actions)
- [Times](#times)
- [Variables](#variables)
- [Guards](#guards)
- [Events with a value](#events-with-a-value)
- [Several machines side by side](#several-machines-side-by-side)
- [How the machines behave](#how-the-machines-behave)
- [On the website](#on-the-website)
- [In the PDF](#in-the-pdf)
- [Mistakes and warnings](#mistakes-and-warnings)
- [Trying things out: `editable: true`](#trying-things-out-editable-true)
- [Examples](#examples)
- [What is not possible (yet)](#what-is-not-possible-yet)

**Gallery.** The course template has a page with many machines, each with its
YAML to change and apply:
[`references/statemachines.md`](https://github.com/SaxionACS/course_template/blob/main/references/statemachines.md).
It is a [draft](authoring.md#draft-pages): run `course preview` in the
template and open *References → State machine gallery*.

## A first machine

````markdown
```statemachine
title: The staircase light
inputs:
  pressed: button
outputs:
  LED: amber led
states:
  LIGHT_OFF:
    entry: LED off
    on:
      pressed: LIGHT_ON
  LIGHT_ON:
    entry: LED on
    on:
      pressed: LIGHT_ON
      after 10 s: LIGHT_OFF
```
````

- `inputs:` declares a button `pressed`. On the website it is a button to
  click; every click is the event `pressed`.
- `outputs:` declares an amber LED, named `LED`.
- `states:` lists the states. The first one is where the machine starts (the
  black dot in the diagram points at it).
- `entry:` actions run when the machine enters the state.
- `on:` lists the arrows out of the state: `event: TARGET`.
  `after 10 s` is an event too: 10 s after the machine entered the state.

The arrow from LIGHT_ON back to LIGHT_ON leaves the state and enters it
again, so the 10 s start over: pressing again keeps the light on.

On GitHub, the block reads as plain YAML.

## The YAML at a glance

Settings of the block:

| Key | Meaning |
|:--|:--|
| `title` | a title above the machine |
| `task` | what the student should do or look at, in a box (plain text) |
| `inputs` | the inputs, one per line: `NAME: kind` ([Inputs](#inputs)) |
| `outputs` | the outputs, one per line: `NAME: kind` ([Outputs](#outputs)) |
| `variables` | the variables, one per line: `name: first value` ([Variables](#variables)) |
| `states` | the states of the machine ([States](#states)) |
| `initial` | the state the machine starts in; the first state if left out |
| `machines` | instead of `states`: several machines side by side ([Several machines](#several-machines-side-by-side)) |
| `direction` | `LR` (left to right, the default) or `TB` (top to bottom) |
| `text` | `display` (the default) or `terminal`: what `print` writes on ([Actions](#actions)) |
| `speed` | the speed the machine starts at: `1` (real time, the default), slower (`1/4`, `1/10`, `1/100`, down to `1/1000`) or faster (`2`, `10`, up to `100`) |
| `speeds` | the speed buttons, for example `[1, 2, 10]` or `[1/100, 1/10, 1]`. By default they are chosen from the machine's times ([On the website](#on-the-website)) |
| `clock` | `true` or `false`: show the time and its controls (*Pause*, *Speed*, *Skip ahead*). By default only for machines that use time ([On the website](#on-the-website)) |
| `transition` | how long the dot takes along an arrow: `420 ms` (the default), `1 s`, up to `5 s`, or `0` for no dot. Only the picture waits for it ([On the website](#on-the-website)) |
| `log` | `open` (the default), `folded` (closed until the student opens it) or `hidden` (no log) |
| `editable` | `true`: in `course preview`, the YAML under the machine, to change and apply ([Trying things out](#trying-things-out-editable-true)) |

Every other key is a mistake (a typo such as `stats:` is reported, not
ignored).

Names of inputs, outputs, states, timers and events are made of letters,
digits and `_`, and do not start with a digit: `LIGHT_ON`, `arm_pressed`,
`exit_delay`. The words of the language cannot be names: `print`, `clear`,
`start`, `stop`, `send`, `blink`, `after`, `on`, `off`, `toggle`. A variable
or a parameter cannot be called `true`, `false`, `now`, `ms` or `s` either.

## Inputs

Every input is declared, with its kind. An event that is not an input, a
timer or a sent event is a mistake, so a typo is reported instead of becoming
a button that does nothing.

| Kind | On the website | Its events |
|:--|:--|:--|
| `button` | a button; every click is one event | `NAME` |
| `button [100, 500, 1000]` | a button with a list of values next to it; every click is one event with the value chosen in the list ([Events with a value](#events-with-a-value)) | `NAME`, or `NAME(value)` to use the value |
| `hold button` | a button that is down while the student holds it (mouse, touch, or Space/Enter on the keyboard) | `NAME pressed`, `NAME released`, and `NAME pressed for 1 s` |
| `pin` | a switch: a click sets the pin high, the next click low. The button shows the level | `NAME high`, `NAME low`, and `NAME high for 50 ms` |
| `pin [open, closed]` | a pin with its own words for high and low | `NAME open`, `NAME closed`, and `NAME open for 50 ms` |
| `bouncy button` | a hold button that bounces, with a checkbox and a trace | as `hold button` |
| `bouncy pin`, `bouncy pin [open, closed]` | a pin that bounces, with a checkbox and a trace | as `pin` |

A `button` is a press that the software has already cleaned up: one click is
one event, as `btn_just_pressed()` returns `true` once per press. Use it in
most machines. A `hold button` or a `pin` is a signal with a level. It has
events when it changes, and guards and actions can read its level at any moment
([Guards](#guards)). Use one when a machine asks how an input *is*, or for how
long it has been that way, not only when it changes: a door that must be closed,
or a long press.

**A pin and a bouncy pin are different inputs.** A `pin` or a `hold button`
changes cleanly, once per click or press, and has only its button. A *bouncy*
input is the raw signal of a contact, for a debouncer: at every change it flips
two to four times back and forth within the first 12 ms. It has a row of its
own, with a checkbox to switch the bouncing off and on, and a trace of its level
over the last 8 seconds of real time (at 1/100 speed: the last 80 ms).

**Own words for a pin.** `door: pin [open, closed]` names the levels. The first
word is high, what a click gives; the second is low, where the pin starts. The
words replace `high` and `low` everywhere: `door open: ALARM`, `door closed for
1 s: ARMED`, `exit_delay [door closed]: ARMED`, and on the button. A hold button
always has `pressed` and `released`.

Inputs appear on the website in the order of `inputs:`, the bouncy ones after
the others.

## Outputs

| Kind | On the website |
|:--|:--|
| `led` | a red LED |
| `red led`, `green led`, `amber led`, `yellow led`, `blue led`, `white led` | an LED of that colour |
| `buzzer` | a speaker icon that shows sound waves while it is on. No sound is played. |

Outputs start off. Actions switch them: `LED on`, `LED off`, `LED toggle`;
`blink` (under `do:`) makes an LED blink.

There is no output to declare for text: `print` writes on a display or a
terminal, which appears when a machine prints ([Actions](#actions)).

## States

```yaml
states:
  ARMING:
    entry: start exit_delay 10 s
    do: blink LED 500 ms
    on:
      arm_pressed: DISARMED
      exit_delay: ARMED
```

Every state has a name and, all optional:

| Key | Meaning |
|:--|:--|
| `entry` | actions that run when the machine enters the state. Drawn in the box as `entry: …` |
| `do` | an activity while the machine is in the state. The only one is `blink OUTPUT time`: the output toggles every `time`. Drawn as `do: …` |
| `exit` | actions that run when the machine leaves the state, whichever arrow it takes. Drawn in the box as `exit: …` |
| `on` | the arrows out of the state, one per line: `event: arrow` |

A state with none of these is written `NAME: {}` or just `NAME:`.

Use an exit action for what belongs to leaving the state, however that
happens: `exit: stop next_toggle` saves writing `stop next_toggle` on every
arrow out of the state.

## Events: the left side of `on:`

| Event | When it happens |
|:--|:--|
| `pressed` | a click on the `button` named `pressed` |
| `KEY pressed`, `KEY released` | a `hold button` named KEY goes down or up |
| `pin high`, `pin low` | a `pin` named pin goes high or low |
| `door open`, `door closed` | the same, for `door: pin [open, closed]` |
| `KEY pressed for 1 s`, `pin high for 50 ms` | the input has been in that level for that long without a break. Drawn as `[pin high for 50 ms]` |
| `after 10 s` | 10 s after the machine entered the state. A random time: `after 2..5 s` |
| `exit_delay` | the named timer `exit_delay` runs out (started with `start exit_delay 10 s`) |
| `pressed` | another machine sends `pressed` (`send pressed`) |
| `set_blinking(period)` | the event `set_blinking`, whose value this arrow calls `period` ([Events with a value](#events-with-a-value)) |

Any of these can have a guard behind it: `pressed [count < 3]`,
`after 2 s [attempt == 5]` ([Guards](#guards)).

A state can react to an event with several arrows, if they have guards. An
event that the current state has no arrow for is ignored ([How the machines
behave](#how-the-machines-behave)).

**Held conditions** (`… for T`) count from the moment the input reached the
level, or from the moment the machine entered the state, whichever is later.
Every bounce starts the count again. That is the counter of
`btn_just_pressed()`, which restarts its timeout whenever the pin still has
its old level:

```c
if (gpio_get(btn->pin) == btn->down) { btn->debounce_time = make_timeout_time_ms(DEBOUNCE_MS); return false; }
if (!time_reached(btn->debounce_time)) return false;
btn->down = !btn->down; return btn->down;
```

So `pin high for 50 ms` in state RELEASED is that code with `down == false`.
See [the debouncer](#the-debouncer-btn_just_pressed).

**`after` and named timers** differ:

- `after 10 s` belongs to its state. It starts when the machine enters the
  state and stops when the machine leaves it. Write it when the state itself
  times out.
- A named timer is started by an action (`start exit_delay 10 s`), runs until
  it runs out or is stopped (`stop exit_delay`), and belongs to no state:
  when it runs out, the machine may be in another state, which reacts to it
  or ignores it. Write it when the time is started in one place and used in
  another, or when it must keep running across states.

## Arrows: the right side of `on:`

| Arrow | Meaning |
|:--|:--|
| `LIGHT_ON` | go to LIGHT_ON |
| `LIGHT_ON / LED on` | go to LIGHT_ON, running the actions after the `/` on the way |
| `/ print "lap"` | an *internal action*: run the actions and stay, without leaving the state |

The diagram shows a `|` between the event and the actions:
`pressed | LED on`. In the YAML, `|` works as well as `/`
(`LIGHT_ON | LED on`), but a value that *starts* with `|` needs quotes, because
YAML reads it as the start of a block of text: `LAP: '| print "lap"'`. With
`/`, no quotes are needed.

An arrow to the state itself (`pressed: LIGHT_ON` in LIGHT_ON) leaves the
state and enters it again: its entry actions run again and its `after` timers
start over. An internal action does neither; the state's `after` timers keep
running. Internal actions are drawn inside the state's box, under its
entry and do lines, as `LAP | print "lap"`.

## Actions

| Action | What it does |
|:--|:--|
| `LED on`, `LED off`, `LED toggle` | switch an output (an LED or a buzzer) |
| `print "Get ready"` | text on the display or terminal (the quotes are needed) |
| `clear` | empty the display or terminal |
| `start T 10 s` | start the named timer T; a running timer starts over. A random time: `start T 2..5 s` |
| `stop T` | stop the named timer T (nothing happens if it does not run) |
| `send pressed` | send the event `pressed` to all machines ([Several machines](#several-machines-side-by-side)) |
| `send set_blinking(250)` | the same, with a value ([Events with a value](#events-with-a-value)) |
| `blink LED 500 ms` | only under `do:`: toggle the output every 500 ms |
| `lap = 1`, `lap++`, `lap--`, `stored += now - run_start` (also `-=`, `*=`, `/=`, `%=`) | change a variable ([Variables](#variables)) |

`text: display` (the default) shows one line of text, like a small LCD: each
`print` replaces the text. `text: terminal` is like a serial terminal (USB):
each `print` adds a line, and it scrolls. Use the display when a machine
prints often, so that the text does not flood; the log already shows every
event.

**Several actions** can be written in three ways:

```yaml
entry: LED on, start T 10 s              # one line, commas
entry: [LED on, start T 10 s]            # a YAML list on one line
entry:                                   # a YAML list
  - LED on
  - start T 10 s
entry:                                   # lines without dashes
  LED on
  start T 10 s
```

The last form works because actions may follow each other without commas:
YAML joins lines without dashes into one line, `LED on start T 10 s`, and
that still reads as two actions.

**YAML quoting.** A text with `: ` (colon and space) or ` #` in it confuses
YAML: put single quotes around the whole value.

```yaml
entry: 'print "Time: 10 s"'
```

Inside `[ ]`, a comma always ends an item, also inside quotes; use a list
with dashes for a print with a comma. In a `print`, write `\"` for a double
quote in the text, and `\{` for a `{`, which otherwise starts a value:

```yaml
entry: print "Lap {lap}"                    # Lap 3
entry: 'print "Time: {stored:s}"'           # Time: 4.02 s
```

`{expression}` prints a value. `{expression:s}` prints a number of ms in
seconds, with two decimals: cut off, not rounded, as the integer division in C
does.

## Times

Times are written with a unit: `500 ms`, `10 s`, `1.5 s` (`10s` works too).
A random time is a range, `2..5 s`, and is drawn again every time the timer
starts or the state is entered; it can be used in `after` and `start`, not in
held conditions or `blink`.

A time can also come from a variable or an expression, again with its unit:
`start next_toggle interval ms`, `after delay * 2 ms`, `blink LED interval ms`.
It is worked out when the timer starts, or after the entry actions of the
state, so an entry action can set it. Not in held conditions. A time that is
not longer than 0 is a message in the log, and the machine uses 1 ms.

## Variables

Numbers that a machine remembers go into variables: its *extended state*.
Declare them with their first value, a whole number or `true` or `false`:

```yaml
variables:
  lap: 1
  stored: 0
  running: false
```

Use a variable for a value the machine keeps, and a state for something that
changes how the machine reacts to events.

Actions change variables (`lap = 1`, `lap++`, `stored += now - run_start`);
guards, times and `print` read them. They hold whole numbers of any size up to
2^53 and do not overflow: this is not C's `int`. Reset brings back the first
values.

**Expressions** use C's operators, in C's order: `+ - * / %`, `< <= > >=`,
`== !=`, `! && ||` and brackets. `/` and `%` work as in C on whole numbers:
`7 / 2` is 3, `-7 / 2` is -3, `-7 % 3` is -1. `&&` and `||` stop as soon as the
answer is known.

`now` is the time since the start, in ms. There are no fractions (write `1500`
for 1.5 s), no arrays and no text.

The level of a hold button or a pin is a value too: `door closed` or `KEY
pressed` is true or false at this moment. It works in every expression:
`[door closed && count < 3]`, `was_open = door open`, `print "open: {door open}"`.
`door` alone is a mistake, because it does not say which level, and so is the
name of a click button, which has no level.

Numbers and booleans do not mix, unlike in C: `[count]` is a mistake (write
`[count > 0]`), and so is `count = true`. Dividing by zero gives 0 and a message
in the log.

## Guards

A guard is a condition behind an event, in square brackets. The arrow can only
fire while its guard is true:

```yaml
RESULT:
  on:
    after 2 s [attempt < 5]: READY
    after 2 s [attempt == 5]: SUMMARY
LOCKED:
  on:
    pressed [count < 2]: / count++
    pressed: OPEN / count = 0
```

In a state, the arrows are tried in the order of `on:`, as `if` and `else if`
in C: the first one whose guard is true fires, and an arrow without a guard
last is the `else`.

**When is the guard looked at?** An arrow fires in the first moment that its
event and its guard are both true, as this C in a superloop:

```c
if (pressed && count < 2) { ... }                 // pressed is true for one iteration
if (request && time_reached(state_end)) { ... }   // time_reached() stays true
```

So what happens when the guard is false depends on the event:

| Event | Guard false at that moment |
|:--|:--|
| a button, a `send`, `KEY pressed` or `pin high` | the event is lost. It does not come back when the guard turns true later |
| `after 8 s`, a named timer, `pin high for 50 ms` | the time is up, and the arrow waits. It fires the moment the guard turns true, unless the machine has left the state first |

What the guard was before the time was up does not matter. `after 8 s [request]`
with `request` true from 1 to 7 s and false at 8 s does not fire at 8 s. It
fires when `request` turns true again.

To decide once, at the moment the time is up, give every outcome an arrow to a
state, as `RESULT` above does: one of its guards is always true, so nothing
waits.

A guard on a timeout, a named timer or a held condition cannot use `now`: it
could turn true at any moment. Use a timer. It can read the level of an input,
because the machine sees every change of an input.

**The level of an input.** A guard can read a hold button or a pin, with the
words of its events ([Inputs](#inputs)):

```yaml
inputs:
  door: pin [open, closed]
states:
  ARMING:
    on:
      exit_delay [door closed]: ARMED
      exit_delay [door open]: ALARM
  ARMED:
    on:
      door open: ALARM
```

In front of the brackets, `door open` is an event: the moment the door opens.
Inside them, it is a level: whether the door is open now, whatever happened
before. A door that was opened and closed again during the delay does not count.
In C, with the door's contact pulling the pin high when it opens:

```c
if (time_reached(exit_delay) && !gpio_get(DOOR_PIN)) { ... }   // exit_delay [door closed]
```

A bouncy input is read as it is at that moment, bounces included, as `gpio_get()`
does.

## Events with a value

An event can carry a value: a whole number or `true` or `false`, one per
event. The one who sends the event gives the value and the arrow gives it a
name, as in a C function call:

```yaml
inputs:
  set_blinking: button [100, 500, 1000]
variables:
  interval: 500
states:
  OFF:
    on:
      set_blinking(period): BLINKING / interval = period
  BLINKING:
    entry: start next_toggle interval ms
    on:
      next_toggle: / LED toggle, start next_toggle interval ms
```

On the website, `set_blinking` is a button with a list next to it. Choosing in
the list sends nothing; the button sends the event with the value chosen. The
log shows it: `set_blinking(500): OFF -> BLINKING`.

Another machine sends a value with `send set_blinking(250)`, which reads like
`blnk_set_blinking(&blinker, 250)` in C. Only a `button` and `send` can have
values, not a timer or a hold button or pin.

The name (`period`) can be used only in that arrow's guard and actions: not in
entry or exit actions. To keep the value, put it in a variable on the arrow, as
above. An arrow that does not need the value leaves out the name:
`set_blinking: OFF`.

## Several machines side by side

A superloop often runs several machines, each in its own function. Write them
under `machines:`, each with a name and its own `states:`:

```yaml
inputs:
  pin: bouncy pin
outputs:
  LED: amber led
machines:
  button:
    title: btn_just_pressed()
    states:
      RELEASED:
        on:
          pin high for 50 ms: PRESSED / send pressed
      PRESSED:
        on:
          pin low for 50 ms: RELEASED
  switch:
    title: light switch
    states:
      LIGHT_OFF:
        on:
          pressed: LIGHT_ON / LED on
      LIGHT_ON:
        on:
          pressed: LIGHT_OFF / LED off
```

- Inputs and outputs are shared: they are declared once, at the top.
- Every machine gets every event. The button machine sends `pressed`; the
  light switch reacts to it.
- Each machine can have `title` (shown above it; else its name), `initial`,
  `direction` and `folded`.
- `folded: true` starts the machine folded: one line that says what it reacts
  to and what it sends, instead of its diagram. Students can fold and unfold
  every machine. Fold a helper machine (a debouncer) to show that the bigger
  machine only sees its events.
- Named timers belong to the whole block, not to one machine.
- `variables:` under a machine are its own, like the fields of its `struct`:
  two machines can each have an `n`, and no other machine sees them. Machines
  tell each other values with `send event(value)`. `variables:` at the top of
  the block are shared by all machines. One name cannot be both.

## How the machines behave

The rules follow UML state machines, as far as the course uses them.

1. **One event at a time.** An event goes to every machine, in the order of
   `machines:`. A machine whose current state has an arrow for the event takes
   it; the others ignore it. Events that the machines `send` wait in a queue
   and are handled when the current event is done, in the order they were
   sent.
2. **A transition** leaves the current state (its `after` timers and its
   blinking stop, its exit actions run), runs the arrow's actions, then enters
   the target state (its entry actions run, its `after` timers start, its
   blinking starts). So the order is exit, arrow, entry.
3. **An internal action** (`/ actions`) runs its actions only: no exit, no
   entry, nothing stops or starts. On `after`, it therefore runs once: nothing
   starts the time again. To repeat something in a state, use a named timer:
   `tick: / LED toggle, start tick 500 ms`. An arrow back to the state does
   repeat, but it runs the entry actions too.
4. **Ignored events** change nothing. On the website, a student's click that
   no state reacts to flashes the current state and says so (`LAP is ignored:
   RESET has no arrow for it.`); the log shows every ignored event, also
   timers that run out where nothing reacts. A hold button or a pin is a
   signal, which may change with nobody listening: a change counts as ignored
   only if some state has an arrow for it (`KEY pressed`), so never in a
   machine that only has `KEY pressed for 1 s`. It does not count either while
   a current state has such a `for` arrow on that input, because the change
   starts or cancels its count, or a guard that reads its level, because the
   guard will see the change. An arrow with a false guard still explains why the
   event was lost, and is reported. Bounces are not reported.
5. **Blinking** toggles the output every period, starting one period after
   entry. Leaving the state stops the blinking and leaves the output as it
   is: switch it off on the arrow or in the next state's entry if it must be
   off.
6. **Named timers** run out once; a running timer that is started again
   starts over.
7. **Things that happen at the same moment** are handled in this order:
   bounces, held conditions, `after` timeouts, named timers, blinking.
8. **Loops.** Machines that send each other events forever are stopped after
   500 events in a row, with a message in the log.
9. **Guards.** The first arrow for an event whose guard is true fires. If all
   guards are false, a click or a sent event is ignored, and a timeout waits
   for its guard ([Guards](#guards)). With several machines, an action of one
   can change a shared variable that the guard of the next one reads. A guard
   reads the level of an input as it is at that moment.

Time on the website is simulated, so speed changes only the pace: at 1/100,
the 50 ms of a debouncer take 5 s, and the result is exactly the same as at
full speed.

## On the website

From top to bottom:

- **The diagram**, centred, with the current state in green. A transition
  flashes its arrow orange and sends a dot along it. The state stays green
  until the dot arrives; then the new state turns green and its entry actions
  light up for a moment. That shows the order: first the arrow's actions,
  then the entry actions. Exit actions light up when the dot leaves. An
  internal action lights up when it runs. A state
  with a running `after` or held condition shows a bar at its bottom that
  fills up.

  The outputs and the text follow the dot: what the arrow's actions change
  shows when the dot leaves, what the entry actions change (and blinking)
  when it arrives. Only the picture waits: the machine has moved at once, so
  a timer that the new state starts counts from the event, and the log
  shows the event's time.

  The dot takes 420 ms, or the `transition:` of the YAML (`transition: 1 s`
  to follow it more easily, `transition: 0` for no dot). It is shorter when
  the new state would move on before it arrives (a fast blinker, or a high
  speed): the dot always arrives before the next timeout. A click before it
  arrives finishes it at once. A folded machine, and a browser set to reduce
  motion, show no dot.
- **Inputs**: a row of buttons, in the order of `inputs:`, with a list of values
  next to a button that has them, and on a pin's button its level. Then every
  bouncy input in a row of its own, with its *bounces* checkbox and its trace.
  Buttons always work, also when the current state ignores them: that is
  something to see.
- **Outputs**: the LEDs and buzzers.
- **Display** or **Terminal**, if a machine prints.
- **Variables**, if there are any, with their values. With several machines,
  each row says whose it is. A value that changes lights up. A variable changes
  on the page when its action shows: an entry action's change waits for the dot.
- **Timers**, if the machines use time: every named timer (running or not),
  and every `after` and held condition of the current states, with the time
  left, or *guard is false* for one that waits for its guard. With variables,
  the timers are right under them.
- **Controls**: *Reset* (back to the start), and for a machine that uses
  time also *Pause*/*Run*, *Speed*, *Skip ahead* and the time since the start. *Skip
  ahead* jumps to the next bounce or timeout, so students do not wait 10 s for
  a timer, and can step through the bounces of a button one by one (with
  *Pause*); it says what it jumped to.

  A machine uses time when it has an `after`, a named timer, a held condition
  (`… for 50 ms`), a `blink`, a bouncy input or `now`. A light switch that only
  reacts to clicks shows only *Reset*. `clock: true` or `clock: false`
  overrides this.

  The *Speed* buttons are those of `speeds:`. Without it, they follow the
  times of the machine:

  - a time under 100 ms (a `blink`, an `after`, a held condition) adds 1/10×,
    and a time under 20 ms or a bouncy input adds 1/100× too;
  - long times add speed-ups: 2×, 5×, 10×, 20×, 50× or 100×, as long as the
    longest time still takes a second or more, at most three of them. A 10 s
    timeout gets 2×, 5× and 10×; a 60 s one 10×, 20× and 50×;
  - with only 1× left (times between 100 ms and 2 s), there are no speed
    buttons.

  The `speed` of the YAML is always one of the buttons.
- **Log**: every event with its time and value, the transition it caused or
  that it was ignored, and why if a guard was false. With several machines, each
  line names the machine. Mistakes that only show while running (a division by
  zero) are here too. Bounces, and changes of a hold button or pin that do not
  count as ignored ([How the machines behave](#how-the-machines-behave)), are
  left out.

A block that is not on the screen pauses, and the layout is the same in every
browser: text is measured with the widths of Lato, the font of the course.

## In the PDF

A PDF cannot run a machine. Every block becomes:

- its title and task;
- the first values of the variables, and the values of buttons that have them;
- per machine: its title (with several machines), the diagram as a picture,
  the first values of its own variables, and a **transition table**: a row per
  state, a column per event, and in every cell the target state and the actions
  (`LIGHT_ON | LED on`), an internal action (`| print "lap"`), or a dash when
  the state ignores the event. Arrows with guards share a cell:
  `[attempt < 5] READY; [attempt == 5] SUMMARY`;
- a link to the machine on the website.

## Mistakes and warnings

The build checks every machine and reports problems with the page and the
machine's number, for example
`warning: lessons/week_04/lesson1.md: state machine 2: state ARMING, on exit_dalay: exit_dalay is not an input, a timer or an event that a machine sends.`

**Mistakes** stop the machine from being shown: on the website and in the PDF
the block shows the message instead. For example:

- YAML that cannot be read, or an unknown key;
- an event that is not an input, a timer or a sent event (usually a typo);
- an action that does not exist or is incomplete (`LED onn`, `start T` without
  a time, `print` without quotes), an output or state that does not exist;
- `blink` under `entry:` or other actions under `do:`;
- `KEY` for a hold button (write `KEY pressed` or `KEY released`), or
  `pressed released` for a click button;
- in an expression, an input without its level (`[door]`), a word the input does
  not have (`[door high]` for `door: pin [open, closed]`), or a click button,
  which has no level;
- own words for a pin that are not two different names (`pin [open]`), or own
  words for a hold button;
- a variable that is not declared or belongs to another machine, numbers and
  true/false mixed (`[count]`, `count = true`), a fraction in an expression;
- a guard without an event, or a guard with `now` on a timeout;
- a name for a value that the event does not have (`next_toggle(x)`, `send e`
  and `e(x)`), or the name of a value outside its arrow.

**Warnings** do not stop the machine, but usually point at a mistake:

- a timer that runs out but no state reacts to it;
- `stop T` for a timer that is never started;
- `send e` but no state reacts to `e`;
- an input that no state uses, an output that no action switches, a variable
  that no state uses;
- a state that can never be reached from the initial state;
- an internal action on `after`, which runs only once;
- an arrow back into its own state that changes an output, when the state's
  entry actions undo that change (`after 500 ms: BLINK / LED toggle` with
  `entry: LED on`: the LED stays on);
- an arrow that can never fire, because an arrow for the same event above it has
  no guard;
- a button with values whose values no arrow gives a name.

## Trying things out: `editable: true`

With `editable: true`, `course preview` shows the YAML under the machine:
change it and click *Apply* (or press Ctrl+Enter) to see the new machine;
*Reset* brings back the original. Mistakes and warnings are shown under the
YAML, as the build would report them. The published website never shows the
YAML. This is how the gallery in the course template works; the editor loads
its YAML reader from the internet when it is first used.

## Examples

### The debouncer: `btn_just_pressed()`

The machine of `btn_just_pressed()` next to a light switch that uses it. The
pin bounces; at 1/100 speed, students see every bounce restart the count.

```yaml
title: The button and the light switch
speed: 1/100
inputs:
  pin: bouncy pin
outputs:
  LED: amber led
machines:
  button:
    title: btn_just_pressed()
    states:
      RELEASED:
        on:
          pin high for 50 ms: PRESSED / send pressed
      PRESSED:
        on:
          pin low for 50 ms: RELEASED
  switch:
    title: light switch
    states:
      LIGHT_OFF:
        on:
          pressed: LIGHT_ON / LED on
      LIGHT_ON:
        on:
          pressed: LIGHT_OFF / LED off
```

To step through the bounces: *Pause*, click *pin*, then *Skip ahead* again
and again.

### A long press

```yaml
inputs:
  KEY: hold button
outputs:
  LED: green led
  BUZZER: buzzer
states:
  IDLE:
    on:
      KEY pressed: DOWN
  DOWN:
    on:
      KEY released: IDLE / LED toggle
      KEY pressed for 1 s: LONG
  LONG:
    entry: BUZZER on
    on:
      KEY released: IDLE / BUZZER off
```

### A blinker: an internal action on a named timer

The LED changes, but how the machine reacts to events does not, so blinking is
one state, not two. In C, the `time_reached()` branch toggles the pin and sets
the next time, without calling `enter_state()`: that is an internal action.

```yaml
inputs:
  led_set_on: button
  led_set_off: button
  led_set_blinking: button [100, 500, 1000]
outputs:
  LED: amber led
variables:
  interval: 500
states:
  BLINKER_OFF:
    entry: LED off
    on:
      led_set_on: BLINKER_ON
      led_set_blinking(period): BLINKER_BLINKING / interval = period
  BLINKER_ON:
    entry: LED on
    on:
      led_set_off: BLINKER_OFF
      led_set_blinking(period): BLINKER_BLINKING / interval = period
  BLINKER_BLINKING:
    entry: LED on, start next_toggle interval ms
    exit: stop next_toggle
    on:
      led_set_off: BLINKER_OFF
      led_set_on: BLINKER_ON
      led_set_blinking(period): BLINKER_BLINKING / interval = period
      next_toggle: / LED toggle, start next_toggle interval ms
```

### A stopwatch: variables, `now` and an exit action

```yaml
direction: TB
text: terminal
inputs:
  START: button
  LAP: button
outputs:
  LED: green led
variables:
  stored: 0
  run_start: 0
  lap: 1
states:
  SW_RESET:
    entry: stored = 0, lap = 1, LED off, print "Press START."
    on:
      START: SW_RUNNING
  SW_RUNNING:
    entry: run_start = now
    do: blink LED 250 ms
    exit: stored += now - run_start
    on:
      START: SW_STOPPED
      LAP: '/ print "Lap {lap}: {stored + now - run_start:s}", lap++'
  SW_STOPPED:
    entry: LED on, print "Stopped at {stored:s}"
    on:
      START: SW_RUNNING
      LAP: SW_RESET
```

### A named timer that outlives its state

```yaml
direction: TB
inputs:
  arm_pressed: button
  door_opened: button
outputs:
  LED: red led
states:
  DISARMED:
    entry: LED off
    on:
      arm_pressed: ARMING
  ARMING:
    entry: start exit_delay 10 s
    do: blink LED 500 ms
    on:
      arm_pressed: DISARMED
      exit_delay: ARMED
  ARMED:
    entry: LED on
    on:
      door_opened: ALARM
      arm_pressed: DISARMED
  ALARM:
    do: blink LED 100 ms
    on:
      arm_pressed: DISARMED
```

Disarm during ARMING: `exit_delay` keeps running and runs out in DISARMED,
where nothing reacts to it (the log says so). With `after 10 s: ARMED`
instead, the time would stop with ARMING.

### An alarm that looks at the door

```yaml
direction: TB
inputs:
  arm_pressed: button
  door: pin [open, closed]
outputs:
  LED: red led
states:
  DISARMED:
    entry: LED off
    on:
      arm_pressed: ARMING
  ARMING:
    entry: start exit_delay 10 s
    do: blink LED 500 ms
    on:
      arm_pressed: DISARMED
      exit_delay [door closed]: ARMED
      exit_delay [door open]: ALARM
  ARMED:
    entry: LED on
    on:
      door open: ALARM
      arm_pressed: DISARMED
  ALARM:
    do: blink LED 100 ms
    on:
      arm_pressed: DISARMED
```

The machine decides when `exit_delay` runs out, from the level of the door at
that moment. One of the two guards is always true, so nothing waits. With only
`exit_delay [door closed]: ARMED`, ARMING would wait for the door to close.

Opening the door in DISARMED says that `door open` is ignored, because ARMED has
an arrow for it and DISARMED has not. In ARMING it says nothing, because the
guards there read the door.

## What is not possible (yet)

- **An arrow with only a guard** (`[count == 5]: DONE`): give it an event, or
  check the value on the arrow that changes it.
- **Arrays, fractions and text in variables**, and more than one value per event.
- **States inside states** (hierarchical machines): use machines side by
  side that send each other events.
- **Sound**: the buzzer is only shown.
- **Other activities than `blink`**, and outputs other than LEDs, buzzers
  and text.
