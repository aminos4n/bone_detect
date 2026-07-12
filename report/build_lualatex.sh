#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

mkdir -p "$PROJECT_ROOT/.texlive-var"

export TEXMFVAR="$PROJECT_ROOT/.texlive-var"

cd "$SCRIPT_DIR"
lualatex -interaction=nonstopmode alexnet_transfer_learning.tex
lualatex -interaction=nonstopmode alexnet_transfer_learning.tex
