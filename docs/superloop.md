# Superloop

A ```` ```superloop ```` block runs a short C program from a lesson, in the
browser, against simulated time. Students press the buttons on the board and
watch the program run: the code with the line that runs (or sleeps), the
LEDs, the variables, and a timeline of the inputs, the outputs and what the
processor does, with every moment the program read an input. A press the
program never read is marked. With a terminal, students open it, type to the
program and read what it prints, as with a terminal app on their computer. In
the PDF the block becomes the code and the timeline of one run with scripted
presses (and typing).

The program is C as on a Raspberry Pi Pico: the sizes of the RP2040, C's
integer rules, and undefined behaviour that stops the program with a message.
It runs in the block's own interpreter, in the browser and at build time; no
compiler is involved.

This page describes everything a block can do. The
[authoring guide](authoring.md#superloop-blocks) has the short version.

- [A first block](#a-first-block)
- [The YAML at a glance](#the-yaml-at-a-glance)
- [The program](#the-program)
- [Inputs and outputs](#inputs-and-outputs)
- [Time](#time)
- [Undefined behaviour](#undefined-behaviour)
- [The terminal: `printf` and `getchar`](#the-terminal-printf-and-getchar)
- [Variants](#variants)
- [Constants students change: `params`](#constants-students-change-params)
- [Variables and counters: `watch` and `show`](#variables-and-counters-watch-and-show)
- [The timeline](#the-timeline)
- [On the website](#on-the-website)
- [Scripts](#scripts)
- [Challenges: `goal`](#challenges-goal)
- [In the PDF](#in-the-pdf)
- [Mistakes and warnings](#mistakes-and-warnings)
- [Trying things out: `editable: true`](#trying-things-out-editable-true)
- [Examples](#examples)
- [What is not possible (yet)](#what-is-not-possible-yet)

**Gallery.** The course template has a page with many blocks, each with its
YAML to change and apply:
[`references/superloop.md`](https://github.com/SaxionACS/course_template/blob/main/references/superloop.md).
It is a [draft](authoring.md#draft-pages): run `course preview` in the
template and open *References → Superloop gallery*.

## A first block

````markdown
```superloop
title: The LED follows the button
inputs:
  BUTTON_PIN: hold button
outputs:
  LED_PIN: red led
code: |
  while (true) {
    bool pressed = gpio_get(BUTTON_PIN);
    gpio_put(LED_PIN, pressed);
  }
show: [iterations]
```
````

The code is a fragment, as lessons show code: statements without a `main()`.
`BUTTON_PIN` and `LED_PIN` are not declared in it, so the block declares them
(GP16 and GP15, the course's wiring) and sets the pins up before the program
starts. On the website, holding the button lights the LED, and the counter
shows how often the superloop ran.

## The YAML at a glance

| Setting | Meaning | Default |
|:--|:--|:--|
| `title` | shown above the block | none |
| `task` | what to do, in a box above the block ("Try it"; "Challenge" with a `goal`) | none |
| `code` | the program: a whole program or a fragment ([The program](#the-program)) | |
| `variants` | instead of `code`: `{name: program, …}`, shown as tabs; all run at the same time, on the same presses ([Variants](#variants)) | |
| `variant` | the tab shown first | the first |
| `inputs` | `{NAME: kind}`: `button`, `hold button`, `pin`, `bouncy button`, `bouncy hold button`, `bouncy pin` | none |
| `outputs` | `{NAME: kind}`: `led` (red), `red led`, `green led`, `amber led`, `yellow led`, `blue led`, `white led`, `buzzer` | none |
| `active` | `high`: a pressed button reads 1 (wired to 3.3 V, with a pull-down, as in this course); `low`: it reads 0 | `high` |
| `io_setup` | `auto`: the pins of inputs and outputs are set up before the program starts; `code` (or `manual`): the program sets them up itself, as on a real Pico | `auto` |
| `stdio_setup` | `auto`: USB stdio is started before the program starts; `code` (or `manual`): the program calls `stdio_init_all()`, as on a real Pico ([The terminal](#the-terminal-printf-and-getchar)) | `manual` |
| `undefined_behavior` | `stop`: undefined behaviour stops the program with a message; `permit`: it goes on as on a Pico, with a note ([Undefined behaviour](#undefined-behaviour)) | `stop` |
| `terminal` | settings of their own (`open`, `enter`, `echo`, below); with them, the block has a terminal app on the computer, for the Pico's USB stdio ([The terminal](#the-terminal-printf-and-getchar)) | no terminal |
| `terminal: open` | `manual` (or `button`): students open it; `auto`: it opens by itself as soon as the Pico is on USB | `manual` |
| `terminal: enter` | what the terminal sends for Enter: `cr`, `lf` or `crlf` | `cr` |
| `terminal: echo` | the terminal's local echo at the start, and in the PDF: `true` or `false` | `false` |
| `watch` | variables to show, by name; `name:hex` in hexadecimal | none |
| `timeline` | the lanes, top to bottom: `cpu`, `terminal`, inputs, outputs and `absolute_time_t` variables | `cpu`, `terminal` (with a terminal), then the inputs and the outputs |
| `window` | how much time the timeline shows (and the length of a row in the PDF) | `4 s` |
| `params` | constants students may change: `[DELAY_MS]`, or `{DELAY_MS: {min: 0, max: 2000}}` | none |
| `show` | `iterations` (how often the superloop ran), `sleep` (the share of time asleep) | none |
| `controls` | `speed` (the speed buttons), `step` (Step and Next loop), `bounce` (a switch to turn bouncing on and off) | `[speed]` |
| `speed`, `speeds` | the speed at the start, and the speed buttons: `1/10`, `[1/100, 1/10, 1]` | `1`; buttons chosen from the program's times |
| `line_time` | how long one statement takes (10 ns to 1 ms) | `1 us` |
| `seed` | the random numbers of bounces in the PDF and the tests | `1` |
| `script` | scripted presses and typing for the PDF and the answers ([Scripts](#scripts)) | none |
| `run` | how long the scripted run lasts | `3 s` (`10 s` for checking an answer) |
| `print` | the PDF: `all` variants, or `one` (the one of `variant`) | `all` |
| `goal`, `answer_script`, `answer` | a challenge ([Challenges](#challenges-goal)) | none |
| `editable` | `true`: in `course preview`, the YAML under the block to change and apply | `false` |

Times are written with a unit: `500 ms`, `4 s`, `10 us` (or `µs`); a plain
number is in seconds. Speeds are `1` (real time), `1/10`, `1/100` (slower) or
`2`, `10` (faster), from 1/1000 to 100.

## The program

### Whole programs and fragments

If the code has a `main()`, it is a whole program: global declarations,
functions and `main()`, as in a lesson's complete listing. When `main()`
returns, the program stops (as on a Pico, the outputs keep their last value).

If not, it is a **fragment**, as lessons show code. Function definitions are
taken out. Declarations at the top become globals (zero initialised, as in
C). The other statements, in order, are the body of `main()`. A global whose
value needs the program (`absolute_time_t now = get_absolute_time();`) gets it
when `main()` reaches that line.

`#include` lines are accepted and ignored; an unknown header is a warning.
`#define` is an error with a hint: write a `const` instead.

### The language

A part of C99, enough for the lessons of weeks 1 and 2. Anything else is an
error that says what is not supported, never a silent misreading.

- **Types**: `bool`, `char`, `signed char`, `unsigned char`, `short`, `int`,
  `long`, `long long` and their `unsigned` forms, `int8_t` … `int64_t`,
  `uint8_t` … `uint64_t`, `size_t`, `uint`, `absolute_time_t`; `const`,
  `volatile` (accepted, no effect); `void` for functions.
- **Declarations**: global and local, with or without a value, several per
  line (`int a = 1, b;`).
- **Statements**: expression statements, blocks, `if`/`else`, `while`,
  `do … while`, `for` (with a declaration in it), `break`, `continue`,
  `return`, the empty statement.
- **Expressions**: every C operator on integers, with C's precedence:
  assignment and compound assignment, `?:`, `||` and `&&` (short-circuit),
  comparisons, bitwise operators and shifts, `+ - * / %`, unary `! ~ - +`,
  `++` and `--` (both forms), casts, the comma operator, calls. Literals:
  decimal, `0x`, `0b`, octal, the suffixes `u`, `l`, `ll`, characters such as
  `'0'` and `'\n'`; `true` and `false`; `INT_MAX` and the other limits of
  `limits.h` and `stdint.h`.
- **Functions** with parameters and `return`, declared before they are
  called (a prototype is enough), as C wants; recursion up to 64 levels.
- **Text**: string literals with C's escapes (`"Hello\n"`, `"\x41"`, letters
  beyond ASCII as UTF-8); literals side by side are one (`"%" PRIu64 "\n"`,
  with `PRIu64` and the other macros of `<inttypes.h>` as the Pico's C
  library defines them). Text is the format and the values of `printf`, the
  text of `puts`, and `const char *` (or `char *`) constants, parameters and
  return values. A `const char *` keeps the text it starts with; text cannot
  be compared or computed with. No other pointers.

### C's integer rules, as on the RP2040

- Sizes as with arm-none-eabi-gcc: `int` and `long` 32 bits, `long long` 64
  bits, `int32_t` is a `long`, `size_t` an `unsigned int`, plain `char` is
  **unsigned** (ARM).
- The integer promotions and the usual arithmetic conversions apply inside
  expressions: a `uint8_t` becomes an `int` before arithmetic, `uint32_t`
  arithmetic wraps where C wraps it, and `-1 < 0u` is false.
- A conversion to a smaller or signed type wraps (implementation-defined in
  C; gcc wraps): `int8_t` 127 + 1 → −128 is no undefined behaviour.
- 64-bit values are exact.
- Division truncates towards zero; `%` has the sign of the left operand.

The interpreter is checked against gcc on thousands of random expressions
for every build of course-tools (`tests/superloop_gcc.js`).

### The SDK

| Function | What the widget does |
|:--|:--|
| `stdio_init_all()` | starts USB stdio: the Pico is on USB 0.25 s later ([The terminal](#the-terminal-printf-and-getchar)); returns `true` |
| `tight_loop_contents()` | nothing |
| `printf(format, …)`, `puts(text)`, `putchar(c)` | send text to the terminal, as the SDK does ([The terminal](#the-terminal-printf-and-getchar)) |
| `getchar()` | waits for a key and returns it (0 to 255) |
| `stdio_getchar_timeout_us(t)`, `getchar_timeout_us(t)` | a key, or `PICO_ERROR_TIMEOUT` (−2) after t µs; with 0, it does not wait |
| `stdio_usb_connected()` | whether a terminal is open |
| `stdio_flush()`, `fflush(stdout)` | nothing (the SDK's `printf` sends at once) |
| `gpio_init(pin)` | the pin becomes an input of the SIO, its output value 0; the pulls stay as they are (the pull-down from reset) |
| `gpio_set_dir(pin, GPIO_OUT / GPIO_IN)` | the direction (`GPIO_OUT` is 1, `GPIO_IN` 0; `true` and `false` work too) |
| `gpio_put(pin, value)` | the output value; it drives the pin only when the pin is an output |
| `gpio_get(pin)` | an output: its value; an input: its level ([Inputs and outputs](#inputs-and-outputs)) |
| `gpio_pull_up`, `gpio_pull_down`, `gpio_disable_pulls` | the pull |
| `sleep_ms(n)`, `sleep_us(n)` | time passes; the program is *asleep* |
| `busy_wait_ms(n)`, `busy_wait_us(n)`, `busy_wait_us_32(n)` | time passes; the program is *busy* |
| `get_absolute_time()`, `time_us_64()` | now, in µs since the start |
| `to_us_since_boot(t)` | `t` |
| `time_us_32()` | now, in µs, as 32 bits |
| `make_timeout_time_ms(n)`, `make_timeout_time_us(n)` | now + n |
| `delayed_by_ms(t, n)`, `delayed_by_us(t, n)` | t + n, at most `at_the_end_of_time` |
| `time_reached(t)` | now ≥ t |
| `absolute_time_diff_us(from, to)` | to − from, signed |
| `nil_time`, `at_the_end_of_time` | 0, and the largest time (`INT64_MAX`), as in the SDK |
| `PICO_ERROR_TIMEOUT`, `PICO_OK`, `PICO_ERROR_GENERIC`, `EOF` | −2, 0, −1, −1 |

A call of any other function that the code does not define is an error that
names it.

## Inputs and outputs

Each name in `inputs` and `outputs` is a device on a GPIO, named like a pin
constant of the code (`LED_PIN`). If the code declares the constant
(`const uint LED_PIN = 15;`), that is the device's GPIO. If not, the block
declares it: outputs get GP15, 14, 13, …, inputs GP16, 17, 18, …, the
course's wiring; a note under the board says so (*LED_PIN is GP15,
BUTTON_PIN is GP16.*). A name can also be a GPIO number: `16: hold button`
is shown as GP16, and the code uses `16`.

**Inputs.**

- `button`: a click is a press of 150 ms (of simulated time).
- `hold button`: pressed while it is held down (mouse, touch, or Space and
  Enter).
- `pin`: a switch; a click sets it high or low.
- `bouncy …`: at every change, 2 to 4 pairs of extra flips in the first
  12 ms, as a real contact does. With `controls: [bounce]`, a switch next to
  the button turns bouncing on and off.

With `active: high`, a pressed button gives 3.3 V and reads 1; released, the
pull decides: pull-down 0, pull-up 1, no pull: the pin floats and reads 0 or
1 at random (with a note). With `active: low`, a press gives 0 V, and a
released button needs a pull-up to read 1.

**Outputs.** An LED is lit, and a buzzer on, while its pin is an output
driven high. An LED is drawn as an eye sees it: its level averaged over about
20 ms of real time, shown as the perceived lightness (CIE L\*). An LED that
is on half the time looks about 76 % bright; a fast blink looks like a dim,
steady LED, which leads to PWM.

**`io_setup`.** With `io_setup: auto` (the default), before the program starts,
inputs are inputs with the pull for `active` (a pull-down for `high`), and
outputs are outputs driven low, so lesson fragments without `gpio_init()`
work. With `io_setup: code` (or `manual`), every pin starts as after reset: an input with its
pull-down on. Then:

- `gpio_put()` on a pin that is not an output does nothing, and the widget
  says so once: *gpio_put(15, 1) does nothing: GP15 is not an output.
  gpio_set_dir(15, GPIO_OUT) is missing.*
- `gpio_get()` of a pin with nothing connected reads 0 (the pull-down), with
  a note.
- A device whose pin the program never sets up is a build warning.

## Time

Time is simulated. Every statement takes `line_time` (1 µs): each expression
statement, declaration with a value, `return`, `break`, `continue`, each
evaluation of a condition (`if`, `while`, `for`, `do`) and each `for` step.
Calls of the SDK take nothing more, except `sleep_*` and `busy_wait_*`, which
take their time, `printf`, `puts` and `putchar`, which take the time they take
on a Pico ([The terminal](#the-terminal-printf-and-getchar)), and `getchar()`,
which waits for a key. These numbers are a model: a Pico runs a statement in about
0.1 µs. A superloop round of a few statements takes a few microseconds, as
the lessons say.

A press comes between two statements. During `sleep_ms()` an input can change
and change back without the program ever reading it: that is what the
timeline shows.

On the website, the program runs at real time × the speed. A program that
needs more statements than the browser manages runs slower, and the widget
says so (*Running slower than real time here: 0.4×*). A block that is off the
screen, or in a hidden tab, stands still.

## Undefined behaviour

With `undefined_behavior: stop` (the default), the first undefined behaviour
stops the program, with a message that names the line and says what to write
instead:

- *Line 6: 50000 \* 50000 does not fit in an int (uint16_t values become int
  before the multiplication). Signed overflow is undefined behaviour in C.
  Write (uint32_t)width \* height.*
- *Line 3: 1 << 31 shifts a 1 into or past the sign bit of an int. Write
  1u << 31.*
- *Line 7: debounce_time is used before it gets a value.*

A variable changed twice in one expression (`i = i++ + 1`, `x + x++`,
`f(i++, i)`) is a build error.

With `undefined_behavior: permit`, the program goes on as it would on a Pico,
and students are always warned: every undefined behaviour shows a note (once
per line) and a mark on its line, saying what happened, what the widget did,
and that the compiled program may do something else. What the widget does
was measured on a Pico, a Release build of SDK 2.3.1 (`-O3`, gcc 13 to 15
decide the same):

| Undefined behaviour | `permit` in the widget | On the Pico |
|:--|:--|:--|
| signed overflow in `+ - * ++ --` and unary `-` | wraps | wraps when the value is stored or printed |
| the same, where a comparison depends on it | wraps | the compiler assumes it never happens: `x + 1 > x` is always 1, `a + b < 0` overflow checks are removed, a doubling loop `i > 0` never ends |
| a 32-bit shift by 32 or more, or by a negative count | as the processor: the count's low byte; 32 or more gives 0 (or the sign for a signed `>>`) | `1u << 32` → 0, `1u << 256` → 1, `-8 >> 32` → −1 |
| a 64-bit shift by 64 or more | as gcc's code | `1ull << 64` → 0, `3ull << 256` → 3 |
| a 1 shifted into the sign bit, a negative number shifted left | as the processor | `1 << 31` → `INT_MIN`, `-1 << 1` → −2 |
| reading an uninitialised local | 0 at first, then the variable's last value (in a loop, of the round before) | gcc uses 0, or the only value ever assigned; in a loop, the round before's value |
| division by zero | as the SDK's divider | `x / 0` → `INT_MAX` (x > 0), `INT_MIN` (x < 0), 0 (x = 0); unsigned: 4294967295; `x % 0` → 0 |
| `INT_MIN / -1`, `INT_MIN % -1` | as the divider | `INT_MIN`, 0 |
| a variable changed twice in one expression | left to right | gcc evaluates left to right: `i = i++ + 1` → 8 (i = 7), `f(i++, i++)` → `f(7, 8)` |
| a function that ends without `return`, its value used | the first argument | the register is unchanged: the first argument |

gcc's own `-Wall -Wextra` warns only about the last two rows and some
uninitialised reads; it says nothing about overflow, shifts or `1 << 31`.

## The terminal: `printf` and `getchar`

A `terminal:` block gives the block a terminal: a terminal app on the
computer, such as PuTTY or minicom, talking to the Pico over USB. Students
open it, type, and read what the program prints. The Pico itself has *USB
stdio* (`stdio_init_all()` starts it); the computer shows it as a serial
device (COM3, `/dev/ttyACM0`), which the terminal app opens. Everything below
is what the Pico SDK 2.3.1 does, checked on a Pico W.

```yaml
stdio_setup: manual       # the program calls stdio_init_all() (manual = code; auto: the block does)
terminal:                 # a terminal; without this block, there is none
  open: manual            # students click Open (manual = button); auto: it opens by itself
  enter: cr               # what Enter sends: cr, lf or crlf
  echo: false             # local echo at the start (and in the PDF)
```

Every setting has a default (the values above), so `terminal:` with nothing
under it is a terminal that students open, for a program that calls
`stdio_init_all()` itself.

- **On USB.** The Pico appears on USB 0.25 s after `stdio_init_all()` (the
  computer needs that long to recognise it; measured). With
  `stdio_setup: manual` (the default), the program calls `stdio_init_all()`
  itself, as on a Pico; a fragment without it never appears on USB. With
  `stdio_setup: auto`, USB stdio starts before the program. Open before the
  Pico is on USB says *The computer sees no Pico on USB: the program has not
  called stdio_init_all(), which starts its USB connection.* (or *The
  computer doesn't see the Pico on USB yet.*). With `open: auto`, the
  terminal opens by itself as soon as the Pico is on USB, as terminal apps
  that reconnect by themselves do.
- **Text without a terminal is dropped**, as the SDK drops it: before
  `stdio_init_all()`, before the Pico is on USB, and while no terminal is
  open. A program that prints one line at the start loses it, even with
  `open: auto`. `stdio_usb_connected()` is true while a terminal is open;
  `while (!stdio_usb_connected()) sleep_ms(10);` waits for one.
- **`\n` goes out as `\r\n`**, unless it follows a `\r`, also across calls
  (the SDK's CR/LF conversion).
- **Keys.** Every key is sent at once; Enter as `enter` (`\r`, as most
  terminals), Backspace as DEL (0x7F, as PuTTY), letters beyond ASCII as
  UTF-8. Local echo (`echo`, also a checkbox) shows the keys on the screen, as a
  terminal app does; it is off by default, as in most terminals. A closed
  terminal takes no keys. Keys the program does not read yet wait, in order,
  and are never lost: on a Pico, USB makes the computer hold what does not fit
  in the Pico's buffer (measured: 1000 keys typed during a `sleep_ms(3000)`
  all arrive; keys still waiting when the terminal closes stay). The widget
  keeps up to 4 KB, then stops taking keys, with a note.
- **`getchar()` waits** for a key: the `cpu` lane says *waiting*, the line
  *waiting for a key*. `stdio_getchar_timeout_us(t)` waits at most t µs.
- **The screen** shows what the terminal received, as a terminal shows it:
  `\r` goes back to the start of the line (so `printf("\rt = %llu", t)`
  updates a line in place), `\b` back one character, `\t` to the next
  multiple of 8; other control characters and escape sequences are not
  interpreted. It keeps the last 1000 lines. Every variant has its own
  screen; Open, Close and the keys go to all variants at once, as the presses
  do. Reset closes the terminal and clears it (a reset of the Pico drops its
  USB connection).

**`printf`** prints as the SDK's own `printf` (`pico_printf`) does, quirks
included: `%d %i %u %x %X %o %b %c %s %%`, the flags `- 0 + space #`, a width
and a precision (also `*`), and the lengths `hh h l ll z j t`. `%#4x` of
`0x1234` prints `0x34`, and zero padding stops at 32 characters, as on a Pico.
`%f` comes with `float`. The build checks every value against its conversion,
in both `undefined_behavior` modes:

- a value of another size, or text for a number (or a number for text), is an
  error with the fix: *Line 5, column 16: %d expects an int, but time_us_64()
  is a uint64_t: use %llu (or "%" PRIu64)*. What a Pico prints there comes
  from whatever is left in a register, so the widget cannot copy it. A
  missing value is an error too.
- a value of the same size and the other signedness prints as on a Pico,
  without a message: `printf("%u", -1)` prints 4294967295, `%d` of an
  `int32_t` (a `long` on the Pico) prints the number;
- extra values are a warning;
- the format must be text in double quotes, or a `const char *` constant with
  such text.

**Times** (measured on a Pico W, within 20 %). These are real times, like
`sleep_ms()`, not scaled like `line_time`:

| | `printf`, `puts` | `putchar` |
|:--|:--|:--|
| USB stdio not started | 2 µs + 0.02 µs per character | 2 µs |
| no terminal open (dropped) | 10 µs + 0.15 µs per character | 4 µs |
| a terminal open | 40 µs + 0.15 µs per character, and waits for room | 13 µs, and waits for room |

A 64-bit number (`%llu`) adds 1.1 µs per digit: the RP2040 divides 64-bit
numbers in software. With a terminal open, the text leaves in USB packets of
up to 64 bytes, one per 90 µs, and the Pico holds 64 bytes besides the packet
being sent; a call that does not fit waits (*busy* on the `cpu` lane). So
printing in the superloop slows it down: 64-character lines in a tight loop
take about 0.1 ms each.

## Variants

````markdown
variants:
  sleeping: |
    …
  checking: |
    …
````

Every variant runs at the same time, on the same presses; the tab chooses
which one is shown: its code, variables, counters and timeline. After one
press, the other tab shows what that version did with the same press.
Switching tabs resets nothing; Reset and a changed constant restart all
variants. The lines that differ from the other variant (with more than two:
from the first) have an orange mark in the margin.

## Constants students change: `params`

`params: [DELAY_MS]` makes a `const` integer of the program changeable: its
number in the code becomes a box that students edit in place (arrow keys
step the value). A change restarts the program; it applies to every variant
that has the constant. The range is `min` … `max`, by default 0 to 10 times
the value (at least 10): `params: {DELAY_MS: {min: 1, max: 1000}}`.

## Variables and counters: `watch` and `show`

`watch: [armed, debounce_time, flags:hex]` shows variables next to the code,
one row each: `bool` as `true` or `false`, integers in decimal (or `0x…`), an
`absolute_time_t` relative to now (*in 37.2 ms*, *reached 1.20 s ago*, *not
set*) with its value small under it. A local shows *not in scope now* outside
its function. A value that just changed flashes (not with reduced motion).

`show: [iterations, sleep]` adds *The superloop ran 2 345 678 times.* (the
superloop is the first `while (true)`, `while (1)` or `for (;;)` of
`main()`) and *Asleep 97 % of the last 4 s.*

## The timeline

The last `window` of time, with *now* at 80 % of the width, so that deadlines
in the near future show. It scrolls as time passes. The lanes, in the order
of `timeline`:

- **An input**: its level. Each moment the program read it (`gpio_get()`) is
  a dot on the signal, at the level it read. Where reads come closer than a
  dot, the signal is highlighted instead: the program read it all the time. A
  press the program never read has a red dashed box, with a tooltip: *This
  press was never read: the program was asleep (sleep_ms) the whole time* (or
  *busy elsewhere*).
- **An output**: its level. Changes too close for a pixel become a hatched
  band, with the rate when there is room (*toggling at 100 Hz*).
- **`cpu`**: what the processor does: running (blue), asleep (grey,
  hatched), busy (`busy_wait`, blue hatched), waiting for a key (light blue),
  stopped.
- **`terminal`**: the USB connection as a band (hatched: the Pico is not on
  USB; grey: no terminal open; dark: a terminal open). Above it, an orange
  mark for each `printf`, `puts` or `putchar`, with its text (C's notation)
  where there is room and as a tooltip; text that was dropped is a red ✕,
  struck through, with the reason in its tooltip (*Dropped (no terminal was
  open)*). Prints closer than a mark become a band (*printing 2 000
  times/s*). Below the band, a dark mark for each key typed (`5`, `12⏎`), and
  a green dot where `getchar()` took a key.
- **An `absolute_time_t` variable**: `time_reached(variable)` as a level (low
  before the deadline, high after, low while it is 0), and a flag at its
  value with *in 37 ms*. In the debouncing example, the flag runs ahead of
  now while the button is up or bouncing, then stops, and now catches up
  with it.

Colours: dark and orange for the pins (inputs, outputs), green for what is
inside the program (its reads, its deadlines), blue for the processor.

## On the website

From top to bottom: the title, the task, the tabs, then the code next to the
board (they stack on a narrow screen), the controls, the timeline with its
legend, and the status line.

- **The code**, with line numbers and the colours of the course's code
  blocks. While it runs, the lines that run often are tinted (a heat map, so
  the superloop's body glows). A line that sleeps is marked, with *asleep:
  650 ms left* and a progress bar. Paused, the line about to run is marked.
- **The board**: the inputs as buttons, the outputs as LEDs and buzzers.
- **The terminal** (with `terminal`): Open/Close, local echo, and the screen,
  which students click and type into. A line that waits for a key says
  *waiting for a key*.
- **Controls**: Reset, Pause/Run, the speed buttons, Step (one statement)
  and Next loop (to the start of the next round of the superloop) with
  `controls: [step]`, and the clock (*t = 1.234 s*).
- **The status line**: *main() returned…*, *The program stopped: Line 9:
  division by zero.*, the notes about pins and undefined behaviour, and the
  challenge's status.

## Scripts

A script is scripted input: for the PDF and for checking answers.

```yaml
script:
  - BUTTON_PIN press at 300 ms for 400 ms   # pressed from 0.3 s to 0.7 s
  - BUTTON_PIN press at 2 s                 # and held
  - BUTTON_PIN release at 2.5 s
  - SWITCH high at 1 s                      # a pin: high or low
  - terminal open at 1.5 s                  # with a terminal: open, close
  - type "5" at 2 s                         # C's escapes: "12\r"
run: 3 s
```

A `button` (click) without `for` is pressed for 150 ms. Bouncy inputs bounce
in a script too, from `seed`. The steps of an input must be in time order and
end within `run`; so must the terminal's. `type` sends its text at once, like
a paste (several steps type slowly); with `open: manual`, the script opens
the terminal before it types.

## Challenges: `goal`

```yaml
task: Disarm the alarm with one short press.
goal:
  variant: checking            # with variants: the goal names its variant
  vars: {armed: false}         # these variables have these values at some moment
  outputs: {LED_PIN: off}      # and/or these outputs
  shows: "Playing 5 beeps."    # and/or the terminal has shown this text
  max_presses: 1               # optional: with at most this many presses
answer_script:
  - BUTTON_PIN press at 100 ms for 150 ms
answer: Press once, for longer than 50 ms: the checking program reads the button all the time.
```

The goal is met at the first moment all its variables and outputs hold (and
the terminal has shown its text: text that was dropped does not count). The
status says *Not yet.*, then *Right! armed became false at t = 0.152 s.*;
with too many presses, *That took 3 presses. Can you do it with 1? (Reset
starts again.)*. After a try that did not reach the goal (and a Reset), or
after too many presses, a *Show the answer* button shows `answer` and offers
to play `answer_script` on the widget.

The build runs `answer_script` and checks that it reaches the goal within
`run` (10 s unless set). If it does not, the build warns (*goal: the
answer_script does not reach the goal (armed is still true after 10 s)*) and
the PDF has no exercise.

## In the PDF

Every block starts with a note, *Live on the website*: the PDF shows one run
of a program that runs live on the website, with a link to the block. Then,
per variant (or only `variant` with `print: one`):

1. the variant's name;
2. the code, with line numbers;
3. the timeline of a run of `run` with the `script` (rows a `window` long,
   at most 12; a run shorter than the window gets one row of its own length);
4. a caption: *With the script: BUTTON_PIN pressed at 0.3 s for 0.4 s. The
   press was never read. At the end: armed = true.* With a terminal, the
   caption has its steps and the dropped prints: *With the script: the
   terminal opened at 1.5 s, typed "5" at 2 s. One print was dropped (the
   Pico was not on USB yet).*
5. with a terminal, its screen at the end of the run: the last 20 lines, as
   students would see them (the keys only with `echo: true`).

A challenge whose `answer_script` reaches its goal is an exercise: the code
of its variant and the task. Its answer, at the end of the PDF under
*Answers*, is `answer`, the script in words with the moment the goal was met
(*BUTTON_PIN pressed at 0.1 s for 0.15 s: armed is false at 0.15 s.*), and
the timeline of that run.

The program runs at build time with the script, in the same interpreter as
on the website, with a limit of 50 million statements per run.

## Mistakes and warnings

The build reports, with the page and the block's number:

- errors in the program, with the line and the column of the program (not of
  the YAML) and a hint for common cases: *Line 3, column 10: ";" is missing
  at the end of the line*; unknown functions, types or variables; assignment
  to a `const`; `break` outside a loop; a function called before it is
  declared; a variable changed twice in one expression (with `stop`);
  `printf` values that do not fit their conversions, a missing value, an
  unknown conversion, `%f`, a format that is not text in double quotes;
- unknown settings, input or output kinds; names in `watch`, `timeline` and
  `params` that are not in the program (`params` must be `const` integers
  with a number as their value); a device name that the code uses for
  something else than a pin number; two devices on one GPIO;
- scripts: unknown inputs, steps out of order, steps after the end of the
  run, terminal steps without a terminal, typing into a closed terminal;
  goals: unknown variables or outputs, a goal without `variant` in a block
  with variants, a goal on the terminal without one;
- warnings: a goal without `answer_script` or `answer`, an `answer_script`
  that does not reach the goal or has more presses than `max_presses`; a run
  that stops at build time (undefined behaviour, a crash, too many
  statements); with `io_setup: code`, a device whose pin the program never sets
  up; an unknown `#include`; `printf` with extra values; a program that
  prints or reads keys in a block without a terminal.

On the website, a block with a mistake shows the same message instead of the
block.

## Trying things out: `editable: true`

With `editable: true`, `course preview` shows the block's YAML under it, to
change and apply (Ctrl+Enter); mistakes and the build's warnings appear under
the YAML. Reset brings back the original. The published site never has the
YAML. To use a block from the gallery in a lesson, copy it and leave out
`editable: true`.

## Examples

### Sleeping and checking

The burglar alarm of week 2, as two variants: a short press is missed by the
sleeping program and read by the checking one.

````markdown
```superloop
title: The burglar alarm, sleeping and checking
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
task: Disarm the alarm with one short press. Then look at the other tab; it got the same press.
```
````

### Debouncing, slowed down

````markdown
```superloop
title: Debouncing without waiting
speed: 1/10
speeds: [1/100, 1/10, 1]
window: 400 ms
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
  - BUTTON_PIN press at 100 ms
run: 400 ms
task: Press and hold the button. Watch debounce_time while the button bounces, and after.
```
````

### Blinking, with a constant to change

````markdown
```superloop
title: Blinking
io_setup: code
outputs:
  LED_PIN: red led
code: |
  const uint LED_PIN = 15;
  const uint32_t DELAY_MS = 500;

  int main() {
    gpio_init(LED_PIN);
    gpio_set_dir(LED_PIN, GPIO_OUT);
    while (true) {
      gpio_put(LED_PIN, 1);
      sleep_ms(DELAY_MS);
      gpio_put(LED_PIN, 0);
      sleep_ms(DELAY_MS);
    }
  }
params: [DELAY_MS]
timeline: [cpu, LED_PIN]
speeds: [1/10, 1]
task: Make DELAY_MS smaller and smaller. When does the LED stop blinking and start to look dim?
```
````

### Where did the prompt go?

Week 3's two surprises: the first prompt is lost, because the Pico prints it
before any terminal is open (here, before the Pico is even on USB), and the
keys do not show. The second tab waits for the terminal.

```yaml
title: Where did the prompt go?
stdio_setup: manual
terminal:
  open: manual
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
task: Open the terminal, then type a digit. Where is the first prompt? Then look at the second tab.
```

## What is not possible (yet)

- `switch` and `enum`; `float` and `double` (and so `%f`); the lessons'
  button and blinker libraries (`uses`, accepted with a warning).
- `struct`, arrays, pointers other than `const char *`, `static` locals,
  `scanf`, `sprintf`, `fgets`.
- Interrupts and callbacks (`add_repeating_timer_ms`, GPIO IRQs), the second
  core, the PWM, ADC and UART hardware (the `pwm` and `adc` widgets cover
  some), the RP2040's real timing.
- Editing the whole program on the published site: students change
  `params`; `editable: true` is for authors, in `course preview`.
