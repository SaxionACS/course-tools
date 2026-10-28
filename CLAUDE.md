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
| `src/course_tools/assets/filters/course.lua` | Lua filter: PDF button, learning outcomes and reading time, slides/GenAI/logbook/starter boxes, links, code annotations, diagram alignment, footer, PDF header |
| `src/course_tools/assets/theme/` | `head.html` (browser script), `practice.html` (self-checks, predictions, comparisons), `terms.html` (definitions on first use, review deck; reads the glossary page) and `saxion.scss` (theme) |
| `src/course_tools/assets/typst/header.typ` | PDF styling |
| `src/course_tools/assets/fonts/` | Lato (OFL), the body font of the PDFs: staged into `_course/fonts`, found by Typst through `font-paths` |
| `src/course_tools/assets/texts/genai/` | texts of the GenAI policy page |
| `src/course_tools/assets/_extensions/pandoc-ext/diagram` | vendored PlantUML filter (don't edit) |
| `.github/workflows/publish-course.yml` | reusable workflow that course repositories call as `@v2` |
| `.github/workflows/check.yml` | CI for this repository: runs `scripts/check.py` |
| `tests/course/` | test course that uses every feature |
| `scripts/check.py` | builds the test course and checks the output |
| `tests/widgets.js` | tests of the widgets' logic and PDF answers (`quarto run tests/widgets.js`, also run by `check.py`) |
| `docs/authoring.md`, `docs/course-info.md` | documentation for course authors |
| `install.sh`, `requirements.md` | local installation (Ubuntu and macOS): system packages, uv, `uv tool install`, `course setup` |

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
- `course preview` writes changed pages one at a time (`stage.sync(settle=...)`,
  `cli._rendered`): Quarto's preview fails silently when it re-renders several
  pages at once, from the second time on. Keep it that way unless a Quarto
  release fixes this (test: change two pages at once, twice, in a preview).
- The Quarto, PlantUML and Chrome Headless Shell versions are pinned in one
  place, `tools.py`, with the SHA-256 of the download for every platform
  (`check.py` checks that none is missing). The build uses only the copies
  from `course setup` (or `QUARTO_PATH`, `PLANTUML_JAR`), never a Quarto on
  `PATH`. Don't add system-wide tools; Graphviz (apt, Homebrew) is the only
  one.

## Platforms

- **Ubuntu 24.04** (also in WSL) is the main platform. CI runs on Ubuntu
  24.04 too.
- **macOS** with Homebrew is best effort: there is no macOS CI, and an
  occasional broken local build on macOS is acceptable. A Claude agent on the
  maintainer's Mac brings macOS up to date when asked (see "Syncing macOS").
- Keep things working on both:
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
  - Lato comes with course-tools, so the PDFs look the same everywhere;
    other fonts Typst finds on its own (check with `quarto typst fonts`).

## Checking a change

1. Use this checkout: `./install.sh --local` installs it in editable mode
   (once) and runs `course setup`. After a change of the pins in `tools.py`,
   run `course setup` again.
2. Run `python3 scripts/check.py`. It builds the test course with PDFs (one to
   three minutes) and must end with `0 failed`. `--html-only` is faster;
   `--keep` keeps the build so you can look at it. For widget changes,
   `quarto run tests/widgets.js` checks the logic in seconds.
3. For changes that affect how pages look, also look at the pages: run
   `course preview` in a copy of `tests/course`, or build a real course.

## Branches, CI and merging

- Never work directly on `main`. Use a branch: `feature/<topic>`,
  `fix/<topic>` or `macos/<topic>`.
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
