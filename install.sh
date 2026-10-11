#!/usr/bin/env bash
# Install everything needed to build and preview Saxion ACS courses locally.
# Tested on Ubuntu 24.04 LTS (also works in WSL) and on macOS 26 with
# Homebrew (https://brew.sh). See requirements.md.
#
# Usage:
#   ./install.sh            install course-tools from GitHub (tag $TOOLS_REF)
#   ./install.sh --local    install course-tools from this directory (editable,
#                           for working on course-tools itself)
#
# Versions can be overridden with environment variables, e.g.
#   QUARTO_VERSION=1.10.18 PLANTUML_VERSION=1.2026.8 ./install.sh

set -euo pipefail

QUARTO_VERSION="${QUARTO_VERSION:-1.10.18}"
PLANTUML_VERSION="${PLANTUML_VERSION:-1.2026.8}"
TOOLS_REF="${TOOLS_REF:-v1}"
TOOLS_REPO="https://github.com/SaxionACS/course-tools"
PLANTUML_DIR=/usr/local/lib/plantuml
QUARTO_URL="https://github.com/quarto-dev/quarto-cli/releases/download/v${QUARTO_VERSION}"

LOCAL=0
if [[ "${1:-}" == "--local" ]]; then
  LOCAL=1
elif [[ $# -gt 0 ]]; then
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi

if [[ $EUID -eq 0 ]]; then
  echo "Run this script as your normal user; it uses sudo where needed." >&2
  exit 1
fi

step() { printf '\n==> %s\n' "$*"; }

case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=macos ;;
  *) echo "This script supports Ubuntu (also in WSL) and macOS, not $(uname -s)." >&2; exit 1 ;;
esac

JAVA=java   # runs PlantUML
BREW=

if [[ ${OS} == linux ]]; then
  step "System packages (Python, pipx, Java and Graphviz for PlantUML, Lato font, git-lfs)"
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends \
    ca-certificates curl git git-lfs python3 python3-venv pipx \
    default-jre-headless graphviz fonts-lato zip unzip
else
  # A new terminal may not have Homebrew on PATH yet.
  BREW="$(command -v brew || true)"
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -z ${BREW} && -x ${b} ]]; then BREW=${b}; fi
  done
  if [[ -z ${BREW} ]]; then
    echo "Homebrew is needed: install it from https://brew.sh, then run this script again." >&2
    exit 1
  fi
  eval "$("${BREW}" shellenv bash)"

  step "Homebrew packages (Python, pipx, Java and Graphviz for PlantUML, git-lfs)"
  "${BREW}" install pipx openjdk graphviz git-lfs
  # Homebrew's Java is not on PATH (/usr/bin/java is a stub that only reports
  # that Java is missing), so the plantuml wrapper below runs it directly.
  JAVA="$("${BREW}" --prefix)/opt/openjdk/bin/java"
fi

step "Quarto ${QUARTO_VERSION}"
if command -v quarto >/dev/null && [[ "$(quarto --version)" == "${QUARTO_VERSION}" ]]; then
  echo "Quarto ${QUARTO_VERSION} is already installed."
else
  tmp="$(mktemp -d)"
  if [[ ${OS} == linux ]]; then
    curl -fsSL -o "${tmp}/quarto.deb" "${QUARTO_URL}/quarto-${QUARTO_VERSION}-linux-amd64.deb"
    sudo apt-get install -y "${tmp}/quarto.deb"
  else
    # The official installer: Quarto in /Applications/quarto, linked from /usr/local/bin.
    curl -fsSL -o "${tmp}/quarto.pkg" "${QUARTO_URL}/quarto-${QUARTO_VERSION}-macos.pkg"
    sudo installer -pkg "${tmp}/quarto.pkg" -target /
  fi
  rm -rf "${tmp}"
fi

step "Chrome Headless Shell (renders Mermaid diagrams for PDFs)"
quarto install chrome-headless-shell --no-prompt

if [[ ${OS} == macos ]]; then
  step "Lato font (PDF)"
  # Asks Typst, which renders the PDFs, so that a Lato installed otherwise counts too.
  fonts="$(quarto typst fonts 2>&1 || true)"
  if grep -qx Lato <<<"${fonts}"; then
    echo "Lato is already installed."
  else
    "${BREW}" install --cask font-lato
  fi
fi

step "PlantUML ${PLANTUML_VERSION}"
jar="${PLANTUML_DIR}/plantuml-${PLANTUML_VERSION}.jar"
if [[ ! -f "${jar}" ]]; then
  sudo mkdir -p "${PLANTUML_DIR}"
  sudo curl -fsSL -o "${jar}" \
    "https://github.com/plantuml/plantuml/releases/download/v${PLANTUML_VERSION}/plantuml-${PLANTUML_VERSION}.jar"
fi
if [[ ${OS} == macos ]]; then
  sudo mkdir -p /usr/local/bin   # not always there on Apple silicon
fi
# /usr/local/bin comes before /usr/bin, so this wrapper takes precedence over
# the (much older) plantuml package from Ubuntu.
sudo tee /usr/local/bin/plantuml >/dev/null <<EOF
#!/bin/sh
exec ${JAVA} -Djava.awt.headless=true -jar "${jar}" "\$@"
EOF
sudo chmod +x /usr/local/bin/plantuml

step "course-tools"
if [[ ${LOCAL} -eq 1 ]]; then
  pipx install --force --editable "$(cd "$(dirname "$0")" && pwd)"
else
  pipx install --force "git+${TOOLS_REPO}@${TOOLS_REF}"
fi
pipx ensurepath >/dev/null

step "Check"
export PATH="${HOME}/.local/bin:${PATH}"
found="$(command -v plantuml || true)"
if [[ -n ${found} && ${found} != /usr/local/bin/plantuml ]]; then
  echo "warning: ${found} comes before /usr/local/bin/plantuml on PATH" >&2
fi
course doctor

echo
echo "Done. Open a new terminal (so PATH is updated), go to a course repository and run:"
echo "  course preview    # live preview at http://localhost:4200"
echo "  course build      # website + PDFs in dist/"
