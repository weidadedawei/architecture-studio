#!/usr/bin/env python3
"""Regression tests using independent tiny artifacts and corrupted copies.

All fixtures are generated in a temporary directory. This suite never modifies
or publishes the actual diagrams and requires only Python's standard library.
"""
import base64
import json
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

import static_check


def png_bytes(width, height):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    pixels = b"".join(b"\x00" + b"\xff\xff\xff\xff" * width for _ in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


def fixture_book():
    result = {"schema": 2, "storageId": "portable-example-fixture", "active": "system", "locale": "zh-CN", "diagrams": {}, "drafts": {}}
    for kind in static_check.DIAGRAMS:
        result["diagrams"][kind] = {
            "schema": 1, "diagramType": kind, "width": 64, "height": 48,
            "title": "示例", "groups": [], "annotations": [],
            "nodes": [
                {"id": "client", "x": 2, "y": 2, "w": 16, "h": 10, "name": "客户端", "icon": "monitor"},
                {"id": "service", "x": 42, "y": 30, "w": 16, "h": 10, "name": "服务", "modules": ["示例任务"]},
            ],
            "edges": [{"id": "request", "from": "client", "to": "service", "route": "poly", "waypoints": [[30, 7], [30, 35]], "label": "HTTPS", "labelPosition": [24, 20]}],
            "translations": {
                "zh-CN": {"diagram.title": "示例", "node.client.name": "客户端", "node.service.name": "服务", "node.service.modules": ["示例任务"], "edge.request.label": "HTTPS"},
                "en": {"diagram.title": "Example", "node.client.name": "Client", "node.service.name": "Service", "node.service.modules": ["Example task"], "edge.request.label": "HTTPS"},
            },
        }
    return result


class StaticCheckTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="diagram-check-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for folder in ("demo", "images", "examples"):
            (self.root / folder).mkdir()
        self.book = fixture_book()
        self.save_project()
        for kind in static_check.DIAGRAMS:
            for locale in static_check.LOCALES:
                base = self.root / "images" / f"{kind}-{locale}"
                base.with_suffix(".svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48"><rect width="64" height="48" fill="white"/></svg>', encoding="utf-8")
                base.with_suffix(".png").write_bytes(png_bytes(128, 96))
                base.with_suffix(".drawio").write_text('<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="client" parent="1" vertex="1"/><mxCell id="service" parent="1" vertex="1"/><mxCell id="request" parent="1" edge="1" source="client" target="service"/></root></mxGraphModel></diagram></mxfile>', encoding="utf-8")

    def save_project(self, update_html=True):
        raw = json.dumps(self.book, ensure_ascii=False)
        (self.root / "demo/diagram-project.json").write_text(raw, encoding="utf-8")
        (self.root / "examples/01-bilingual-edit.json").write_text(raw, encoding="utf-8")
        if update_html:
            icon = base64.b64encode(b'<svg xmlns="http://www.w3.org/2000/svg"/>').decode()
            embedded = json.dumps({"book": self.book, "icons": {"monitor": {"src": "data:image/svg+xml;base64," + icon}}, "ui": {}}, ensure_ascii=False)
            (self.root / "demo/index.html").write_text('<!doctype html><html><head><style>body{color:#123}</style></head><body><script id="editorData" type="application/json">' + embedded + '</script><script>const example=1;</script></body></html>', encoding="utf-8")

    def results(self):
        return {item["id"]: item for item in static_check.run_checks(self.root)["checks"]}

    def assert_rejected(self, check_id):
        result = self.results()[check_id]
        self.assertEqual("FAIL", result["status"], result)

    def test_01_independent_valid_fixture_passes_all_checks(self):
        report = static_check.run_checks(self.root)
        self.assertEqual(13, report["passed"], report)
        self.assertEqual(0, report["failed"])

    def test_02_remote_script_is_rejected(self):
        page = self.root / "demo/index.html"
        page.write_text(page.read_text() + '<script src="https://example.invalid/library.js"></script>')
        self.assert_rejected("offline_html")

    def test_03_dangling_endpoint_is_rejected(self):
        self.book["diagrams"]["system"]["edges"][0]["to"] = "missing-node"
        self.save_project()
        self.assert_rejected("endpoints")

    def test_04_outside_canvas_waypoint_is_rejected(self):
        self.book["diagrams"]["network"]["edges"][0]["waypoints"][0] = [1000, 7]
        self.save_project()
        self.assert_rejected("geometry")

    def test_05_module_string_instead_of_array_is_rejected(self):
        self.book["diagrams"]["system"]["translations"]["en"]["node.service.modules"] = "Not an array"
        self.save_project()
        self.assert_rejected("bilingual_text")

    def test_06_cross_collection_id_collision_is_rejected(self):
        self.book["diagrams"]["system"]["annotations"] = [{"id": "client", "x": 1, "y": 1, "text": "collision"}]
        self.save_project()
        self.assert_rejected("unique_ids")

    def test_07_stale_embedded_project_is_rejected(self):
        self.book["diagrams"]["system"]["nodes"][0]["x"] = 3
        self.save_project(update_html=False)
        self.assert_rejected("embedded_project")

    def test_08_damaged_png_is_rejected(self):
        (self.root / "images/network-en.png").write_bytes(b"not a png")
        self.assert_rejected("png_exports")

    def test_09_private_marker_is_rejected_without_echoing_it(self):
        self.book["diagrams"]["system"]["title"] = "PRIVATE_PROJECT architecture"
        self.save_project()
        result = self.results()["redaction_scan"]
        self.assertEqual("FAIL", result["status"])
        self.assertNotIn("PRIVATE_PROJECT", result["detail"])
        self.book["diagrams"]["system"]["title"] = "Example"
        self.save_project()
        source = self.root / "demo/source"
        source.mkdir()
        (source / "example.js").write_text('const example = "PRIVATE_PROJECT";')
        self.assert_rejected("redaction_scan")

    def test_10_invalid_drawio_endpoint_is_rejected(self):
        path = self.root / "images/system-en.drawio"
        path.write_text(path.read_text().replace('target="service"', 'target="missing"'))
        self.assert_rejected("drawio_exports")

    def test_11_cli_reports_all_checks_and_nonzero_exit(self):
        (self.root / "images/system-en.png").unlink()
        report_path = self.root / "reports/static.json"
        run = subprocess.run([sys.executable, str(Path(static_check.__file__)), "--root", str(self.root), "--report", str(report_path)], capture_output=True, text=True, check=False)
        self.assertEqual(1, run.returncode)
        report = json.loads(report_path.read_text())
        self.assertEqual(13, len(report["checks"]))
        self.assertGreaterEqual(report["failed"], 2)
        self.assertIn("[PASS]", run.stdout)
        self.assertIn("[FAIL]", run.stdout)

    def test_12_svg_external_image_is_rejected(self):
        path = self.root / "images/network-zh-CN.svg"
        path.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48"><image href="https://example.invalid/photo.png"/></svg>')
        self.assert_rejected("svg_exports")

    def test_13_group_endpoints_and_explicit_decorative_lines_are_valid(self):
        model = self.book["diagrams"]["system"]
        model["groups"] = [{"id": "boundary", "x": 1, "y": 1, "w": 60, "h": 44}]
        model["edges"][0]["to"] = "boundary"
        self.save_project()
        path = self.root / "images/system-en.drawio"
        line = '<mxCell id="legend-line" edge="1" parent="1" style="endArrow=none;"><mxGeometry><mxPoint x="0" y="0" as="sourcePoint"/><mxPoint x="8" y="0" as="targetPoint"/></mxGeometry></mxCell>'
        path.write_text(path.read_text().replace('</root>', line + '</root>'))
        report = static_check.run_checks(self.root)
        self.assertEqual(0, report["failed"], report)


if __name__ == "__main__":
    unittest.main(verbosity=2)
