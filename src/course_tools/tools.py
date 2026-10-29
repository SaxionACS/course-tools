"""The programs course-tools runs, in a per-user folder: Quarto, PlantUML, Chrome Headless Shell
and, on Windows, Graphviz.

`course setup` downloads the pinned versions below, checks them against their
SHA-256 and unpacks them into `home()`. `course build` and `course preview` use
only these copies (not a Quarto or PlantUML on PATH), so that every machine and
CI build with the same versions; QUARTO_PATH and PLANTUML_JAR override them.
Java comes from the jdk4py package (a dependency of course-tools) and, except
on Windows, Graphviz from the system (apt, Homebrew).
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import shutil
import ssl
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

# Pinned versions. A new version needs the SHA-256 of each of its downloads in SHA256.
QUARTO = "1.10.18"
PLANTUML = "1.2026.8"
CHROME = "156.0.8078.73"   # Chrome Headless Shell, from Chrome for Testing
GRAPHVIZ = "16.1.0"        # Windows only; elsewhere from apt or Homebrew

SHA256 = {
    # https://github.com/quarto-dev/quarto-cli/releases/download/v1.10.18/quarto-1.10.18-checksums.txt
    "quarto-1.10.18-linux-amd64.tar.gz": "afad071b5bd22c02f2d300695743189d3650e0537a53073e654b630cff2b0c73",
    "quarto-1.10.18-linux-arm64.tar.gz": "f6a07df68e25330b5df34f65d3df66bca605acce3b830c593a58e91884d4cf6c",
    "quarto-1.10.18-macos.tar.gz": "ddd6a71a9e0448ab15fb655bc589e11cb6589a248ec35ccd7f7f44137531688e",
    "quarto-1.10.18-win.zip": "4e824652ff0da3f646868277582ed59c0872d1456e35350b7d7cdc4243ee18c2",
    # the digest GitHub shows for the release asset
    "plantuml-1.2026.8.jar": "5e1ecfa8ecd32c90b03bbf3b1eb6f020943f98ab0fcf4032be31a0002ee2c462",
    # computed from the downloads (Chrome for Testing publishes no checksums)
    "chrome-headless-shell-156.0.8078.73-linux64.zip": "77eb8d52798efc7a857ab61abcc62a456d8ea9635b02341d06dffee2761768c8",
    "chrome-headless-shell-156.0.8078.73-linux-arm64.zip": "98c084708f0f1fa4ed589ad601cc79b437f0cebe60ffc9794af78a085c01a2a7",
    "chrome-headless-shell-156.0.8078.73-mac-arm64.zip": "512c7d34cd5b65d617a39a48915b490eed4208a63e9d47b0fd7893e83be85765",
    "chrome-headless-shell-156.0.8078.73-mac-x64.zip": "be798095cd693357a7a6a0e7a0c4ebd81563e16f51225eb98aacc906d6326519",
    "chrome-headless-shell-156.0.8078.73-win64.zip": "e6d26810df71efd0a3dfd0f7246d75d279ebdf8a8ec153d1ac44069657298628",
    # https://gitlab.com/graphviz/graphviz/-/releases (the .sha256 next to the zip)
    "graphviz-16.1.0-win64.zip": "733e49626c492242eb8dca30ea627b6ead20710e207998c7933b4909d92d6abc",
}

PLATFORMS = ("linux-x64", "linux-arm64", "macos-x64", "macos-arm64", "windows-x64")

STATE = "tools.json"


class ToolError(Exception):
    """A tool is missing or has the wrong version; the message says what to do."""


def current_platform() -> str:
    """One of PLATFORMS (or another name, which course setup reports as unsupported)."""
    machine = platform.machine().lower()
    arch = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(machine, machine)
    system = {"linux": "linux", "darwin": "macos", "win32": "windows"}.get(sys.platform, sys.platform)
    return f"{system}-{arch}"


def home() -> Path:
    """The per-user folder with the tools ($COURSE_TOOLS_HOME overrides it)."""
    if os.environ.get("COURSE_TOOLS_HOME"):
        return Path(os.environ["COURSE_TOOLS_HOME"])
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / "course-tools"


# --------------------------------------------------------------------------
# The tools
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Tool:
    key: str        # folder and key in tools.json
    label: str
    pinned: str
    option: str | None = None   # `course setup` option for another version
    platforms: tuple[str, ...] = PLATFORMS

    def download(self, version: str, plat: str) -> tuple[str, str]:
        """(URL, file name) of the download; the file name is the key in SHA256."""
        if self.key == "quarto":
            suffix = {"linux-x64": "linux-amd64.tar.gz", "linux-arm64": "linux-arm64.tar.gz",
                      "windows-x64": "win.zip"}.get(plat, "macos.tar.gz")
            name = f"quarto-{version}-{suffix}"
            return f"https://github.com/quarto-dev/quarto-cli/releases/download/v{version}/{name}", name
        if self.key == "plantuml":
            name = f"plantuml-{version}.jar"
            return f"https://github.com/plantuml/plantuml/releases/download/v{version}/{name}", name
        if self.key == "graphviz":
            return (f"https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/{version}/"
                    f"windows_10_cmake_Release_Graphviz-{version}-win64.zip", f"graphviz-{version}-win64.zip")
        cft = _chrome_platform(plat)
        return (f"https://storage.googleapis.com/chrome-for-testing-public/{version}/{cft}/"
                f"chrome-headless-shell-{cft}.zip", f"chrome-headless-shell-{version}-{cft}.zip")

    def program(self, folder: Path) -> Path:
        """The file to run in an unpacked version folder."""
        windows = sys.platform == "win32"
        if self.key == "quarto":
            return folder / "bin" / ("quarto.exe" if windows else "quarto")
        if self.key == "plantuml":
            return folder / "plantuml.jar"
        if self.key == "graphviz":
            return folder / "bin" / "dot.exe"
        return folder / ("chrome-headless-shell.exe" if windows else "chrome-headless-shell")


def _chrome_platform(plat: str) -> str:
    return {"linux-x64": "linux64", "linux-arm64": "linux-arm64", "macos-x64": "mac-x64",
            "macos-arm64": "mac-arm64", "windows-x64": "win64"}[plat]


TOOLS = (
    Tool("quarto", "Quarto", QUARTO, "quarto"),
    Tool("plantuml", "PlantUML", PLANTUML, "plantuml"),
    Tool("chrome", "Chrome Headless Shell", CHROME),
    Tool("graphviz", "Graphviz", GRAPHVIZ, platforms=("windows-x64",)),
)
BY_KEY = {t.key: t for t in TOOLS}


def _state() -> dict:
    try:
        return json.loads((home() / STATE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


_warned: set[str] = set()


def installed(key: str) -> Path:
    """The program of a tool set up by `course setup`; ToolError if it is missing or outdated."""
    tool = BY_KEY[key]
    entry = _state().get(key)
    if not entry:
        raise ToolError(f"{tool.label} is not set up: run `course setup`")
    version, override = entry["version"], entry.get("override", False)
    if version != tool.pinned and not override:
        raise ToolError(f"{tool.label} {tool.pinned} is needed (set up: {version}): run `course setup`")
    program = tool.program(home() / key / version)
    if not program.exists():
        raise ToolError(f"{tool.label} {version} is missing from {home()}: run `course setup`")
    if override and key not in _warned:
        _warned.add(key)
        print(f"warning: using {tool.label} {version} instead of {tool.pinned} (course setup --{tool.option})",
              file=sys.stderr)
    return program


def quarto() -> str:
    """Quarto to run: $QUARTO_PATH, else the one from `course setup`."""
    return os.environ.get("QUARTO_PATH") or str(installed("quarto"))


def java() -> str:
    """Java from the jdk4py package."""
    try:
        import jdk4py
    except ImportError:   # course-tools installed without its dependencies
        return "java"
    if sys.platform == "win32":
        return str(jdk4py.JAVA.with_suffix(".exe"))
    return str(jdk4py.JAVA)


def dot() -> str | None:
    """Graphviz's `dot`: from `course setup` on Windows, else from PATH (None if missing)."""
    if sys.platform == "win32":
        return str(installed("graphviz"))
    return shutil.which("dot")


def plantuml() -> list[str]:
    """Command that runs PlantUML: the jar in $PLANTUML_JAR, else the one from `course setup`."""
    jar = os.environ.get("PLANTUML_JAR") or str(installed("plantuml"))
    return [java(), "-Djava.awt.headless=true", "-jar", jar]


def environment(pdf: bool) -> dict[str, str]:
    """Environment for Quarto: for PDFs, the Chrome Headless Shell from `course setup` (Mermaid);
    on Windows, Graphviz from `course setup` for PlantUML."""
    env = dict(os.environ)
    if pdf and not env.get("QUARTO_CHROMIUM"):
        env["QUARTO_CHROMIUM"] = str(installed("chrome"))
    if sys.platform == "win32" and not env.get("GRAPHVIZ_DOT"):
        env["GRAPHVIZ_DOT"] = dot()
    return env


# --------------------------------------------------------------------------
# course setup
# --------------------------------------------------------------------------

def setup(versions: dict[str, str | None] | None = None, force: bool = False) -> None:
    """Download the pinned tools (or the `versions` asked for) into home(); remove other versions."""
    plat = current_platform()
    if plat not in PLATFORMS:
        raise ToolError(f"this platform ({plat}) is not supported; supported: {', '.join(PLATFORMS)}")
    root = home()
    root.mkdir(parents=True, exist_ok=True)
    state = _state()
    for tool in TOOLS:
        if plat not in tool.platforms:
            continue
        version = (versions or {}).get(tool.key) or tool.pinned
        if not re.fullmatch(r"[0-9][0-9A-Za-z.+-]*", version):
            raise ToolError(f"{version!r} is not a {tool.label} version")
        folder = root / tool.key / version
        if force or not tool.program(folder).exists():
            _install(tool, version, plat, folder)
        else:
            print(f"{tool.label} {version}: already set up")
        state[tool.key] = {"version": version, "override": version != tool.pinned}
        for other in (root / tool.key).iterdir():
            if other.name != version:
                if not other.name.startswith("."):   # left over from an interrupted setup
                    print(f"Removing {tool.label} {other.name}")
                _remove(other)
    (root / STATE).write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    print(f"Tools are in {root}")


def _install(tool: Tool, version: str, plat: str, folder: Path) -> None:
    url, name = tool.download(version, plat)
    expected = SHA256.get(name) if version == tool.pinned else None
    if version == tool.pinned and not expected:
        raise ToolError(f"no SHA-256 pinned for {name}")
    folder.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".setup-", dir=folder.parent, ignore_cleanup_errors=True) as tmp:
        archive = Path(tmp) / name
        print(f"Downloading {tool.label} {version} from {url}", flush=True)
        digest = _download(url, archive)
        if expected is None:
            print(f"warning: {name} is not checked (no SHA-256 pinned for {tool.label} {version}): {digest}",
                  file=sys.stderr)
        elif digest != expected:
            raise ToolError(f"{name} has SHA-256 {digest}, expected {expected}: download refused")
        unpacked = Path(tmp) / "unpacked"
        unpacked.mkdir()
        if name.endswith(".jar"):
            shutil.move(str(archive), unpacked / "plantuml.jar")
        else:
            _unpack(archive, unpacked)
            # Unwrap a single top-level folder (quarto-1.10.18/, chrome-headless-shell-linux64/).
            entries = list(unpacked.iterdir())
            if len(entries) == 1 and entries[0].is_dir():
                unpacked = entries[0]
        if not tool.program(unpacked).exists():
            raise ToolError(f"{name} does not contain {tool.program(Path()).as_posix()}")
        if tool.key == "graphviz":
            # The zip has no plugin list (config6): without it, dot knows no output formats.
            subprocess.run([str(tool.program(unpacked)), "-c"], check=True, timeout=120)
        _remove(folder)
        _rename(unpacked, folder)


def _ssl_context() -> ssl.SSLContext:
    # The system's certificates, also on macOS and behind proxies that inspect TLS.
    try:
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except ImportError:
        return ssl.create_default_context()


def _download(url: str, target: Path) -> str:
    """Download `url` to `target` and return its SHA-256."""
    h = hashlib.sha256()
    request = urllib.request.Request(url, headers={"User-Agent": "course-tools"})
    with urllib.request.urlopen(request, context=_ssl_context(), timeout=60) as response, \
            open(target, "wb") as out:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        tty = sys.stdout.isatty()
        while chunk := response.read(1 << 20):
            out.write(chunk)
            h.update(chunk)
            done += len(chunk)
            if tty and total:
                print(f"\r  {done >> 20} of {total >> 20} MB", end="", flush=True)
        if tty and total:
            print()
    return h.hexdigest()


def _unpack(archive: Path, target: Path) -> None:
    if archive.name.endswith(".zip"):
        _unzip(archive, target)
    else:
        with tarfile.open(archive) as tf:
            if hasattr(tarfile, "data_filter"):
                tf.extractall(target, filter="data")
            else:
                tf.extractall(target)


def _unzip(archive: Path, target: Path) -> None:
    """Unzip, keeping the executable bits and symbolic links (zipfile.extractall drops them)."""
    root = target.resolve()
    with zipfile.ZipFile(archive) as zf:
        for info in zf.infolist():
            path = (target / info.filename).resolve()
            if not path.is_relative_to(root):
                raise ToolError(f"{archive.name}: {info.filename} is outside the archive")
            mode = info.external_attr >> 16
            if info.is_dir():
                path.mkdir(parents=True, exist_ok=True)
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            if stat.S_ISLNK(mode) and sys.platform != "win32":
                os.symlink(zf.read(info).decode("utf-8"), path)
                continue
            with zf.open(info) as src, open(path, "wb") as dst:
                shutil.copyfileobj(src, dst)
            if mode & 0o111:
                path.chmod(path.stat().st_mode | 0o755)


def _rename(source: Path, target: Path) -> None:
    # On Windows, a virus scanner may still have a new file open for a moment.
    for attempt in range(40):
        try:
            source.rename(target)
            return
        except PermissionError:
            if attempt == 39:
                raise
            time.sleep(0.5)


def _remove(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    elif path.exists() or path.is_symlink():
        path.unlink()
