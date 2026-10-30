# Changelog

What changed in each release of course-tools. A release is a git tag such as
`v2.0.0`; the tag `v2` points to the newest 2.x release, which the course
repositories use. `v1` stays at 1.18.0.

Every release from 1.11.1 on has **platform notes**:

- **Dependencies:** new or changed Python packages and system tools, or "none".
- **Ubuntu / CI:** what was checked on Ubuntu 24.04 (locally, WSL included,
  and in the Check workflow).
- **macOS:** `verified` (with macOS version, chip and date), `untested`, or
  what still has to be done on a Mac. macOS is supported on a best-effort
  basis and has no CI; see "Syncing macOS" in [CLAUDE.md](CLAUDE.md).
- **Windows** (from 2.1.0): the same, for native Windows. Best effort, no CI.

## 2.6.0 (2026-10-30)

Templates: texts of course-tools that a course can replace.

- The GenAI policy page of each level is one Markdown template
  (`genAI/not-allowed.md`, `genAI/tutor.md`, ...), and so is the GenAI box of an
  assignment (`genAI/assignment-allowed.md`, ...). A course replaces one with
  its own copy in `templates/` (not published). The built-in pages are the
  same as before.
- `course template list` lists the templates; `course template copy
  genAI/not-allowed.md` copies one into the course, to change it there
  (`--force` replaces an earlier copy).
- `description` in `info/genAI.yaml` is no longer used, and the build warns
  about it: a course's own rules go into its copy of the policy page. Level
  `custom` warns until the course has its own `templates/genAI/custom.md`.
- A file in `templates/` that replaces no template (a typo) is reported.

Platform notes:

- **Dependencies:** none.
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL), 151 checks.
- **macOS:** untested; nothing platform-specific.
- **Windows:** untested; template names are compared with `/` and in any case.

## 2.5.0 (2026-10-30)

- Callouts on the website: their text and code are as big as in the rest of
  the page (Quarto made them 90 %). The PDF had them right already.
- A callout that opens and closes (`collapse="true"`) can have a
  `teaser="..."`: a line under its title while it is closed, to say what is
  inside. See Callouts in [docs/authoring.md](docs/authoring.md).

State machines:

- When the entry actions, the `do` activities or an internal action of a
  state take more than one line, the next lines start under the first item,
  not under `entry:`, `do:` or the event. Also in the PDF.

Platform notes:

- **Dependencies:** none.
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL), 145 checks
  (`tests/statemachine.js`: 133, in the browser: 27).
- **macOS:** untested; nothing platform-specific.
- **Windows:** untested; nothing platform-specific.

## 2.4.0 (2026-10-29)

State machines:

- The new state turns green when the dot along the arrow arrives, not when
  it leaves; the old state stays green until then. What the entry actions
  change (outputs, text, blinking) also shows when the dot arrives; the
  arrow's actions when it leaves. The machine itself still moves at once:
  timers and the log keep the true time.
- `transition: 1 s` sets the time of the dot (420 ms by default, up to 5 s);
  `transition: 0` leaves it out. The dot is shorter when the new state would
  move on before it arrives, so fast blinkers and high speeds keep up.

Platform notes:

- **Dependencies:** none.
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL), 141 checks
  (`tests/statemachine.js`: 132, in the browser: 27).
- **macOS:** untested; nothing platform-specific.
- **Windows:** untested; nothing platform-specific.

## 2.3.0 (2026-10-29)

State machines, after their first use in a lesson:

- The clock, *Pause*, *Speed* and *Skip ahead* appear only for machines that
  use time (`after`, named timers, held conditions, `blink`, bouncy inputs).
  A light switch shows only *Reset*. `clock: true` or `clock: false`
  overrides this.
- Diagrams, internal actions and the PDF's transition tables show `|` between
  the event and the actions (`pressed | LED on`). The YAML takes `/`, as
  before, or `|`. A value that starts with an unquoted `|` (which YAML reads as
  a block of text) is reported with a hint.
- Two `/` on one arrow are reported as such.
- Bigger text in the diagrams (state names 15px, actions 13px, arrow labels
  14px), also in the PDF; diagrams are centred in their block.
- When a state is entered, its entry actions light up for a moment, after
  the dot along the arrow; an internal action lights up when it runs.
- Speed buttons follow the machine's times: slower ones for short times and
  bounces, faster ones (2× to 100×) for long times, none when only 1× makes
  sense. `speeds: [1, 2, 10]` sets them by hand; `speed:` can be faster than
  1 now.
- A block without a log no longer ends with an empty line.

Platform notes:

- **Dependencies:** none.
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL), 141 checks
  (`tests/statemachine.js`: 122, in the browser: 23).
- **macOS:** untested.
- **Windows:** untested; nothing platform-specific.

## 2.2.0 (2026-10-29)

State machines: ```` ```statemachine ```` blocks (see
[docs/statemachines.md](docs/statemachines.md)).

- A block of YAML declares inputs (buttons, hold buttons, pins, bouncy ones),
  outputs (coloured LEDs, buzzers) and states with entry actions, a `blink`
  activity and arrows: `event: TARGET / actions`, or `/ actions` for an
  internal action. Events are inputs, held conditions (`pin high for 50 ms`,
  the counter of `btn_just_pressed()`), `after` timeouts, named timers and
  events that machines `send` each other. Times can be random (`2..5 s`).
- On the website the machine runs: input buttons, LEDs, a display or a
  terminal for `print`, the timers, a log of every event (`log: open`,
  `folded` or `hidden`), speeds down to 1/100 and *Skip ahead* to the next
  bounce or timeout. Ignored events are shown. Machines side by side
  (`machines:`) can be folded to what they react to and send.
- In the PDF: per machine a picture and a transition table, and a link.
- The build reports mistakes (an event that comes from nowhere, an unknown
  output, state or action) and warnings (a timer nobody reacts to, a state
  that cannot be reached), with the page and the machine's number.
  `editable: true` shows the YAML in `course preview`, with the same checks.
- The YAML of a state machine is read with only `true` and `false` as
  booleans, as in the browser: `on:`, `ON` and `OFF` are text. Two equal keys
  are a mistake.
- dagre 3.1.1 (MIT) lays out the diagrams; it comes with course-tools and is
  only loaded on pages with state machines.
- `widgets.py` can find other blocks than widgets and run another
  `print.js` (no change for widgets).
- Tests: `tests/statemachine.js` (logic, mistakes, layouts that must not
  overlap, the PDF form) and `tests/statemachine_browser.js` (the test
  course's machines in Chrome Headless Shell), both run by `check.py`.

Platform notes:

- **Dependencies:** none (dagre is part of course-tools; the browser test
  uses the Chrome Headless Shell of `course setup`).
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL), 141
  checks (new: state machines in HTML, PDF, the preview and a browser).
- **macOS:** untested.
- **Windows:** untested; the browser test turns Windows paths into `file:///`
  URLs, nothing else is platform-specific.

## 2.1.0 (2026-10-29)

Windows: course-tools runs natively on Windows 10/11 (x64).

- `install.ps1` installs it from PowerShell:
  `irm https://raw.githubusercontent.com/SaxionACS/course-tools/v2/install.ps1 | iex`,
  or `-File install.ps1 [-Local]` from a clone. Like `install.sh`, it installs
  uv, course-tools (Python 3.12) and runs `course setup`; Git for Windows
  comes from winget if git is missing. No administrator rights needed.
- On Windows, `course setup` also downloads Graphviz (16.1.0, the official
  zip, SHA-256 checked) and PlantUML uses it (`GRAPHVIZ_DOT`).
- `course doctor` reports the Graphviz that PlantUML itself finds.
- Fixes, found on Windows but not only for it:
  - The PlantUML command in `_quarto.yml` is escaped: Quarto reads it as
    Markdown, which took the backslashes out of a Windows path and would
    also change a path with `_name_` or `$x$` in it.
  - Warnings name course files with `/`, also on Windows.
  - Stopping `course preview` on Windows stops Quarto's server too
    (`quarto.exe` starts `deno.exe`); the port is free again.
  - `course setup` waits for a virus scanner that still holds a new file.
- The installers leave `PATH` alone when `UV_NO_MODIFY_PATH` is set, and
  `.gitattributes` keeps `install.sh` in LF, so that a clone made with Git
  for Windows still runs in WSL.
- The test course has a PlantUML class diagram, which needs Graphviz.
- The docs recommend WSL on Windows (2-4 times faster), with native Windows
  as the simpler option.

Platform notes:

- **Dependencies:** on Windows, Graphviz 16.1.0 from `course setup`. Else none.
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL), 127
  checks (new: the class diagram), with Typst ignoring the system fonts. A
  PlantUML jar under a path with `_x_`, `b~1` and `$y$` in it works.
  `install.sh --local` tested again in a scratch home (stubs for apt, sudo,
  pipx), also with `UV_NO_MODIFY_PATH`.
- **macOS:** untested; nothing in this release is meant to change macOS
  (the escaped PlantUML command and the class diagram are the parts to watch).
- **Windows:** verified on Windows 11 Enterprise (x64), 2026-10-28, natively
  (not WSL), in a sandbox folder: `install.ps1 -Local` and the `irm | iex`
  form, `scripts/check.py` (127 checks), and `course preview` of the
  template, checked out with CRLF line endings, with and without `--pdf`
  (one- and two-page edits, twice; stopping it frees the port). A changed
  page shows up after about 12 s (50 s with `--pdf`), against 5 s (13 s) in
  WSL on the same laptop.

## 2.0.0 (2026-10-28)

A contained installation: course-tools brings its own tools.

- `course setup` downloads the pinned Quarto (1.10.18), PlantUML (1.2026.8)
  and Chrome Headless Shell (156.0.8078.73) into a per-user folder
  (`~/.local/share/course-tools`, `~/Library/Application Support/course-tools`),
  checks each download against its SHA-256 and removes versions that are no
  longer pinned. `course build` and `course preview` use only these copies;
  a missing or outdated tool stops them with "run `course setup`".
  `QUARTO_PATH` and `PLANTUML_JAR` still override them.
- The versions are pinned in one place, `src/course_tools/tools.py`, instead
  of three. `course setup --quarto VERSION` (or `--plantuml`) sets up another
  version, without a SHA-256 check and with a warning on every build.
- Java comes from the jdk4py package (Java 21), a dependency of course-tools.
- The Lato font comes with course-tools (Typst `font-paths`); it no longer
  has to be installed.
- `install.sh` installs [uv](https://docs.astral.sh/uv/) (unless present),
  which installs Python 3.12 and course-tools (`uv tool install`), then runs
  `course setup`. It works as a one-liner,
  `curl -LsSf https://raw.githubusercontent.com/SaxionACS/course-tools/v2/install.sh | bash`;
  `--local` still installs a clone, editable. From apt and Homebrew it only
  installs Graphviz, git and git-lfs. It replaces course-tools 1.x (pipx)
  and offers to remove what the 1.x installer put in `/usr/local` and
  `/Applications`, Quarto's package and Quarto's Chrome Headless Shell.
- `course doctor` shows the tools folder and the versions.
- The publish workflow and the check workflow install course-tools with uv
  and run `course setup`, with the tools folder cached per course-tools
  version. The `quarto-version` and `plantuml-version` inputs are empty by
  default (the pinned versions); a value sets up that version instead.

Why a new major version: course repositories have to change `@v1` to `@v2`,
and local installations have to be redone.

Upgrading a course: in `.github/workflows/publish.yml`, change
`publish-course.yml@v1` to `@v2` (and `tools-ref`, if the workflow sets it).
Upgrading a local installation: run the one-liner above (or `./install.sh`
from a clone).

Platform notes:

- **Dependencies:** new: uv (replaces pipx), jdk4py (replaces the system
  Java), truststore. Gone: system Quarto, PlantUML wrapper, Java, fonts-lato /
  font-lato, Chrome Headless Shell installed by Quarto. Graphviz stays
  (apt, Homebrew).
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL), 126
  checks, with new ones for the SHA-256 of every pinned download on every
  platform, `course setup` keeping tools that are present, and Lato in the
  PDFs; run with Typst ignoring the system fonts and without Quarto's own
  Chrome Headless Shell. Tested by hand: `course setup` when a tool is
  missing, outdated or another version, a download with a wrong SHA-256,
  `course preview --pdf` with an edit, and `install.sh --local` in a scratch
  home with apt, sudo and pipx stubbed (not on a clean machine). The new
  Check workflow runs on the push of this branch.
- **macOS:** untested. To do on a Mac: `./install.sh --local` (Homebrew
  packages, uv, the removal of the 1.x tools, `course setup` with the
  `macos.tar.gz` Quarto and the `mac-arm64` Chrome), then `scripts/check.py`.

## 1.18.0 (2026-10-26)

Frame widgets: zoom, bit values, escapes.

- A short timing diagram is zoomed in to fill the width of the widget (up
  to 3×) instead of filling a third of it; a long one starts at the normal
  zoom, as before. The zoom follows the width of the page until the student
  uses the zoom buttons.
- `bit_values: true` (default off) shows a 0 or 1 under the label of every
  bit: start, data, parity and stop bits (UART), MOSI and MISO (SPI), and
  the address, R/W, data and ACK bits (I²C), in the browser and in the PDF.
  The `bit_values` control lets students show or hide them.
- Text data understands C escapes, in the YAML and in the text box:
  `\0 \a \b \t \n \v \f \r \e \\ \" \' \?`, octal `\101`, `\x41`, `\u0041`.
  The box shows the data with escapes, frames are named by them (`'\n' 0x0A`),
  and in a decode challenge, `\n` or `'\n'` is accepted as an answer.

Platform notes:

- **Dependencies:** none.
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL), 123
  checks, with new ones for escapes and bit values (and 1438 widget logic
  checks: escapes of every byte, bit values for UART, SPI and I²C, zoom to
  fit). The zoom, the bit values and the text box were tested in a browser
  on a real course page (12 checks), not part of CI.
- **macOS:** untested. Nothing platform-specific changed.

## 1.17.2 (2026-10-25)

- Fix: a UART frame widget put one idle bit time between frames, which looked
  like a second stop bit. Now the frames follow each other without a pause,
  as when a UART always has the next byte ready. This also applies to packets
  sent with `send: uart`. The new setting `gap` (0 to 20 bit times, default
  0) lets the line idle between frames, marked "idle".

Platform notes:

- **Dependencies:** none.
- **Ubuntu / CI:** `scripts/check.py` passes in the Check workflow (Ubuntu
  24.04), 121 checks.
- **macOS:** verified on macOS 26.6.2 (Apple M1), 2026-10-25.
  `scripts/check.py` passes, 121 checks with the PDFs; the UART frames in
  the PDF of the test course were checked by eye.

## 1.17.1 (2026-10-22)

- Fix: `course preview` showed "Quarto Render Error" (without a message) on
  a page after the second edit that changed several pages at once, such as a
  key term (the lesson and the glossary), until the preview was restarted.
  This is a bug in Quarto's preview: it fails when it re-renders several
  pages at once, from the second time on (Quarto 1.10.18, 1.10.19 and the
  1.11.6 pre-release; also in a plain two-page Quarto website). Now the
  preview writes changed pages one at a time and waits until Quarto has
  rendered each one (at most 60 s) before it writes the next. A key-term edit
  takes a few seconds longer.

Platform notes:

- **Dependencies:** none.
- **Ubuntu / CI:** `scripts/check.py` passes on Ubuntu 24.04 (WSL), 121
  checks. The fix was tested by hand with `course preview` on a real course:
  four key-term edits in a row (each time the lesson and the glossary
  updated, about 5 s; with `--pdf` about 12 s, PDFs included), where the
  second edit failed before. The check script does not run the preview.
- **macOS:** verified on macOS 26.6.2 (Apple M1), 2026-10-24.
  `scripts/check.py` passes, 121 checks with the PDFs (about 35 s), with
  Python 3.15 and Graphviz 16.1 from Homebrew. `course preview` was tested
  with a script on a copy of the test course: four key-term edits in a row
  (the cheat sheet and the glossary) updated both pages within 3 s each; with
  `--pdf`, the HTML and the PDFs within 5 s. Ctrl+C stops the preview.

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
- **macOS:** verified on macOS 26.6.2 (Apple M1), 2026-10-24, with 1.17.1:
  `course preview --pdf` serves the PDFs and updates them after every edit.

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
- **macOS:** verified on macOS 26.6.2 (Apple M1), 2026-10-24, with 1.17.1:
  `scripts/check.py` passes. The YAML editor in the browser was not tried.

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
- **macOS:** verified on macOS 26.6.2 (Apple M1), 2026-10-24, with 1.17.1:
  `scripts/check.py` passes, the widget logic tests included
  (`quarto run tests/widgets.js`).

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
- **macOS:** verified on macOS 26.6.2 (Apple M1), 2026-10-24, with 1.17.1:
  `scripts/check.py` passes.

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
- **macOS:** verified on macOS 26.6.2 (Apple M1), 2026-10-24, with 1.17.1:
  `scripts/check.py` passes.

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
- **macOS:** verified on macOS 26.6.2 (Apple M1), 2026-10-24, with 1.17.1:
  `scripts/check.py` passes.

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
- **macOS:** verified on macOS 26.6.2 (Apple M1), 2026-10-24, with 1.17.1:
  `scripts/check.py` passes, the PDF text checks included (`pdftotext` from
  Homebrew's poppler), and the private-file checks work with the temporary
  directory under `/private/var`. `install.sh` has not changed since 1.11.0.

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
