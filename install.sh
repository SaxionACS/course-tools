#!/usr/bin/env bash
# Install everything needed to build and preview Saxion ACS courses locally.
# Tested on Ubuntu 24.04 LTS (also works in WSL) and on macOS 26 with
# Homebrew (https://brew.sh). See requirements.md.
#
# Usage:
#   curl -LsSf https://raw.githubusercontent.com/SaxionACS/course-tools/v2/install.sh | bash
#   ./install.sh            the same, from a clone
#   ./install.sh --local    install course-tools from this clone (editable,
#                           for working on course-tools itself)
#
# Environment: TOOLS_REF (course-tools version from GitHub, default v2),
# PYTHON_VERSION (default 3.12).

set -euo pipefail

TOOLS_REF="${TOOLS_REF:-v2}"
PYTHON_VERSION="${PYTHON_VERSION:-3.12}"
TOOLS_REPO="https://github.com/SaxionACS/course-tools"

step() { printf '\n==> %s\n' "$*"; }

# Everything runs from main, called on the last line, so that bash has read
# the whole script before it starts (`curl … | bash`).
main() {
  local local_dir=""
  if [[ "${1:-}" == "--local" ]]; then
    local_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  elif [[ $# -gt 0 ]]; then
    sed -n '2,13p' "${BASH_SOURCE[0]}" 2>/dev/null | sed 's/^# \{0,1\}//' >&2
    exit 1
  fi

  if [[ $EUID -eq 0 ]]; then
    echo "Run this script as your normal user; it uses sudo where needed." >&2
    exit 1
  fi

  local os
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=macos ;;
    *) echo "This script supports Ubuntu (also in WSL) and macOS, not $(uname -s)." >&2; exit 1 ;;
  esac

  if [[ ${os} == linux ]]; then
    step "System packages (Graphviz for PlantUML, git, git-lfs)"
    sudo apt-get update
    sudo apt-get install -y --no-install-recommends ca-certificates curl git git-lfs graphviz
  else
    # A new terminal may not have Homebrew on PATH yet.
    local brew b
    brew="$(command -v brew || true)"
    for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
      if [[ -z ${brew} && -x ${b} ]]; then brew=${b}; fi
    done
    if [[ -z ${brew} ]]; then
      echo "Homebrew is needed: install it from https://brew.sh, then run this script again." >&2
      exit 1
    fi
    eval "$("${brew}" shellenv bash)"
    step "Homebrew packages (Graphviz for PlantUML, git-lfs)"
    "${brew}" install graphviz git-lfs
  fi

  step "uv (installs Python and course-tools)"
  local login_path="${PATH}"
  export PATH="${HOME}/.local/bin:${PATH}"
  if command -v uv >/dev/null; then
    echo "uv is already installed: $(uv --version)"
  else
    curl -LsSf https://astral.sh/uv/install.sh | sh
  fi

  # course-tools 1.x was installed with pipx; its `course` would clash with the new one.
  if command -v pipx >/dev/null && pipx list --short 2>/dev/null | grep -q '^saxion-course-tools '; then
    step "Removing course-tools 1.x (pipx)"
    pipx uninstall saxion-course-tools
  fi

  step "course-tools"
  if [[ -n ${local_dir} ]]; then
    uv tool install --force --python "${PYTHON_VERSION}" --editable "${local_dir}"
  else
    uv tool install --force --python "${PYTHON_VERSION}" "git+${TOOLS_REPO}@${TOOLS_REF}"
  fi
  # Puts ~/.local/bin (where `course` is) on PATH in the shell's startup files,
  # if a new terminal would not have it there.
  PATH="${login_path}" "$(command -v uv)" tool update-shell || true

  remove_old_installs "${os}"

  step "Quarto, PlantUML and Chrome Headless Shell"
  course setup

  step "Check"
  course doctor

  echo
  echo "Done. Open a new terminal (so PATH is updated), go to a course repository and run:"
  echo "  course preview    # live preview at http://localhost:4200"
  echo "  course build      # website + PDFs in dist/"
}

# What install.sh of course-tools 1.x installed system-wide. course-tools 2
# has its own copies (`course setup`); offer to remove the old ones.
remove_old_installs() {
  local os=$1 data
  local found=()
  if [[ -d /usr/local/lib/plantuml ]]; then found+=("/usr/local/lib/plantuml (PlantUML jar)"); fi
  if old_plantuml_wrapper; then found+=("/usr/local/bin/plantuml (PlantUML wrapper)"); fi
  if [[ ${os} == linux ]]; then
    if old_quarto_deb; then found+=("Quarto $(quarto --version 2>/dev/null || true) (package quarto)"); fi
    data="${XDG_DATA_HOME:-${HOME}/.local/share}/quarto/chrome-headless-shell"
  else
    if [[ -d /Applications/quarto ]]; then found+=("/Applications/quarto (Quarto)"); fi
    data="${HOME}/Library/Application Support/quarto/chrome-headless-shell"
  fi
  if [[ -d ${data} ]]; then found+=("${data} (Chrome Headless Shell installed by Quarto)"); fi
  if [[ ${#found[@]} -eq 0 ]]; then return 0; fi

  step "Tools installed by course-tools 1.x"
  echo "course-tools 2 no longer uses these:"
  printf '  %s\n' "${found[@]}"
  local answer=""
  # Under `curl … | bash`, stdin is the script: ask the terminal (none in CI).
  if (exec </dev/tty) 2>/dev/null; then
    read -r -p "Remove them? Keep them if other projects use Quarto. [y/N] " answer </dev/tty || true
  fi
  if [[ ${answer} != [yY]* ]]; then
    echo "Kept. requirements.md says how to remove them later."
    return 0
  fi
  sudo rm -rf /usr/local/lib/plantuml
  if old_plantuml_wrapper; then sudo rm -f /usr/local/bin/plantuml; fi
  if [[ ${os} == linux ]]; then
    if old_quarto_deb; then sudo apt-get remove -y quarto; fi
  elif [[ -d /Applications/quarto ]]; then
    case "$(readlink /usr/local/bin/quarto 2>/dev/null || true)" in
      /Applications/quarto/*) sudo rm -f /usr/local/bin/quarto ;;
    esac
    sudo rm -rf /Applications/quarto
  fi
  rm -rf "${data}"
}

old_plantuml_wrapper() {
  [[ -f /usr/local/bin/plantuml ]] && grep -q /usr/local/lib/plantuml /usr/local/bin/plantuml
}

old_quarto_deb() {
  dpkg-query -W -f='${Status}' quarto 2>/dev/null | grep -q "install ok installed"
}

main "$@"
