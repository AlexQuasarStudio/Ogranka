import json
import os
import tempfile
import unittest
from unittest.mock import patch

import jobs
import releases


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class GithubIssuesTest(unittest.TestCase):
    def test_parses_issues_and_labels_and_skips_pull_requests(self):
        payload = [
            {
                "number": 12,
                "title": "Не работает кнопка",
                "state": "open",
                "html_url": "https://github.com/AlexQuasarStudio/Ogranka/issues/12",
                "comments": 3,
                "created_at": "2026-11-16T10:00:00Z",
                "updated_at": "2026-11-16T11:00:00Z",
                "user": {"login": "tester"},
                "labels": [{"name": "bug", "color": "d73a4a"}],
            },
            {
                "number": 13,
                "title": "PR",
                "pull_request": {"url": "https://example.com"},
            },
        ]
        with patch("releases.urlopen", return_value=FakeResponse(payload)):
            result = releases.github_issues(True)
        self.assertTrue(result["checked"])
        self.assertEqual(len(result["issues"]), 1)
        issue = result["issues"][0]
        self.assertEqual(issue["number"], 12)
        self.assertEqual(issue["labels"][0]["name"], "bug")

    def test_load_all_models_keeps_every_run(self):
        with tempfile.TemporaryDirectory() as root:
            for name, model_name, stamp in (
                ("run-a", "старая", 1000),
                ("run-b", "новая", 2000),
            ):
                run = os.path.join(root, name)
                os.makedirs(run)
                path = os.path.join(run, "results.json")
                with open(path, "w", encoding="utf-8") as f:
                    json.dump({"models": [{"name": model_name}]}, f)
                os.utime(path, (stamp, stamp))
            models = jobs.load_all_models(root)
        self.assertEqual([m["name"] for m in models], ["старая", "новая"])


if __name__ == "__main__":
    unittest.main()
