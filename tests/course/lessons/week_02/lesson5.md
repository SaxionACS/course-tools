# Superloop

Short C programs that run against simulated time. The last two blocks have
mistakes on purpose: the build reports them.

## Two variants on the same presses

The script presses the button once, briefly. The sleeping variant never reads
it; the checking one does.

```superloop
title: SL-TITLE
task: SL-TASK
editable: true
inputs:
  BUTTON_PIN: hold button
outputs:
  LED_PIN: red led
variants:
  sleeping: |
    const uint32_t BLINK_MS = 1000;
    const uint32_t DEBOUNCE_MS = 50;

    bool armed = true;

    while (true) {
      if (armed) {
        gpio_put(LED_PIN, 1);
        sleep_ms(BLINK_MS);
        gpio_put(LED_PIN, 0);
        sleep_ms(BLINK_MS);

        if (gpio_get(BUTTON_PIN)) {
          sleep_ms(DEBOUNCE_MS);
          if (gpio_get(BUTTON_PIN)) {
            armed = false;
          }
        }
      }
    }
  checking: |
    const uint32_t BLINK_MS = 1000;
    const uint32_t DEBOUNCE_MS = 50;

    bool armed = true;
    absolute_time_t next_toggle_time;
    absolute_time_t debounce_time;

    while (true) {
      if (armed) {
        if (time_reached(next_toggle_time)) {
          next_toggle_time = make_timeout_time_ms(BLINK_MS);
          gpio_put(LED_PIN, !gpio_get(LED_PIN));
        }

        if (!gpio_get(BUTTON_PIN)) {
          debounce_time = make_timeout_time_ms(DEBOUNCE_MS);
        }
        else if (time_reached(debounce_time)) {
          armed = false;
        }
      }
    }
watch: [armed]
timeline: [cpu, BUTTON_PIN, LED_PIN]
script:
  - BUTTON_PIN press at 300 ms for 400 ms
run: 3 s
```

## A challenge

```{#alarm-challenge .superloop}
title: SL-CHALLENGE
task: Disarm the alarm with one short press.
inputs:
  BUTTON_PIN: hold button
outputs:
  LED_PIN: red led
code: |
  const uint32_t DEBOUNCE_MS = 50;

  bool armed = true;
  absolute_time_t debounce_time;

  while (true) {
    if (armed) {
      if (!gpio_get(BUTTON_PIN)) {
        debounce_time = make_timeout_time_ms(DEBOUNCE_MS);
      }
      else if (time_reached(debounce_time)) {
        armed = false;
      }
    }
    gpio_put(LED_PIN, armed);
  }
watch: [armed]
goal:
  vars: {armed: false}
  outputs: {LED_PIN: off}
  max_presses: 1
answer_script:
  - BUTTON_PIN press at 100 ms for 150 ms
answer: SL-ANSWER Press once, for longer than 50 ms.
```

## A whole program that sets up its pins

```superloop
title: The LED follows the button
io_setup: code
inputs:
  BUTTON_PIN: hold button
outputs:
  LED_PIN: red led
code: |
  #include "pico/stdlib.h"

  const uint LED_PIN = 15;
  const uint BUTTON_PIN = 16;

  int main() {
    gpio_init(LED_PIN);
    gpio_set_dir(LED_PIN, GPIO_OUT);
    gpio_init(BUTTON_PIN);
    gpio_set_dir(BUTTON_PIN, GPIO_IN);
    gpio_pull_down(BUTTON_PIN);

    while (true) {
      bool pressed = gpio_get(BUTTON_PIN);
      gpio_put(LED_PIN, pressed);
    }
  }
show: [iterations]
timeline: [BUTTON_PIN, LED_PIN]
controls: [speed, step]
script:
  - BUTTON_PIN press at 0.5 s for 1 s
run: 2 s
```

## Bounces and a deadline

```superloop
title: Debouncing without waiting
speed: 1/10
speeds: [1/100, 1/10, 1]
window: 200 ms
inputs:
  BUTTON_PIN: bouncy hold button
outputs:
  LED_PIN: red led
code: |
  const uint32_t DEBOUNCE_MS = 50;

  bool armed = true;
  absolute_time_t debounce_time;

  while (true) {
    if (armed) {
      if (!gpio_get(BUTTON_PIN)) {
        debounce_time = make_timeout_time_ms(DEBOUNCE_MS);
      }
      else if (time_reached(debounce_time)) {
        armed = false;
      }
    }
    gpio_put(LED_PIN, armed);
  }
watch: [armed, debounce_time]
timeline: [BUTTON_PIN, debounce_time, LED_PIN]
controls: [speed, step, bounce]
script:
  - BUTTON_PIN press at 50 ms
run: 200 ms
```

## Undefined behaviour, permitted

```superloop
title: A counter that overflows
outputs:
  LED_PIN: green led
code: |
  int count = 2147000000;

  while (true) {
    count = count + 100000;
    gpio_put(LED_PIN, count > 0);
    sleep_ms(1);
  }
watch: [count]
timeline: [cpu, LED_PIN]
undefined_behavior: permit
run: 20 ms
```

## The terminal

```superloop
title: SL-TERM Where did the prompt go?
terminal:
  open: manual
stdio_setup: manual
variants:
  as is: |
    #include "pico/stdlib.h"
    #include <stdio.h>

    int main() {
      stdio_init_all();

      while (true) {
        printf("Enter a number (1-9): ");
        int n = getchar();
        if (n < '1' || n > '9') {
          printf("\nInvalid input.\n");
          continue;
        }
        printf("\nPlaying %d beeps.\n", n - '0');
      }
    }
  waiting for the terminal: |
    #include "pico/stdlib.h"
    #include <stdio.h>

    int main() {
      stdio_init_all();
      while (!stdio_usb_connected()) sleep_ms(10);

      while (true) {
        printf("Enter a number (1-9): ");
        int n = getchar();
        if (n < '1' || n > '9') {
          printf("\nInvalid input.\n");
          continue;
        }
        printf("\nPlaying %d beeps.\n", n - '0');
      }
    }
timeline: [cpu, terminal]
script:
  - terminal open at 1.5 s
  - type "5" at 2 s
run: 3 s
task: Open the terminal, then type a digit. Where is the first prompt? Then look at the second tab.
```

```superloop
title: SL-CLOCK Time since boot
terminal:
  open: auto
stdio_setup: auto
code: |
  const uint32_t PERIOD_MS = 250;

  while (true) {
    uint64_t ms = time_us_64() / 1000;
    printf("\rt = %" PRIu64 ".%03" PRIu64 " s", ms / 1000, ms % 1000);
    sleep_ms(PERIOD_MS);
  }
params: [PERIOD_MS]
goal:
  shows: "t = 1.0"
answer_script: []
answer: Wait one second; the line updates in place, because \r goes back to the start of the line.
```

A block shown as code is not run:

````markdown
```superloop
NOT-A-SUPERLOOP: true
```
````

## Mistakes

```superloop
code: |
  while (true) { x = 1; }
flavour: vanilla
```

```superloop
inputs: [BUTTON_PIN
```
