<!--
The page "Generative AI and academic integrity" of a course whose
info/genAI.yaml says `level: not-allowed`. A course replaces it with its own
templates/genAI/not-allowed.md: `course template copy genAI/not-allowed.md` puts a copy
there to change. Comments like this one are left out of the page.
-->

::: {.callout-warning appearance="simple" icon=false}
**In short:** Generative AI is **not allowed** in the assignments of this course. Whatever you hand in, you must be able to explain it.
:::

## Generative AI in this course

You may **not** use generative AI (GenAI) in the assignments of this course.
This holds for every assignment, without exceptions. The assignments are where
you practise and show what *you* can do, and GenAI would take exactly that
practice away.

These rules cover everything you hand in or present for an assignment: code,
tests, documentation, reports, designs, diagrams and data. They do not restrict
how you study the course material: you may, for example, have GenAI explain a
concept from a lecture or quiz you on it, as long as you do not use it on the
assignments themselves. For exams, the exam rules apply.

### Examples

Where GenAI is not allowed, this means for example that you may **not**:

- have a GenAI tool such as ChatGPT, Copilot, Claude or Gemini write, complete,
  fix or improve your code;
- use AI code completion in your editor, such as GitHub Copilot, JetBrains AI
  Assistant or Cursor — switch it off while you work on these assignments;
- paste (part of) the assignment or your solution into a GenAI tool, for
  example to have an error explained or to get a hint;
- have GenAI write or rewrite text that you hand in, such as a report, a README
  or code comments — also not to translate or "polish" it;
- generate tests, test data, diagrams or designs with GenAI.

You **may**:

- use GenAI to understand the course material, as long as it is not about the
  assignment: for example *"explain the difference between a stack and a
  queue"*;
- use ordinary tools that do not generate content: compilers, debuggers,
  linters, formatters, the regular code completion of your editor and spelling
  checkers;
- use books, documentation, the lecture material and other sources, cited as
  described in [Your own work](#your-own-work).

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
