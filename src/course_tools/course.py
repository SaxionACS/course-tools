"""Discover the structure of a course repository.

Expected layout (all parts optional except ``info/general.yaml``)::

    README.md                         home page
    info/general.yaml                 course information
    info/assessment.yaml              assessment components and matrices
    info/genAI.yaml                   generative-AI policy for the assignments
    lessons/week_NN/README.md         week overview
    lessons/week_NN/*.md              lectures
    assignments/week_NN/README.md     assignments overview of the week
    assignments/week_NN/*.md          single-page assignments
    assignments/week_NN/<name>/index.md (or README.md)
    assignments/week_NN/<name>/starter/   zipped and attached to the assignment
    (a Markdown file named in an assignment's `logbook` front matter is that
    assignment's logbook: downloadable and previewed, not an assignment itself)
    slides/week_NN/<lecture>.pdf      slides exported from PowerPoint
    exams/*.md
    references/*.md, references/*.pdf

Week directories are named ``week_01``, ``week_02``, ... (two or more digits).

Any directory named ``private`` (at any depth) and any hidden file or directory
is ignored completely.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

import yaml

from .markdown import natural_key, pop_leading_h1, split_front_matter, title_from_name

WEEK_DIR = re.compile(r"^week_(\d{2,})$")
EXCLUDED_DIRS = {"private"}
README_NAMES = ("README.md", "readme.md", "index.md")


class CourseError(Exception):
    pass


def is_ignored(path: Path, root: Path) -> bool:
    """True for anything inside a ``private`` directory or hidden."""
    for part in path.relative_to(root).parts:
        if part in EXCLUDED_DIRS or part.startswith("."):
            return True
    return False


@dataclass
class Page:
    src: Path | None             # source file (None for generated pages)
    rel: PurePosixPath           # staged path, relative to the stage root (.qmd)
    kind: str                    # home, info, week, lecture, assignments, assignment, logbook, exam, reference, section
    meta: dict
    body: str
    title: str
    week: int | None = None
    slides: PurePosixPath | None = None     # staged path of the slides PDF
    slides_expected: bool = False           # show "No presentation yet" when missing
    starter_dir: Path | None = None         # source dir zipped as starter files
    logbooks: list["Page"] = field(default_factory=list)   # logbooks of an assignment
    assignment: "Page | None" = None        # the assignment of a logbook

    @property
    def order(self):
        return (self.meta.get("order", 1e9), natural_key(self.rel.stem if self.rel.stem != "index" else self.rel.parent.name))


@dataclass
class Week:
    number: int
    label: str
    overview: Page | None = None
    lectures: list[Page] = field(default_factory=list)
    assignments_overview: Page | None = None
    assignments: list[Page] = field(default_factory=list)
    logbooks: list[Page] = field(default_factory=list)
    slides: list[PurePosixPath] = field(default_factory=list)


@dataclass
class Course:
    root: Path
    general: dict
    assessment: dict | None
    genai: dict | None
    home: Page | None
    info_pages: list[Page]
    weeks: list[Week]
    exams_overview: Page | None
    exams: list[Page]
    references_overview: Page | None
    references: list[Page]
    reference_files: list[PurePosixPath]

    @property
    def title(self) -> str:
        return str(self.general.get("title", "Course"))

    def pages(self) -> list[Page]:
        result = [p for p in [self.home] if p] + list(self.info_pages)
        for w in self.weeks:
            result += [p for p in [w.overview] if p] + w.lectures
            result += [p for p in [w.assignments_overview] if p] + w.assignments + w.logbooks
        result += [p for p in [self.exams_overview] if p] + self.exams
        result += [p for p in [self.references_overview] if p] + self.references
        return result


def read_page(src: Path, rel: PurePosixPath, kind: str, week: int | None = None) -> Page:
    meta, body = split_front_matter(src.read_text(encoding="utf-8"))
    title = meta.get("title")
    if not title:
        title, body = pop_leading_h1(body)
    if not title:
        title = title_from_name(src.stem if src.stem.lower() not in ("readme", "index") else src.parent.name)
    return Page(src=src, rel=rel, kind=kind, meta=meta, body=body, title=str(title), week=week)


def _find_readme(directory: Path) -> Path | None:
    for name in README_NAMES:
        p = directory / name
        if p.is_file():
            return p
    return None


def _md_files(directory: Path, root: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(
        (p for p in directory.iterdir()
         if p.is_file() and p.suffix.lower() == ".md" and p.name not in README_NAMES
         and not p.name.startswith("_") and not is_ignored(p, root)),
        key=lambda p: natural_key(p.name),
    )


def _week_dirs(parent: Path, root: Path) -> dict[int, Path]:
    found: dict[int, Path] = {}
    if parent.is_dir():
        for d in sorted(parent.iterdir()):
            if not d.is_dir() or is_ignored(d, root):
                continue
            m = WEEK_DIR.match(d.name)
            if not m:
                if d.name.lower().startswith("week"):
                    print(f"warning: ignoring {_rel(d, root)}: week directories are named week_01, week_02, ...",
                          file=sys.stderr)
                continue
            n = int(m.group(1))
            if n in found:
                raise CourseError(f"Two directories for week {n}: {found[n].name} and {d.name}")
            found[n] = d
    return found


def _rel(path: Path, root: Path) -> PurePosixPath:
    return PurePosixPath(path.relative_to(root).as_posix())


def _qmd(rel: PurePosixPath) -> PurePosixPath:
    if rel.name in README_NAMES:
        return rel.parent / "index.qmd"
    return rel.with_suffix(".qmd")


def _load_yaml(path: Path) -> dict | None:
    if not path.is_file():
        return None
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise CourseError(f"{path} must contain a YAML mapping")
    return data


def _attach_logbooks(assignments: list[Page], root: Path, week: int) -> list[Page]:
    """Turn the files named in the assignments' `logbook` front matter into logbooks.

    A logbook is a Markdown file that students download and fill in. It is
    removed from `assignments` (it is not an assignment itself) and returned
    as a page of kind "logbook", attached to its assignment.
    """
    by_src = {p.src.resolve(): p for p in assignments if p.src is not None}
    logbooks: dict[Path, Page] = {}
    for page in list(assignments):
        refs = page.meta.get("logbook")
        if refs is None:
            continue
        for ref in refs if isinstance(refs, list) else [refs]:
            path = (page.src.parent / str(ref)).resolve()
            where = page.src.relative_to(root)
            if not path.is_file() or path.suffix.lower() != ".md":
                print(f"warning: {where}: logbook {ref} is not a Markdown file next to the assignment",
                      file=sys.stderr)
                continue
            if not path.is_relative_to(root) or is_ignored(path, root):
                print(f"warning: {where}: logbook {ref} is outside the course or in a private directory",
                      file=sys.stderr)
                continue
            if path not in logbooks:
                logbook = by_src.get(path)
                if logbook is not None and logbook is not page:
                    assignments.remove(logbook)
                else:
                    logbook = read_page(path, _qmd(_rel(path, root)), "logbook", week)
                logbook.kind = "logbook"
                logbook.assignment = page
                logbooks[path] = logbook
            page.logbooks.append(logbooks[path])
    return list(logbooks.values())


def _week_label(n: int, title: str | None) -> str:
    if not title:
        return f"Week {n}"
    if re.match(r"^week\s*\d+", title, re.I):
        return title
    return f"Week {n}: {title}"


def scan(root: Path) -> Course:
    root = root.resolve()
    general = _load_yaml(root / "info" / "general.yaml")
    if general is None:
        raise CourseError(f"{root / 'info' / 'general.yaml'} not found - is this a course repository?")
    assessment = _load_yaml(root / "info" / "assessment.yaml")
    genai = None
    if (root / "info").is_dir():
        for p in sorted((root / "info").iterdir()):
            if p.name.lower() in ("genai.yaml", "genai.yml"):
                genai = _load_yaml(p)

    home = None
    readme = _find_readme(root)
    if readme:
        home = read_page(readme, PurePosixPath("index.qmd"), "home")

    info_pages = [read_page(p, _qmd(_rel(p, root)), "info") for p in _md_files(root / "info", root)]

    lesson_weeks = _week_dirs(root / "lessons", root)
    assignment_weeks = _week_dirs(root / "assignments", root)
    slide_weeks = _week_dirs(root / "slides", root)

    weeks = []
    for n in sorted(set(lesson_weeks) | set(assignment_weeks) | set(slide_weeks)):
        week = Week(number=n, label=f"Week {n}")

        sdir = slide_weeks.get(n)
        slide_pdfs = {}
        if sdir:
            for p in sorted(sdir.iterdir(), key=lambda p: natural_key(p.name)):
                if p.is_file() and p.suffix.lower() == ".pdf" and not is_ignored(p, root):
                    slide_pdfs[p.stem] = _rel(p, root)
            week.slides = list(slide_pdfs.values())

        ldir = lesson_weeks.get(n)
        if ldir:
            r = _find_readme(ldir)
            if r:
                week.overview = read_page(r, _qmd(_rel(r, root)), "week", n)
                week.label = _week_label(n, week.overview.meta.get("title") or week.overview.title)
                week.overview.title = week.label
            for p in _md_files(ldir, root):
                page = read_page(p, _qmd(_rel(p, root)), "lecture", n)
                wanted = page.meta.get("slides", p.stem)
                if wanted is not False:
                    page.slides_expected = True
                    page.slides = slide_pdfs.get(PurePosixPath(str(wanted)).stem)
                week.lectures.append(page)

        adir = assignment_weeks.get(n)
        if adir:
            r = _find_readme(adir)
            if r:
                week.assignments_overview = read_page(r, _qmd(_rel(r, root)), "assignments", n)
                if week.assignments_overview.title == title_from_name(adir.name):
                    week.assignments_overview.title = "Assignments"
            for p in _md_files(adir, root):
                week.assignments.append(read_page(p, _qmd(_rel(p, root)), "assignment", n))
            for d in sorted(adir.iterdir(), key=lambda p: natural_key(p.name)):
                if not d.is_dir() or is_ignored(d, root):
                    continue
                r = _find_readme(d)
                if r:
                    page = read_page(r, _qmd(_rel(r, root)), "assignment", n)
                    starter = d / "starter"
                    if starter.is_dir():
                        page.starter_dir = starter
                    week.assignments.append(page)
            week.logbooks = _attach_logbooks(week.assignments, root, n)

        week.lectures.sort(key=lambda p: p.order)
        week.assignments.sort(key=lambda p: p.order)
        for p in [week.overview, week.assignments_overview, *week.lectures, *week.assignments, *week.logbooks]:
            if p:
                p.meta.setdefault("course-week", week.label)
        weeks.append(week)

    def section(name: str, kind: str):
        d = root / name
        overview = None
        r = _find_readme(d) if d.is_dir() else None
        if r:
            overview = read_page(r, _qmd(_rel(r, root)), "section")
        pages = [read_page(p, _qmd(_rel(p, root)), kind) for p in _md_files(d, root)]
        pages.sort(key=lambda p: p.order)
        return overview, pages

    exams_overview, exams = section("exams", "exam")
    references_overview, references = section("references", "reference")
    ref_dir = root / "references"
    reference_files = []
    if ref_dir.is_dir():
        reference_files = [
            _rel(p, root) for p in sorted(ref_dir.iterdir(), key=lambda p: natural_key(p.name))
            if p.is_file() and p.suffix.lower() == ".pdf" and not is_ignored(p, root)
        ]

    return Course(
        root=root, general=general, assessment=assessment, genai=genai, home=home, info_pages=info_pages,
        weeks=weeks, exams_overview=exams_overview, exams=exams,
        references_overview=references_overview, references=references,
        reference_files=reference_files,
    )
