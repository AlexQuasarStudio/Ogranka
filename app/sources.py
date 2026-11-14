"""Demo/file sources and reconstruction quality labels."""
import os

import numpy as np

from core import pipeline


def demo_body(name):
    phi = (1 + 5**0.5) / 2
    if name == "octa":
        v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    elif name == "icosa":
        v = [
            [0, 1, phi],
            [0, 1, -phi],
            [0, -1, phi],
            [0, -1, -phi],
            [1, phi, 0],
            [1, -phi, 0],
            [-1, phi, 0],
            [-1, -phi, 0],
            [phi, 0, 1],
            [phi, 0, -1],
            [-phi, 0, 1],
            [-phi, 0, -1],
        ]
    elif name == "dodeca":
        v = []
        for a in (1, -1):
            for b in (1, -1):
                for c in (1, -1):
                    v.append([a, b, c])
        for a in (1, -1):
            for b in (1, -1):
                v += [[0, a / phi, b * phi], [a / phi, b * phi, 0], [a * phi, 0, b / phi]]
    elif name == "diamond":
        v = []
        for r, z in [(0.8, 3.0), (1.7, 2.05), (1.7, 1.95), (0.1, 0.0)]:
            for k in range(10):
                a = 2 * np.pi * k / 10
                v.append([r * np.cos(a), r * np.sin(a), z])
    elif name == "cube":
        v = [[x, y, z] for z in (0.0, 3.0) for x in (-1.0, 1.0) for y in (-1.0, 1.0)]
    elif name == "prism":
        v = []
        for z in (0.0, 3.0):
            for k in range(8):
                a = 2 * np.pi * k / 8 + np.pi / 8
                v.append([1.2 * np.cos(a), 1.2 * np.sin(a), z])
    else:
        raise ValueError(f"неизвестное тело: {name}")
    return np.asarray(v, float)


GOOD_RMSE = 0.03
MEDIUM_RMSE = 0.12


def quality(m):
    if not m or m.get("rmse") is None:
        return None
    r = float(m["rmse"])
    return "good" if r < GOOD_RMSE else ("medium" if r < MEDIUM_RMSE else "bad")


def prepare_source(source, report=None):
    def say(text, frac):
        if report:
            report(text, frac)

    if source["kind"] == "demo":
        say("демо-тело", 0.01)
        v = pipeline.normalize_mesh(demo_body(source["name"]), flip=False)
        title = {
            "octa": "Октаэдр",
            "icosa": "Икосаэдр",
            "dodeca": "Додекаэдр",
            "diamond": "Бриллиант",
            "cube": "Куб",
            "prism": "Восьмиугольная призма",
        }[source["name"]]
        say("нормализация", 0.03)
        v, faces = pipeline.hull(v)
        say("выпуклая оболочка", 0.05)
        return v, faces, title

    path = source["path"]
    say("чтение файла", 0.01)
    with open(path, encoding="utf-8", errors="ignore") as fh:
        text = fh.read()
    say("разбор OBJ" if path.lower().endswith(".obj") else "разбор точек", 0.02)
    if path.lower().endswith(".obj"):
        v, faces = pipeline.parse_obj(text)
    else:
        v = pipeline.parse_points(text)
        faces = []
    if len(v) < 4:
        raise ValueError("меньше четырёх точек")
    say("нормализация", 0.04)
    v = pipeline.normalize_mesh(v, flip=True)
    say("выпуклая оболочка", 0.06)
    v, faces = pipeline.hull(v)
    return v, faces, source.get("name") or os.path.basename(path)
