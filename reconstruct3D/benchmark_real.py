"""Сводка бенчмарка реальных моделей по metrics_real.csv."""
import argparse
import csv
from pathlib import Path
import statistics


VARIANTS = ["r0", "r8", "r80", "fft_r8", "fft_r80", "uni_r8", "uni_r80"]
MODES = ["maxima", "envelope"]


def load_rows(path):
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def number(row, key):
    value = row.get(key)
    if value in (None, ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def average(rows, key):
    values = [number(row, key) for row in rows]
    values = [value for value in values if value is not None]
    return statistics.fmean(values) if values else None


def fmt(value, digits=6):
    return "—" if value is None else f"{value:.{digits}f}"


def summarize(rows):
    groups = {}
    for row in rows:
        groups.setdefault((row.get("mode"), row.get("variant")), []).append(row)
    return groups


def improvement(base, improved):
    if not base or not improved or base <= 0:
        return None
    return (base - improved) / base * 100.0


def build_report(rows, source):
    groups = summarize(rows)
    has_time = any(number(row, "time_sec") is not None for row in rows)
    lines = [
        "# Бенчмарк реальных моделей",
        "",
        f"Источник: `{source}`",
        "",
        "| режим | вариант | моделей | MSE | RMSE | d_max | время, с |",
        "|---|---|---:|---:|---:|---:|---:|",
    ]
    for mode in MODES:
        for variant in VARIANTS:
            group = groups.get((mode, variant), [])
            if not group:
                continue
            lines.append(
                "| {mode} | {variant} | {count} | {mse} | {rmse} | {dmax} | {time} |".format(
                    mode=mode,
                    variant=variant,
                    count=len(group),
                    mse=fmt(average(group, "mse")),
                    rmse=fmt(average(group, "rmse")),
                    dmax=fmt(average(group, "dmax")),
                    time=fmt(average(group, "time_sec"), 3) if has_time else "—",
                )
            )
    lines += ["", "## Устойчивость к шуму", ""]
    for mode in MODES:
        base8 = average(groups.get((mode, "r8"), []), "rmse")
        base80 = average(groups.get((mode, "r80"), []), "rmse")
        for variant, base, label in (
            ("fft_r8", base8, "Фурье r8"),
            ("uni_r8", base8, "соседи r8"),
            ("fft_r80", base80, "Фурье r80"),
            ("uni_r80", base80, "соседи r80"),
        ):
            value = average(groups.get((mode, variant), []), "rmse")
            gain = improvement(base, value)
            lines.append(
                f"- {mode}, {label}: RMSE {fmt(value)}, "
                + ("нет данных" if gain is None else f"изменение {gain:+.1f}%")
            )
    if not has_time:
        lines += [
            "",
            "Время не указано: в исходном CSV нет колонки `time_sec`.",
            "Пересоберите метрики через `real_data3D.py`, чтобы получить время.",
        ]
    lines.append("")
    return "\n".join(lines)


def main():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--metrics", default=str(here / "out3D_real" / "metrics_real.csv"))
    parser.add_argument("--out", default=str(here / "out3D_real" / "benchmark_real.md"))
    args = parser.parse_args()
    rows = load_rows(args.metrics)
    report = build_report(rows, args.metrics)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(report + "\n", encoding="utf-8")
    print(report)
    print(f"\nЗаписано: {output}")


if __name__ == "__main__":
    main()
