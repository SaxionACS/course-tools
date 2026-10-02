## Citing generative AI

When you use GenAI for an assignment where it is allowed, say so — honestly and
completely. Saxion follows the APA guidelines for generative AI of the Dutch
APA Working Group of universities of applied sciences: state **which tool**
you used, **what you asked** (the prompt) and **what you did with the
output**.

### Small use: a comment in your code

For a single, short piece of generated code (up to about ten lines), a comment
directly above the code is enough. It names the tool and the date, gives the
prompt and says what you changed.

::: {.panel-tabset}

### Python

```python
# GenAI: ChatGPT (GPT-5, OpenAI), 2026-10-14
# Prompt: "Write a Python function that returns the index of the largest
#          value in a list."
# Changed: renamed the variables, added the check for an empty list.
def index_of_max(values):
    if not values:
        raise ValueError("empty list")
    best = 0
    for i, value in enumerate(values):
        if value > values[best]:
            best = i
    return best
```

### C++

```cpp
// GenAI: Copilot (Microsoft), 2026-10-14
// Prompt: "C++ function that swaps two integers using references"
// Used unchanged.
void swap_ints(int& a, int& b) {
    int tmp = a;
    a = b;
    b = tmp;
}
```

:::

### More use: a GENAI.md file

If you use GenAI for more than that — several pieces of code, whole functions,
classes or files, tests, a design, a debugging session, or text — add a file
`GENAI.md` to the root of your submission. It describes **all** your use of
GenAI in the assignment. In the code, refer to the entry, for example
`# GenAI: see GENAI.md, entry 2`.

```markdown
# Use of generative AI

## Tools

- OpenAI. (2026). *ChatGPT* (GPT-5) [Generative AI]. https://chatgpt.com
- Microsoft. (2026). *Copilot* [Generative AI]. https://copilot.microsoft.com

## 1. Reading the input file (`parser.py`)

- **Tool:** ChatGPT
- **Prompt:** "Write a Python function that reads a CSV file with the columns
  name and score and returns a dictionary." (Or a link to the shared
  conversation.)
- **Output used:** the function `read_scores`, lines 10–34 of `parser.py`.
- **My changes and checks:** added error handling for missing columns;
  tested with the files in `tests/data`.

## 2. Unit tests (`test_parser.py`)

- ...
```

Text that you write with the help of GenAI, for example in a report, is cited
as described in the Saxion GenAI Student Guide: mention a writing aid in the
introduction, and describe the tool, the input and the output when you used
GenAI as a research tool.

Using GenAI without complete citation is plagiarism, which is a form of fraud
(see [Your own work](#your-own-work)).
