<!--
The page "Generative AI and academic integrity" of a course whose
info/genAI.yaml says `level: allowed-with-citation`. A course replaces it with its own
templates/genAI/allowed-with-citation.md: `course template copy genAI/allowed-with-citation.md` puts a copy
there to change. Comments like this one are left out of the page.
-->

::: {.callout-tip appearance="simple" icon=false}
**In short:** Generative AI is **allowed** in the assignments, **provided that you cite every use**. Whatever you hand in, you must be able to explain it.
:::

## Generative AI in this course

You may use generative AI (GenAI) in the assignments of this course,
**provided that you cite every use**, as described in
[Citing generative AI](#citing-generative-ai). Use that you do not cite counts
as plagiarism. An assignment can still forbid GenAI; the top of every
assignment shows whether GenAI is allowed in it.

GenAI can help you learn: it can explain code, suggest approaches and help you
find bugs. It can also keep you from learning, when it does the work you are
supposed to practise. Use it to understand, not to skip. You remain
responsible for everything you hand in.

These rules cover everything you hand in or present for an assignment: code,
tests, documentation, reports, designs, diagrams and data. They do not restrict
how you study the course material: you may, for example, have GenAI explain a
concept from a lecture or quiz you on it, as long as you do not use it on the
assignments themselves. For exams, the exam rules apply.

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

## Using generative AI responsibly

Saxion's rules for GenAI (Saxion GenAI Student Guide) apply:

- **You are responsible** for everything you hand in, including what GenAI
  made. Check the output: GenAI can be convincingly wrong. You must understand
  every line you hand in and be able to explain it.
- **Protect data.** Never enter personal data (names, student numbers, e-mail
  addresses, …), confidential information of companies, or material you have
  no right to share — such as code from your internship company or
  copyrighted material — into a GenAI tool.
- **Use Copilot with your Saxion account** where you can. Saxion has approved
  it, and what you enter is not used to train the model.
- Use GenAI where it adds something: it costs a lot of energy.

## Your own work

Assignments show what *you* know and can do. What you hand in must therefore
be your own work, apart from the parts you clearly cite. Saxion's Education and
Examination Regulations (EER) treat anything else as fraud.

### Not allowed

- Copying (part of) another student's solution, from this year or from earlier
  years — also when you change it.
- Letting someone else do (part of) your work: a fellow student, a friend, a
  paid tutor, a website or a "homework service".
- Sharing your solution with others or making it available to them, for
  example in a public GitHub repository, on a shared drive or in a group chat —
  also after the course has ended. Letting others copy your work makes you
  complicit.
- Splitting individual work between students and combining the results.
- Searching or asking for complete solutions to the assignments online, for
  example on forums, Stack Overflow or Discord.
- Using code, text, images or ideas of others without citing them.

In group assignments, all members are responsible for the whole submission:
if one member plagiarises, the others are complicit if they could have known.

### Allowed

- Discussing the course material and the approach to an assignment with
  fellow students — but write your own code and text, and do not exchange
  solutions.
- Helping a fellow student understand an error message or a concept, without
  giving them your code.
- Using well-known algorithms, data structures and design patterns (for
  example quicksort, Dijkstra's algorithm or the observer pattern), and code
  from books, documentation or websites — **provided that you cite the source
  completely** and that the code is not a solution to the assignment itself.
- Using libraries and frameworks, unless the assignment says otherwise.
  Mention them, for example in a `requirements.txt` or in the README.

Cite code from other sources the same way as GenAI: a comment with the source
and what you changed.

```python
# Source: "Binary search algorithm", Wikipedia,
#   https://en.wikipedia.org/wiki/Binary_search_algorithm (2026-10-14)
# Translated the pseudocode to Python; returns the insertion point
# instead of -1 when the value is not found.
def binary_search(values, target):
    ...
```

### Consequences

Examiners check submitted work for plagiarism, also with software that
compares code and texts. Every suspicion of plagiarism or other fraud is
reported to the Examination Board. The Examination Board investigates the
case and hears you before it decides. It can declare your work invalid and
exclude you from one or more exams for up to one year. In case of serious
fraud, the Executive Board can end your enrolment. The decision is recorded in
your student file.

Not sure whether something is allowed? Ask your lecturer *before* you hand in
your work.

## Explaining your work

Examiners may always invite you for an additional oral check of your work if they suspect that it is not (entirely) your own — for example when parts look generated or copied. This is Saxion policy. In the conversation you explain your work: the choices you made, how your code works, and which parts you made with GenAI or took from other sources.

Such a check is part of the assessment, not a punishment. If it shows that the work is your own, your assessment stands. If the suspicion is confirmed, the examiner reports it to the Examination Board.

So make sure that you understand everything you hand in, and that you can explain it.
