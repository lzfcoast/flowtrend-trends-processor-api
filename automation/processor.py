#!/usr/bin/env python3
"""Processador local do FlowTrend: stdin JSON/XML -> JSON tratado ou feed Atom Blogger."""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from blogger_automation import Article, LEGAL_PAGES, clean_html, classify, meta_description, normalize_text, rewrite_template, safe_http_url

ATOM = "http://www.w3.org/2005/Atom"
APP = "http://www.w3.org/2007/app"
BLOGGER = "http://schemas.google.com/blogger/2008/kind"
ET.register_namespace("", ATOM)
ET.register_namespace("app", APP)
ET.register_namespace("blogger", BLOGGER)


def records_from_xml(raw: bytes) -> list[dict]:
    root = ET.fromstring(raw)
    records = []
    for item in root.findall(".//item") + root.findall(".//entry"):
        def value(*names: str) -> str:
            for name in names:
                node = item.find(name)
                if node is None:
                    node = item.find(f"{{*}}{name}")
                if node is not None:
                    if node.text and node.text.strip():
                        return node.text
                    if node.attrib.get("href"):
                        return node.attrib["href"]
            return ""
        records.append({"title": value("title"), "content": value("description", "summary", "content"), "url": value("link", "url"), "source": value("source", "publisher")})
    return records


def records_from_json(raw: bytes) -> list[dict]:
    value = json.loads(raw.decode("utf-8"))
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        if value.get("title"):
            return [value]
        return value.get("articles") or value.get("items") or []
    raise ValueError("Entrada JSON deve ser uma lista, matéria ou objeto com articles/items")


def process_records(records: list[dict]) -> list[dict]:
    output = []
    for raw in records:
        title = normalize_text(raw.get("title"))
        if not title:
            continue
        article = Article(
            title=title,
            content=str(raw.get("content", raw.get("description", ""))),
            source_url=normalize_text(raw.get("url", raw.get("link", ""))),
            source_name=normalize_text(raw.get("source", raw.get("publisher", ""))),
            category=normalize_text(raw.get("category")) or classify(title, str(raw.get("content", raw.get("description", "")))),
        )
        prepared = rewrite_template(article)
        source_url = safe_http_url(prepared.source_url)
        description = meta_description(prepared.content)
        content = prepared.content
        if source_url:
            content += f'<p><strong>Fonte original:</strong> <a href="{html.escape(source_url)}" target="_blank" rel="noopener noreferrer">{html.escape(prepared.source_name or source_url)}</a></p>'
        output.append({
            "title": prepared.title,
            "content": content,
            "description": description,
            "category": prepared.category,
            "sourceUrl": source_url,
            "sourceName": prepared.source_name,
            "originalTitle": prepared.original_title,
        })
    return output


def add_text(parent: ET.Element, name: str, value: str, attrs: dict | None = None) -> ET.Element:
    node = ET.SubElement(parent, f"{{{ATOM}}}{name}", attrs or {})
    node.text = value
    return node


def add_entry(feed: ET.Element, entry_id: str, title: str, content: str, description: str, category: str, kind: str, published: str) -> None:
    entry = ET.SubElement(feed, f"{{{ATOM}}}entry")
    add_text(entry, "id", f"tag:flowtrend.com.br,2026:{kind}/{entry_id}")
    add_text(entry, "title", title)
    add_text(entry, "updated", published)
    add_text(entry, "published", published)
    ET.SubElement(entry, f"{{{ATOM}}}category", {"scheme": "http://schemas.google.com/g/2005", "term": f"{BLOGGER}#{kind}"})
    if category:
        ET.SubElement(entry, f"{{{ATOM}}}category", {"term": category, "scheme": "http://www.blogger.com/atom/ns#"})
    add_text(entry, "summary", description, {"type": "html"})
    add_text(entry, "content", content, {"type": "html"})


def build_blogger_xml(items: list[dict], contact_email: str = "contato@flowtrend.com.br") -> bytes:
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    feed = ET.Element(f"{{{ATOM}}}feed")
    add_text(feed, "id", "tag:flowtrend.com.br,2026:feed")
    add_text(feed, "title", "Flow Trend")
    add_text(feed, "updated", now)
    add_text(feed, "generator", "FlowTrend local editorial processor")
    for index, (title, template) in enumerate(LEGAL_PAGES.items(), 1):
        content = template.format(email=html.escape(contact_email), date=dt.date.today().isoformat())
        add_entry(feed, f"page-{index}", title, content, meta_description(content), "Institucional", "page", now)
    for index, item in enumerate(items, 1):
        add_entry(feed, f"post-{index}", item["title"], item["content"], item["description"], item["category"], "post", now)
    return ET.tostring(feed, encoding="utf-8", xml_declaration=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--format", choices=["json", "xml"], default="json")
    parser.add_argument("--contact-email", default="contato@flowtrend.com.br")
    args = parser.parse_args()
    raw = sys.stdin.buffer.read()
    if not raw.strip():
        raise SystemExit("Entrada vazia")
    records = records_from_xml(raw) if raw.lstrip().startswith(b"<") else records_from_json(raw)
    items = process_records(records)
    if args.format == "xml":
        sys.stdout.buffer.write(build_blogger_xml(items, args.contact_email))
    else:
        sys.stdout.write(json.dumps({"items": items, "total": len(items)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
