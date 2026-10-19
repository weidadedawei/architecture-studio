#!/usr/bin/env python3
"""Dependency-free release checks for the offline architecture tutorial.

These checks validate the shipped artifacts; they do not execute JavaScript,
verify a deployed environment, or prove that arbitrary secrets are absent.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import re
import struct
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

DIAGRAMS = ("system", "network")
LOCALES = ("zh-CN", "en")
SUFFIXES = ("svg", "png", "drawio")


class CheckFailure(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise CheckFailure(message)


def relative(path, root):
    return str(path.relative_to(root))


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.data_blocks = []
        self.external = []
        self._collect = False
        self._parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("id") == "editorData":
            require(not self._collect, "nested editorData script")
            self._collect = True
            self._parts = []
        resource_attributes = []
        if tag in ("script", "img", "iframe", "embed", "audio", "video", "source", "track", "input"):
            resource_attributes += ["src", "srcset", "poster"]
        if tag == "object":
            resource_attributes += ["data"]
        if tag == "link" and set(attrs.get("rel", "").lower().split()) & {
            "stylesheet", "preload", "modulepreload", "icon", "manifest"
        }:
            resource_attributes += ["href"]
        for attr in resource_attributes:
            value = attrs.get(attr, "").strip()
            if value and not value.startswith(("data:", "#")):
                self.external.append(f"<{tag}> {attr}={value[:100]}")
        if tag == "base" and attrs.get("href"):
            self.external.append("<base href> can change resource resolution")

    def handle_data(self, data):
        if self._collect:
            self._parts.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._collect:
            self.data_blocks.append("".join(self._parts))
            self._collect = False
            self._parts = []


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_page(root):
    html = (root / "demo/index.html").read_text(encoding="utf-8")
    page = PageParser()
    page.feed(html)
    require(len(page.data_blocks) == 1, "exactly one script#editorData is required")
    data = json.loads(page.data_blocks[0])
    require(isinstance(data, dict) and isinstance(data.get("book"), dict), "editorData.book must be an object")
    return html, page, data


def books(root):
    paths = [root / "demo/diagram-project.json"] + sorted((root / "examples").glob("*.json"))
    return [(relative(path, root), read_json(path)) for path in paths]


def walk_models(root):
    for filename, book in books(root):
        require(isinstance(book, dict), f"{filename}: project must be an object")
        require(isinstance(book.get("diagrams"), dict), f"{filename}: diagrams must be an object")
        for diagram_id, model in book["diagrams"].items():
            require(isinstance(model, dict), f"{filename}/{diagram_id}: diagram must be an object")
            yield f"{filename}/{diagram_id}", model


def required_files(root):
    paths = [root / "demo/index.html", root / "demo/diagram-project.json", root / "examples/01-bilingual-edit.json"]
    paths += [root / "images" / f"{kind}-{locale}.{suffix}" for kind in DIAGRAMS for locale in LOCALES for suffix in SUFFIXES]
    missing = [relative(path, root) for path in paths if not path.is_file() or path.stat().st_size == 0]
    require(not missing, "missing or empty artifacts: " + ", ".join(missing))
    return f"{len(paths)} required artifacts exist and are nonempty"


def embedded_project(root):
    _, _, data = load_page(root)
    project = read_json(root / "demo/diagram-project.json")
    require(data["book"] == project, "editorData.book differs from demo/diagram-project.json")
    return "HTML embedded project exactly matches the downloadable JSON"


def project_structure(root):
    for filename, book in books(root):
        require(isinstance(book, dict) and book.get("schema") == 2, f"{filename}: schema must equal 2")
        require(set(book.get("diagrams", {})) == set(DIAGRAMS), f"{filename}: system and network diagrams are required")
        require(book.get("active") in DIAGRAMS, f"{filename}: invalid active diagram")
        require(book.get("locale") in LOCALES, f"{filename}: invalid current locale")
        require(isinstance(book.get("storageId"), str) and bool(book["storageId"].strip()), f"{filename}: storageId is missing")
    for name, model in walk_models(root):
        for collection in ("groups", "nodes", "edges", "annotations"):
            require(isinstance(model.get(collection), list), f"{name}: {collection} must be an array")
        require(model["nodes"], f"{name}: empty node collection")
        require(model.get("diagramType") in DIAGRAMS, f"{name}: unknown diagramType")
    return "All projects have schema 2, two diagrams, a valid active view and locale"


def bilingual_text(root):
    checked = 0
    for name, model in walk_models(root):
        translations = model.get("translations")
        require(isinstance(translations, dict) and all(isinstance(translations.get(l), dict) for l in LOCALES), f"{name}: two translation catalogs are required")
        zh, en = (translations[l] for l in LOCALES)
        require(set(zh) == set(en), f"{name}: locale key sets differ")
        required = set()
        for field in ("title", "kicker", "mode", "referenceNote", "baseline"):
            if field in model and model[field] != "":
                required.add(f"diagram.{field}")
        for collection, prefix, fields in (
            ("nodes", "node", ("name", "sub", "detail", "modules")),
            ("groups", "group", ("title", "sub", "code", "footer")),
            ("edges", "edge", ("label",)),
            ("annotations", "annotation", ("text",)),
        ):
            for item in model.get(collection, []):
                for field in fields:
                    if field in item:
                        required.add(f"{prefix}.{item.get('id')}.{field}")
        require(required <= set(zh), f"{name}: untranslated fields: {', '.join(sorted(required - set(zh))[:8])}")
        for key, value in zh.items():
            other = en[key]
            if key.endswith(".modules"):
                require(isinstance(value, list) and isinstance(other, list), f"{name}/{key}: module translations must be arrays")
                require(len(value) == len(other) and all(isinstance(v, str) for v in value + other), f"{name}/{key}: module translations must be equal-length string arrays")
            else:
                require(isinstance(value, str) and isinstance(other, str), f"{name}/{key}: translations must be strings")
            checked += 1
    return f"{checked} paired translation keys have matching keys and value types"


def unique_ids(root):
    count = 0
    for name, model in walk_models(root):
        seen = set()
        for collection in ("groups", "nodes", "edges", "annotations"):
            for item in model.get(collection, []):
                require(isinstance(item, dict), f"{name}/{collection}: item must be an object")
                item_id = item.get("id")
                require(isinstance(item_id, str) and item_id.strip(), f"{name}/{collection}: missing string ID")
                require(item_id not in seen, f"{name}: duplicate ID {item_id}")
                seen.add(item_id)
                count += 1
    return f"{count} IDs are unique within each diagram scope"


def endpoints(root):
    count = 0
    for name, model in walk_models(root):
        node_ids = {n.get("id") for n in model.get("nodes", []) + model.get("groups", []) if isinstance(n, dict)}
        for edge in model.get("edges", []):
            require(edge.get("from") in node_ids and edge.get("to") in node_ids, f"{name}/{edge.get('id')}: dangling edge endpoint")
            for field in ("fromPort", "toPort"):
                if field in edge:
                    require(edge[field] in ("left", "right", "top", "bottom", "auto"), f"{name}/{edge.get('id')}: invalid {field}")
            for field in ("fromFraction", "toFraction"):
                if field in edge:
                    require(number(edge[field]) and 0 <= edge[field] <= 1, f"{name}/{edge.get('id')}: {field} must be between 0 and 1")
            count += 1
    return f"{count} edge endpoint pairs and optional port settings are valid"


def geometry(root):
    count = 0
    for name, model in walk_models(root):
        width, height = model.get("width"), model.get("height")
        require(number(width) and number(height) and width > 0 and height > 0, f"{name}: positive finite canvas size required")
        for collection in ("groups", "nodes"):
            for item in model.get(collection, []):
                values = [item.get(f) for f in ("x", "y", "w", "h")]
                require(all(number(v) for v in values), f"{name}/{item.get('id')}: nonnumeric geometry")
                x, y, w, h = values
                require(x >= 0 and y >= 0 and w > 0 and h > 0 and x + w <= width and y + h <= height, f"{name}/{item.get('id')}: rectangle outside canvas")
                count += 1
        for item in model.get("annotations", []):
            point(item.get("x"), item.get("y"), width, height, f"{name}/{item.get('id')}")
        for edge in model.get("edges", []):
            waypoints = edge.get("waypoints", [])
            require(isinstance(waypoints, list), f"{name}/{edge.get('id')}: waypoints must be an array")
            for index, xy in enumerate(waypoints):
                require(isinstance(xy, list) and len(xy) == 2, f"{name}/{edge.get('id')}: waypoint {index} must contain x,y")
                point(*xy, width, height, f"{name}/{edge.get('id')}/waypoint-{index}")
            if "labelPosition" in edge:
                xy = edge["labelPosition"]
                require(isinstance(xy, list) and len(xy) == 2, f"{name}/{edge.get('id')}: invalid labelPosition")
                point(*xy, width, height, f"{name}/{edge.get('id')}/label")
    return f"{count} rectangles plus annotation and waypoint coordinates fit their canvases"


def point(x, y, width, height, name):
    require(number(x) and number(y) and 0 <= x <= width and 0 <= y <= height, f"{name}: point outside canvas or nonnumeric")


def inline_icons(root):
    _, _, data = load_page(root)
    icons = data.get("icons")
    require(isinstance(icons, dict) and icons, "editorData.icons must be a nonempty object")
    for name, icon in icons.items():
        src = icon.get("src") if isinstance(icon, dict) else icon
        require(isinstance(src, str) and re.match(r"^data:image/[A-Za-z0-9.+-]+;base64,", src), f"icon {name}: base64 data:image source required")
        base64.b64decode(src.split(",", 1)[1], validate=True)
    for name, model in walk_models(root):
        for node in model.get("nodes", []):
            for field in ("icon", "altIcon"):
                if node.get(field):
                    require(node[field] in icons, f"{name}/{node.get('id')}: unknown {field} {node[field]}")
    return f"{len(icons)} icons are embedded; all diagram icon references resolve"


def offline_html(root):
    html, page, _ = load_page(root)
    require(not page.external, "external/nonembedded HTML resource: " + "; ".join(page.external))
    require(not re.search(r"@import\s+(?:url\s*\()?\s*['\"]?(?:https?:)?//", html, re.I), "remote CSS @import")
    require(not re.search(r"url\(\s*['\"]?(?:https?:)?//", html, re.I), "remote CSS url()")
    require(not re.search(r"(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(", html), "network API call found in offline HTML")
    return "HTML resources and icons are inline; no remote CSS or network API calls detected"


def svg_exports(root):
    for kind in DIAGRAMS:
        for locale in LOCALES:
            path = root / "images" / f"{kind}-{locale}.svg"
            xml = ET.fromstring(path.read_bytes())
            require(xml.tag.rsplit("}", 1)[-1] == "svg", f"{path.name}: SVG root required")
            require(xml.get("viewBox"), f"{path.name}: viewBox required")
            for item in xml.iter():
                for key, value in item.attrib.items():
                    if key.rsplit("}", 1)[-1] == "href":
                        require(value.startswith(("data:image/", "#")), f"{path.name}: external image or SVG reference")
    return "All four SVG documents parse and contain no external href resources"


def drawio_exports(root):
    count = 0
    for kind in DIAGRAMS:
        for locale in LOCALES:
            path = root / "images" / f"{kind}-{locale}.drawio"
            xml = ET.fromstring(path.read_bytes())
            require(xml.tag == "mxfile", f"{path.name}: mxfile root required")
            cells = xml.findall(".//mxCell")
            require(cells, f"{path.name}: uncompressed editable mxCell elements required")
            ids = [cell.get("id") for cell in cells]
            require(all(ids) and len(ids) == len(set(ids)), f"{path.name}: duplicate or empty cell IDs")
            vertices = {cell.get("id") for cell in cells if cell.get("vertex") == "1"}
            require(vertices, f"{path.name}: editable vertices required")
            for cell in cells:
                if cell.get("parent"):
                    require(cell.get("parent") in ids, f"{path.name}: unknown parent cell")
                if cell.get("edge") == "1":
                    if cell.get("source") is not None or cell.get("target") is not None:
                        require(cell.get("source") in vertices and cell.get("target") in vertices, f"{path.name}: edge source/target must reference editable vertices")
                        count += 1
                    else:
                        require("endArrow=none;" in cell.get("style", ""), f"{path.name}: unconnected edge is not an explicit decorative line")
                        points = {p.get("as"): p for p in cell.findall("mxGeometry/mxPoint")}
                        require("sourcePoint" in points and "targetPoint" in points, f"{path.name}: decorative line needs sourcePoint and targetPoint")
                        for role in ("sourcePoint", "targetPoint"):
                            coordinates = [float(points[role].get(axis, "nan")) for axis in ("x", "y")]
                            require(all(math.isfinite(v) for v in coordinates), f"{path.name}: decorative line has nonfinite coordinates")
    return f"Four editable Draw.io documents parse; {count} edge endpoint pairs resolve"


def png_exports(root):
    project = read_json(root / "demo/diagram-project.json")
    dimensions = []
    for kind in DIAGRAMS:
        model = project["diagrams"][kind]
        for locale in LOCALES:
            path = root / "images" / f"{kind}-{locale}.png"
            data = path.read_bytes()
            require(data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 33, f"{path.name}: invalid PNG signature")
            require(data[12:16] == b"IHDR" and struct.unpack(">I", data[8:12])[0] == 13, f"{path.name}: missing IHDR")
            w, h = struct.unpack(">II", data[16:24])
            require(w > 0 and h > 0, f"{path.name}: nonpositive PNG dimensions")
            require(w == int(model["width"] * 2) and h == int(model["height"] * 2), f"{path.name}: expected 2x canvas size, got {w}x{h}")
            require(b"IDAT" in data and data[-8:-4] == b"IEND", f"{path.name}: truncated PNG structure")
            dimensions.append(f"{path.name}={w}x{h}")
    return "; ".join(dimensions)


def redaction_scan(root):
    patterns = {
        "private teaching marker": re.compile(r"(?i)\b(?:PRIVATE_PROJECT|INTERNAL_ONLY)\b"),
        "cloud account number": re.compile(r"(?<![A-Za-z0-9.])[0-9]{12}(?![A-Za-z0-9.])"),
        "local user path": re.compile(r"/(?:Users|Volumes|home)/[^\s\"'<>]+|[A-Z]:\\Users\\", re.I),
        "cloud account ARN": re.compile(r"arn:(?:aws|aws-cn|aws-us-gov):[^\s\"'<>]*:[0-9]{12}:", re.I),
        "private key block": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    }
    paths = [root / "demo/index.html", root / "demo/diagram-project.json", root / "examples/01-bilingual-edit.json"]
    paths += list((root / "images").glob("*.svg")) + list((root / "images").glob("*.drawio"))
    paths += [p for p in root.glob("*.md") if not p.name.lower().startswith(("license", "notice"))]
    for folder in (root / "demo/source", root / "examples"):
        paths += [p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in (".html", ".js", ".css", ".json", ".py", ".md", ".txt") and "licenses" not in p.parts and not p.name.lower().startswith(("license", "notice"))]
    paths = sorted(set(paths))
    findings = []
    for path in paths:
        content = path.read_text(encoding="utf-8")
        # Encoded public icon bytes cannot contain readable business labels.
        content = re.sub(r"data:image/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+", "data:image/[embedded]", content)
        for label, pattern in patterns.items():
            if pattern.search(content):
                # Report only a category and filename: never repeat a matched secret.
                findings.append(f"{relative(path, root)}: {label}")
    require(not findings, "redaction patterns found: " + "; ".join(findings))
    return f"{len(paths)} publishable text artifacts passed the documented pattern list (not a general secret-scan guarantee)"


CHECKS = (
    ("required_files", required_files),
    ("embedded_project", embedded_project),
    ("project_structure", project_structure),
    ("bilingual_text", bilingual_text),
    ("unique_ids", unique_ids),
    ("endpoints", endpoints),
    ("geometry", geometry),
    ("inline_icons", inline_icons),
    ("offline_html", offline_html),
    ("svg_exports", svg_exports),
    ("drawio_exports", drawio_exports),
    ("png_exports", png_exports),
    ("redaction_scan", redaction_scan),
)


def run_checks(root):
    root = Path(root).resolve()
    results = []
    for check_id, check in CHECKS:
        try:
            detail = check(root)
            results.append({"id": check_id, "status": "PASS", "detail": detail})
        except Exception as error:
            # Continue so one malformed artifact does not hide independent failures.
            detail = str(error)
            detail = detail.replace(str(root), "<root>")
            results.append({"id": check_id, "status": "FAIL", "detail": detail})
    passed = sum(item["status"] == "PASS" for item in results)
    return {"schema": 1, "kind": "static-artifact-checks", "passed": passed, "failed": len(results) - passed, "total": len(results), "checks": results, "limits": ["No JavaScript execution or browser interaction", "No production, network, security-compliance or performance verification", "Redaction is limited to the documented patterns"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1], help="publish kit root (defaults to parent of tests/)")
    parser.add_argument("--report", type=Path, help="write JSON report to this path")
    args = parser.parse_args(argv)
    report = run_checks(args.root)
    for item in report["checks"]:
        print(f"[{item['status']}] {item['id']}: {item['detail']}")
    print(f"\n{report['passed']}/{report['total']} passed; {report['failed']} failed")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"JSON report: {args.report.name}")
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
