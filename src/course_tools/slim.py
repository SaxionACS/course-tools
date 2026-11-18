"""Make a page on its own (`course standalone`) small: what it cannot use goes.

Quarto's `embed-resources` puts the website's whole CSS and JavaScript in every
file, about 1.2 MB even for a page of text: Bootstrap's CSS and the theme
(470 kB, stored URL-encoded, a third more), the Bootstrap Icons font (340 kB),
Bootstrap's JavaScript, tippy, Popper and Quarto's tab scripts. `slim` takes
out what the page cannot use:

- Scripts of features the page doesn't have: Bootstrap's (only tabs and
  collapsible callouts need it), the tab modules, tippy (hovers of footnotes,
  cross-references, citations and learning outcomes) and Popper (tippy's and
  Bootstrap's). Quarto's script after the body calls AnchorJS and ClipboardJS
  without checking for them: those stay.
- CSS rules that match nothing: a selector stays only when each class and id
  it needs is in the page, or in one of its scripts, which add classes at run
  time. Names inside parentheses (`:not(.btn)`, `:is(...)`) are not needed,
  and a name counts as found when a script builds it from a string
  (`'cw-' + kind`, `` `sl-line${n}` ``). The course's own components build
  their class names freely (`.cw-sh-tile.on.g1`, from `'g' + n`), so a page
  with widgets keeps every selector with a `cw-` class (and `sm-`, `sl-` for
  state machines and superloop blocks). Fonts and keyframes
  stay only when a remaining rule uses them; the icon font only when a rule
  for one of its icons (`.bi-cpu::before`) remains. All CSS ends up in one
  `<style>`, as text.

Standard library only: scripts/check.py tests it directly.
"""

from __future__ import annotations

import base64
import re
import urllib.parse

# Elements that matter here, in document order; comments are skipped whole.
_ELEMENT = re.compile(r"<!--.*?-->|<(script|style)\b([^>]*)>(.*?)</\1\s*>|<link\b([^>]*)>", re.S | re.I)
_IDENT = re.compile(r"-?[A-Za-z_][\w-]*")
# A string in a script that a class name is built from: 'cw-' + kind, `sl-line${n}`.
_BUILT = re.compile(r"""["'`]([A-Za-z_][\w-]{2,})(?:["'`]\s*\+|\$\{)""")
# The course's components: the class on the page, and the prefix of every class of its own.
COMPONENTS = {"course-widget": "cw-", "course-statemachine": "sm-", "course-superloop": "sl-"}
# What makes a script needed, in the page's markup.
HOVERS = ('role="doc-noteref"', "quarto-xref", 'role="doc-biblioref"', 'class="course-outcome"')
ICON_FONT = "bootstrap-icons"


def _attr(attrs: str, name: str) -> str | None:
    m = re.search(rf'\b{name}\s*=\s*"([^"]*)"', attrs, re.I) or re.search(rf"\b{name}\s*=\s*'([^']*)'", attrs, re.I)
    return m.group(1) if m else None


def _data_text(url: str) -> str:
    """The text of a data: URL (base64 or URL-encoded)."""
    meta, _, data = url.partition(",")
    if meta.endswith(";base64"):
        return base64.b64decode(data).decode("utf-8", "replace")
    return urllib.parse.unquote(data)


def _script_kind(attrs: str, body: str) -> str | None:
    """Which library a script is, for the ones that can go."""
    start = body.lstrip()[:400]
    if re.match(r"/\*!?\s*\*\s*Bootstrap v5", start):
        return "bootstrap"
    if "@popperjs/core v" in start and "MIT License" in start:
        return "popper"
    if ".tippy=t(" in start or ').tippy=' in start:
        return "tippy"
    src = _attr(attrs, "src") or ""
    if src.startswith("data:application/javascript") and "module" in (_attr(attrs, "type") or ""):
        text = _data_text(src)
        if text.startswith("// tabsets/") or "quarto-persistent-tabsets-data" in text:
            return "tabsets"
    return None


# --------------------------------------------------------------------------
# CSS
# --------------------------------------------------------------------------

def _strip_comments(css: str) -> str:
    out, i, n = [], 0, len(css)
    while i < n:
        ch = css[i]
        if ch in "\"'":
            j = i + 1
            while j < n and css[j] != ch:
                j += 2 if css[j] == "\\" else 1
            out.append(css[i:j + 1])
            i = j + 1
        elif css.startswith("/*", i):
            end = css.find("*/", i + 2)
            i = n if end < 0 else end + 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _blocks(css: str):
    """The top-level items of a style sheet: (prelude, body), body None for `@import ...;`."""
    i, n = 0, len(css)
    while i < n:
        j = i
        while j < n and css[j] not in "{;}":
            if css[j] in "\"'":
                q, j = css[j], j + 1
                while j < n and css[j] != q:
                    j += 2 if css[j] == "\\" else 1
            j += 1
        if j >= n:
            return
        prelude = css[i:j].strip()
        if css[j] in ";}":
            if prelude:
                yield prelude, None
            i = j + 1
            continue
        k, depth = j + 1, 1
        while k < n and depth:
            c = css[k]
            if c in "\"'":
                k += 1
                while k < n and css[k] != c:
                    k += 2 if css[k] == "\\" else 1
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            k += 1
        yield prelude, css[j + 1:k - 1]
        i = k


def _selectors(prelude: str) -> list[str]:
    """A selector list, split at the commas outside parentheses and brackets."""
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(prelude):
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(prelude[start:i])
            start = i + 1
    parts.append(prelude[start:])
    return [p.strip() for p in parts if p.strip()]


def _needed_names(selector: str) -> list[str]:
    """The classes and ids a selector needs: not those in brackets or parentheses."""
    s = re.sub(r"\[[^\]]*\]", "", selector)
    while True:
        t = re.sub(r"\([^()]*\)", "", s)
        if t == s:
            break
        s = t
    return [m.group(1) for m in re.finditer(r"[.#](-?[A-Za-z_][\w-]*)", s)]


class Used:
    """The names a page uses: in its markup and scripts, or built by a script from a prefix."""

    def __init__(self, text: str, scripts: str, markup: str):
        self.names = set(_IDENT.findall(text))
        self.prefixes = tuple(set(_BUILT.findall(scripts)))
        self.components = tuple(prefix for cls, prefix in COMPONENTS.items() if cls in markup)

    def __contains__(self, name: str) -> bool:
        return name in self.names or name.startswith(self.prefixes)

    def keeps(self, selector: str) -> bool:
        """Whether a selector stays: one of its classes is a component's on the page, or all its names are found."""
        names = _needed_names(selector)
        if any(n.startswith(self.components) for n in names):
            return True
        return all(n in self for n in names)


def _purge(css: str, used: Used) -> str:
    out = []
    for prelude, body in _blocks(css):
        lower = prelude.lower()
        if body is None:
            if not lower.startswith("@charset"):
                out.append(prelude + ";")
        elif lower.startswith(("@media", "@supports", "@layer", "@container", "@document")):
            inner = _purge(body, used)
            if inner:
                out.append(prelude + "{" + inner + "}")
        elif lower.startswith("@"):
            out.append(prelude + "{" + body + "}")     # @font-face, @keyframes, @page, ...: see purge_css
        else:
            keep = [s for s in _selectors(prelude) if used.keeps(s)]
            if keep:
                out.append(",".join(keep) + "{" + body.strip() + "}")
    return "".join(out)


def _font_family(body: str) -> str:
    m = re.search(r"font-family\s*:\s*([^;]+)", body)
    return m.group(1).strip().strip("\"'") if m else ""


def _unused_at_rules(css: str) -> str:
    """Leave out @font-face and @keyframes that no remaining rule uses (at any depth)."""
    rules = "".join(prelude + "{" + (body or "") + "}" for prelude, body in _blocks(css)
                    if not prelude.lower().startswith(("@font-face", "@keyframes", "@-webkit-keyframes")))
    icons = re.search(r"\.bi-[\w-]+::?before", rules)

    def keep(prelude: str, body: str | None) -> bool:
        lower = prelude.lower()
        if lower.startswith("@font-face"):
            family = _font_family(body or "")
            if family == ICON_FONT and not icons:
                return False
            return bool(family) and family in rules
        if lower.startswith(("@keyframes", "@-webkit-keyframes")):
            return prelude.split(None, 1)[-1].strip() in rules
        return True

    out = []
    for prelude, body in _blocks(css):
        if body is not None and prelude.lower().startswith(("@media", "@supports", "@layer", "@container")):
            inner = _unused_at_rules(body)
            if inner:
                out.append(prelude + "{" + inner + "}")
        elif keep(prelude, body):
            out.append(prelude + (";" if body is None else "{" + body + "}"))
    return "".join(out)


def purge_css(css: str, used: Used) -> str:
    """The rules of `css` that the page can use."""
    return _unused_at_rules(_purge(_strip_comments(css), used))


# --------------------------------------------------------------------------
# The page
# --------------------------------------------------------------------------

def slim(html: str) -> str:
    head_end = html.find("</head>")
    elements = []          # (start, end, kind, text): kind is a script's library, "css" or None
    for m in _ELEMENT.finditer(html):
        tag, attrs, body, link_attrs = m.group(1), m.group(2) or "", m.group(3) or "", m.group(4)
        if tag and tag.lower() == "script":
            elements.append((m.start(), m.end(), "script", _script_kind(attrs, body), body))
        elif tag and tag.lower() == "style" and m.start() < head_end:
            elements.append((m.start(), m.end(), "css", None, body))
        elif link_attrs is not None and m.start() < head_end:
            href = _attr(link_attrs, "href") or ""
            if href.startswith("data:text/css") and "stylesheet" in (_attr(link_attrs, "rel") or ""):
                elements.append((m.start(), m.end(), "css", None, _data_text(href)))

    # The markup: the page without scripts and styles, to look for what needs a script.
    markup, last = [], 0
    for start, end, *_ in elements:
        markup.append(html[last:start])
        last = end
    markup = "".join(markup) + html[last:]
    bootstrap = "data-bs-toggle" in markup
    hovers = any(h in markup for h in HOVERS)
    needed = {"bootstrap": bootstrap, "tabsets": "panel-tabset" in markup, "tippy": hovers,
              "popper": hovers or bootstrap}
    gone = [e for e in elements if e[2] == "script" and e[3] is not None and not needed[e[3]]]
    css = [e for e in elements if e[2] == "css"]

    # What the CSS can match: the page without its style sheets and the scripts that go.
    skip = sorted(gone + css)
    text, last = [], 0
    for start, end, *_ in skip:
        text.append(html[last:start])
        last = end
    text = "".join(text) + html[last:]
    scripts = "".join(e[4] for e in elements if e[2] == "script" and e not in gone)
    style = purge_css("\n".join(e[4] for e in css), Used(text, scripts, markup))

    out, last = [], 0
    for start, end, kind, *_ in sorted(gone + css):
        out.append(html[last:start])
        if css and start == css[0][0]:
            out.append("<style>\n" + style.replace("</style", "<\\/style") + "\n</style>")
        last = end
    return "".join(out) + html[last:]
