"""Check every catalog datasheet URL and report dead links and stale entries.

Usage: python scripts/check_links.py [--report PATH] [--stale-days N]

Exit status is 1 when any URL is definitely broken (HTTP 404/410 or the host does not resolve).
Many manufacturer sites block automated clients (401/403/429) or time out; those are listed as
"could not verify", not as failures. Prices are not checked: they can only be confirmed per site.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import httpx

CATALOG_DIR = Path(__file__).resolve().parent.parent / "backend" / "data" / "catalog"
HEADERS = {"User-Agent": "Mozilla/5.0 (actuator-research-tool link check)"}
BROKEN = {404, 410}


def load_urls() -> tuple[dict[str, list[str]], list[tuple[str, str]]]:
    urls: dict[str, list[str]] = defaultdict(list)
    retrieved: list[tuple[str, str]] = []
    for path in sorted(CATALOG_DIR.glob("*.json")):
        for row in json.loads(path.read_text(encoding="utf-8")):
            urls[row["datasheet_url"]].append(row["id"])
            retrieved.append((row["id"], row.get("retrieved_on", "")))
    return urls, retrieved


async def probe(client: httpx.AsyncClient, url: str, sem: asyncio.Semaphore) -> tuple[str, str, str]:
    async with sem:
        try:
            resp = await client.head(url)
            if resp.status_code in {405, 403} or resp.status_code >= 500:
                resp = await client.get(url)
        except httpx.ConnectError as exc:
            return url, "broken", f"connect error: {exc}"
        except httpx.HTTPError as exc:
            return url, "unverified", type(exc).__name__
    if resp.status_code in BROKEN:
        return url, "broken", f"HTTP {resp.status_code}"
    if resp.status_code < 400:
        return url, "ok", f"HTTP {resp.status_code}"
    return url, "unverified", f"HTTP {resp.status_code}"


async def check(urls: list[str], concurrency: int) -> list[tuple[str, str, str]]:
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=20) as client:
        return await asyncio.gather(*(probe(client, u, sem) for u in urls))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path)
    parser.add_argument("--stale-days", type=int, default=365)
    parser.add_argument("--concurrency", type=int, default=8)
    args = parser.parse_args()

    urls, retrieved = load_urls()
    results = asyncio.run(check(sorted(urls), args.concurrency))
    broken = [r for r in results if r[1] == "broken"]
    unverified = [r for r in results if r[1] == "unverified"]
    today = date.today()
    stale = [(i, d) for i, d in retrieved if not d or (today - date.fromisoformat(d)).days > args.stale_days]

    lines = [
        "# Catalog link check",
        "",
        f"- URLs checked: {len(results)} (used by {sum(len(v) for v in urls.values())} entries)",
        f"- Broken: {len(broken)}",
        f"- Could not verify (blocked or timed out): {len(unverified)}",
        f"- Entries retrieved more than {args.stale_days} days ago: {len(stale)}",
        "",
    ]
    if broken:
        lines += ["## Broken", ""]
        lines += [f"- {u} ({why}); entries: {', '.join(urls[u][:5])}" for u, _, why in broken]
        lines.append("")
    if unverified:
        lines += ["## Could not verify", ""]
        lines += [f"- {u} ({why})" for u, _, why in unverified]
        lines.append("")
    report = "\n".join(lines)
    print(report)
    if args.report:
        args.report.write_text(report, encoding="utf-8")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
