import json
import os
import tempfile
import unittest
from unittest.mock import patch

import app


class FeedbackTest(unittest.TestCase):
    def test_add_list_and_update_feedback(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "feedback.json")
            with patch.object(app, "FEEDBACK_FILE", path):
                item = app._add_feedback(
                    {"type": "Ошибка", "name": "Тест", "contact": "test@example.com", "message": "Не работает кнопка"}
                )
                self.assertEqual(item["status"], "in_progress")
                self.assertTrue(os.path.isfile(path))
                items = app._feedback_items()
                self.assertEqual(len(items), 1)
                self.assertEqual(items[0]["message"], "Не работает кнопка")
                updated = app._set_feedback_status(item["id"], "done")
                self.assertIsNotNone(updated)
                self.assertEqual(app._feedback_items()[0]["status"], "done")

    def test_feedback_can_be_deleted(self):
        with tempfile.TemporaryDirectory() as root:
            with patch.object(app, "FEEDBACK_FILE", os.path.join(root, "feedback.json")):
                item = app._add_feedback({"message": "Удалить меня"})
                self.assertTrue(app._delete_feedback(item["id"]))
                self.assertEqual(app._feedback_items(), [])
                self.assertFalse(app._delete_feedback(item["id"]))

    def test_empty_feedback_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            with patch.object(app, "FEEDBACK_FILE", os.path.join(root, "feedback.json")):
                with self.assertRaises(ValueError):
                    app._add_feedback({"message": " "})

    def test_unknown_feedback_status_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            with patch.object(app, "FEEDBACK_FILE", os.path.join(root, "feedback.json")):
                item = app._add_feedback({"message": "Запрос"})
                with self.assertRaises(ValueError):
                    app._set_feedback_status(item["id"], "later")

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
            with patch.object(app, "RUNS", root):
                models = app.load_all_models()
        self.assertEqual([m["name"] for m in models], ["старая", "новая"])


if __name__ == "__main__":
    unittest.main()
