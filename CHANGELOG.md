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
