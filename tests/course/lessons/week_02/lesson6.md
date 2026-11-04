# PWM

PWM widgets of every kind, in the order `tests/pwm_browser.js` expects them.
The last two have mistakes on purpose: the build reports them.

```widget
type: pwm
title: One slice, two channels
wrap: 3
levels: {A: 1, B: 3}
controls: [wrap, levels]
show: [counter, outputs, numbers, code, led]
```

```widget
type: pwm
title: wrap 65535, level 13107
wrap: 65535
level: 13107
controls: [wrap, levels]
show: [counter, outputs, numbers, code, led]
```

```widget
type: pwm
wrap: 65535
levels: {A: 0}
controls: [wrap, levels]
task: Make a 10 kHz signal with a duty of 25 % on channel A.
goal:
  frequency: 10 kHz
  duty: 25%
```

```widget
type: pwm
wrap: 65535
levels: {A: 0}
controls: [wrap, levels]
check: live
task: Make a 10 kHz signal with a duty of 25 % on channel A.
goal:
  frequency: 10 kHz
  duty: 25%
```

```widget
type: pwm
wrap: 65535
levels: {A: 65535}
controls: [wrap, levels]
task: Make the output of channel A high all the time (a duty of 100 %).
goal:
  duty: 100%
```

```widget
type: pwm
wrap: 65535
level: 32768
controls: [wrap, levels, clkdiv]
task: Make a 1 kHz signal with a duty of 50 % on channel A. You need the clock divider.
goal:
  frequency: 1 kHz
  duty: 50%
```

```widget
type: pwm
wrap: 65535
level: 65535
controls: [levels]
show: [outputs, led, numbers]
task: Make LED A look half as bright as the LED when it is fully on, like the goal LED. Is that a duty of 50 %?
goal:
  brightness: 50%
```

```widget
type: pwm
wrap: 4
levels: {A: 3}
task: Which wrap and which level give this signal?
goal: decode
```

```widget
type: pwm
wrap: 12499
levels: {A: 3125, B: 9375}
periods: 2
task: Which wrap and which levels give these two signals of one slice?
goal: decode
```

```widget
type: pwm
title: A slow PWM
wrap: 65535
level: 32768
clkdiv: 64
controls: [clkdiv]
show: [outputs, numbers, led]
task: Make the divider smaller. From which frequency on does the LED at real speed stop flickering?
```

```widget
type: pwm
wrap: 65535
level: 6250
controls: [wrap]
task: Make a signal of about 10 kHz. Anything from 9.9 kHz to 10.1 kHz is fine.
goal:
  frequency: 10 kHz +/- 100 Hz
```

A goal that cannot be reached:

```widget
type: pwm
controls: [wrap, levels]
task: PWM-UNREACHABLE-TASK
goal:
  frequency: 1 kHz
```

A setting that is out of range:

```widget
type: pwm
wrap: 70000
```
