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
