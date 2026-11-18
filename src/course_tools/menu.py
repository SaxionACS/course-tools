"""A menu in the terminal, for `course standalone`: arrow keys, Enter, q.

`Menu` holds the state and answers keys; it needs no terminal, so the tests
drive it with key names. `run` shows it in the terminal's alternate screen and
reads the keys: with termios on Linux and macOS, with msvcrt on Windows.
Standard library only.
"""

from __future__ import annotations

import contextlib
import os
import shutil
import sys
from dataclasses import dataclass, field

UP, DOWN, LEFT, RIGHT, ENTER, ESC, QUIT = "up", "down", "left", "right", "enter", "esc", "quit"
HELP = "Up/Down: move   Enter: open or export   Left or Esc: back   q: quit"

REVERSE, DIM, RESET = "\x1b[7m", "\x1b[2m", "\x1b[0m"


@dataclass
class Entry:
    text: str
    rel: str | None = None          # what it opens: a page (.qmd) or a file, as a stage path
    children: list["Entry"] = field(default_factory=list)   # a section: its entries
    reason: str | None = None       # why it can't be chosen (shown when it is)


class Menu:
    """Entries in levels: Right or Enter opens a section, Left or Esc goes back.

    `press` returns the entry chosen with Enter, QUIT, or None to go on.
    """

    def __init__(self, title: str, entries: list[Entry]):
        self.title = title
        self.entries = entries
        self.cursor = 0
        self.above: list[tuple[list[Entry], int, str]] = []   # the levels above: entries, cursor, name
        self.message = ""

    def press(self, key: str | None):
        self.message = ""
        if key == UP:
            self.cursor = max(self.cursor - 1, 0)
        elif key == DOWN:
            self.cursor = min(self.cursor + 1, len(self.entries) - 1)
        elif key in (RIGHT, ENTER):
            entry = self.entries[self.cursor]
            if entry.children:
                self.above.append((self.entries, self.cursor, entry.text))
                self.entries, self.cursor = entry.children, 0
            elif key == ENTER:
                if entry.reason is None:
                    return entry
                self.message = f"{entry.text} can't be exported: {entry.reason}."
        elif key in (LEFT, ESC):
            if self.above:
                self.entries, self.cursor, _ = self.above.pop()
            elif key == ESC:
                return QUIT
        elif key == QUIT:
            return QUIT
        return None

    def lines(self, width: int, height: int) -> list[str]:
        """The screen: title, keys, where we are, the entries (scrolled to the cursor), a message."""
        def fit(text: str) -> str:
            return text if len(text) <= width else text[:max(width - 3, 0)] + "..."

        place = " > ".join(name for _, _, name in self.above) or "Pages"
        out = [fit(self.title), DIM + fit(HELP) + RESET, "", fit(place)]
        rows = max(height - len(out) - 3, 3)
        start = 0
        if len(self.entries) > rows:
            start = min(max(self.cursor - rows // 2, 0), len(self.entries) - rows)
        for i, entry in enumerate(self.entries[start:start + rows], start):
            text = "  " + entry.text + (" >" if entry.children else "")
            if entry.reason is not None:
                text += " (can't be exported)"
            text = fit(text)
            if i == self.cursor:
                text = REVERSE + text + RESET
            elif entry.reason is not None:
                text = DIM + text + RESET
            out.append(text)
        if start + rows < len(self.entries):
            out.append(DIM + "  (more below)" + RESET)
        out += ["", fit(self.message)]
        return out


def run(menu: Menu) -> Entry | None:
    """Show the menu until an entry is chosen (returned) or it is left (None)."""
    if sys.platform == "win32":
        _windows_vt()
    out = sys.stdout
    out.write("\x1b[?1049h\x1b[?25l")    # alternate screen, no cursor
    try:
        with _keys() as read:
            while True:
                size = shutil.get_terminal_size()
                out.write("\x1b[H\x1b[2J" + "\n".join(menu.lines(size.columns, size.lines)))
                out.flush()
                result = menu.press(read())
                if result == QUIT:
                    return None
                if result is not None:
                    return result
    finally:
        out.write("\x1b[?25h\x1b[?1049l")
        out.flush()


def _windows_vt() -> None:
    """Let the Windows console understand the escape sequences (Windows 10 and later)."""
    import ctypes
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.GetStdHandle(-11)     # standard output
    mode = ctypes.c_uint32()
    if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
        kernel32.SetConsoleMode(handle, mode.value | 0x0004)    # ENABLE_VIRTUAL_TERMINAL_PROCESSING


@contextlib.contextmanager
def _keys():
    """A function that waits for a key and returns its name (None for other keys)."""
    if sys.platform == "win32":
        import msvcrt

        def read_windows():
            ch = msvcrt.getwch()
            if ch in ("\x00", "\xe0"):      # arrows: a prefix, then the key
                return {"H": UP, "P": DOWN, "K": LEFT, "M": RIGHT}.get(msvcrt.getwch())
            if ch == "\x03":
                raise KeyboardInterrupt
            return {"\r": ENTER, "\n": ENTER, "\x1b": ESC, "\x08": LEFT, "q": QUIT, "Q": QUIT}.get(ch)
        yield read_windows
        return

    import select
    import termios
    import tty
    fd = sys.stdin.fileno()
    saved = termios.tcgetattr(fd)
    tty.setcbreak(fd)       # keys one at a time, not echoed; Ctrl+C still stops

    def read_posix():
        ch = os.read(fd, 1)
        if ch != b"\x1b":
            return {b"\r": ENTER, b"\n": ENTER, b"\x7f": LEFT, b"\x08": LEFT,
                    b"q": QUIT, b"Q": QUIT, b"\x04": QUIT}.get(ch)
        # An arrow sends Esc [ A (or Esc O A) at once; Esc alone sends nothing more.
        if not select.select([fd], [], [], 0.05)[0]:
            return ESC
        if os.read(fd, 1) not in (b"[", b"O"):
            return None
        seq = b""
        while len(seq) < 8:
            seq += os.read(fd, 1)
            if seq[-1:].isalpha() or seq[-1:] == b"~":
                break
        return {b"A": UP, b"B": DOWN, b"C": RIGHT, b"D": LEFT}.get(seq[-1:])
    try:
        yield read_posix
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, saved)
