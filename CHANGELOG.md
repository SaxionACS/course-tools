# Changelog

What changed in each release of course-tools. A release is a git tag such as
`v1.11.1`; the tag `v1` points to the newest 1.x release, which the course
repositories use.

Every release from 1.11.1 on has **platform notes**:

- **Dependencies:** new or changed Python packages and system tools, or "none".
- **Ubuntu / CI:** what was checked on Ubuntu 24.04 (locally, WSL included,
  and in the Check workflow).
- **macOS:** `verified` (with macOS version, chip and date), `untested`, or
  what still has to be done on a Mac. macOS is supported on a best-effort
  basis and has no CI; see "Syncing macOS" in [CLAUDE.md](CLAUDE.md).

## 1.17.0 (2026-10-22)

- `course preview --pdf`: the preview renders the PDFs too, and the pages
  have their PDF buttons. Quarto renders every PDF at the start and the PDF
  of every page you change, a few seconds after the web page. Without
  `--pdf`, the preview is HTML only, as before.

Platform notes:

- **Dependencies:** none.
- **Ubuntu / CI:** `scripts/check.py --html-only` passes on Ubuntu 24.04
  (WSL); the Check workflow runs it with the PDFs. `course preview --pdf`
  was tested by hand on the test course: PDF buttons, PDFs served, and a
  page's PDF updated about 2 seconds after saving. The check script does not
  run the preview.
- **macOS:** untested. Nothing platform-specific changed.

## 1.16.0 (2026-10-22)

Draft pages, and widgets whose YAML can be edited in the preview.

- **Draft pages:** a page with `draft: true` in its front matter is shown by
  `course preview` only, with a note at the top. `course build` leaves it
  out completely (page, PDF, sidebar, search index, glossary). See
  [docs/authoring.md](docs/authoring.md#draft-pages).
- **`editable: true`** on a widget: in `course preview`, the widget's YAML is
  under it, to change and apply (Ctrl+Enter), and *Reset* brings back the
  original. On the published site the setting does nothing, so a challenge's
  goal stays hidden. The YAML reader (js-yaml) is loaded from a CDN when it
  is first needed; 64-bit values stay exact.
- The course template has a widget gallery: every widget in its different
  configurations, editable, as a draft page (`references/widgets.md`).
- `course stage --preview` stages as `course preview` does, for debugging.

Platform notes:

- **Dependencies:** none. Editing a widget's YAML in the preview needs an
  internet connection the first time (js-yaml from cdnjs).
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL): 121
  checks, with new ones for draft pages (left out of the build, staged with
  a note for the preview) and editable widgets (YAML only in the preview).
  The editor was tested in `course preview` of the template's gallery with
  a browser script (11 checks), not part of CI.
- **macOS:** untested. Nothing platform-specific changed; to do: run
  `scripts/check.py`.

## 1.15.0 (2026-10-22)

Interactive widgets for bits, numbers, registers and data on a wire. See
[docs/authoring.md](docs/authoring.md#widgets).

- A ```` ```widget ```` block with YAML in a page becomes an interactive
  widget on the website. Types: `number` (converter, wheel), `arithmetic`
  (addition and subtraction column by column, with flags), `shift` (shifts
  and rotations, animated bit by bit), `register` (register map, bit
  operations, C code challenge), `frame` (UART, SPI in all four modes, I²C
  as timing diagrams with every signal line; optionally the SPI shift-register
  ring) and `packet` (fields packed into bytes, byte and bit order, sent with
  UART or SPI).
- Shared settings: `signed: false | true | both` (which readings of a number
  are shown), `convention: arm | intel` (flag names, the meaning of the carry
  after a subtraction, shift instructions), widths up to 64 bits.
- A widget with a `goal` is a challenge: the student's answer is checked in
  the browser. In the PDF it becomes a numbered exercise with blank boxes to
  fill in, and its answer goes to the "Answers" section at the end of the
  page. Every printed answer is first checked with the same code that checks
  a student's answer; a goal that cannot be reached is reported.
- In the PDF, every widget is a picture of its starting state (shifts: every
  step; long waveforms: in rows), with a link to the widget on the website.
- The build checks every widget and reports mistakes with the page and the
  widget's number: unknown types, settings and controls, YAML that cannot be
  read, goals that do not fit. Bit ranges are written `7` or `6..5`.
- The widget script is added only to pages with widgets.

Platform notes:

- **Dependencies:** none new. At build time the widget script runs in the
  Deno that Quarto ships (`quarto run`), on every platform.
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL): 117
  checks, with new ones for the widget page, its PDF (pictures, exercises,
  answers) and the reported mistakes, and the widget logic tests
  (`quarto run tests/widgets.js`, 1414 checks: every kind of challenge's
  printed answer checked like a student's answer, encoders, shifts). The
  interactive behaviour was tested with a browser script (33 checks), not
  part of CI.
- **macOS:** untested. To do: run `scripts/check.py`; `quarto run` must work
  (it is part of Quarto).

## 1.14.0 (2026-10-21)

Learning outcomes on pages, and the outcome map. See
[docs/authoring.md](docs/authoring.md#learning-outcomes-of-a-page).

- Learning outcomes in `info/general.yaml` can have a `title`, a short name
  (for example "Superloops"). It is shown with the id on the course
  information and assessment pages.
- `outcomes: [LO1, LO3]` in the front matter of a page shows the outcomes at
  the top of the page, by title (or by id, without a title), with the whole
  outcome on hover, and an estimate of the reading time. In the PDF, one line
  under the title.
- **Outcome map** (*Course information* in the sidebar): for every learning
  outcome, the weeks and pages that work towards it, and the assessment
  components that assess it. Generated when at least one page names
  outcomes.
- Warnings for an unknown outcome in the front matter, and for an outcome
  that no page covers.

Platform notes:

- **Dependencies:** none.
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL), with new
  checks for the badges, the outcome map and their PDFs. The hover text was
  tested with a browser script, not part of CI.
- **macOS:** untested. Nothing platform-specific changed; to do: run
  `scripts/check.py`.

## 1.13.0 (2026-10-21)

Key terms. See [docs/authoring.md](docs/authoring.md#key-terms).

- `::: {.terms}` in a page: a definition list of the page's key terms, shown
  as a *Key terms* box. A term can have other names (`aliases`).
- **Definitions on first use:** on every page, the first use of a key term
  (or one of its other names, also in the plural) is underlined; pointing at
  it, or tapping it, shows the definition, with links to where the term is
  introduced and to the glossary. Not in self-checks and predictions, where
  the definition could give the answer away.
- **Glossary:** a generated page with all key terms from A to Z, each linking
  to the page that introduces it. In the sidebar under *Key terms*, also as
  PDF.
- **Review key terms:** a deck of flash cards with spaced repetition (Leitner
  boxes: again after 1, 3, 7, 16 and 35 days), filtered by week, asking for
  the definition or the term. Progress is saved in the student's browser
  only. No PDF.
- A term defined twice gives a warning; the glossary uses the first
  definition.

Platform notes:

- **Dependencies:** none.
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL), with new
  checks for the glossary, the key-terms box, the review page and their PDFs.
  The browser part (definitions on first use, the review deck) was tested with
  a browser script, not part of CI.
- **macOS:** untested. Nothing platform-specific changed; to do: run
  `scripts/check.py`.

## 1.12.0 (2026-10-20)

Practice in the lessons, and Compiler Explorer links. See
[docs/authoring.md](docs/authoring.md).

- **Self-checks** (`::: {.check}`): multiple choice with one or several right
  answers and feedback per option, or fill-in blanks (`[42]{.blank}`) for
  whole, hexadecimal, binary and decimal numbers (with a tolerance) and text
  (case-sensitive or not, other accepted answers, spaces ignored for code). An
  optional explanation appears when the answer is right; "Show answer"
  appears after a wrong attempt.
- **Predict** (`::: {.predict}`): code with a box for the student's
  prediction; the answer is revealed after writing one. Compiler Explorer links
  in the block appear only then.
- **Compare** (`::: {.compare}`): two code blocks side by side with labels;
  the lines that differ are marked.
- **Compiler Explorer links** on code blocks (`{c ce=asm}`, `ce=run`,
  `ce=exe`). The compiler, its options and a target label are set for the
  course (`compiler_explorer` in `info/general.yaml`), can be changed per page
  in the front matter and per code block. Compiler Explorer can only run
  x86-64 programs, so a course can set a separate compiler for `run` and `exe`.
- PDFs: questions without the answers; answers, feedback and explanations in
  an "Answers" section at the end of the page. Compiler Explorer links are
  clickable.

Platform notes:

- **Dependencies:** none. The links lead to <https://godbolt.org>; the code of
  the block is sent there when a student opens a link.
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL), with new
  checks for the self-checks, predictions, comparisons and the Compiler
  Explorer links. The answer checking in the browser was tested with a browser
  script (not part of CI): all question types, tolerances, decimal commas,
  case, accepted answers, "Show answer", predictions and the marked lines.
- **macOS:** untested. Nothing platform-specific changed; to do: run
  `scripts/check.py`.

## 1.11.1 (2026-10-20)

Groundwork for developing course-tools. Nothing changes for courses.

- `CLAUDE.md`: how course-tools is built, the rules for changing it, and how
  changes reach macOS. Claude Code reads it automatically.
- `CHANGELOG.md` (this file), with platform notes per release.
- `tests/course/`: a test course that uses every feature.
- `scripts/check.py`: builds the test course and checks the website, the PDFs,
  links, private files, zips, page footers and the build output.
- Check workflow (`.github/workflows/check.yml`): runs `scripts/check.py` on
  every push to every branch. It publishes nothing. Merge a branch into
  `main` only when the check has passed.

Platform notes:

- **Dependencies:** none for courses. `scripts/check.py` needs only Python's
  standard library. It also checks the text of the PDFs when `pdftotext` is
  installed (`poppler-utils` on Ubuntu, `brew install poppler` on macOS);
  without it, that part is skipped.
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL). The Check
  workflow runs on GitHub's Ubuntu 24.04 runners.
- **macOS:** untested. To do: run `./install.sh --local` and
  `python3 scripts/check.py`. Note that temporary directories on macOS are
  under `/private/var/...`; course-tools only treats `private` directories
  *inside* the course as private.

## 1.11.0 (2026-10-11)

- Native macOS support for local builds: `install.sh` installs everything with
  Homebrew; `course doctor` gives macOS-specific hints.
- Renaming a page in a way that only changes upper/lower case works on
  case-insensitive file systems (macOS).
- `requirements.md`: Ubuntu's Graphviz reports version 2.43.

Platform notes:

- **macOS:** supported from this release; `install.sh` tested on macOS 26 with
  Homebrew.

## 1.10.0 (2026-10-08)

- Code annotations: the numbers sit right after the code, aligned in one
  column, instead of at the right edge of the code block.

## 1.9.0 (2026-10-08)

- Code annotations: `// <1>` markers work in C; in PDFs, annotations are
  circled numbers.

## 1.8.0 (2026-10-07)

- PDF links open in a new tab instead of downloading.

## 1.7.0 (2026-10-04)

- Mermaid and PlantUML diagrams are centred by default; opt out with
  `fig-align: left`.

## 1.6.0 (2026-10-04)

- Page footer with the dates a page was added and last changed, and by whom,
  from git.

## 1.5.0 (2026-10-03)

- Introductions for the assessment page and its components, with default
  texts.

## 1.4.0 (2026-10-03)

- Introductions for learning outcomes, levels, literature and links;
  mandatory and optional literature.

## 1.3.0 (2026-10-02)

- Logbooks: download and preview from the assignment.
- GitHub-style horizontal rules and lists right after text.

## 1.2.0 (2026-10-02)

- Learning outcomes section on the assessment page; rubric description;
  minimum grade and resit removed.

## 1.1.0 (2026-10-02)

- Optional grading criteria (rubric) per assessment component.

## 1.0.2 (2026-10-02)

- The build job of the publish workflow may read the Pages configuration.

## 1.0.1 (2026-10-02)

- The publish workflow installs Graphviz for PlantUML; `course doctor` reports
  PlantUML and Graphviz separately.

## 1.0.0 (2026-10-02)

- First release.
