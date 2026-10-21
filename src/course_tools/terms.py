"""Key terms: definition lists in ``::: {.terms}`` blocks of the pages.

From all pages, the stager generates the course glossary
(``glossary/index.qmd``) and a review page (``glossary/review.qmd``). In the
browser, theme/terms.html reads the glossary to show a term's definition where
it is first used on a page, and runs the review deck.

A key-terms block in a page::

    ::: {.terms}
    volatile
    : A qualifier that tells the compiler that a variable can change outside
      the normal program flow.

    [ISR]{aliases="interrupt service routine|interrupt handler"}
    : A function that the hardware calls when an interrupt occurs.
    :::

Definitions are copied into the glossary as Markdown, so they look the same
there; relative links in them are adjusted to the glossary's location.
"""

from __future__ import annotations

import posixpath
import re
import sys
from dataclasses import dataclass, field

GLOSSARY = "glossary/index.qmd"
REVIEW = "glossary/review.qmd"

_DIV_OPEN = re.compile(r"^\s{0,3}(:{3,})\s*(\{[^}]*\}|[\w-]+)\s*:*\s*$")
_DIV_CLOSE = re.compile(r"^\s{0,3}:{3,}\s*$")
_CODE_FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
_DEF_START = re.compile(r"^[:~](?: {1,3}|\t)")
_SPAN = re.compile(r"^\[(?P<text>.+)\]\{(?P<attrs>[^}]*)\}$")
_ALIASES = re.compile(r"""aliases\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))""")
_LINK = re.compile(r"(!?\[[^\]]*\]\()([^)\s]+)((?:\s+\"[^\"]*\")?\))")


def _warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


@dataclass
class Term:
    name: str                       # plain text, e.g. "ISR"
    markdown: str                   # as written, e.g. "`volatile`"
    definition: str                 # Markdown, links relative to the page
    aliases: list[str] = field(default_factory=list)
    id: str = ""                    # HTML id: term-<slug>
    page: str = ""                  # stage path of the page, e.g. lessons/week_01/lesson1.qmd
    source: str = ""                # source file, e.g. lessons/week_01/lesson1.md
    page_title: str = ""
    week: int | None = None
    week_label: str = ""


def slug(name: str) -> str:
    """The id of a term; filters/terms.lua makes the same from the text."""
    return "term-" + (re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "x")


def _is_blank(line: str) -> bool:
    return not line.strip()


def _dedent(line: str) -> str:
    if line.startswith("\t"):
        return line[1:]
    return line[min(4, len(line) - len(line.lstrip(" "))):]


def blocks(body: str) -> list[list[str]]:
    """The lines inside each `::: {.terms}` block (fenced code is skipped)."""
    found, current, depth, fence = [], None, 0, None
    for line in body.splitlines():
        code = _CODE_FENCE.match(line)
        if fence:
            if code and code.group(1)[0] == fence[0] and len(code.group(1)) >= len(fence) \
                    and not line.strip()[len(code.group(1)):].strip():
                fence = None
            if current is not None:
                current.append(line)
            continue
        if code:
            fence = code.group(1)
            if current is not None:
                current.append(line)
            continue
        opening = _DIV_OPEN.match(line)
        if opening:
            attrs = opening.group(2)
            if current is None and re.search(r"(^|[\s{])\.?terms($|[\s}])", attrs):
                current, depth = [], 1
                continue
            if current is not None:
                depth += 1
        elif _DIV_CLOSE.match(line) and current is not None:
            depth -= 1
            if depth == 0:
                found.append(current)
                current = None
                continue
        if current is not None:
            current.append(line)
    return found


def definitions(lines: list[str]) -> list[tuple[str, str]]:
    """(term line, definition Markdown) pairs of a definition list."""
    entries, i, n = [], 0, len(lines)

    def next_content(k: int) -> int:
        while k < n and _is_blank(lines[k]):
            k += 1
        return k

    while i < n:
        line = lines[i]
        j = next_content(i + 1)
        if _is_blank(line) or line[0] in " \t:~" or j >= n or j - i > 2 or not _DEF_START.match(lines[j]):
            i += 1
            continue
        term, i, parts = line.strip(), j, []
        while i < n and _DEF_START.match(lines[i]):
            text = [_DEF_START.sub("", lines[i], count=1).strip()]
            i += 1
            while i < n:
                current = lines[i]
                if _is_blank(current):
                    k = next_content(i)
                    if k < n and lines[k].startswith(("    ", "\t")):
                        text += [""] * (k - i)
                        i = k
                        continue
                    break
                if _DEF_START.match(current):
                    break
                if current[0] in " \t":
                    text.append(_dedent(current).rstrip())
                else:
                    k = next_content(i + 1)
                    if k < n and k - i <= 2 and _DEF_START.match(lines[k]):
                        break           # the next term
                    text.append(current.rstrip())   # lazy continuation
                i += 1
            parts.append("\n".join(text).strip())
            k = next_content(i)
            if k < n and _DEF_START.match(lines[k]):
                i = k
            else:
                break
        entries.append((term, "\n\n".join(p for p in parts if p)))
    return entries


def _term(line: str) -> tuple[str, str, list[str]]:
    """(plain name, Markdown as written, aliases) of a term line."""
    markdown, aliases = line, []
    span = _SPAN.match(line)
    if span:
        markdown = span.group("text")
        found = _ALIASES.search(span.group("attrs"))
        if found:
            aliases = [a.strip() for a in next(g for g in found.groups() if g is not None).split("|") if a.strip()]
    name = re.sub(r"[`*]", "", markdown).strip()
    return name, markdown, aliases


def collect(pages) -> list[Term]:
    """The key terms of all pages, in course order; the first of duplicates wins."""
    terms: list[Term] = []
    seen: dict[str, Term] = {}
    ids: set[str] = set()
    for page, where in pages:
        for block in blocks(page.body):
            entries = definitions(block)
            if not entries:
                _warn(f"{where}: a ::: {{.terms}} block without terms (write `term` and `: definition` lines)")
            for line, definition in entries:
                name, markdown, aliases = _term(line)
                key = name.lower()
                if key in seen:
                    _warn(f"{where}: key term `{name}` is already defined in {seen[key].source}; "
                          "the glossary uses that definition")
                    continue
                term_id = slug(name)
                while term_id in ids:
                    term_id += "-2"
                ids.add(term_id)
                term = Term(name=name, markdown=markdown, definition=definition, aliases=aliases, id=term_id,
                            page=str(page.rel), source=str(where), page_title=page.title, week=page.week,
                            week_label=page.meta.get("course-week", f"Week {page.week}") if page.week else "")
                seen[key] = term
                terms.append(term)
    return terms


def page_ids(terms: list[Term], page: str) -> list[str]:
    """Ids of the terms that a page defines, in order (for filters/terms.lua)."""
    return [t.id for t in terms if t.page == page]


def _rebase(markdown: str, from_page: str, to_page: str) -> str:
    """Relative link and image targets, from one page's directory to another's."""
    src, dst = posixpath.dirname(from_page), posixpath.dirname(to_page)

    def fix(m: re.Match) -> str:
        target = m.group(2)
        if re.match(r"^([a-z][\w+.-]*:|#|/)", target, re.I):
            return m.group(0)
        path, _, frag = target.partition("#")
        new = posixpath.relpath(posixpath.normpath(posixpath.join(src, path)), dst or ".")
        return m.group(1) + new + ("#" + frag if frag else "") + m.group(3)

    return _LINK.sub(fix, markdown)


def _attr(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def glossary_page(terms: list[Term]) -> str:
    """Markdown of the glossary: all terms from A to Z."""
    out = ["---", "title: Glossary", "---", "",
           "The key terms of this course, from A to Z. On the other pages, the first time a term is "
           "used it is underlined: point at it, or tap it, to see its definition. To practise them, "
           f"use [Review key terms]({posixpath.relpath(REVIEW, posixpath.dirname(GLOSSARY))}).", "",
           "::: {.course-glossary}"]
    letter = None
    for t in sorted(terms, key=lambda t: t.name.lower()):
        first = t.name[:1].upper()
        heading = first if first.isalpha() else "#"
        if heading != letter:
            letter = heading
            out += ["", f"## {heading}", ""]
        attrs = [f"#{t.id}", ".course-term"]
        if t.aliases:
            attrs.append(f'aliases="{_attr("|".join(t.aliases))}"')
        if t.week:
            attrs.append(f'week="{t.week}"')
        source = posixpath.relpath(t.page, posixpath.dirname(GLOSSARY))
        where = f"{t.page_title} ({t.week_label})" if t.week_label else t.page_title
        definition = _rebase(t.definition, t.page, GLOSSARY).splitlines() or [""]
        # A blank line after the term: paragraphs stay paragraphs ("loose" list).
        out += [f"[{t.markdown}]{{{' '.join(attrs)}}}", ""]
        out.append(f":   {definition[0]}")
        out += [f"    {line}" if line else "" for line in definition[1:]]
        out += ["", f"    [Introduced in [{where}]({source}#{t.id})]{{.course-term-source}}", ""]
    out += [":::", ""]
    return "\n".join(out)


def review_page() -> str:
    return "\n".join([
        "---", "title: Review key terms", "---", "",
        "Short reviews spread over days help you remember more than one long session. This deck holds "
        f"the key terms of the [glossary]({posixpath.relpath(GLOSSARY, posixpath.dirname(REVIEW))}). "
        "Every day it shows the cards that are due. A card you know comes back after 1, 3, 7, 16 and then "
        "35 days; a card you don't know comes back the same day. Choose the weeks you have done so far.", "",
        "Your progress is saved in this browser only.", "",
        "::: {.course-review}",
        "The review deck needs JavaScript.",
        ":::", "",
    ])
