"""Turn a course repository into a Quarto website project (the "stage").

The stage is a generated directory (``.build/`` by default). It contains the
course pages converted to ``.qmd``, generated pages (course information,
assessment), starter-file zips, the theme/filters from this package, and a
generated ``_quarto.yml``. Only files that changed are rewritten, so that
``quarto preview`` re-renders just what was edited.
"""

from __future__ import annotations

import io
import json
import os
import posixpath
import shutil
import stat
import sys
import zipfile
from dataclasses import dataclass
from importlib import resources
from pathlib import Path, PurePosixPath

import yaml

from . import genai, info
from .course import Course, Page, Week, is_ignored
from .markdown import join_front_matter, natural_key, rewrite_fences, split_front_matter

ASSETS_DIR = "_course"            # theme, filters and Typst includes inside the stage
MANIFEST = ".course-stage.json"   # files written by the stager (for cleanup)
COPIED_DIRS = ("info", "lessons", "assignments", "exams", "references", "assets", "images")
ROOT_FILE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".pdf"}
ZIP_SKIP = {".git", ".DS_Store", "__pycache__", ".idea", ".vscode", "private"}


@dataclass
class Options:
    site_url: str | None = None
    pdf: bool = True                  # also render a PDF of every page
    plantuml: list[str] | None = None  # command used to run PlantUML


# --------------------------------------------------------------------------
# Desired stage content
# --------------------------------------------------------------------------

def _rel_link(from_page: PurePosixPath, target: PurePosixPath) -> str:
    return posixpath.relpath(str(target), str(from_page.parent))


def _zip_bytes(directory: Path, top: str) -> bytes:
    """Zip a directory deterministically (stable bytes for unchanged input)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirnames, filenames in os.walk(directory):
            dirnames[:] = sorted(d for d in dirnames if d not in ZIP_SKIP)
            for name in sorted(filenames):
                if name in ZIP_SKIP or name.endswith(".pyc"):
                    continue
                path = Path(dirpath) / name
                arcname = f"{top}/{path.relative_to(directory).as_posix()}"
                zi = zipfile.ZipInfo(arcname, date_time=(1980, 1, 1, 0, 0, 0))
                zi.external_attr = (stat.S_IMODE(path.stat().st_mode) | stat.S_IFREG) << 16
                zi.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(zi, path.read_bytes())
    return buf.getvalue()


def _page_meta(page: Page, course: Course, extra: dict) -> dict:
    meta = dict(page.meta)
    for key in ("slides", "order", "genai"):
        meta.pop(key, None)
    meta["title"] = page.title
    meta["engine"] = "markdown"   # never execute code; diagrams still work
    course_page = {"kind": page.kind, "dir": str(page.rel.parent) if str(page.rel.parent) != "." else ""}
    if page.week is not None:
        course_page["week"] = meta.pop("course-week", f"Week {page.week}")
    course_page.update(extra)
    meta["course-page"] = course_page
    return meta


def _week_materials(week: Week, page: Page) -> str:
    """Markdown list of a week's materials, appended to the week overview."""
    lines = []
    for p in week.lectures:
        lines.append(f"- [{p.title}]({_rel_link(page.rel, p.rel)})")
    if week.assignments_overview:
        lines.append(f"- [{week.assignments_overview.title}]({_rel_link(page.rel, week.assignments_overview.rel)})")
    for p in week.assignments:
        lines.append(f"- [{p.title}]({_rel_link(page.rel, p.rel)})")
    if not lines:
        return ""
    return "\n\n## This week\n\n" + "\n".join(lines) + "\n"


def desired_files(course: Course, opts: Options) -> dict[str, bytes | Path]:
    """Map of stage-relative path -> content (bytes) or source file to copy."""
    files: dict[str, bytes | Path] = {}
    root = course.root

    # 1. Plain files (images, data, ...) from the content directories.
    for d in COPIED_DIRS:
        base = root / d
        if not base.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [n for n in dirnames if n not in ("private",) and not n.startswith(".")]
            for name in filenames:
                p = Path(dirpath) / name
                if name.startswith(".") or is_ignored(p, root):
                    continue
                files[p.relative_to(root).as_posix()] = p
    for p in root.iterdir():
        if p.is_file() and p.suffix.lower() in ROOT_FILE_EXTS:
            files[p.name] = p
    # Slides: only the exported PDFs are published.
    for week in course.weeks:
        for s in week.slides:
            files[str(s)] = root / s
    for f in course.reference_files:
        files[str(f)] = root / f

    # 2. Pages (Markdown sources replaced by their .qmd version).
    genai_level = genai.level(course.genai) if course.genai is not None else None
    if course.genai is None:
        print("warning: no info/genAI.yaml: the course has no generative-AI policy "
              "(Saxion's default applies: allowed, with citation)", file=sys.stderr)
    for page in course.pages():
        if page.src is not None:
            files.pop(page.src.relative_to(root).as_posix(), None)
        extra: dict = {}
        if page.kind == "lecture" and page.slides_expected:
            extra["slides"] = _rel_link(page.rel, page.slides) if page.slides else False
        if page.starter_dir is not None:
            week_dir = page.starter_dir.parent.parent.name
            zip_name = f"{week_dir}-{page.starter_dir.parent.name}.zip"
            zip_rel = page.rel.parent / zip_name
            files[str(zip_rel)] = _zip_bytes(page.starter_dir, zip_name[:-4])
            extra["starter"] = zip_name
        if page.kind == "assignment":
            rule = genai.assignment_rule(genai_level, page.meta.get("genai"), str(page.src.relative_to(root)))
            if rule is not None:
                extra["genai"] = {**rule, "policy": _rel_link(page.rel, PurePosixPath("info/genai.qmd"))}
        body = rewrite_fences(page.body)
        if page.kind == "week" and page.meta.get("materials", True) is not False:
            week = next(w for w in course.weeks if w.overview is page)
            body = body.rstrip() + "\n" + _week_materials(week, page)
        meta = _page_meta(page, course, extra)
        meta.pop("materials", None)
        files[str(page.rel)] = join_front_matter(meta, body).encode("utf-8")

    # 3. Generated pages.
    generated = generated_pages(course)
    if "index.qmd" in generated:
        files["index.qmd"] = info.default_home(course.general).encode("utf-8")
    files["info/index.qmd"] = _generated(
        info.general_page(course.general, "info/assessment.qmd" in generated, "info/genai.qmd" in generated), "info")
    if "info/assessment.qmd" in generated:
        files["info/assessment.qmd"] = _generated(info.assessment_page(course.assessment, course.general), "info")
    if "info/genai.qmd" in generated:
        files["info/genai.qmd"] = _generated(genai.policy_page(course.genai, genai_level), "info")

    # 4. Theme, filters, extensions.
    assets = resources.files("course_tools") / "assets"
    for rel, data in _walk_resources(assets):
        if rel.startswith("texts/"):   # used by the stager itself
            continue
        target = rel if rel.startswith("_extensions/") else f"{ASSETS_DIR}/{rel}"
        files[target] = data

    # 5. Project configuration.
    files["_quarto.yml"] = yaml.safe_dump(
        quarto_config(course, opts), sort_keys=False, allow_unicode=True, width=1000
    ).encode("utf-8")
    return files


def generated_pages(course: Course) -> list[str]:
    """Pages generated from the YAML files (stage paths)."""
    pages = ["info/index.qmd"]
    if course.home is None:
        pages.append("index.qmd")
    if course.assessment is not None:
        pages.append("info/assessment.qmd")
    if course.genai is not None:
        pages.append("info/genai.qmd")
    return pages


def _generated(text: str, directory: str) -> bytes:
    meta, body = split_front_matter(text)
    meta["engine"] = "markdown"
    meta["course-page"] = {"kind": "info", "dir": directory}
    return join_front_matter(meta, body).encode("utf-8")


def _walk_resources(base, prefix=""):
    for entry in base.iterdir():
        rel = f"{prefix}{entry.name}"
        if entry.is_dir():
            yield from _walk_resources(entry, rel + "/")
        else:
            yield rel, entry.read_bytes()


# --------------------------------------------------------------------------
# _quarto.yml
# --------------------------------------------------------------------------

def _nav_item(page: Page, text: str | None = None):
    return {"href": str(page.rel), "text": text or page.title}


def sidebar(course: Course) -> list:
    contents: list = [{"href": "index.qmd", "text": "Home"}]

    info_section = {"section": "Course information", "href": "info/index.qmd", "contents": []}
    generated = generated_pages(course)
    if "info/assessment.qmd" in generated:
        info_section["contents"].append({"href": "info/assessment.qmd", "text": "Assessment"})
    if "info/genai.qmd" in generated:
        info_section["contents"].append({"href": "info/genai.qmd", "text": "Generative AI"})
    info_section["contents"] += [_nav_item(p) for p in course.info_pages]
    contents.append(info_section)

    for week in course.weeks:
        items = [_nav_item(p) for p in week.lectures]
        if week.assignments_overview:
            items.append(_nav_item(week.assignments_overview))
        items += [_nav_item(p) for p in week.assignments]
        section = {"section": week.label, "contents": items}
        if week.overview:
            section["href"] = str(week.overview.rel)
        contents.append(section)

    def add_section(name, overview, pages, files=()):
        if not (overview or pages or files):
            return
        section = {"section": name, "contents": [_nav_item(p) for p in pages]}
        section["contents"] += [{"href": str(f), "text": f.stem.replace("_", " ")} for f in files]
        if overview:
            section["href"] = str(overview.rel)
        contents.append(section)

    add_section("Exams", course.exams_overview, course.exams)
    add_section("References", course.references_overview, course.references, course.reference_files)
    return contents


def quarto_config(course: Course, opts: Options) -> dict:
    general = course.general
    year = general.get("academic_year")
    footer_left = course.title + (f" · {year}" if year else "")
    website = {
        "title": course.title,
        "search": True,
        "page-navigation": True,
        "sidebar": {"style": "docked", "search": True, "collapse-level": 1, "contents": sidebar(course)},
        "page-footer": {"left": footer_left, "right": "Saxion University of Applied Sciences"},
    }
    if opts.site_url:
        website["site-url"] = opts.site_url

    formats = {
        "html": {
            "theme": ["cosmo", f"{ASSETS_DIR}/theme/saxion.scss"],
            "include-in-header": [f"{ASSETS_DIR}/theme/head.html"],
            "toc": True,
            "toc-depth": 3,
            "code-copy": True,
            "link-external-newwindow": True,
            "format-links": False,
            "mermaid": {"theme": "neutral"},
        }
    }
    if opts.pdf:
        formats["typst"] = {
            "papersize": "a4",
            "mainfont": "Lato",
            "fontsize": "10.5pt",
            "margin": {"x": "2.2cm", "y": "2.5cm"},
            "include-in-header": [f"{ASSETS_DIR}/typst/header.typ"],
            "mermaid-format": "png",
        }

    resources_globs = ["assignments/**/*.zip", "slides/**/*.pdf", "references/**/*.pdf"]
    pages = sorted((str(p.rel) for p in course.pages()), key=natural_key)
    pages += [p for p in generated_pages(course) if p not in pages]

    engines = {name: False for name in ("asymptote", "cetz", "d2", "dot", "mermaid", "tikz")}
    engines["plantuml"] = {"execpath": opts.plantuml} if opts.plantuml else True

    return {
        "project": {
            "type": "website",
            "output-dir": "_site",
            "render": pages,
            "resources": resources_globs,
        },
        "website": website,
        "lang": general.get("lang", "en"),
        "format": formats,
        "filters": [f"{ASSETS_DIR}/filters/course.lua", "diagram", f"{ASSETS_DIR}/filters/inline-mediabag.lua"],
        "diagram": {"engine": engines},
        "course-site": {
            "title": course.title,
            "pdf": opts.pdf,
            "url": (opts.site_url or "").rstrip("/"),
        },
    }


# --------------------------------------------------------------------------
# Writing the stage
# --------------------------------------------------------------------------

def sync(stage: Path, files: dict[str, bytes | Path]) -> list[str]:
    """Make ``stage`` contain exactly ``files`` (plus Quarto's own output).

    Returns the list of paths that were written or removed.
    """
    stage.mkdir(parents=True, exist_ok=True)
    changed = []
    manifest_path = stage / MANIFEST
    previous = set()
    if manifest_path.is_file():
        previous = set(json.loads(manifest_path.read_text()))

    for rel, content in files.items():
        target = stage / rel
        if isinstance(content, Path):
            st = content.stat()
            if target.is_file():
                tst = target.stat()
                if tst.st_size == st.st_size and int(tst.st_mtime) == int(st.st_mtime):
                    continue
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(content, target)
        else:
            if target.is_file() and target.read_bytes() == content:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        changed.append(rel)

    for rel in sorted(previous - set(files)):
        target = stage / rel
        if target.is_file():
            target.unlink()
            changed.append(rel)
    manifest_path.write_text(json.dumps(sorted(files)))
    return changed
