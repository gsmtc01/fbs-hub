"""GitHub Pages에 공개할 파일만 dist 디렉터리에 모은다."""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
FILES = [
    "index.html", "styles.css", "app.js", "local-llm.js",
    "sw.js", "manifest.webmanifest", "robots.txt", "LICENSE",
]
DIRECTORIES = ["assets", "data", "pages"]


def build() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    for name in FILES:
        shutil.copy2(ROOT / name, DIST / name)
    for name in DIRECTORIES:
        shutil.copytree(ROOT / name, DIST / name)
    (DIST / ".nojekyll").touch()
    shutil.copy2(ROOT / "index.html", DIST / "404.html")
    print(f"GitHub Pages 공개 파일 → {DIST}")


if __name__ == "__main__":
    build()
