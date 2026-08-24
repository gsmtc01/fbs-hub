"""GitHub Pages 배포 산출물의 구성과 링크를 검증한다."""
from __future__ import annotations

import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

from validate_data import validate


REQUIRED_FILES = {
    ".nojekyll",
    "404.html",
    "LICENSE",
    "app.js",
    "assets/favicon.svg",
    "data/notices.json",
    "index.html",
    "local-llm.js",
    "manifest.webmanifest",
    "pages/copyright.html",
    "pages/licenses.html",
    "pages/page.css",
    "pages/privacy.html",
    "pages/support.html",
    "pages/terms.html",
    "robots.txt",
    "styles.css",
    "sw.js",
}
FORBIDDEN_NAMES = {".DS_Store", "__pycache__", "notices.db"}
FORBIDDEN_SUFFIXES = {".db", ".py", ".pyc", ".dc.html"}
TEXT_SUFFIXES = {".css", ".html", ".js", ".json", ".svg", ".txt", ".webmanifest"}
LEGACY_ENGLISH_NAME = "pin" + "bix"


class HtmlScan(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.links: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        if values.get("id"):
            self.ids.append(values["id"])
        if tag == "a" and values.get("href"):
            self.links.append(values)


def scan_html(path: Path) -> HtmlScan:
    scan = HtmlScan()
    scan.feed(path.read_text(encoding="utf-8"))
    return scan


def verify(root: Path) -> list[str]:
    root = root.resolve()
    errors: list[str] = []
    if not root.is_dir():
        return [f"배포 디렉터리가 없습니다: {root}"]

    files = {path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()}
    for missing in sorted(REQUIRED_FILES - files):
        errors.append(f"필수 배포 파일 누락: {missing}")

    for path in root.rglob("*"):
        relative = path.relative_to(root).as_posix()
        if path.name in FORBIDDEN_NAMES or any(relative.endswith(suffix) for suffix in FORBIDDEN_SUFFIXES):
            errors.append(f"비공개 파일이 배포 산출물에 포함됨: {relative}")
        if path.is_file() and (path.suffix in TEXT_SUFFIXES or path.name == "LICENSE"):
            text = path.read_text(encoding="utf-8")
            if re.search(LEGACY_ENGLISH_NAME, text, re.IGNORECASE):
                errors.append(f"이전 영문 명칭이 남아 있음: {relative}")

    manifest_path = root / "manifest.webmanifest"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("name") != "핀빅스 허브" or manifest.get("start_url") != "./":
            errors.append("웹 앱 매니페스트의 서비스명 또는 시작 경로가 올바르지 않습니다.")
    except (OSError, json.JSONDecodeError) as error:
        errors.append(f"웹 앱 매니페스트를 읽을 수 없습니다: {error}")

    html_paths = sorted(root.rglob("*.html"))
    scans = {path: scan_html(path) for path in html_paths}
    for path, scan in list(scans.items()):
        duplicate_ids = sorted({value for value in scan.ids if scan.ids.count(value) > 1})
        if duplicate_ids:
            errors.append(f"중복 ID: {path.relative_to(root)}: {', '.join(duplicate_ids)}")

        for link in scan.links:
            href = link["href"]
            parsed = urlsplit(href)
            if link.get("target") == "_blank":
                rel = set(link.get("rel", "").split())
                if not {"noopener", "noreferrer"}.issubset(rel):
                    errors.append(f"외부 링크 보안 속성 누락: {path.relative_to(root)}: {href}")
            if parsed.scheme or parsed.netloc or href.startswith(("mailto:", "javascript:")):
                continue

            target = path if not parsed.path else (path.parent / unquote(parsed.path)).resolve()
            if target.is_dir():
                target = target / "index.html"
            try:
                target.relative_to(root)
            except ValueError:
                errors.append(f"배포 디렉터리 밖을 가리키는 링크: {path.relative_to(root)}: {href}")
                continue
            if not target.exists():
                errors.append(f"깨진 로컬 링크: {path.relative_to(root)}: {href}")
                continue
            if parsed.fragment and target.suffix == ".html":
                target_scan = scans.get(target) or scan_html(target)
                if unquote(parsed.fragment) not in target_scan.ids:
                    errors.append(f"없는 앵커를 가리키는 링크: {path.relative_to(root)}: {href}")

    errors.extend(f"공개 데이터: {error}" for error in validate(root / "data" / "notices.json"))
    return errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path, nargs="?", default=Path("dist"))
    args = parser.parse_args()
    errors = verify(args.path)
    if errors:
        for error in errors:
            print(f"[FAIL] {error}")
        raise SystemExit(1)
    print(f"[OK] GitHub Pages 배포 산출물 검증 완료: {args.path.resolve()}")


if __name__ == "__main__":
    main()
