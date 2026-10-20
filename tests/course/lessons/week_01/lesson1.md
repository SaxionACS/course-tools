# Superloops

A lesson that uses the Markdown features. Inline math $O(n)$, a link to
[lesson 2](lesson2.md), the [assessment](../../info/assessment.yaml), the
[week overview](README.md) and the [slides](../../slides/week_01/lesson1.pdf).

$$
T(n) = \sum_{i=1}^{n} c = c \cdot n
$$

::: {.callout-tip}
## Remember
CALLOUT-TIP-TEXT
:::

::: {.panel-tabset}
### C
```c
printf("hello\n");
```
### Python
```python
print("hello")
```
:::

## Annotated code

```c
int main(void) {
    setup();                 // <1>
    while (1) {              // <2>
        loop();
    }
}
```
1. Configure the hardware once.
2. Repeat forever.

Executable-cell syntax is shown, never run:

```{python}
print("SHOWN-NEVER-RUN")
```

## Diagrams

```mermaid
flowchart LR
  A[Read inputs] --> B[Update outputs]
```

```plantuml
@startuml
Alice -> Bob: hello
@enduml
```

```plantuml
@startuml
'| fig-align: left
start
:read inputs;
:update outputs;
stop
@enduml
```

![A figure](images/figure.svg){width=40%}

---
Text right after a horizontal rule, and a list right after text:
- first item
- second item
