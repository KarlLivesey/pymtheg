#!/usr/bin/env python3
"""Cache readable excerpts from explicitly selected public research sources."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import sys
from urllib.request import Request, urlopen


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.links = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.parts.append(data.strip())


def fetch(entry):
    slug, url = entry
    timestamp = datetime.now(timezone.utc).isoformat()
    try:
        request = Request(url, headers={"User-Agent": "Specification-language-research/1.0"})
        with urlopen(request, timeout=30) as response:
            final_url = response.url
            data = response.read(4_000_001)
            if len(data) > 4_000_000:
                raise ValueError("Source exceeds the 4 MB download limit")
            raw = data.decode("utf-8", "replace")
            content_type = response.headers.get("Content-Type", "")
        if "html" in content_type or "<html" in raw[:1000].lower():
            parser = VisibleText()
            parser.feed(raw)
            body = "\n".join(parser.parts)
            links = list(dict.fromkeys(parser.links))
        else:
            body = raw
            links = []
        output = Path(__file__).parent / "sources" / f"{slug}.txt"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(f"Source: {url}\nResolved: {final_url}\nRetrieved: {timestamp}\n\n{body}\n")
        return {"slug": slug, "url": url, "resolved_url": final_url,
                "retrieved": timestamp, "file": output.name, "characters": len(body),
                "links": links, "status": "ok"}
    except Exception as error:
        return {"slug": slug, "url": url, "retrieved": timestamp,
                "status": "error", "error": str(error)}


def main():
    entries = [item.split("=", 1) for item in sys.argv[1:]]
    if not entries or any(len(item) != 2 for item in entries):
        raise SystemExit("Usage: fetch_sources.py slug=https://example.org [...]")
    root = Path(__file__).parent / "sources"
    root.mkdir(parents=True, exist_ok=True)
    manifest_file = root / "index.json"
    previous = json.loads(manifest_file.read_text()) if manifest_file.exists() else []
    manifest = {item["slug"]: item for item in previous}
    with ThreadPoolExecutor(max_workers=5) as pool:
        for result in pool.map(fetch, entries):
            manifest[result["slug"]] = result
            print(json.dumps({key: value for key, value in result.items() if key != "links"}))
    manifest_file.write_text(json.dumps(list(manifest.values()), indent=2) + "\n")


if __name__ == "__main__":
    main()
