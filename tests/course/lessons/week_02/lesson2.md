---
compiler_explorer:
  target: RISC-V
  compiler: rv32-cgcc1520
  options: -O2 -march=rv32imac -mabi=ilp32 --param=max-inline-insns-single=10
---

# Another target

This page uses a different compiler, set in its front matter.

```{c ce=asm}
int add(int a, int b) {
    return a + b;
}
```
