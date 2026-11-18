"""`course standalone`: one course page as a single HTML file, for Brightspace.

Legacy courses keep their content in Brightspace's own pages instead of
embedding the website. This renders one page of the course on its own: the
file contains everything the page uses (scripts, styles, pictures, fonts
except Lato, which Brightspace serves), and none of the website around it: no
sidebar, table of contents, PDF button, boxes with files (slides, starter
files, logbooks) or footer. Links to other pages and to files become
placeholders with a red [TODO] (filters/course.lua), listed after the export.
Quarto's `embed-resources` puts the website's whole CSS and JavaScript in the
file; slim.py then takes out what the page cannot use.

The pages are staged in .build-standalone/ (a plain Quarto project, see
stage._standalone_config) and written to standalone/ in the course, named
after their path on the website (lessons/week_01/lecture1 ->
lessons-week_01-lecture1.html). Both folders ignore themselves in git (a
.gitignore of `*`), so that course repositories need no change.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, replace
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath

from . import slim, terms
from .course import Course
from .menu import Entry
from .stage import Options, desired_files, sidebar, sync
from .statemachine import CACHE as STATEMACHINE_CACHE
from .superloop import CACHE as SUPERLOOP_CACHE
from .widgets import CACHE as WIDGET_CACHE

STAGE_DIR = ".build-standalone"
OUTPUT_DIR = "standalone"
GITIGNORE = "# Made by `course standalone`: not for git.\n*\n"

# Why an entry of the menu can't be exported.
FILE = "it is a file, not a page; upload the file itself"
REVIEW = "the review deck reads the glossary of the website"

# Generated pages: the YAML file they are made from (to name them on the command line).
GENERATED_FROM = {"info/index.qmd": "info/general.yaml", "info/assessment.qmd": "info/assessment.yaml"}


class ExportError(Exception):
    pass


# --------------------------------------------------------------------------
# What can be exported: the website's sidebar
# --------------------------------------------------------------------------

def entries(course: Course) -> list[Entry]:
    """The menu: the sidebar of the website. A section opens; its own page comes first in it."""
    def entry(item: dict) -> Entry:
        if "section" in item:
            children = [entry(i) for i in item.get("contents", [])]
            if item.get("href"):
                children.insert(0, entry({"href": item["href"], "text": item["section"]}))
            return Entry(item["section"], children=children)
        href = item["href"]
        reason = REVIEW if href == terms.REVIEW else None if href.endswith(".qmd") else FILE
        return Entry(item["text"], href, reason=reason)
    return [entry(item) for item in sidebar(course)]


def leaves(items: list[Entry]):
    for e in items:
        if e.children:
            yield from leaves(e.children)
        else:
            yield e


def export_name(rel: str) -> str:
    """The file name of an exported page: its path on the website with - for /."""
    parts = PurePosixPath(rel).with_suffix("").parts
    if parts and parts[-1] == "index":
        parts = parts[:-1]
    return ("-".join(parts) or "home") + ".html"


def find(items: list[Entry], course: Course, name: str) -> Entry | None:
    """The entry a page is named by: its source file (lessons/week_01/lecture1.md), its path on
    the website (info/assessment, info/assessment.html) or the name of its export."""
    key = name.replace("\\", "/").strip("/")
    if key.startswith("./"):
        key = key[2:]
    sources = {str(p.rel): p.src.relative_to(course.root).as_posix() for p in course.pages() if p.src}
    sources.update(GENERATED_FROM)
    if course.genai_file is not None:
        sources["info/genai.qmd"] = course.genai_file.relative_to(course.root).as_posix()
    for e in leaves(items):
        stem = e.rel[:-len(".qmd")] if e.rel.endswith(".qmd") else e.rel
        names = {e.rel, stem, stem + ".html", export_name(e.rel), sources.get(e.rel)}
        if stem.endswith("/index") or stem == "index":
            names.add(stem[:-len("index")].rstrip("/") or "index")
        if key in names or key.lower() in {n.lower() for n in names if n}:
            return e
    return None


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------

@dataclass
class Export:
    path: Path                         # the file written
    todos: list[tuple[str, str]]       # placeholders: (text, stage path of the target)
    loose: list[str]                   # other links to files that are not in the page


class _Scan(HTMLParser):
    """The placeholders of a rendered page, and links that still point outside it."""
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.todos: list[tuple[str, str]] = []
        self.loose: list[str] = []
        self._todo: list | None = None     # [target, text, depth]

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if self._todo is not None:
            if tag not in self.VOID:
                self._todo[2] += 1
        elif "course-todo-link" in (a.get("class") or "").split():
            self._todo = [a.get("data-target") or "", "", 1]
        for key in ("href", "src"):
            value = (a.get(key) or "").strip()
            if value and not value.startswith(("data:", "#", "http:", "https:", "mailto:", "javascript:", "tel:")):
                self.loose.append(value)

    def handle_endtag(self, tag):
        if self._todo is not None and tag not in self.VOID:
            self._todo[2] -= 1
            if self._todo[2] == 0:
                self.todos.append((" ".join(self._todo[1].split()), self._todo[0]))
                self._todo = None

    def handle_data(self, data):
        if self._todo is not None:
            self._todo[1] += data


def _ignore_in_git(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    if not (folder / ".gitignore").exists():
        (folder / ".gitignore").write_text(GITIGNORE, encoding="utf-8")


def export(course: Course, entry: Entry, opts: Options, quarto: str, env: dict) -> Export:
    """Stage the course for pages on their own, render the page and copy it to standalone/."""
    stage = course.root / STAGE_DIR
    _ignore_in_git(stage)
    opts = replace(opts, standalone=True, pdf=False, widget_cache=stage / WIDGET_CACHE,
                   statemachine_cache=stage / STATEMACHINE_CACHE, superloop_cache=stage / SUPERLOOP_CACHE)
    sync(stage, desired_files(course, opts))
    result = subprocess.run([quarto, "render", entry.rel, "--to", "html"], cwd=stage, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                            encoding="utf-8", errors="replace")
    log = result.stdout or ""
    for line in log.splitlines():     # the filters' warnings (widgets with mistakes, ...)
        if line.startswith(("WARN", "ERROR")) or "warning:" in line.lower():
            print(line)
    rendered = stage / "_site" / PurePosixPath(entry.rel).with_suffix(".html")
    if result.returncode != 0 or not rendered.is_file():
        raise ExportError("Quarto failed:\n" + "\n".join(log.splitlines()[-40:]))
    html = slim.slim(rendered.read_text(encoding="utf-8"))
    scan = _Scan()
    scan.feed(html)
    out = course.root / OUTPUT_DIR
    _ignore_in_git(out)
    target = out / export_name(entry.rel)
    target.write_text(html, encoding="utf-8")
    return Export(target, scan.todos, sorted(set(scan.loose)))


def describe_target(items: list[Entry], target: str) -> str:
    """What a placeholder leads to: the page (and the name of its export), or the file."""
    for e in leaves(items):
        if e.rel == target and e.reason is None:
            return f"{e.text} ({export_name(e.rel)})"
    return f"{target} (a file)" if not target.endswith(".qmd") else target
