#!/usr/bin/env python3
"""Build the test course (tests/course) and check the result.

    python3 scripts/check.py               # website and PDFs (a few minutes)
    python3 scripts/check.py --html-only   # website only, faster
    python3 scripts/check.py --keep        # keep the build to inspect it

The test course is copied to a temporary directory and committed there with a
fixed author and date, so that the page footers are predictable. Then `course
doctor`, `course build` and `course stage` run, and the output in dist/ is
checked: pages, PDFs, links, private files, zips, footers and the build log.
The state machines of the test course are also run in Chrome Headless Shell
(from `course setup`).

The `course` command under test is the one on PATH; after
`./install.sh --local` that is this checkout. To test this checkout without
installing it:

    PYTHONPATH=src python3 scripts/check.py --course "python3 -m course_tools"

The tools must be set up (`course setup`). Only the Python standard library
is used. If `pdftotext` and `pdffonts` (poppler) are installed, the text and
the fonts of the PDFs are checked too.

When you add a feature to course-tools, use it in tests/course and check it
here.
"""

from __future__ import annotations

import argparse
import base64
import html as htmllib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "src"))
from course_tools import tools  # noqa: E402  (standard library only, like this script)

COURSE = REPO / "tests" / "course"
SITE_URL = "https://example.org/check/"
SECRET = "SECRET-PRIVATE-TOKEN"     # in every private file of the test course
AUTHOR = "Check Author"
DATE = "2026-01-05T10:00:00+01:00"
FOOTER = ("Added on 5 January 2026.", "Last changed on 5 January 2026 at 10:00 by Check Author.")

# Build messages caused on purpose by the test course: they must appear.
REQUIRED_MESSAGES = (
    "warning: ignoring lessons/week1: week directories are named week_01, week_02, ...",
    'warning: lessons/week_02/lesson1.md: ce="asm exe": exe (output only) cannot be combined '
    "with asm or run; using run",
    "warning: lessons/week_02/lesson1.md: key term `superloop` is already defined in "
    "lessons/week_01/lesson1.md; the glossary uses that definition",
    "warning: exams/exam1.md: outcomes: LO9 is not a learning outcome in general.yaml",
    "warning: general.yaml: learning outcome LO3 is not covered by any page "
    "(`outcomes` in the front matter of a page)",
)
# Widgets with mistakes (lessons/week_02/lesson3.md): each line must start with one of these.
WIDGET_MESSAGES = (
    'warning: lessons/week_02/lesson3.md: widget 18 (dial): unknown type "dial" '
    "(number, arithmetic, shift, register, frame, packet)",
    'warning: lessons/week_02/lesson3.md: widget 19 (register): field MODE: bits "6,5" should look like 7 or 6..5',
    'warning: lessons/week_02/lesson3.md: widget 20 (number): unknown setting "widht"',
    "warning: lessons/week_02/lesson3.md: widget 20 (number): goal: unsigned: 300 does not fit in 8 bits",
    "warning: lessons/week_02/lesson3.md: widget 21: the YAML cannot be read: ",
)
# State machines with mistakes (lessons/week_02/lesson4.md): each line must start with one of these.
STATEMACHINE_MESSAGES = (
    "warning: lessons/week_02/lesson4.md: state machine 4: state A, on presed: presed is not an input, a timer "
    "or an event that a machine sends.",
    "warning: lessons/week_02/lesson4.md: state machine 5: input unused is not used in any state",
    "warning: lessons/week_02/lesson4.md: state machine 5: output LED is never switched",
    "warning: lessons/week_02/lesson4.md: state machine 6: the YAML cannot be read: ",
)
# Other lines that look like a warning or an error fail the check, except these.
ALLOWED_MESSAGES = REQUIRED_MESSAGES + WIDGET_MESSAGES + STATEMACHINE_MESSAGES + (
    # Quarto, for tabsets in Typst (shown one after the other in the PDF).
    "Warning: couldn't recognize format, using default tabset rendering",
)
PROBLEM = re.compile(r"warn|error|fail|exception|traceback", re.IGNORECASE)
ANSI = re.compile(r"\x1b\[[0-9;]*m")

PAGES = [
    "index.html",
    "info/index.html", "info/assessment.html", "info/genai.html", "info/rules.html", "info/outcomes.html",
    "lessons/week_01/index.html", "lessons/week_01/lesson1.html",
    "lessons/week_01/lesson2.html", "lessons/week_01/lesson10.html",
    "lessons/week_02/index.html", "lessons/week_02/lesson1.html", "lessons/week_02/lesson2.html",
    "lessons/week_02/lesson3.html", "lessons/week_02/lesson4.html",
    "assignments/week_01/index.html", "assignments/week_01/assignment1.html",
    "assignments/week_01/assignment2/index.html",
    "exams/index.html", "exams/exam1.html",
    "references/index.html", "references/cheatsheet.html",
    "glossary/index.html",
]
FILES = [
    "assignments/week_01/logbook1.html", "assignments/week_01/logbook1.md",
    "assignments/week_01/assignment2/week_01-assignment2.zip",
    "slides/week_01/lesson1.pdf", "references/datasheet.pdf",
    "lessons/week_01/images/figure.svg", "search.json",
    "glossary/review.html",
]


class Checks:
    def __init__(self) -> None:
        self.passed = 0
        self.failed: list[str] = []
        self.skipped: list[str] = []

    def section(self, name: str) -> None:
        print(f"\n{name}")

    def ok(self, condition, what: str, detail: str = "") -> bool:
        if condition:
            self.passed += 1
            print(f"  ok    {what}")
        else:
            self.failed.append(what)
            print(f"  FAIL  {what}" + (f"\n        {detail}" if detail else ""))
        return bool(condition)

    def skip(self, what: str, why: str) -> None:
        self.skipped.append(what)
        print(f"  skip  {what} ({why})")


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, encoding="utf-8", errors="replace")


def main_content(html: str) -> str:
    """The <main> element of a page (without the sidebar and the footer)."""
    start, end = html.find("<main"), html.find("</main>")
    return html[start:end] if start >= 0 and end > start else ""


def commit(course: Path) -> None:
    env = dict(os.environ, GIT_AUTHOR_DATE=DATE, GIT_COMMITTER_DATE=DATE)
    git = ["git", "-c", f"user.name={AUTHOR}", "-c", "user.email=check@example.org",
           "-c", "commit.gpgsign=false"]
    for args in (["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "Test course"]):
        result = run(git + args, cwd=course, env=env)
        if result.returncode != 0:
            sys.exit(f"error: git {' '.join(args)} failed:\n{result.stdout}")


def version_of_checkout() -> str | None:
    m = re.search(r'^version\s*=\s*"([^"]+)"', (REPO / "pyproject.toml").read_text(), re.M)
    return m.group(1) if m else None


def check_tools(c: Checks, course_cmd: list[str]) -> bool:
    c.section("Tools")
    version = run(course_cmd + ["--version"])
    expected = version_of_checkout()
    c.ok(version.returncode == 0 and version.stdout.strip() == expected,
         f"`course --version` is the version in pyproject.toml ({expected})",
         f"got: {version.stdout.strip()!r}. Is the `course` under test this checkout?")
    changelog = (REPO / "CHANGELOG.md").read_text(encoding="utf-8") if (REPO / "CHANGELOG.md").is_file() else ""
    c.ok(re.search(rf"^## {re.escape(expected or '?')}\b", changelog, re.M),
         f"CHANGELOG.md has an entry for {expected}")
    missing = [name for t in tools.TOOLS for plat in t.platforms
               if (name := t.download(t.pinned, plat)[1]) not in tools.SHA256]
    c.ok(not missing, "every pinned download has a SHA-256, for every platform", f"missing: {missing}")
    setup = run(course_cmd + ["setup"])
    c.ok(setup.returncode == 0 and "Downloading" not in setup.stdout,
         "`course setup` keeps the tools that are already set up", setup.stdout.strip())
    doctor = run(course_cmd + ["doctor"])
    return c.ok(doctor.returncode == 0, "`course doctor` finds all tools", doctor.stdout.strip())


def check_build(c: Checks, course_cmd: list[str], course: Path, html_only: bool) -> bool:
    c.section("Build")
    extra = ["--html-only"] if html_only else []
    build = run(course_cmd + ["build", "--source", str(course), "--output", str(course / "dist"),
                              "--site-url", SITE_URL] + extra, cwd=course)
    log = ANSI.sub("", build.stdout)
    if not c.ok(build.returncode == 0, "`course build` succeeds", "\n        ".join(log.splitlines()[-40:])):
        return False
    lines = [line.strip() for line in log.splitlines()]
    unexpected = [line for line in lines
                  if PROBLEM.search(line) and not any(e in line for e in ALLOWED_MESSAGES)]
    c.ok(not unexpected, "no unexpected warnings or errors in the build output", "\n        ".join(unexpected))
    c.ok(REQUIRED_MESSAGES[0] in lines, "a wrongly named week directory is reported")
    c.ok(REQUIRED_MESSAGES[1] in lines, "a wrong Compiler Explorer mode is reported")
    c.ok(REQUIRED_MESSAGES[2] in lines, "a key term defined twice is reported")
    c.ok(REQUIRED_MESSAGES[3] in lines, "an unknown learning outcome in the front matter is reported")
    c.ok(REQUIRED_MESSAGES[4] in lines, "a learning outcome that no page covers is reported")
    missing = [m for m in WIDGET_MESSAGES if not any(line.startswith(m) for line in lines)]
    c.ok(not missing, "widgets with mistakes are reported, with the page and the widget's number", "\n        ".join(missing))
    missing = [m for m in STATEMACHINE_MESSAGES if not any(line.startswith(m) for line in lines)]
    c.ok(not missing, "state machines with mistakes are reported, with the page and the machine's number",
         "\n        ".join(missing))

    # A second stage with the same options must not change any file.
    stage = run(course_cmd + ["stage", "--source", str(course), "--site-url", SITE_URL] + extra, cwd=course)
    c.ok(stage.returncode == 0 and "(0 files updated)" in stage.stdout,
         "staging again changes nothing", stage.stdout.strip())
    return True


def check_preview_stage(c: Checks, course_cmd: list[str], course: Path) -> None:
    """Stage as `course preview` does (after the build has been checked)."""
    c.section("Preview only: draft pages, editable widgets (course stage --preview)")
    stage = run(course_cmd + ["stage", "--source", str(course), "--preview"], cwd=course)
    build = course / ".build"
    gallery = build / "references" / "gallery.qmd"
    text = gallery.read_text(encoding="utf-8") if gallery.is_file() else ""
    c.ok(stage.returncode == 0 and "DRAFT-ONLY-TEXT" in text and "## Draft" in text and "\ndraft:" not in text
         and "references/gallery.qmd" in (build / "_quarto.yml").read_text(encoding="utf-8"),
         "a draft page is staged for the preview, in the sidebar, with a note", stage.stdout.strip())
    data = json.loads((build / "_course" / "widgets.json").read_text(encoding="utf-8"))
    yaml = [e["yaml"] for e in data["widgets"].values() if "yaml" in e]
    c.ok(len(yaml) == 2 and any(y.startswith("type: number\ntitle: WIDGET-TITLE\neditable: true") for y in yaml),
         "editable widgets have their YAML in the preview", f"found {len(yaml)}")
    data = json.loads((build / "_course" / "statemachines.json").read_text(encoding="utf-8"))
    yaml = [e["yaml"] for e in data["machines"].values() if "yaml" in e]
    c.ok(len(yaml) == 1 and yaml[0].startswith("title: SM-TITLE\ntask: SM-TASK\neditable: true"),
         "editable state machines have their YAML in the preview", f"found {len(yaml)}")


def compiler_explorer_links(html: str) -> list[tuple[str, dict]]:
    """(mode, first session of the client state) of every Compiler Explorer link."""
    links = []
    for mode, state in re.findall(r'<div class="course-ce" data-ce-mode="(\w+)">'
                                  r'<a href="https://godbolt.org/clientstate/([^"]+)"', html):
        data = json.loads(base64.urlsafe_b64decode(state + "=" * (-len(state) % 4)))
        links.append((mode, data["sessions"][0]))
    return links


def check_practice(c: Checks, read) -> None:
    c.section("Self-checks, predictions and comparisons (lessons/week_02/lesson1)")
    p = main_content(read("lessons/week_02/lesson1.html"))
    kinds = re.findall(r'class="course-check" data-kind="(\w+)"', p)
    c.ok(kinds == ["choice"] * 3 + ["fill"] * 3, "three multiple-choice and three fill-in checks", f"found: {kinds}")
    inputs = re.findall(r'<input type="(radio|checkbox)" name="check-(\d+)"', p)
    c.ok(inputs == [("radio", "1")] * 3 + [("checkbox", "2")] * 2 + [("checkbox", "3")] * 3,
         "radio buttons for one right option; checkboxes for several, or with type=multiple", f"found: {inputs}")
    c.ok(p.count('class="course-feedback" hidden') == 2 and 'class="course-explanation" hidden' in p,
         "feedback per option and an explanation, hidden until checked")
    blanks = [(kind, htmllib.unescape(answer))
              for kind, answer in re.findall(r'class="course-blank[^"]*" data-type="(\w+)" data-answer="([^"]*)"', p)]
    c.ok(blanks == [("int", "42"), ("hex", "0x2A"), ("bin", "101010"), ("float", "0.1"), ("float", "100"),
                    ("text", "volatile"), ("text", "ISR"), ("text", "PORTB |= (1 << 5);")],
         "blanks with their types, guessed or set", f"found: {blanks}")
    c.ok(all(a in p for a in ('data-precision="0.001"', 'data-precision="1%"', 'data-case="sensitive"',
                              'data-spaces="ignore"', 'data-accept="interrupt service routine|interrupt handler"',
                              '<span class="course-blank-unit">ms</span>')),
         "blank options: precision, case, spaces, other accepted answers, unit")
    c.ok('class="course-predict"' in p and "<textarea" in p and 'class="course-answer" hidden' in p
         and "PREDICT-ANSWER" in p, "prediction with a hidden answer")
    c.ok('class="course-compare wrong-right"' in p and p.count('class="course-compare-column"') == 2
         and "Without volatile" in p, "comparison of two code blocks, with labels")

    c.section("Compiler Explorer links")
    links = compiler_explorer_links(p) + compiler_explorer_links(main_content(read("lessons/week_02/lesson2.html")))
    modes = [mode for mode, _ in links]
    c.ok(modes == ["run", "asm", "asm", "asm", "exe", "asm", "run", "asm"], "a link for every code block with ce",
         f"modes: {modes}")
    if len(links) != 8:
        return
    s = [session for _, session in links]

    def compiler(session):
        first = (session.get("compilers") or [{}])[0]
        return first.get("id"), first.get("options")

    arm, x86 = ("carmug1520", "-O2 -mcpu=cortex-m0plus -mthumb"), ("cg152", "-O2")
    c.ok(compiler(s[1]) == arm and compiler(s[2]) == arm, "asm: the course compiler (general.yaml)")
    first = s[0]["compilers"][0]
    c.ok(compiler(s[0]) == x86 and first.get("filters") == {"execute": True}
         and first.get("specialoutputs") == ["compilerOutput"],
         "run: the course's run compiler, assembly and the program's output")
    executor = (s[4].get("executors") or [{}])[0]
    c.ok(not s[4].get("compilers") and executor.get("compiler") == {"id": "cg152", "options": "-O2"}
         and executor.get("stdin") == "Q\nR" and executor.get("arguments") == "-v",
         "exe: only the program's output, with input and arguments")
    c.ok(compiler(s[5]) == ("cavrg1520", "-Os -mmcu=atmega328p") and "ATmega328P" in p,
         "a code block overrides compiler, options and target")
    c.ok(compiler(s[6]) == x86, "ce=\"asm exe\" becomes run")
    c.ok(compiler(s[7]) == ("rv32-cgcc1520", "-O2 -march=rv32imac -mabi=ilp32 --param=max-inline-insns-single=10"),
         "front matter overrides the course settings (and -- in flags stays intact)")
    c.ok("<1>" not in s[3]["source"] and "return x * x;" in s[3]["source"], "annotation markers are left out of the code")
    c.ok(all(session["language"] == "c" for session in s), "the language comes from the code block")
    annotated = p.find('class="code-annotation-container-grid"')
    c.ok(0 < annotated < p.find('class="course-ce"', p.find("square")), "the link comes after the annotations")


def check_terms(c: Checks, read) -> None:
    c.section("Key terms")
    g = main_content(read("glossary/index.html"))
    ids = re.findall(r'<dt><span id="(term-[\w-]+)" class="course-term"', g)
    c.ok(ids == ["term-isr", "term-linker", "term-period", "term-superloop", "term-volatile"],
         "glossary: the terms from A to Z",
         f"found: {ids}")
    c.ok("NOT-A-TERM" not in g, "a key-terms block in a code block is not read")
    c.ok("DUPLICATE-DEFINITION" not in g, "of a term defined twice, the glossary has the first definition")
    c.ok('data-aliases="interrupt service routine|interrupt handler"' in g and 'data-week="2"' in g
         and '<span id="term-linker" class="course-term">' in g,
         "aliases and weeks; no week for a term defined outside the weeks")
    c.ok('Introduced in <a href="../lessons/week_01/lesson1.html#term-isr">' in g
         and 'href="../references/cheatsheet.html#term-linker"' in g, "each term links to where it is introduced")
    c.ok('href="../lessons/week_01/lesson2.html"' in g, "links in definitions work from the glossary")
    lesson = main_content(read("lessons/week_01/lesson1.html"))
    c.ok('class="course-terms"' in lesson and '<span id="term-isr" class="course-term-name">' in lesson,
         "the key-terms box of a lesson, with the ids the glossary links to")
    review = read("glossary/review.html")
    c.ok('class="course-review"' in main_content(review) and 'class="course-pdf"' not in review,
         "the review page, without a PDF button")
    home = read("index.html")
    c.ok('href="./glossary/index.html"' in home and 'href="./glossary/review.html"' in home,
         "a Key terms section in the sidebar")
    c.ok("course-term-ref" in read("lessons/week_02/lesson1.html"), "the definitions-on-first-use script is on the pages")


def check_outcomes(c: Checks, read) -> None:
    c.section("Learning outcomes of pages, outcome map")

    def badges(page: str) -> list[tuple[str, str, str]]:
        """(link, id, shown name) of the learning-outcome badges of a page."""
        banner = re.search(r'<div class="course-outcomes">(.*?)</div>', main_content(read(page)), re.S)
        return [(href, lo_id or name, name) for href, lo_id, name in
                re.findall(r'<a class="course-outcome" href="([^"]+)"[^>]*>(?:<span class="course-outcome-id">'
                           r'([^<]*)</span>)?([^<]*)</a>', banner.group(1) if banner else "")]

    lesson = badges("lessons/week_02/lesson1.html")
    c.ok(lesson == [("../../info/outcomes.html#lo1", "LO1", "Superloops"), ("../../info/outcomes.html#lo2", "LO2", "LO2")],
         "badges show the title (or the id without one) and link to the outcome map", f"found: {lesson}")
    c.ok(badges("assignments/week_01/assignment1.html") == [("../../info/outcomes.html#lo2", "LO2", "LO2")],
         "outcome ids in the front matter are not case-sensitive")
    c.ok(badges("exams/exam1.html") == [("../info/outcomes.html#lo2", "LO2", "LO2")], "an unknown outcome is left out")
    c.ok(not badges("lessons/week_01/lesson2.html"), "no badges without outcomes")
    c.ok('data-text="LO1: Write a superloop in C."' in read("lessons/week_02/lesson1.html")
         and re.search(r'about \d+ min read', read("lessons/week_02/lesson1.html")),
         "the whole outcome on hover, and the reading time")
    m = main_content(read("info/outcomes.html"))
    rows = [re.sub(r"<[^>]+>|\s+", " ", r).split() for r in re.findall(r"<tr[^>]*>(.*?)</tr>", m, re.S)]
    c.ok(rows[1:] == [["LO1", "Superloops", "●", "●", "Written", "exam"],
                      ["LO2", "●", "●", "●", "Written", "exam,", "Practical"],
                      ["LO3", "Debugging", "Written", "exam"]],
         "outcome map: the weeks (and other pages) that cover each outcome, and where it is assessed", f"rows: {rows}")
    c.ok('id="lo2"' in m and 'href="../assignments/week_01/assignment1.html"' in m
         and 'href="../exams/exam1.html"' in m and "No pages work towards this outcome yet." in m,
         "outcome map: the pages of each outcome")
    info = main_content(read("info/index.html"))
    c.ok("<strong>LO1: Superloops</strong>" in info and "<strong>LO2</strong>" in info
         and 'href="../info/outcomes.html"' in info, "course information: outcome titles and a link to the map")
    c.ok("<strong>Debugging</strong> – Find bugs" in main_content(read("info/assessment.html")),
         "assessment page: outcome titles")
    c.ok('href="./info/outcomes.html"' in read("index.html"), "the outcome map in the sidebar")


def check_widget_logic(c: Checks) -> None:
    c.section("Widget logic (quarto run tests/widgets.js)")
    try:
        out, lines = run([tools.quarto(), "run", str(REPO / "tests" / "widgets.js")]), []
        lines = ANSI.sub("", out.stdout).strip().splitlines()
    except tools.ToolError as e:
        out, lines = None, [str(e)]
    c.ok(out is not None and out.returncode == 0 and lines and lines[-1].endswith(" ok, 0 failed"),
         "PDF answers checked like a student's answer, for every kind of challenge; encoders and shifts"
         + (f" ({lines[-1]})" if lines else ""), "\n        ".join(lines[-15:]))


def check_statemachine_logic(c: Checks) -> None:
    c.section("State machine logic and layout (quarto run tests/statemachine.js)")
    try:
        out, lines = run([tools.quarto(), "run", str(REPO / "tests" / "statemachine.js")]), []
        lines = ANSI.sub("", out.stdout).strip().splitlines()
    except tools.ToolError as e:
        out, lines = None, [str(e)]
    c.ok(out is not None and out.returncode == 0 and lines and lines[-1].endswith(" ok, 0 failed"),
         "machines run as the examples say, mistakes are reported, layouts do not overlap"
         + (f" ({lines[-1]})" if lines else ""), "\n        ".join(lines[-15:]))


def check_statemachines(c: Checks, read, dist: Path) -> None:
    c.section("State machines (lessons/week_02/lesson4)")
    html = read("lessons/week_02/lesson4.html")
    p = main_content(html)
    divs = re.findall(r'<div class="course-statemachine" id="([\w-]+)"(?: data-config="([^"]*)")?>', p)
    configs = [json.loads(htmllib.unescape(cfg)) if cfg else {} for _, cfg in divs]
    c.ok(len(divs) == 6, "a state machine for every ```statemachine block, not for one shown inside a code block",
         f"found {len(divs)}")
    if len(divs) == 6:
        c.ok([d[0] for d in divs[:3]] == ["statemachine-1", "debouncer", "statemachine-3"],
             "every state machine has an id: the block's own, or statemachine-<n>")
        states = configs[0].get("states", {})
        c.ok(configs[0].get("initial") == "OFF" and states.get("OFF", {}).get("on") == {"pressed": "ON / LED on"},
             "on:, ON and OFF stay text (YAML 1.2 booleans: only true and false)", json.dumps(configs[0])[:200])
        c.ok(configs[2]["states"]["STOPPED"]["entry"] == "LED on stop limit print \"stopped\"",
             "lines without dashes are one line, as in the browser's YAML reader", configs[2]["states"]["STOPPED"]["entry"])
    c.ok("NOT-A-STATEMACHINE" in p and p.count('class="sm-error"') == 1,
         "a state machine in a code block is shown as code; unreadable YAML is reported on the page")
    c.ok("data-yaml" not in p, "editable state machines have no YAML on the published site")
    lib = re.search(r'<script src="[^"]*site_libs/quarto-contrib/(course-statemachine-\w+)/dagre\.min\.js"></script>\s*'
                    r'<script src="[^"]*site_libs/quarto-contrib/course-statemachine-\w+/statemachine\.js"', html)
    c.ok(lib and (dist / "site_libs" / "quarto-contrib" / lib.group(1) / "dagre.min.js.LEGAL.txt").is_file()
         and "course-statemachine" not in read("lessons/week_02/lesson3.html"),
         "dagre, its licence and the state machine script, only on pages with state machines")
    try:
        chrome = str(tools.installed("chrome"))
    except tools.ToolError as e:
        c.skip("state machines in a browser", str(e))
        return
    out = run([tools.quarto(), "run", str(REPO / "tests" / "statemachine_browser.js"), chrome,
               str(dist / "lessons" / "week_02" / "lesson4.html")])
    lines = ANSI.sub("", out.stdout).strip().splitlines()
    c.ok(out.returncode == 0 and lines and lines[-1].endswith(" ok, 0 failed"),
         "in a browser: clicks move the machines, bounces, timers, text and log (tests/statemachine_browser.js)"
         + (f" ({lines[-1]})" if lines else ""), "\n        ".join(lines[-15:]))


def check_widgets(c: Checks, read) -> None:
    c.section("Widgets (lessons/week_02/lesson3)")
    html = read("lessons/week_02/lesson3.html")
    p = main_content(html)
    divs = re.findall(r'<div class="course-widget" id="([\w-]+)"(?: data-config="([^"]*)")?>', p)
    configs = [json.loads(htmllib.unescape(cfg)) if cfg else {} for _, cfg in divs]
    c.ok(len(divs) == 21, "a widget for every ```widget block, not for one shown inside a code block", f"found {len(divs)}")
    types = [cfg.get("type") for cfg in configs]
    c.ok(types == ["number"] * 4 + ["arithmetic"] * 4 + ["shift"] + ["register"] * 3 + ["frame"] * 4 + ["packet"]
         + ["dial", "register", "number", None], "the configurations of the widgets, as JSON", f"types: {types}")
    if len(configs) == 21:
        c.ok(configs[3].get("value") == "16045690984503111693", "64-bit values are passed as text (no rounding in JavaScript)")
        c.ok(divs[0][0] == "widget-1" and divs[2][0] == "wheel", "every widget has an id: the block's own, or widget-<n>")
    c.ok("NOT-A-WIDGET" in p and p.count('class="cw-error"') == 1, "a widget in a code block is shown as code; unreadable YAML is reported on the page")
    c.ok("data-yaml" not in p, "editable widgets have no YAML on the published site")
    c.ok(re.search(r'<script src="[^"]*site_libs/quarto-contrib/course-widgets-\w+/widgets\.js"', html)
         and "course-widgets" not in read("lessons/week_02/lesson1.html"), "the widget script, only on pages with widgets")


def check_site(c: Checks, dist: Path, html_only: bool) -> None:
    def read(rel: str) -> str:
        p = dist / rel
        return p.read_text(encoding="utf-8", errors="replace") if p.is_file() else ""

    c.section("Pages and files")
    missing = [rel for rel in PAGES + FILES if not (dist / rel).is_file()]
    c.ok(not missing, "all pages and files are there", f"missing: {missing}")
    c.ok(not (dist / "lessons" / "week1").exists(), "a wrongly named week directory is not published")

    c.section("Private files")
    private = [p.relative_to(dist).as_posix() for p in dist.rglob("*") if "private" in p.relative_to(dist).parts]
    c.ok(not private, "no `private` directory is published", f"found: {private}")
    leaks = [p.relative_to(dist).as_posix() for p in dist.rglob("*")
             if p.is_file() and SECRET.encode() in p.read_bytes()]
    c.ok(not leaks, "no private content in any published file (search index included)", f"found in: {leaks}")
    zip_path = dist / "assignments/week_01/assignment2/week_01-assignment2.zip"
    names = zipfile.ZipFile(zip_path).namelist() if zip_path.is_file() else []
    c.ok(names == ["week_01-assignment2/main.c"], "the starter zip has the starter files, without private ones",
         f"zip contains: {names}")

    c.section("Navigation")
    home = read("index.html")
    sidebar = home[home.find('id="quarto-sidebar"'):home.find("</nav>", home.find('id="quarto-sidebar"'))]
    c.ok("Week 1: Basics" in sidebar and "Week 2: Interrupts" in sidebar,
         "weeks are named after the title of their README")
    c.ok(0 <= sidebar.find("lesson2.html") < sidebar.find("lesson10.html"), "pages are in natural order (2 before 10)")
    c.ok("logbook1" not in sidebar, "a logbook is not in the sidebar")
    html_files = [p for p in dist.rglob("*.html")]
    qmd = [p.relative_to(dist).as_posix() for p in html_files if re.search(r'href="[^"]*\.qmd[#"]', p.read_text(errors="replace"))]
    c.ok(not qmd, "no links to .qmd files", f"in: {qmd}")
    md = [p.relative_to(dist).as_posix() for p in html_files
          if re.search(r'href="(?![^"]*logbook1\.md")[^"]*\.md[#"]', p.read_text(errors="replace"))]
    c.ok(not md, "no links to .md files (except logbook downloads)", f"in: {md}")
    try:
        index = json.loads(read("search.json"))
        c.ok(any("Superloops" in json.dumps(e) for e in index), "the search index covers the pages")
    except json.JSONDecodeError as e:
        c.ok(False, "the search index is valid JSON", str(e))

    c.section("Lesson with all Markdown features (lessons/week_01/lesson1)")
    html = read("lessons/week_01/lesson1.html")
    m = main_content(html)
    if html_only:
        c.ok('class="course-pdf"' not in m, "no PDF button without PDFs")
    else:
        c.ok('class="course-pdf"' in m and 'href="lesson1.pdf" target="_blank"' in m, "PDF button, opens in a new tab")
    c.ok("Open the slides" in m and 'href="../../slides/week_01/lesson1.pdf" target="_blank"' in m,
         "slides box with the slides PDF")
    for target, what in (("../../lessons/week_01/lesson2.html", "lesson2.md"),
                         ("../../info/assessment.html", "info/assessment.yaml"),
                         ("../../lessons/week_01/index.html", "README.md")):
        c.ok(f'href="{target}"' in m, f"a link to {what} leads to its page")
    c.ok('class="math inline"' in m and 'class="math display"' in m, "inline and display math")
    c.ok("callout-tip" in m and "CALLOUT-TIP-TEXT" in m, "callout")
    # Quarto makes a callout's text 90 % (.9rem); the theme sets it back, later in the same file
    css = "".join(p.read_text(encoding="utf-8") for p in (dist / "site_libs" / "bootstrap").glob("bootstrap*.min.css"))
    sizes = re.findall(r"\.callout\.callout-style-simple \.callout-body\{[^}]*?font-size:([^;}]+)", css)
    c.ok(sizes[-1:] == ["1rem"], "callout text and code as big as the rest of the page", f"font-size of the callout body: {sizes}")
    c.ok("panel-tabset" in m, "tabs")
    c.ok(m.count('class="code-annotation-anchor') == 2 and "&lt;1&gt;" not in m,
         "C code annotations (// <1>) become annotation numbers")
    c.ok(m.count("SHOWN-NEVER-RUN") == 1, "an executable cell is shown, not run")
    c.ok("mermaid-js" in m and 'data-layout-align="center"' in m, "Mermaid diagram, centred")
    c.ok(m.count('<img src="data:image/svg+xml') == 3, "PlantUML diagrams are inline SVG")
    c.ok(m.count('class="course-diagram" style="text-align: center"') == 2,
         "PlantUML diagrams are centred unless they set fig-align")
    svgs = [base64.b64decode(b).decode("utf-8", "replace")
            for b in re.findall(r'<img src="data:image/svg\+xml;base64,([A-Za-z0-9+/=]+)', m)]
    c.ok(any('data-diagram-type="CLASS"' in svg and "GraphvizPin" in svg for svg in svgs),
         "a PlantUML class diagram, laid out by Graphviz")
    c.ok('src="images/figure.svg"' in m, "image")
    c.ok("<hr" in m and "<li>first item</li>" in m, "a rule followed by text, and a list right after text")
    c.ok(all(line in m for line in FOOTER), "footer with the dates and author from git")
    c.ok("classList.add('embedded')" in html, "embedded mode script (Brightspace)")

    c.section("Other lessons")
    lesson2, lesson10 = main_content(read("lessons/week_01/lesson2.html")), main_content(read("lessons/week_01/lesson10.html"))
    c.ok("No presentation yet" in lesson2, "a lesson without slides says so")
    c.ok("No presentation yet" not in lesson10 and "Open the slides" not in lesson10, "`slides: false` hides the box")

    c.section("Assignments and logbooks")
    a1 = main_content(read("assignments/week_01/assignment1.html"))
    a2 = main_content(read("assignments/week_01/assignment2/index.html"))
    logbook = read("assignments/week_01/logbook1.html")
    c.ok("Generative AI: allowed, with citation" in a1 and "GENAI-NOTE-TEXT" in a1,
         "an assignment can allow GenAI, with a note")
    c.ok("Generative AI: not allowed" in a2, "other assignments follow the course policy")
    c.ok('href="logbook1.md"' in a1 and "logbook1.html" in a1, "logbook box: download and preview")
    c.ok('href="week_01-assignment2.zip"' in a2, "starter files box with the zip")
    c.ok("assignment1.html" in main_content(logbook) and 'class="course-pdf"' not in logbook,
         "logbook preview links back and has no PDF")
    published = dist / "assignments/week_01/logbook1.md"
    c.ok(published.is_file() and published.read_bytes() == (COURSE / "assignments/week_01/logbook1.md").read_bytes(),
         "the logbook is published unchanged")

    c.section("Course information pages")
    info = main_content(read("info/index.html"))
    c.ok("Write a superloop in C." in info and "course-levels" in info and "Kernighan" in info,
         "course information: learning outcomes, levels, literature")
    c.ok(all(line in info for line in FOOTER), "generated pages have a footer from their YAML file")
    assessment = main_content(read("info/assessment.html"))
    c.ok(assessment.count('class="assessment-matrix"') == 2, "an assessment matrix per component")
    c.ok("RUBRIC-DESCRIPTION-TEXT" in assessment and "Bloom" in assessment, "rubric and Bloom legend")
    c.ok("Generative AI and academic integrity" in read("info/genai.html"), "GenAI policy page")
    c.ok("House rules" in read("info/rules.html"), "extra page in info/")

    check_practice(c, read)
    check_terms(c, read)
    check_outcomes(c, read)
    check_widgets(c, read)
    check_statemachines(c, read, dist)
    # the PDF pictures, drawn at build time (the stage, before `stage --preview` changes it)
    data = json.loads((dist.parent / ".build" / "_course" / "widgets.json").read_text(encoding="utf-8"))
    svgs = [e.get("svg", "") for e in data["widgets"].values() if '"bit_values":true' in e.get("config", "")]
    values = "".join(re.findall(r'class="cw-wv-val"[^>]*>([01])<', svgs[0])) if svgs else ""
    c.ok(len(svgs) == 1 and values.startswith("00001001001"),
         "bit values under the bit labels: start, D0 … D7, parity and stop of 'H' (0x48, even parity)", f"values: {values[:22]}")

    c.section("Draft pages are not published")
    leaks = [p.relative_to(dist).as_posix() for p in [*dist.rglob("*.html"), dist / "search.json"]
             if p.is_file() and (b"DRAFT-ONLY-TEXT" in p.read_bytes() or b"gallery" in p.read_bytes())]
    c.ok(not (dist / "references" / "gallery.html").exists() and not leaks,
         "a page with draft: true is not in the site, the search index or any link", f"found in: {leaks}")

    if html_only:
        c.skip("PDFs", "--html-only")
        return
    c.section("PDFs")
    expected_pdfs = [rel[:-5] + ".pdf" for rel in PAGES]
    bad = [rel for rel in expected_pdfs
           if not (dist / rel).is_file() or not (dist / rel).read_bytes().startswith(b"%PDF")]
    c.ok(not bad, "every page has a PDF", f"missing or invalid: {bad}")
    c.ok(not (dist / "assignments/week_01/logbook1.pdf").exists(), "a logbook preview has no PDF")
    c.ok(not (dist / "glossary/review.pdf").exists(), "the review page has no PDF")
    pdf = (dist / "lessons/week_01/lesson1.pdf").read_bytes() if (dist / "lessons/week_01/lesson1.pdf").is_file() else b""
    c.ok(f"{SITE_URL}lessons/week_01/lesson2.html".encode() in pdf, "links in PDFs point to the website")
    practice_pdf = dist / "lessons/week_02/lesson1.pdf"
    c.ok(practice_pdf.is_file() and b"https://godbolt.org/clientstate/" in practice_pdf.read_bytes(),
         "Compiler Explorer links in PDFs")
    if shutil.which("pdffonts"):
        fonts = run(["pdffonts", str(dist / "lessons/week_01/lesson1.pdf")]).stdout
        c.ok("Lato-Regular" in fonts and "Lato-Bold" in fonts,
             "PDFs use Lato, which comes with course-tools (CI does not install it)", fonts)
    else:
        c.skip("fonts of the PDFs", "pdffonts not installed")
    if not shutil.which("pdftotext"):
        c.skip("text of the PDFs", "pdftotext not installed")
        return

    def text(rel: str) -> str:
        out = run(["pdftotext", str(dist / rel), "-"])
        # Typst puts a zero-width space before an element with an id.
        return re.sub(r"[\s\u200b]+", " ", out.stdout)

    t = text("lessons/week_01/lesson1.pdf")
    c.ok("Superloops" in t and "CALLOUT-TIP-TEXT" in t and "Open the slides" in t, "lesson PDF: title, callout, slides")
    c.ok("// ①" in t and "① Configure the hardware once." in t, "lesson PDF: code annotations as circled numbers")
    c.ok(all(line in t for line in FOOTER), "lesson PDF: footer from git")
    c.ok("GENAI-NOTE-TEXT" in text("assignments/week_01/assignment1.pdf"), "assignment PDF: GenAI box")
    t = text("lessons/week_02/lesson1.pdf")
    questions, _, key = t.partition(" Answers ")
    c.ok("Question 6." in questions and "Prediction 1." in questions and "PREDICT-ANSWER" not in questions
         and "EXPLANATION-SINGLE" not in questions, "practice PDF: questions without the answers")
    c.ok(all(a in key for a in ("Correct: volatile", "0.1 ms (± 0.001)", "ISR (also right: interrupt service routine",
                                "EXPLANATION-SINGLE", "PREDICT-ANSWER")),
         "practice PDF: answers, feedback and explanations at the end")
    g = text("glossary/index.pdf")
    c.ok("Glossary" in g and "linker" in g and "Introduced in Superloops (Week 1: Basics)" in g, "glossary PDF")
    c.ok("Key terms superloop" in text("lessons/week_01/lesson1.pdf"), "lesson PDF: the key-terms box")
    c.ok("Learning outcomes: Superloops (LO1), LO2 · about" in text("lessons/week_02/lesson1.pdf"),
         "lesson PDF: the learning outcomes and the reading time")
    c.ok("LO3: Debugging" in text("info/outcomes.pdf"), "outcome map PDF")
    t = text("lessons/week_02/lesson3.pdf")
    questions, _, key = t.partition(" Answers ")
    c.ok("WIDGET-TITLE" in questions and "binary 1101 0010 hexadecimal 0xD2 · unsigned 210 · signed −46" in questions
         and "Try it on the website." in questions, "widget PDF: a picture of the widget, with its title and a link")
    c.ok("Exercise 5." in questions and "Exercise 6." not in questions and "'O' 0x4F" not in questions,
         "widget PDF: challenges are exercises, without their answers")
    c.ok(all(a in key for a in ("Exercise 1 1101 0010 (0xD2)", "For example A =",
                                "TIMCTRL = 0xC3 (1100 0011): EN = 1, MODE = 2 (periodic), DIV = 3.",
                                "GPIO_CFG = (GPIO_CFG & ~(0x3u << 8)) | (0x2u << 8);", "frame 1: 'O' 0x4F, frame 2: 'K' 0x4B.")),
         "widget PDF: the answers at the end")
    c.ok("This widget cannot be shown: unknown type" in questions, "widget PDF: a widget with a mistake says so")
    c.ok("'\\r' 0x0D" in questions and "'\\n' 0x0A" in questions,
         "widget PDF: C escapes in text data (Hi\\r\\n), frames named by their escapes")
    t = text("lessons/week_02/lesson4.pdf")
    c.ok("SM-TITLE SM-TASK" in t and "State pressed OFF ON | LED on ON OFF | LED off" in t
         and "Try it on the website." in t, "state machine PDF: title, task, picture and transition table, and a link")
    c.ok("btn_just_pressed()" in t and "PRESSED | send pressed – PRESSED – RELEASED" in t and 'RUNNING STOPPED | print "lap"' in t,
         "state machine PDF: machines side by side, a dash for an ignored event, an internal action")
    c.ok("This state machine cannot be shown: state A, on presed" in t, "state machine PDF: a machine with a mistake says so")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--course", default="course", help='command to run course-tools (default: "course")')
    parser.add_argument("--html-only", action="store_true", help="skip the PDFs (faster)")
    parser.add_argument("--keep", action="store_true", help="keep the build directory")
    args = parser.parse_args()

    course_cmd = shlex.split(args.course)
    # The commands run in the test course; keep a relative PYTHONPATH=src working.
    if os.environ.get("PYTHONPATH"):
        os.environ["PYTHONPATH"] = os.pathsep.join(
            str(Path(p).resolve()) for p in os.environ["PYTHONPATH"].split(os.pathsep) if p)
    if not shutil.which(course_cmd[0]):
        sys.exit(f"error: {course_cmd[0]} not found. Run ./install.sh --local, or see --help.")

    tmp = Path(tempfile.mkdtemp(prefix="course-check-"))
    course = tmp / "course"
    shutil.copytree(COURSE, course)
    commit(course)
    print(f"Test course: {course}")

    c = Checks()
    check_widget_logic(c)
    check_statemachine_logic(c)
    if check_tools(c, course_cmd) and check_build(c, course_cmd, course, args.html_only):
        check_site(c, course / "dist", args.html_only)
        check_preview_stage(c, course_cmd, course)

    print(f"\n{c.passed} passed, {len(c.failed)} failed" + (f", {len(c.skipped)} skipped" if c.skipped else ""))
    if c.failed or args.keep:
        print(f"The build is kept in {course}")
    else:
        shutil.rmtree(tmp, ignore_errors=True)
    return 1 if c.failed else 0


if __name__ == "__main__":
    sys.exit(main())
