# State machines

State machines of every kind. The last ones have mistakes on purpose: the
build reports them.

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
