# course-tools: notes for Claude

course-tools turns Saxion ACS course repositories (Markdown + YAML) into a
static website on GitHub Pages, which Brightspace embeds page by page, and a
PDF of every page. [README.md](README.md) explains the pipeline for people;
this file says how to change it safely. Read [CHANGELOG.md](CHANGELOG.md) for
what changed recently.

## Map

| Path | What |
|:--|:--|
| `src/course_tools/cli.py` | the `course` command: `build`, `preview`, `stage` (`--preview`: as `course preview` stages), `clean`, `doctor` |
| `src/course_tools/course.py` | scans a course repository: weeks, pages, slides, logbooks; skips `private`, and draft pages (`draft: true`) except in `course preview` |
| `src/course_tools/stage.py` | writes the Quarto project in `.build/`: pages as `.qmd`, generated pages, zips, sidebar, `_quarto.yml`; rewrites only changed files |
| `src/course_tools/markdown.py` | GitHub Markdown → Quarto: code fences, titles, `---` rules |
| `src/course_tools/info.py`, `models.py`, `genai.py` | pages generated from `info/general.yaml`, `assessment.yaml`, `genAI.yaml` |
| `src/course_tools/templates.py` | templates: built-in Markdown texts a course replaces with its own `templates/<group>/<name>.md`; `course template list` / `copy` |
| `src/course_tools/history.py` | page footer dates, from one `git log` |
| `src/course_tools/tools.py` | the pinned Quarto, PlantUML and Chrome Headless Shell (versions and SHA-256), `course setup` (downloads them into a per-user folder) and the lookups the build uses; Java from jdk4py |
| `src/course_tools/compiler_explorer.py` | course and page settings for Compiler Explorer links (validated, passed to the filter) |
| `src/course_tools/terms.py` | key terms: reads `{.terms}` blocks from the Markdown, generates the glossary and review pages |
| `src/course_tools/outcomes.py` | learning outcomes named in the front matter of pages (`outcomes:`), and the outcome map page |
| `src/course_tools/widgets.py` | widgets: finds ```` ```widget ```` blocks, reads their YAML, runs `print.js` (cached) and writes `_course/widgets.json` |
| `src/course_tools/assets/widgets/widgets.js` | the widgets: runs in the browser (`render`) and at build time (`print`, `exercise`); see below |
| `src/course_tools/assets/widgets/print.js` | build-time entry point, run with `quarto run` (Quarto's Deno) |
| `src/course_tools/assets/filters/practice.lua` | Lua filter: self-checks, predictions, comparisons; the "Answers" section of PDFs |
| `src/course_tools/assets/filters/compiler-explorer.lua` | Lua filter: Compiler Explorer links on code blocks with `ce` |
| `src/course_tools/assets/filters/terms.lua` | Lua filter: the key-terms box, with the ids the glossary links to |
| `src/course_tools/assets/filters/widgets.lua` | Lua filter: widgets as `<div class="course-widget" data-config>` (HTML) or pictures and exercises (PDF) |
| `src/course_tools/statemachine.py` | state machines: finds ```` ```statemachine ```` blocks, reads their YAML (only `true`/`false` are booleans, as in the browser), runs their `print.js` with the widgets' helpers and writes `_course/statemachines.json` |
| `src/course_tools/assets/statemachine/statemachine.js` | the state machines: reading the YAML, running them, layout and drawing; in the browser and at build time (`print`) |
| `src/course_tools/assets/statemachine/print.js` | build-time entry point, run with `quarto run` |
| `src/course_tools/assets/statemachine/dagre.min.js` | dagre 3.1.1 (MIT, vendored from npm unchanged, licence next to it): the layout of the diagrams |
| `src/course_tools/assets/filters/statemachine.lua` | Lua filter: state machines as `<div class="course-statemachine" data-config>` (HTML) or pictures and transition tables (PDF) |
| `src/course_tools/assets/filters/course.lua` | Lua filter: PDF button, learning outcomes and reading time, slides/GenAI/logbook/starter boxes, links, code annotations, diagram alignment, footer, PDF header |
| `src/course_tools/assets/theme/` | `head.html` (browser script), `practice.html` (self-checks, predictions, comparisons), `terms.html` (definitions on first use, review deck; reads the glossary page) and `saxion.scss` (theme) |
| `src/course_tools/assets/typst/header.typ` | PDF styling |
| `src/course_tools/assets/fonts/` | Lato (OFL), the body font of the PDFs: staged into `_course/fonts`, found by Typst through `font-paths` |
| `src/course_tools/assets/templates/genAI/` | templates: the GenAI policy page per level, and the GenAI box of an assignment per use |
| `src/course_tools/assets/_extensions/pandoc-ext/diagram` | vendored PlantUML filter (don't edit) |
| `.github/workflows/publish-course.yml` | reusable workflow that course repositories call as `@v2` |
| `.github/workflows/check.yml` | CI for this repository: runs `scripts/check.py` |
| `tests/course/` | test course that uses every feature |
| `scripts/check.py` | builds the test course and checks the output |
| `tests/widgets.js` | tests of the widgets' logic and PDF answers (`quarto run tests/widgets.js`, also run by `check.py`) |
| `tests/statemachine.js` | tests of the state machines: running, mistakes, layouts that must not overlap, the PDF form (`quarto run tests/statemachine.js`, also run by `check.py`) |
| `tests/statemachine_browser.js` | the test course's state machines in Chrome Headless Shell, driven over the DevTools protocol (run by `check.py` after the build) |
| `docs/authoring.md`, `docs/course-info.md` | documentation for course authors (state machines: `docs/statemachines.md`) |
| `install.sh`, `install.ps1`, `requirements.md` | local installation: Ubuntu and macOS (`install.sh`: system packages, uv, `uv tool install`, `course setup`), Windows (`install.ps1`: the same without system packages) |

## Rules

- Course repositories contain no build logic; every change happens here.
- Course code is shown, never run (`engine: markdown`). Don't add anything
  that executes course code at build time.
- Nothing in a `private` directory of a course is ever published: not as a
  page, not in a zip, not in the search index. Check paths *relative to the
  course root*: on macOS, temporary directories are under `/private/var`.
- Every feature works on the website and in the PDF (Typst). Interactive
  things get a static form in the PDF.
- Course authors write plain Markdown that also reads well on GitHub. Prefer
  Pandoc fenced divs and attributes over new syntax.
- English only. Match the style of the code around your change; write docs in
  plain, direct English.
- When you add or change a feature:
  - update `docs/authoring.md` or `docs/course-info.md`;
  - use the feature in `tests/course/` and check it in `scripts/check.py`;
  - describe it in `CHANGELOG.md` under the next version, with platform notes.
- Widgets: `widgets.js` is one script for the browser and for the build
  (Deno, no DOM). Only `render` and the `Kit` may touch the DOM; checks,
  goals and answers are plain functions that both use, so that a printed
  answer is checked like a student's answer. PDF pictures are SVG text
  (`svgText`, `drawRows`, `picture`); Typst draws them.
- State machines are not widgets (the maintainer wants them apart): their
  own block, script, filter, data file and styles (`sm-`). They share only
  plumbing in `widgets.py` (finding blocks, keys, the cache, running a
  `print.js`). As with widgets, `statemachine.js` is one script for the
  browser and the build; only `mount` and its helpers touch the DOM. Text is
  measured with a table of Lato's widths (not the browser's fonts), so the
  layout is the same in the browser, the PDF and the tests; `tests/statemachine.js`
  checks that nothing overlaps. Change the semantics only together with
  `docs/statemachines.md` ("How the machines behave").
- `course preview` writes changed pages one at a time (`stage.sync(settle=...)`,
  `cli._rendered`): Quarto's preview fails silently when it re-renders several
  pages at once, from the second time on. Keep it that way unless a Quarto
  release fixes this (test: change two pages at once, twice, in a preview).
- The Quarto, PlantUML and Chrome Headless Shell versions are pinned in one
  place, `tools.py`, with the SHA-256 of the download for every platform
  (`check.py` checks that none is missing). The build uses only the copies
  from `course setup` (or `QUARTO_PATH`, `PLANTUML_JAR`), never a Quarto on
  `PATH`. Don't add system-wide tools; Graphviz (apt, Homebrew; on Windows
  from `course setup`) is the only one.

## Platforms

- **Ubuntu 24.04** (also in WSL) is the main platform. CI runs on Ubuntu
  24.04 too.
- **macOS** with Homebrew is best effort: there is no macOS CI, and an
  occasional broken local build on macOS is acceptable. A Claude agent on the
  maintainer's Mac brings macOS up to date when asked (see "Syncing macOS").
- **Windows 10/11** (x64), natively, is best effort too, with no CI. WSL
  (Ubuntu) is the recommended way on Windows: it is 2-4 times faster. The
  maintainer's Windows laptop runs WSL; from WSL, a Claude agent brings native
  Windows up to date when asked (see "Syncing Windows"). It tests native
  Windows with `powershell.exe`, in a folder in `%TEMP%` with uv's
  folders, `COURSE_TOOLS_HOME`, `DENO_DIR` and `TEMP` pointed into it and
  `UV_NO_MODIFY_PATH=1` (else `uv tool update-shell` changes the user's PATH).
- Keep things working on all three:
  - `install.sh` and other shell scripts run in macOS's bash 3.2: no
    associative arrays, `mapfile` or `${var,,}`. BSD tools differ from GNU:
    no `sed -i` without a suffix, no `readlink -f`, different `date` options.
  - macOS file systems are case-insensitive: renaming `Lecture1.md` to
    `lecture1.md` must work (see `stage.sync`).
  - On macOS, `python3` on `PATH` can be Apple's: run Python helpers with
    `sys.executable`. Java is jdk4py's (`tools.java()`), never `java` from
    `PATH` (on macOS that can be a stub that only says Java is missing).
  - Homebrew's Graphviz is newer than Ubuntu's 2.43, so PlantUML layouts can
    differ a little. That is fine.
  - Windows: paths use `\`. Print course paths with `/` (`as_posix()`, and
    `source_name()` in the filters). A path in `_quarto.yml` is read as
    Markdown, so the stager escapes it (`stage._literal`). `install.ps1` runs
    in Windows PowerShell 5.1: ASCII only, no `&&`, and no
    `$ErrorActionPreference = 'Stop'` (5.1 then stops on stderr output of
    programs); check `$LASTEXITCODE` instead. Stopping Quarto means stopping
    its process tree (`quarto.exe` starts `deno.exe`).
  - Lato comes with course-tools, so the PDFs look the same everywhere;
    other fonts Typst finds on its own (check with `quarto typst fonts`).

## Checking a change

1. Use this checkout: `./install.sh --local` installs it in editable mode
   (once) and runs `course setup`. After a change of the pins in `tools.py`,
   run `course setup` again.
2. Run `python3 scripts/check.py`. It builds the test course with PDFs (one to
   three minutes) and must end with `0 failed`. `--html-only` is faster;
   `--keep` keeps the build so you can look at it. For widget changes,
   `quarto run tests/widgets.js` checks the logic in seconds, and
   `quarto run tests/statemachine.js` the state machines.
3. For changes that affect how pages look, also look at the pages: run
   `course preview` in a copy of `tests/course`, or build a real course.

## Branches, CI and merging

- Never work directly on `main`. Use a branch: `feature/<topic>`,
  `fix/<topic>`, `macos/<topic>` or `windows/<topic>`.
- Push the branch. The Check workflow runs `scripts/check.py` on Ubuntu for
  every push. It builds, but publishes nothing.
- Merge the branch into `main` only when the Check workflow has passed on the
  branch's last commit (`gh run list --branch <branch>`, or the Actions tab on
  GitHub). Then delete the branch.
- Don't create or move tags, unless the maintainer asks for a release.

## Releasing (when the maintainer asks)

1. Set the version in `pyproject.toml` and `__version__` in
   `src/course_tools/__init__.py` (for example `1.12.0`).
2. Finish the `CHANGELOG.md` entry for that version, with platform notes.
   `scripts/check.py` fails without it.
3. After the merge into `main`, tag and move `v2`:
   `git tag v2.1.0 && git tag -f v2 && git push origin v2.1.0 && git push -f origin v2`.
   `v1` (1.18.0) is frozen: don't move it.

Compatible fixes raise the last number, compatible features the middle one.
An incompatible change needs `v3` (see README).

## Syncing macOS

When asked to bring course-tools up to date on a Mac (for example "sync
course-tools to v2.1.0 on this Mac"):

1. `git fetch --tags` and check out `main`.
2. Note the installed version (`course --version`) and read the platform notes
   of every `CHANGELOG.md` entry after it.
3. Run `./install.sh --local` (installs new dependencies, editable install,
   `course setup`).
4. Run `python3 scripts/check.py`. For the PDF text checks, install
   `pdftotext` and `pdffonts` with `brew install poppler`.
5. If something fails because of macOS, fix it on a branch
   `macos/v<version>`. Don't change how things work on Ubuntu. Update the
   macOS line of the platform notes: `verified on macOS <version> (<chip>),
   <date>`, or what is still broken.
6. Push the branch and merge it into `main` when the Check workflow has passed.
   If nothing needed fixing, only update the platform notes, on the same kind
   of branch.

## Syncing Windows

course-tools is developed in WSL. A second clone on the Windows drive
(`C:\...`, `/mnt/c/...` in WSL) is only for bringing native Windows up to date,
by a Claude agent in WSL opened in that clone, when asked (for example "sync
course-tools to v2.3.0 on Windows"). Don't develop anything else there.

1. `git fetch --tags` and check out `main` (`git pull`: this clone is often
   behind).
2. Read the Windows line of the platform notes of every `CHANGELOG.md` entry
   after the last one verified on Windows.
3. Make a sandbox folder in `%TEMP%`. Point `UV_TOOL_DIR`, `UV_TOOL_BIN_DIR`,
   `UV_PYTHON_INSTALL_DIR`, `UV_CACHE_DIR`, `COURSE_TOOLS_HOME`, `DENO_DIR`,
   `TEMP` and `TMP` into it, set `UV_PYTHON_PREFERENCE=only-managed` and
   `UV_NO_MODIFY_PATH=1`, and put its `UV_TOOL_BIN_DIR` first on `PATH`. The
   maintainer's own Windows installation and `PATH` stay as they are.
4. In that environment, run `install.ps1 -Local` from the clone, then
   `scripts\check.py` with the installed tool's Python
   (`<UV_TOOL_DIR>\saxion-course-tools\Scripts\python.exe`). Run the
   PowerShell scripts with `powershell.exe -NoProfile -ExecutionPolicy Bypass
   -File <script>`, write their output to a file and read it from WSL
   (`tr -d '\r'`). It takes 2-4 times as long as in WSL.
5. If something fails because of Windows, fix it in this clone on a branch
   `windows/v<version>`. Don't change how things work on Ubuntu or macOS.
   Update the Windows line of the platform notes: `verified on Windows
   <edition> (x64), <date>, natively, in a sandbox folder`, or what is still
   broken.
6. Push the branch and merge it into `main` when the Check workflow has passed.
   If nothing needed fixing, only update the platform notes, on the same kind
   of branch.
