"""Command-line interface: ``course build``, ``course preview``, ``course doctor``, ``course clean``."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from . import __version__
from .course import CourseError, is_ignored, scan
from .stage import Options, desired_files, sync

STAGE_DIR = ".build"
OUTPUT_DIR = "dist"


# --------------------------------------------------------------------------
# External tools
# --------------------------------------------------------------------------

def find_quarto() -> str:
    quarto = os.environ.get("QUARTO_PATH") or shutil.which("quarto")
    if not quarto:
        sys.exit("error: Quarto not found. Install it (see requirements.md) or set QUARTO_PATH.")
    return quarto


def find_plantuml() -> list[str] | None:
    """Command for PlantUML: $PLANTUML_JAR (run with java), else `plantuml` on PATH."""
    jar = os.environ.get("PLANTUML_JAR")
    if jar:
        return ["java", "-jar", jar]
    exe = shutil.which("plantuml")
    return [exe] if exe else None


def _version(cmd: list[str]) -> str | None:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    text = (out.stdout or out.stderr).strip().splitlines()
    return text[0] if out.returncode == 0 and text else None


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------

def _stage(source: Path, opts: Options, verbose: bool = True) -> Path:
    course = scan(source)
    stage = source / STAGE_DIR
    changed = sync(stage, desired_files(course, opts))
    if verbose:
        print(f"Staged {course.title!r}: {len(course.weeks)} weeks, "
              f"{len(course.pages())} pages ({len(changed)} files updated)")
    return stage


def cmd_build(args) -> int:
    source = Path(args.source).resolve()
    opts = Options(site_url=args.site_url, pdf=not args.html_only, plantuml=find_plantuml())
    stage = _stage(source, opts)
    quarto = find_quarto()
    cmd = [quarto, "render", str(stage)]
    if args.html_only:
        cmd += ["--to", "html"]
    print("Running:", " ".join(cmd))
    result = subprocess.run(cmd)
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


def cmd_preview(args) -> int:
    source = Path(args.source).resolve()
    opts = Options(site_url=None, pdf=False, plantuml=find_plantuml())
    stage = _stage(source, opts)
    quarto = find_quarto()
    cmd = [quarto, "preview", str(stage), "--render", "html", "--port", str(args.port)]
    if args.no_browser:
        cmd.append("--no-browser")
    print("Running:", " ".join(cmd))
    proc = subprocess.Popen(cmd)
    snap = _snapshot(source)
    try:
        while proc.poll() is None:
            time.sleep(1)
            new = _snapshot(source)
            if new != snap:
                snap = new
                try:
                    _stage(source, opts)
                except (CourseError, OSError, ValueError) as e:
                    print(f"error: {e}", file=sys.stderr)
    except KeyboardInterrupt:
        pass
    finally:
        if proc.poll() is None:
            proc.terminate()
            proc.wait()
    return 0


def cmd_stage(args) -> int:
    source = Path(args.source).resolve()
    opts = Options(site_url=args.site_url, pdf=not args.html_only, plantuml=find_plantuml())
    print(_stage(source, opts))
    return 0


def cmd_clean(args) -> int:
    source = Path(args.source).resolve()
    for name in (STAGE_DIR, OUTPUT_DIR):
        p = source / name
        if p.exists():
            shutil.rmtree(p)
            print(f"Removed {p}")
    return 0


def cmd_doctor(args) -> int:
    ok = True

    def report(name, value, required=True, hint=""):
        nonlocal ok
        mark = "ok " if value else ("ERR" if required else "-- ")
        if not value and required:
            ok = False
        print(f"[{mark}] {name}: {value or 'not found'}" + (f"  ({hint})" if not value and hint else ""))

    print(f"course-tools {__version__}, Python {sys.version.split()[0]}")
    quarto = os.environ.get("QUARTO_PATH") or shutil.which("quarto")
    report("Quarto", quarto and _version([quarto, "--version"]), hint="see requirements.md")
    report("Typst (bundled with Quarto)", quarto and _version([quarto, "typst", "--version"]))
    plantuml = find_plantuml()
    report("PlantUML", plantuml and _version(plantuml + ["-version"]), hint="needs Java; set PLANTUML_JAR")
    report("Java", _version(["java", "-version"]) or (shutil.which("java") and "installed"))
    chrome = os.environ.get("QUARTO_CHROMIUM")
    report("Chrome for Mermaid in PDFs", chrome or "managed by Quarto (run: quarto install chrome-headless-shell)",
           required=False)
    lato = shutil.which("fc-list") and subprocess.run(["fc-list", "Lato"], capture_output=True, text=True).stdout.strip()
    report("Lato font (PDF)", "installed" if lato else None, hint="sudo apt install fonts-lato")
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

    p = add("preview", cmd_preview, "Serve the website locally and rebuild on changes (HTML only).")
    p.add_argument("--port", type=int, default=4200)
    p.add_argument("--no-browser", action="store_true")

    p = add("stage", cmd_stage, "Only generate the Quarto project in .build/ (for debugging).")
    p.add_argument("--site-url", default=os.environ.get("COURSE_SITE_URL"))
    p.add_argument("--html-only", action="store_true")

    add("clean", cmd_clean, "Remove .build/ and dist/.")
    add("doctor", cmd_doctor, "Check that the required tools are installed.")

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except CourseError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
