#!/usr/bin/env python3
"""Read-only HTTP checks for the public, anonymized architecture demo.

Python standard library only. This checks the deployed static artifacts; it does
not execute JavaScript, mutate server state, or validate the pictured services.
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import json
import re
import ssl
import struct
import sys
import uuid
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

DIAGRAMS = ("system", "network")
LOCALES = ("zh-CN", "en")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class CheckFailure(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise CheckFailure(message)


def normalize_base(value):
    try:
        url = urlsplit(value)
        port = url.port
    except ValueError as exc:
        raise argparse.ArgumentTypeError("base URL has an invalid host or port") from exc
    if url.scheme not in ("https", "http") or not url.hostname:
        raise argparse.ArgumentTypeError("use an absolute https:// URL, or http:// for a local rehearsal")
    if url.username or url.password or url.query or url.fragment or re.search(r"\s", value):
        raise argparse.ArgumentTypeError("base URL must not contain credentials, whitespace, a query, or a fragment")
    if port is not None and not 0 < port < 65536:
        raise argparse.ArgumentTypeError("base URL has an invalid port")
    if url.scheme == "http":
        local = url.hostname.lower() == "localhost"
        try:
            local = local or ipaddress.ip_address(url.hostname).is_loopback
        except ValueError:
            pass
        if not local:
            raise argparse.ArgumentTypeError("plain HTTP is permitted only for localhost or a loopback IP; use HTTPS publicly")
    return urlunsplit((url.scheme, url.netloc, url.path.rstrip("/") + "/", "", ""))


class SafeRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        old, new = urlsplit(req.full_url), urlsplit(newurl)
        require(new.scheme in ("http", "https"), "redirect uses an unsupported protocol")
        require(not (old.scheme == "https" and new.scheme != "https"), "HTTPS was redirected to an insecure URL")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.titles = []
        self.blocks = []
        self._title = False
        self._data = False
        self._parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "title":
            self._title = True
        if tag == "script" and attrs.get("id") == "editorData":
            require(not self._data, "nested editorData block")
            self._data = True
            self._parts = []

    def handle_data(self, data):
        if self._title:
            self.titles.append(data)
        if self._data:
            self._parts.append(data)

    def handle_endtag(self, tag):
        if tag == "title":
            self._title = False
        if tag == "script" and self._data:
            self.blocks.append("".join(self._parts))
            self._data = False
            self._parts = []


def parse_json(body):
    try:
        return json.loads(body.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CheckFailure("response is not valid UTF-8 JSON") from exc


def validate_book(book):
    require(isinstance(book, dict) and book.get("schema") == 2, "project schema must equal 2")
    diagrams = book.get("diagrams")
    require(isinstance(diagrams, dict) and set(diagrams) == set(DIAGRAMS), "project must contain system and network diagrams")
    require(book.get("active") in DIAGRAMS, "project has an invalid active diagram")
    require(book.get("locale") in LOCALES, "project has an invalid current locale")
    count = 0
    for name in DIAGRAMS:
        model = diagrams[name]
        require(isinstance(model, dict) and model.get("diagramType") == name, f"{name}: invalid diagram type")
        for collection in ("groups", "nodes", "edges", "annotations"):
            require(isinstance(model.get(collection), list), f"{name}: {collection} must be an array")
        require(bool(model["nodes"]), f"{name}: nodes are missing")
        ids = {item.get("id") for item in model["nodes"] + model["groups"] if isinstance(item, dict)}
        for edge in model["edges"]:
            require(isinstance(edge, dict) and edge.get("from") in ids and edge.get("to") in ids, f"{name}: invalid connection endpoint")
        translations = model.get("translations")
        require(isinstance(translations, dict), f"{name}: translations are missing")
        require(all(isinstance(translations.get(locale), dict) and translations[locale] for locale in LOCALES), f"{name}: both translation catalogs are required")
        zh, en = (translations[locale] for locale in LOCALES)
        require(set(zh) == set(en), f"{name}: translation key sets differ")
        for key, value in zh.items():
            other = en[key]
            if key.endswith(".modules"):
                require(isinstance(value, list) and isinstance(other, list) and len(value) == len(other), f"{name}: module translations have different structures")
                require(all(isinstance(item, str) for item in value + other), f"{name}: module translations must be string arrays")
            else:
                require(isinstance(value, str) and isinstance(other, str), f"{name}: translation values must be strings")
        count += len(zh)
    return f"two diagrams, two locales, {count} paired translation keys"


class SmokeRunner:
    def __init__(self, base_url, timeout, ssl_context=None, expected_commit=None):
        self.base_url = base_url
        self.expected_commit = expected_commit
        self.timeout = timeout
        # create_default_context keeps CERT_REQUIRED and hostname verification.
        context = ssl_context if ssl_context is not None else ssl.create_default_context()
        self.opener = build_opener(SafeRedirects(), HTTPSHandler(context=context))
        self.results = []

    def fetch(self, route, maximum=5 * 1024 * 1024, byte_range=False):
        headers = {"User-Agent": "DeviceDemo-Architecture-Smoke/1.0", "Accept-Encoding": "identity"}
        if byte_range:
            headers["Range"] = f"bytes=0-{maximum - 1}"
        request = Request(urljoin(self.base_url, route), headers=headers)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                status = response.status
                # For ZIP checks, read only the requested prefix even when a host
                # ignores Range and returns 200. Closing avoids a full download.
                body = response.read(maximum if byte_range else maximum + 1)
                require(byte_range or len(body) <= maximum, "response exceeds the checker's size limit")
                return status, body, response.headers
        except HTTPError as exc:
            with exc:
                return exc.code, exc.read(min(maximum, 4096)), exc.headers
        except (URLError, TimeoutError, OSError, HTTPException) as exc:
            # urllib wraps certificate errors in URLError; direct SSL errors are
            # OSError subclasses. Do not expose exception text or CA file paths.
            cause = exc.reason if isinstance(exc, URLError) else exc
            if isinstance(cause, ssl.SSLCertVerificationError):
                raise CheckFailure("TLS certificate verification failed; check the server certificate and trusted CA bundle; supply --ca-file PATH with a trusted PEM bundle (verification stays enabled)") from exc
            raise CheckFailure(f"request failed ({type(exc).__name__}); check DNS, TLS, connectivity, and timeout") from exc

    def check(self, check_id, route, callback):
        try:
            detail = callback()
            result = {"id": check_id, "route": route, "status": "PASS", "detail": detail}
        except (CheckFailure, ValueError, TypeError, KeyError, ET.ParseError, UnicodeDecodeError) as exc:
            result = {"id": check_id, "route": route, "status": "FAIL", "detail": str(exc)}
        self.results.append(result)
        print(f"[{result['status']}] {check_id}: {result['detail']}")

    def root(self):
        status, body, _ = self.fetch("")
        require(status == 200, f"expected HTTP 200, received {status}")
        page = PageParser()
        page.feed(body.decode("utf-8-sig"))
        require(len(page.blocks) == 1, "root page must contain exactly one script#editorData")
        data = parse_json(page.blocks[0].encode("utf-8"))
        require(isinstance(data, dict) and isinstance(data.get("icons"), dict) and isinstance(data.get("ui"), dict), "editorData must include inline icons and UI data")
        return "HTTP 200; " + validate_book(data.get("book"))

    def guide(self):
        status, body, _ = self.fetch("guide.html")
        require(status == 200, f"expected HTTP 200, received {status}")
        page = PageParser()
        page.feed(body.decode("utf-8-sig"))
        title = "".join(page.titles).strip()
        require(title and ("architecture studio" in title.lower() or "架构" in title), "guide needs a meaningful architecture tutorial <title>")
        require(not page.blocks, "guide unexpectedly returned the editor page; check SPA fallback or routing")
        return "HTTP 200; architecture tutorial title exists"

    def health(self):
        status, body, _ = self.fetch("health.json", maximum=64 * 1024)
        require(status == 200, f"expected HTTP 200, received {status}")
        data = parse_json(body)
        expected = {"status": "ok", "app": "Device Demo Architecture Studio", "diagrams": list(DIAGRAMS), "locales": list(LOCALES)}
        require(isinstance(data, dict) and all(data.get(key) == value for key, value in expected.items()), "health fields differ from the published static demo contract")
        if self.expected_commit:
            require(data.get("sourceCommit") == self.expected_commit, "deployed source commit differs from the expected commit; deployment or CDN propagation is incomplete")
        return "HTTP 200; static deployment marker matches (not backend health)" + ("; source commit matches" if self.expected_commit else "")

    def example(self, route):
        status, body, _ = self.fetch(route)
        require(status == 200, f"expected HTTP 200, received {status}")
        return "HTTP 200; " + validate_book(parse_json(body))

    def svg(self, route):
        status, body, _ = self.fetch(route)
        require(status == 200, f"expected HTTP 200, received {status}")
        require(len(body) >= 256, "SVG is unexpectedly small")
        root = ET.fromstring(body)
        require(root.tag.rsplit("}", 1)[-1] == "svg", "response is not an SVG document (possible HTML fallback)")
        require(bool(root.get("viewBox") or (root.get("width") and root.get("height"))), "SVG has no canvas dimensions")
        return f"HTTP 200; valid SVG, {len(body)} bytes"

    def png(self, route):
        status, body, _ = self.fetch(route, maximum=16 * 1024 * 1024)
        require(status == 200, f"expected HTTP 200, received {status}")
        require(len(body) >= 1024 and body.startswith(PNG_SIGNATURE), "response lacks a plausible PNG signature and size")
        require(body[12:16] == b"IHDR" and len(body) >= 24, "PNG IHDR chunk is missing")
        width, height = struct.unpack(">II", body[16:24])
        require(0 < width <= 20000 and 0 < height <= 20000, "PNG dimensions are invalid")
        require(body[-12:-4] == b"\x00\x00\x00\x00IEND", "PNG is incomplete or lacks its IEND chunk")
        return f"HTTP 200; PNG {width} x {height}, {len(body)} bytes"

    def archive(self):
        status, body, _ = self.fetch("downloads/Architecture_Studio_CSDN.zip", maximum=1024, byte_range=True)
        require(status in (200, 206), f"expected HTTP 200 or 206, received {status}")
        require(body.startswith(b"PK\x03\x04"), "download does not start with a ZIP local-file header (possible HTML fallback)")
        mode = "partial content" if status == 206 else "server ignored Range; read only first 1024 bytes"
        return f"HTTP {status}; ZIP header valid; {mode}; archive integrity is not assessed here"

    def missing(self, route):
        status, body, _ = self.fetch(route, maximum=8192, byte_range=True)
        if status == 200:
            looks_html = b"<html" in body.lower() or b"<!doctype html" in body.lower()
            suffix = "; HTML/SPA fallback detected" if looks_html else "; host returned success for an unknown path"
            raise CheckFailure("expected HTTP 404, received 200" + suffix + "; record this hosting limitation instead of treating it as a real 404")
        require(status == 404, f"expected HTTP 404, received {status}")
        return "unknown path returns real HTTP 404"

    def run(self):
        self.check("editor", "/", self.root)
        self.check("guide", "/guide.html", self.guide)
        self.check("health-marker", "/health.json", self.health)
        for filename in ("01-bilingual-edit.json", "02-customized-project.json"):
            route = "examples/" + filename
            self.check("example:" + filename, "/" + route, lambda route=route: self.example(route))
        for diagram in DIAGRAMS:
            for locale in LOCALES:
                for suffix, checker in (("svg", self.svg), ("png", self.png)):
                    route = f"images/{diagram}-{locale}.{suffix}"
                    self.check(f"image:{diagram}-{locale}.{suffix}", "/" + route, lambda route=route, checker=checker: checker(route))
        self.check("download-zip", "/downloads/Architecture_Studio_CSDN.zip", self.archive)
        missing = "__architecture_smoke_missing_" + uuid.uuid4().hex + ".html"
        self.check("real-404", "/<generated-missing-page>.html", lambda: self.missing(missing))
        return self.results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, type=normalize_base, help="public HTTPS demo root; localhost HTTP is allowed for local rehearsal")
    parser.add_argument("--report", type=Path, help="write a UTF-8 JSON result (no local filesystem paths are recorded)")
    parser.add_argument("--ca-file", type=Path, help="optional trusted PEM CA bundle; certificate and hostname verification remain enabled")
    parser.add_argument("--expected-commit", help="optional full Git commit SHA expected in health.json")
    parser.add_argument("--timeout", type=float, default=15, help="per-request timeout in seconds (default: 15)")
    args = parser.parse_args(argv)
    if args.expected_commit and not re.fullmatch(r"[0-9a-f]{40}", args.expected_commit):
        parser.error("--expected-commit must be a full lowercase Git SHA")
    if not 0 < args.timeout <= 60:
        parser.error("--timeout must be greater than zero and at most 60")
    try:
        context = ssl.create_default_context(cafile=str(args.ca_file) if args.ca_file else None)
    except (OSError, ssl.SSLError):
        parser.error("unable to load the trusted CA bundle; check --ca-file permissions and PEM contents")
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    runner = SmokeRunner(args.base_url, args.timeout, ssl_context=context, expected_commit=args.expected_commit)
    results = runner.run()
    passed = sum(item["status"] == "PASS" for item in results)
    report = {
        "kind": "online-http-smoke",
        "started_at_utc": started,
        "finished_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        # Keep only the origin; a caller's URL path can contain private names.
        "target_origin": urlunsplit((*urlsplit(args.base_url)[:2], "", "", "")),
        "expected_source_commit": args.expected_commit,
        "total": len(results), "passed": passed, "failed": len(results) - passed,
        "checks": results,
        "limitations": [
            "HTTP artifact checks do not execute browser JavaScript or verify editing and export interactions.",
            "health.json is a static deployment marker, not a backend, database, MQTT, or AWS health probe.",
            "The ZIP check reads its prefix only and does not prove archive integrity or safety.",
            "A 200 SPA fallback for an unknown route is reported as a failed real-404 check.",
        ],
    }
    if args.report:
        try:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        except OSError:
            print("[FAIL] report: unable to write JSON report; check destination permissions", file=sys.stderr)
            return 2
    print(f"HTTP checks: {passed}/{len(results)} PASS; {len(results) - passed} FAIL")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
