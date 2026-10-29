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
| `states` | the states of the machine ([States](#states)) |
| `initial` | the state the machine starts in; the first state if left out |
| `machines` | instead of `states`: several machines side by side ([Several machines](#several-machines-side-by-side)) |
| `direction` | `LR` (left to right, the default) or `TB` (top to bottom) |
| `text` | `display` (the default) or `terminal`: what `print` writes on ([Actions](#actions)) |
| `speed` | the speed the machine starts at: `1` (real time, the default), slower (`1/4`, `1/10`, `1/100`, down to `1/1000`) or faster (`2`, `10`, up to `100`) |
| `speeds` | the speed buttons, for example `[1, 2, 10]` or `[1/100, 1/10, 1]`. By default they are chosen from the machine's times ([On the website](#on-the-website)) |
| `clock` | `true` or `false`: show the time and its controls (*Pause*, *Speed*, *Skip ahead*). By default only for machines that use time ([On the website](#on-the-website)) |
| `log` | `open` (the default), `folded` (closed until the student opens it) or `hidden` (no log) |
| `editable` | `true`: in `course preview`, the YAML under the machine, to change and apply ([Trying things out](#trying-things-out-editable-true)) |

Every other key is a mistake (a typo such as `stats:` is reported, not
ignored).

Names of inputs, outputs, states, timers and events are made of letters,
digits and `_`, and do not start with a digit: `LIGHT_ON`, `arm_pressed`,
`exit_delay`. The words of the language cannot be names: `print`, `clear`,
`start`, `stop`, `send`, `blink`, `after`, `on`, `off`, `toggle`.

## Inputs

Every input is declared, with its kind. An event that is not an input, a
timer or a sent event is a mistake, so a typo is reported instead of becoming
a button that does nothing.

| Kind | On the website | Its events |
|:--|:--|:--|
| `button` | a button; every click is one event | `NAME` |
| `hold button` | a button that is down while the student holds it (mouse, touch, or Space/Enter on the keyboard) | `NAME pressed`, `NAME released`, and `NAME pressed for 1 s` |
| `pin` | a switch: a click sets the pin high, the next click low | `NAME high`, `NAME low`, and `NAME high for 50 ms` |
| `bouncy button` | a hold button that bounces | as `hold button` |
| `bouncy pin` | a pin that bounces | as `pin` |

A `button` is a press that the software has already cleaned up: one click is
one event, as `btn_just_pressed()` returns `true` once per press. Use it in
most machines. A `hold button` or a `pin` is the signal itself, for machines
that work with levels and times, such as a debouncer or a long press.

A *bouncy* input bounces at every change, as a real contact does: it flips
two to four times back and forth within the first 12 ms. The student can
switch the bouncing off and on with a checkbox next to the input. Under a hold
button or pin, a trace shows its level over the last 8 seconds of real time
(at 1/100 speed: the last 80 ms).

Inputs appear on the website in the order of `inputs:`.

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
| `on` | the arrows out of the state, one per line: `event: arrow` |

A state with none of these is written `NAME: {}` or just `NAME:`.

There are no exit actions: put them on the arrows that leave the state.

## Events: the left side of `on:`

| Event | When it happens |
|:--|:--|
| `pressed` | a click on the `button` named `pressed` |
| `KEY pressed`, `KEY released` | a `hold button` named KEY goes down or up |
| `pin high`, `pin low` | a `pin` named pin goes high or low |
| `KEY pressed for 1 s`, `pin high for 50 ms` | the input has been in that level for that long without a break. Drawn as `[pin high for 50 ms]` |
| `after 10 s` | 10 s after the machine entered the state. A random time: `after 2..5 s` |
| `exit_delay` | the named timer `exit_delay` runs out (started with `start exit_delay 10 s`) |
| `pressed` | another machine sends `pressed` (`send pressed`) |

A state can react to each event once. An event that the current state has no
arrow for is ignored ([How the machines behave](#how-the-machines-behave)).

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
| `blink LED 500 ms` | only under `do:`: toggle the output every 500 ms |

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
quote in the text.

## Times

Times are written with a unit: `500 ms`, `10 s`, `1.5 s` (`10s` works too).
A random time is a range, `2..5 s`, and is drawn again every time the timer
starts or the state is entered; it can be used in `after` and `start`, not in
held conditions or `blink`.

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

## How the machines behave

The rules follow UML state machines, as far as the course uses them.

1. **One event at a time.** An event goes to every machine, in the order of
   `machines:`. A machine whose current state has an arrow for the event takes
   it; the others ignore it. Events that the machines `send` wait in a queue
   and are handled when the current event is done, in the order they were
   sent.
2. **A transition** leaves the current state (its `after` timers and its
   blinking stop), runs the arrow's actions, then enters the target state
   (its entry actions run, its `after` timers start, its blinking starts).
3. **An internal action** (`/ actions`) runs its actions only: no exit, no
   entry, nothing stops or starts.
4. **Ignored events** change nothing. On the website, a student's click that
   no state reacts to flashes the current state and says so (`LAP is ignored:
   RESET has no arrow for it.`); the log shows every ignored event, also
   timers that run out where nothing reacts.
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

Time on the website is simulated, so speed changes only the pace: at 1/100,
the 50 ms of a debouncer take 5 s, and the result is exactly the same as at
full speed.

## On the website

From top to bottom:

- **The diagram**, centred, with the current state in green. A transition
  flashes its arrow orange and sends a dot along it; when the dot arrives,
  the entry actions of the new state light up for a moment. That shows the
  order: first the arrow's actions, then the entry actions. An internal
  action lights up when it runs. A state with a running `after` or held
  condition shows a bar at its bottom that fills up.
- **Inputs**: a button per input, in the order of `inputs:`. Buttons always
  work, also when the current state ignores them: that is something to see.
- **Outputs**: the LEDs and buzzers.
- **Display** or **Terminal**, if a machine prints.
- **Timers**, if the machines use time: every named timer (running or not),
  and every `after` and held condition of the current states, with the time
  left.
- **Controls**: *Reset* (back to the start), and for a machine that uses
  time also *Pause*/*Run*, *Speed*, *Skip ahead* and the time since the start. *Skip
  ahead* jumps to the next bounce or timeout, so students do not wait 10 s for
  a timer, and can step through the bounces of a button one by one (with
  *Pause*); it says what it jumped to.

  A machine uses time when it has an `after`, a named timer, a held condition
  (`… for 50 ms`), a `blink` or a bouncy input. A light switch that only
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
- **Log**: every event with its time, the transition it caused or that it was
  ignored. With several machines, each line names the machine.

A block that is not on the screen pauses, and the layout is the same in every
browser: text is measured with the widths of Lato, the font of the course.

## In the PDF

A PDF cannot run a machine. Every block becomes:

- its title and task;
- per machine: its title (with several machines), the diagram as a picture,
  and a **transition table**: a row per state, a column per event, and in
  every cell the target state and the actions (`LIGHT_ON | LED on`), an
  internal action (`| print "lap"`), or a dash when the state ignores the
  event;
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
- a guard (`[…]`), which is not possible yet.

**Warnings** do not stop the machine, but usually point at a mistake:

- a timer that runs out but no state reacts to it;
- `stop T` for a timer that is never started;
- `send e` but no state reacts to `e`;
- an input that no state uses, an output that no action switches;
- a state that can never be reached from the initial state.

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

## What is not possible (yet)

- **Guards and variables** (`[count < 3]`, `count++`): planned. Until then,
  write a state per value, or explain the guard in the text.
- **States inside states** (hierarchical machines): use machines side by
  side that send each other events.
- **Exit actions**: put them on the arrows that leave the state.
- **Sound**: the buzzer is only shown.
- **Other activities than `blink`**, and outputs other than LEDs, buzzers
  and text.
