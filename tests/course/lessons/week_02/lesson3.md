# Bits and bytes

Widgets of every type and view. The last ones have mistakes on purpose: the
build reports them.

## Numbers

```widget
type: number
title: WIDGET-TITLE
width: 8
value: 0b11010010
controls: [bits, bin, hex, unsigned, signed, width]
explain: true
```

```widget
type: number
width: 8
value: 0
task: Set the bits so that, read as a signed 8-bit number, the value is −46.
controls: [bits]
hide: [unsigned, signed]
goal:
  signed: -46
```

```{#wheel .widget}
type: number
view: wheel
width: 4
value: 5
```

```widget
type: number
width: 64
value: 0xDEADBEEFCAFEF00D
signed: false
```

## Arithmetic

```widget
type: arithmetic
op: add
width: 8
a: 200
b: 100
step: true
controls: [a, b, width]
```

```widget
type: arithmetic
op: sub
width: 4
a: 0b0011
b: 0b0101
controls: [a, b, width]
```

```widget
type: arithmetic
op: add
width: 8
controls: [a, b]
task: Find two 8-bit numbers whose sum overflows as signed numbers (V = 1), but not as unsigned numbers (C = 0).
goal:
  flags: {V: 1, C: 0}
```

```widget
type: arithmetic
op: sub
width: 8
a: 5
b: 9
signed: false
convention: intel
```

```widget
type: shift
width: 8
value: 0b10110011
op: shl
amount: 3
carry: true
ops: [shl, shr, sar, rol, ror, rcl, rcr]
```

## Registers

```widget
type: register
name: TIMCTRL
width: 8
fields:
  - bits: 7
    name: EN
    doc: Enable the timer
  - bits: 6..5
    name: MODE
    values: {0: stopped, 1: one-shot, 2: periodic, 3: reserved}
  - bits: 4
    name: IRQ
    access: r
  - bits: 2..0
    name: DIV
task: Configure an enabled, periodic timer with the clock divided by 8.
goal:
  fields: {EN: 1, MODE: 2, DIV: 3}
```

```widget
type: register
view: ops
name: PORTB
value: 0b01011010
```

```widget
type: register
view: code
name: GPIO_CFG
width: 16
fields:
  - {bits: 15..12, name: DRIVE}
  - {bits: 11, name: PULLUP}
  - {bits: 10, name: PULLDOWN}
  - {bits: 9..8, name: FUNC}
task: Set FUNC to 2 and enable the pull-up, all other bits unchanged.
goal:
  fields: {FUNC: 2}
  set_bits: [11]
```

## Frames and packets

```widget
type: frame
protocol: uart
data: "Hi"
parity: even
controls: [data, parity, stop_bits, bit_order]
```

```widget
type: frame
protocol: spi
mode: 3
mosi: [0x9F, 0x00]
miso: [0xFF, 0xEF]
ring: true
controls: [mode, bit_order]
```

```widget
type: frame
protocol: i2c
address: 0x48
transfers:
  - write: [0x00]
  - read: [0x19, 0x80]
```

```widget
type: frame
protocol: uart
data: "OK"
task: Which two characters were sent?
goal: decode
```

```widget
type: packet
fields:
  - {name: id, bits: 8, value: 0x2A}
  - {name: temperature, bits: 16, value: -125, signed: true}
  - {name: flags, bits: 4, value: 0b1010}
  - {name: seq, bits: 4, value: 7}
byte_order: little
pack: lsb
send: spi
mode: 1
controls: [byte_order, bit_order, pack, send, mode]
```

A widget shown as an example is not a widget:

````markdown
```widget
type: NOT-A-WIDGET
```
````

## Mistakes

```widget
type: dial
```

```widget
type: register
name: CTRL
fields:
  - {bits: [6, 5], name: MODE}
```

```widget
type: number
widht: 8
goal: {unsigned: 300}
```

```widget
type: number
value: [1, 2
```
