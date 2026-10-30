"""Command-line interface: ``course build``, ``course preview``, ``course setup``, ``course doctor``,
``course template``, ``course clean``."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from dataclasses import replace
from pathlib import Path

from . import __version__, templates, tools
from .course import CourseError, is_ignored, scan
from .stage import Options, desired_files, sync
from .statemachine import CACHE as STATEMACHINE_CACHE
from .tools import ToolError
from .widgets import CACHE as WIDGET_CACHE

STAGE_DIR = ".build"
OUTPUT_DIR = "dist"


# --------------------------------------------------------------------------
# External tools
# --------------------------------------------------------------------------

def _tool(find):
    """Run a lookup from tools.py; exit with its hint (`run course setup`) if the tool is missing."""
    try:
        return find()
    except ToolError as e:
        sys.exit(f"error: {e}")


def _version(cmd: list[str], require_success: bool = True) -> str | None:
    """First line of the output of `cmd` (e.g. `tool --version`), or None."""
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    text = (out.stdout or out.stderr).strip().splitlines()
    if not text or (require_success and out.returncode != 0):
        return None
    return text[0]


# How to install Graphviz, which `course doctor` reports when it is missing (see install.sh).
GRAPHVIZ_HINT = {"darwin": "brew install graphviz", "win32": "run `course setup`"}.get(sys.platform,
                                                                                     "sudo apt install graphviz")


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------

def _stage(source: Path, opts: Options, verbose: bool = True, settle=None) -> Path:
    course = scan(source, drafts=opts.preview)
    stage = source / STAGE_DIR
    opts = replace(opts, widget_cache=stage / WIDGET_CACHE, statemachine_cache=stage / STATEMACHINE_CACHE)
    changed = sync(stage, desired_files(course, opts), settle)
    if verbose:
        print(f"Staged {course.title!r}: {len(course.weeks)} weeks, "
              f"{len(course.pages())} pages ({len(changed)} files updated)")
    return stage


def cmd_build(args) -> int:
    source = Path(args.source).resolve()
    quarto, env = _tool(tools.quarto), _tool(lambda: tools.environment(pdf=not args.html_only))
    opts = Options(site_url=args.site_url, pdf=not args.html_only, plantuml=_tool(tools.plantuml))
    stage = _stage(source, opts)
    cmd = [quarto, "render", str(stage)]
    if args.html_only:
        cmd += ["--to", "html"]
    print("Running:", " ".join(cmd))
    result = subprocess.run(cmd, env=env)
    if result.returncode != 0:
        print("error: Quarto failed", file=sys.stderr)
        return result.returncode
    out = Path(args.output).resolve()
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(stage / "_site", out)
    print(f"Website written to {out}")
    return 0


def _snapshot(source: Path) -> dict:
    snap = {}
    for dirpath, dirnames, filenames in os.walk(source):
        dirnames[:] = [d for d in dirnames
                       if not d.startswith(".") and d not in ("private", OUTPUT_DIR)]
        for name in filenames:
            p = Path(dirpath) / name
            if name.startswith(".") or is_ignored(p, source):
                continue
            try:
                st = p.stat()
            except FileNotFoundError:
                continue
            snap[str(p)] = (st.st_mtime_ns, st.st_size)
    return snap


# How long `course preview` waits for Quarto to render a page before it writes the next one
RENDER_WAIT = 60


def _rendered(stage: Path, pdf: bool):
    """For `course preview`: wait until Quarto has rendered a page that was just staged.

    Quarto's preview fails without a message when it re-renders several pages
    at once, from the second time on (Quarto 1.10.18, 1.10.19 and 1.11.6). A
    key-term edit changes two pages: the lesson and the glossary. One page at a
    time works, so the stager writes changed pages one by one and waits here
    for each page's HTML (and its PDF, with --pdf, if the page has one).
    """
    def settle(rel: str) -> None:
        start = time.time()
        out = stage / "_site" / rel[:-len(".qmd")]
        outputs = [Path(f"{out}.html")]
        if pdf and Path(f"{out}.pdf").exists():
            outputs.append(Path(f"{out}.pdf"))
        while time.time() - start < RENDER_WAIT:
            if all(p.exists() and p.stat().st_mtime >= start for p in outputs):
                return
            time.sleep(0.25)
        print(f"warning: Quarto has not rendered {rel} after {RENDER_WAIT} s; going on", file=sys.stderr)
    return settle


def cmd_preview(args) -> int:
    source = Path(args.source).resolve()
    quarto, env = _tool(tools.quarto), _tool(lambda: tools.environment(pdf=args.pdf))
    opts = Options(site_url=None, pdf=args.pdf, plantuml=_tool(tools.plantuml), preview=True)
    stage = _stage(source, opts)
    # --pdf: Quarto renders the PDFs too, at the start and for every page that changes
    cmd = [quarto, "preview", str(stage), "--render", "all" if args.pdf else "html", "--port", str(args.port)]
    if args.no_browser:
        cmd.append("--no-browser")
    print("Running:", " ".join(cmd))
    proc = subprocess.Popen(cmd, env=env)
    snap = _snapshot(source)
    try:
        while proc.poll() is None:
            time.sleep(1)
            new = _snapshot(source)
            if new != snap:
                snap = new
                try:
                    _stage(source, opts, settle=_rendered(stage, args.pdf))
                except (CourseError, OSError, ValueError) as e:
                    print(f"error: {e}", file=sys.stderr)
    except KeyboardInterrupt:
        pass
    finally:
        if proc.poll() is None:
            if sys.platform == "win32":
                # quarto.exe only starts deno.exe, which runs the server: stop both.
                subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
            else:
                proc.terminate()
            proc.wait()
    return 0


def cmd_stage(args) -> int:
    source = Path(args.source).resolve()
    try:
        plantuml = tools.plantuml()
    except ToolError:     # staging works without the tools; Quarto then has no PlantUML command
        plantuml = None
    opts = Options(site_url=args.site_url, pdf=not (args.html_only or args.preview), plantuml=plantuml,
                   preview=args.preview)
    print(_stage(source, opts))
    return 0


def cmd_template(args) -> int:
    if args.action == "list":
        for name in templates.names():
            print(name)
        return 0
    source = Path(args.source).resolve()
    if not (source / "info" / "general.yaml").is_file():
        raise CourseError(f"{source} has no info/general.yaml - is this a course repository?")
    target = templates.copy(args.name, source, force=args.force)
    print(f"Copied to {target.relative_to(source).as_posix()}: the course uses it instead of the built-in text.")
    return 0


def cmd_clean(args) -> int:
    source = Path(args.source).resolve()
    for name in (STAGE_DIR, OUTPUT_DIR):
        p = source / name
        if p.exists():
            shutil.rmtree(p)
            print(f"Removed {p}")
    return 0


def cmd_setup(args) -> int:
    try:
        tools.setup({"quarto": args.quarto, "plantuml": args.plantuml}, force=args.force)
    except (ToolError, OSError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    if sys.platform != "win32" and not shutil.which("dot"):   # on Windows, `course setup` installs it
        print(f"warning: Graphviz is not installed; most PlantUML diagrams need it ({GRAPHVIZ_HINT})",
              file=sys.stderr)
    return 0


def cmd_doctor(args) -> int:
    ok = True

    def report(name, value, required=True, hint=""):
        nonlocal ok
        mark = "ok " if value else ("ERR" if required else "-- ")
        if not value and required:
            ok = False
        print(f"[{mark}] {name}: {value or 'not found'}" + (f"  ({hint})" if not value and hint else ""))

    def tool(find):
        try:
            return find(), None
        except ToolError as e:
            return None, str(e)

    print(f"course-tools {__version__}, Python {sys.version.split()[0]}")
    print(f"Tools folder: {tools.home()}")
    quarto, problem = tool(tools.quarto)
    report("Quarto", quarto and _version([quarto, "--version"]), hint=problem or "")
    report("Typst (bundled with Quarto)", quarto and _version([quarto, "typst", "--version"]))
    plantuml, problem = tool(tools.plantuml)
    # `-version` also reports the Graphviz that PlantUML finds (with the build's
    # environment: on Windows, GRAPHVIZ_DOT), and fails without it.
    out = ""
    if plantuml:
        env, _ = tool(lambda: tools.environment(pdf=False))
        try:
            out = subprocess.run(plantuml + ["-version"], capture_output=True, text=True, timeout=60, env=env).stdout
        except (OSError, subprocess.TimeoutExpired):
            pass
    lines = out.strip().splitlines()
    report("PlantUML", lines[0] if lines and "PlantUML" in lines[0] else None, hint=problem or "")
    report("Java (jdk4py, runs PlantUML)", _version([tools.java(), "-version"]))
    graphviz = next((line.split(":", 1)[1].strip() for line in lines if line.startswith("GraphViz:")), None)
    report("Graphviz (PlantUML diagrams other than sequence and activity diagrams)",
           graphviz if "Installation seems OK" in out else None, hint=GRAPHVIZ_HINT)
    chrome, problem = tool(lambda: tools.environment(pdf=True)["QUARTO_CHROMIUM"])
    if chrome and not os.environ.get("QUARTO_CHROMIUM"):
        chrome = Path(chrome).parent.name    # the version folder
    report("Chrome Headless Shell (Mermaid diagrams in PDFs)", chrome, hint=problem or "")
    report("Lato font (PDF)", "bundled with course-tools")
    return 0 if ok else 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="course", description=__doc__)
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)

    def add(name, func, help_text):
        p = sub.add_parser(name, help=help_text, description=help_text)
        p.add_argument("--source", default=".", help="course repository (default: current directory)")
        p.set_defaults(func=func)
        return p

    p = add("build", cmd_build, "Build the website and PDFs into dist/.")
    p.add_argument("--output", default=OUTPUT_DIR, help="output directory (default: dist)")
    p.add_argument("--site-url", default=os.environ.get("COURSE_SITE_URL"),
                   help="URL the site is published at; used for links in PDFs (env: COURSE_SITE_URL)")
    p.add_argument("--html-only", action="store_true", help="skip the PDFs (faster)")

    p = add("preview", cmd_preview, "Serve the website locally and rebuild on changes (HTML only, unless --pdf).")
    p.add_argument("--port", type=int, default=4200)
    p.add_argument("--no-browser", action="store_true")
    p.add_argument("--pdf", action="store_true", help="also render the PDFs, with PDF buttons on the pages (slower)")

    p = add("stage", cmd_stage, "Only generate the Quarto project in .build/ (for debugging).")
    p.add_argument("--site-url", default=os.environ.get("COURSE_SITE_URL"))
    p.add_argument("--html-only", action="store_true")
    p.add_argument("--preview", action="store_true", help="stage as `course preview` does (draft pages, editable widgets)")

    p = add("template", cmd_template, "List the texts of course-tools that a course can replace, or copy one into the "
                                      "course's templates/ to change it.")
    actions = p.add_subparsers(dest="action", required=True)
    actions.add_parser("list", help="list the templates, e.g. genAI/not-allowed.md")
    c = actions.add_parser("copy", help="copy a template into the course's templates/, to change it there")
    c.add_argument("name", help="the template, as `course template list` shows it, e.g. genAI/not-allowed.md")
    c.add_argument("--force", action="store_true", help="replace the course's copy if it has one")
    c.add_argument("--source", default=argparse.SUPPRESS, help="course repository (default: current directory)")

    add("clean", cmd_clean, "Remove .build/ and dist/.")
    add("doctor", cmd_doctor, "Check that the required tools are installed.")

    p = sub.add_parser("setup", help="Download Quarto, PlantUML and Chrome Headless Shell (pinned versions).",
                       description=f"Download the pinned Quarto ({tools.QUARTO}), PlantUML ({tools.PLANTUML}) and "
                                   f"Chrome Headless Shell ({tools.CHROME}) into {tools.home()}, and remove "
                                   "other versions. Already present tools are kept.")
    p.add_argument("--quarto", metavar="VERSION", help="another Quarto version (not checked against a SHA-256)")
    p.add_argument("--plantuml", metavar="VERSION", help="another PlantUML version (not checked against a SHA-256)")
    p.add_argument("--force", action="store_true", help="download again, also tools that are present")
    p.set_defaults(func=cmd_setup)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except CourseError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
