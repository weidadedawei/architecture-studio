import json
import unittest
from http_smoke import SmokeRunner, CheckFailure

class PublishedCommitTests(unittest.TestCase):
    def runner(self, published, expected):
        runner = SmokeRunner("https://example.com/architecture-studio/", 10, expected_commit=expected)
        marker = {"status":"ok","app":"Device Demo Architecture Studio","diagrams":["system","network"],"locales":["zh-CN","en"],"sourceCommit":published}
        runner.fetch = lambda *args, **kwargs: (200, json.dumps(marker).encode(), {})
        return runner

    def test_current_commit_is_accepted(self):
        sha = "a" * 40
        self.assertIn("source commit matches", self.runner(sha, sha).health())

    def test_stale_cdn_marker_is_rejected(self):
        with self.assertRaises(CheckFailure):
            self.runner("a" * 40, "b" * 40).health()

    def test_manual_local_build_needs_no_git_stamp(self):
        self.assertIn("static deployment marker matches", self.runner("local-build", None).health())
