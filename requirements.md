# Requirements

Tools needed to build and preview courses locally. [`install.sh`](install.sh)
installs all of them on Ubuntu 24.04 LTS (also in WSL) and on macOS with
[Homebrew](https://brew.sh):

```bash
curl -LsSf https://raw.githubusercontent.com/SaxionACS/course-tools/v2/install.sh | bash
```

On Windows 10/11, use WSL and the line above (faster), or
[`install.ps1`](install.ps1) in PowerShell (see [Windows](#windows)):

```powershell
irm https://raw.githubusercontent.com/SaxionACS/course-tools/v2/install.ps1 | iex
```

Most tools are not installed system-wide. [uv](https://docs.astral.sh/uv/)
installs Python and the `course` command (in `~/.local/bin`), and `course
setup` downloads the pinned Quarto, PlantUML and Chrome Headless Shell into a
folder of your own:

| System | Tools folder |
|:--|:--|
| Ubuntu | `~/.local/share/course-tools` |
| macOS | `~/Library/Application Support/course-tools` |
| Windows | `%LOCALAPPDATA%\course-tools` |

`course build` and `course preview` use only these copies, not a Quarto or
PlantUML installed otherwise. The GitHub Actions workflows install the tools
the same way (on Ubuntu).

| Tool | Version | Used for | Installed by |
|:--|:--|:--|:--|
| [uv](https://docs.astral.sh/uv/) | any | installs Python and course-tools | Astral's installer (`install.sh`, `install.ps1`), unless uv is already there |
| Python | 3.12 | runs course-tools | uv |
| PyYAML, jdk4py, truststore | see `pyproject.toml` | the course YAML files; Java (21) for PlantUML; downloads with the system's certificates | uv, with course-tools |
| [Quarto](https://quarto.org) | 1.10.18 | renders the website (HTML) and the PDFs; includes Pandoc and Typst | `course setup` |
| [PlantUML](https://plantuml.com) | 1.2026.8 | renders PlantUML diagrams | `course setup` |
| Chrome Headless Shell | 156.0.8078.73 | renders Mermaid diagrams for PDFs | `course setup` |
| Lato font | 2.015 | body font of the PDFs | comes with course-tools |
| [Graphviz](https://graphviz.org) | any; 16.1.0 on Windows | layout engine PlantUML needs for most diagram types (not for sequence and activity diagrams) | apt (Ubuntu), Homebrew (macOS), `course setup` (Windows) |
| git, git-lfs | any | version control; LFS is optional (e.g. for large slide files) | apt (Ubuntu); git: Xcode Command Line Tools, git-lfs: Homebrew (macOS); Git for Windows, which includes git-lfs (winget, if git is missing) |

The versions of Quarto, PlantUML, Chrome Headless Shell and Windows' Graphviz are pinned in
[`src/course_tools/tools.py`](src/course_tools/tools.py), with the SHA-256 of
every download; `course setup` refuses a download that does not match.

Notes:

- Check your installation with `course doctor`. It also shows the tools
  folder.
- After an update of course-tools that pins a new version, `course build`
  stops with "run `course setup`". `course setup` downloads the new version
  and removes the old one.
- `course setup --quarto 1.11.6` (or `--plantuml`) sets up another version,
  for example to try a newer Quarto. It is not checked against a SHA-256, and
  every build warns about it. `course setup` alone goes back to the pinned
  version.
- `QUARTO_PATH` (a Quarto program) and `PLANTUML_JAR` (a PlantUML jar) override
  the tools folder, for debugging.
- Mermaid diagrams on the website are drawn in the browser; Chrome is only
  needed for the PDFs.
- Homebrew's Graphviz is much newer than Ubuntu's (2.43), which CI uses. PlantUML
  diagrams other than sequence diagrams may be laid out slightly differently in
  a local build than on the published site.
- On macOS, install [Homebrew](https://brew.sh) first; `install.sh` does not
  install it.
- The installers put `~/.local/bin` (where `course` is) on `PATH`, in the
  shell's startup files (Windows: the user's `PATH`). Set
  `UV_NO_MODIFY_PATH=1` to keep them from it.

## Windows

course-tools runs on Windows 10/11 (64-bit, x64), natively or in WSL. Native
Windows is supported on a best-effort basis, like macOS: there is no Windows
CI.

- **WSL (recommended):** install Ubuntu 24.04 in WSL, keep the course in the
  Linux file system (`~/...`, not `/mnt/c/...`) and use `install.sh`. It is
  the faster option: on the same laptop, a changed page showed up in
  `course preview` after about 5 s in WSL against about 12 s natively, and
  with `--pdf` after 13 s against 50 s.
- **Native:** run the PowerShell line above (Windows PowerShell 5.1 or
  PowerShell 7). It needs no administrator rights, unless git is missing:
  then it installs Git for Windows with winget. From a clone:
  `powershell -ExecutionPolicy Bypass -File install.ps1` (`-Local` installs the
  clone, editable). Use `course preview` without `--pdf` where you can.
- Natively, `course preview --pdf` once did not come up (in 13 tries): its
  output stopped at a page with Mermaid diagrams, while Quarto waited for
  Chrome Headless Shell. Stop it (Ctrl+C) and start it again.
- Git for Windows checks files out with Windows line endings (CRLF); that is
  fine for course-tools.

## Uninstall

```bash
uv tool uninstall saxion-course-tools
```

Then delete the tools folder (`course doctor` shows it, before you uninstall).

## Coming from course-tools 1.x

`install.sh` of course-tools 1.x installed the tools system-wide. The new
`install.sh` replaces the old `course` command (pipx) and offers to remove the
rest. To remove it yourself:

| What | Ubuntu | macOS |
|:--|:--|:--|
| course-tools 1.x | `pipx uninstall saxion-course-tools` | the same |
| PlantUML | `sudo rm -rf /usr/local/lib/plantuml /usr/local/bin/plantuml` | the same |
| Quarto | `sudo apt remove quarto` | `sudo rm -rf /Applications/quarto /usr/local/bin/quarto` |
| Chrome Headless Shell (Quarto's) | `rm -rf ~/.local/share/quarto/chrome-headless-shell` | `rm -rf ~/Library/Application\ Support/quarto/chrome-headless-shell` |
| Java, Lato | `sudo apt remove default-jre-headless fonts-lato` | `brew uninstall openjdk && brew uninstall --cask font-lato` |

Keep Quarto if other projects use it. Java and Lato may be used by other
programs too.
