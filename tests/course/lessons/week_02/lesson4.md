# State machines

State machines of every kind. Those under *Mistakes* have mistakes on purpose:
the build reports them.

## A switch

States named ON and OFF, and the key `on:`: YAML 1.1 would read them as
booleans. One arrow separates its actions with `|`, the other with `/`. No
timers: no clock.

```statemachine
title: SM-TITLE
task: SM-TASK
editable: true
inputs:
  pressed: button
outputs:
  LED: amber led
initial: OFF
states:
  OFF:
    on:
      pressed: ON / LED on
  ON:
    on:
      pressed: OFF | LED off
```

## Two machines side by side

```{#debouncer .statemachine}
title: The button and the light switch
speed: 1/100
log: hidden
transition: 0
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
    folded: true
    direction: TB
    states:
      LIGHT_OFF:
        on:
          pressed: LIGHT_ON / LED on
      LIGHT_ON:
        on:
          pressed: LIGHT_OFF / LED off
```

## A terminal, timers and an internal action

The entry actions of STOPPED are on lines without dashes: YAML joins them
into one line.

```statemachine
direction: TB
text: terminal
inputs:
  START: button
  LAP: button
outputs:
  LED: green led
  BUZZER: buzzer
states:
  RESET:
    entry: LED off, BUZZER off, print "reset"
    on:
      START: RUNNING
  RUNNING:
    entry:
      - print "running"
      - start limit 50..60 s
    do: blink LED 250 ms
    on:
      START: STOPPED
      LAP: / print "lap"
      limit: STOPPED / BUZZER on
  STOPPED:
    entry:
      LED on
      stop limit
      print "stopped"
    on:
      START: RUNNING
      LAP: RESET
      after 30 s: RESET
```

A state machine in a code block is shown as code:

````markdown
```statemachine
NOT-A-STATEMACHINE: true
```
````

## Mistakes

```statemachine
inputs:
  pressed: button
states:
  A:
    on:
      presed: B
  B: {}
```

```statemachine
clock: true
inputs:
  pressed: button
  unused: button
outputs:
  LED: red led
states:
  A:
    on:
      pressed: A
```

```statemachine
states: [unclosed
```

## Variables, guards, a button with values and exit actions

```statemachine
title: SM-VARIABLES
text: terminal
inputs:
  set_blinking: button [200, 1000]
  stop_it: button
  count_it: button
  finish: button
outputs:
  LED: green led
variables:
  interval: 500
  count: 0
states:
  OFF:
    entry: LED off
    on:
      set_blinking(period): BLINKING / interval = period
      count_it: / count++, print "count {count}"
      finish [count >= 2]: DONE
  BLINKING:
    entry: LED on, start next_toggle interval ms
    exit: stop next_toggle, print "left blinking"
    on:
      next_toggle: / LED toggle, start next_toggle interval ms
      stop_it: OFF
  DONE:
    entry: print "done at {count}"
```

## Levels: a pin with its own words, read by a guard

A pin and a hold button that do not bounce: buttons in one row, in the order of
`inputs:`, without a checkbox or a trace.

```statemachine
title: SM-DOOR
direction: TB
inputs:
  btn_pressed: button
  door: pin [open, closed]
  KEY: hold button
outputs:
  LED: red led
states:
  DISARMED:
    entry: LED off
    on:
      btn_pressed: ARMING
  ARMING:
    entry: LED on, start exit_delay 10 s
    do: blink LED 500 ms
    on:
      btn_pressed: DISARMED
      exit_delay [door closed]: ARMED
      exit_delay [door open]: RINGING
  ARMED:
    entry: LED on
    on:
      door open: RINGING
      btn_pressed: DISARMED
      KEY pressed for 1 s: DISARMED
  RINGING:
    entry: LED on
    do: blink LED 100 ms
    on:
      btn_pressed: DISARMED
```
