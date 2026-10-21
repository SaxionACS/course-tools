---
outcomes: [LO1, LO2]
---

# Interrupt handlers

A lesson with self-checks, a prediction, a comparison and Compiler Explorer
links. The keyword `volatile` matters when an interrupt service routine
shares data with the superloop.

::: {.terms}
`volatile`
: A qualifier that tells the compiler that a variable can change outside the
  normal program flow, so every access must really read or write memory.

superloop
: DUPLICATE-DEFINITION

period
: The time of one cycle of a periodic signal: $T = 1/f$.
:::

## Self-checks

::: {.check}
Which keyword makes the compiler read a variable from memory every time?

- [ ] `static`

  FEEDBACK-STATIC: `static` is about lifetime and visibility.

- [x] `volatile`

  Right: it tells the compiler that the value can change at any time.

- [ ] `const`

::: {.explanation}
EXPLANATION-SINGLE
:::
:::

::: {.check type="multiple"}
Which of these are true for an interrupt service routine?

- [x] It runs between two instructions of `main`.
- [ ] It can take arguments.
:::

::: {.check}
Which statements about `volatile` are true?

- [x] Every read of the variable really reads memory.
- [ ] Accesses to the variable become atomic.
- [x] A flag that an ISR sets needs it.
:::

::: {.check}
`0x2A` is [42]{.blank} in decimal and [0x2A]{.blank type=hex} in hexadecimal;
`42` is [101010]{.blank type=bin} in binary.
:::

::: {.check}
A 10 kHz PWM signal has a period of [0.1]{.blank type=float precision=0.001 unit=ms},
that is [100]{.blank type=float precision=1% unit=µs}.
:::

::: {.check}
The keyword is [`volatile`]{.blank case=sensitive}. An interrupt handler is also
called an [ISR]{.blank accept="interrupt service routine|interrupt handler"}. Set
bit 5 of `PORTB` with [`PORTB |= (1 << 5);`]{.blank spaces=ignore case=sensitive}.
:::

## Predict

::: {.predict}
What does this program print?

```{c ce=run}
#include <stdio.h>
#include <stdint.h>

int main(void) {
    uint8_t x = 200;
    x += 100;
    printf("%u\n", x);
    return 0;
}
```

::: {.answer}
PREDICT-ANSWER: `44`, because a `uint8_t` wraps around at 256.
:::
:::

## Compare

::: {.compare .wrong-right labels="Without volatile|With volatile"}
```{c ce=asm}
#include <stdint.h>

uint8_t tick;

void wait(void) {
    while (!tick) { }
}
```

```{c ce=asm}
#include <stdint.h>

volatile uint8_t tick;

void wait(void) {
    while (!tick) { }
}
```
:::

## Compiler Explorer

```{c ce=asm}
int square(int x) {
    return x * x;      // <1>
}
```
1. One multiplication.

```{c ce=exe ce-stdin="Q\nR" ce-args="-v"}
#include <stdio.h>

int main(void) {
    int c = getchar();
    printf("%c\n", c);
    return 0;
}
```

```{c ce=asm ce-compiler=cavrg1520 ce-options="-Os -mmcu=atmega328p" ce-target="ATmega328P"}
#include <avr/io.h>

void led_on(void) {
    PORTB |= (1 << PB5);
}
```

```{c ce="asm exe"}
int one(void) { return 1; }
```
