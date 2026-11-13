"""Сборка коллажей из одиночных рисунков раздела 2 (вход/выход)."""
from PIL import Image, ImageDraw, ImageFont

FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
PANEL_W, PANEL_H = 640, 480
LABEL_H = 46
GAP = 26
MARGIN = 26
BORDER = (200, 200, 200)


def panel(img_path, label):
    img = Image.open(img_path).convert("RGB").resize((PANEL_W, PANEL_H), Image.LANCZOS)
    cell = Image.new("RGB", (PANEL_W, PANEL_H + LABEL_H), "white")
    cell.paste(img, (0, 0))
    d = ImageDraw.Draw(cell)
    d.rectangle([0, 0, PANEL_W - 1, PANEL_H + LABEL_H - 1], outline=BORDER, width=2)
    f = ImageFont.truetype(FONT, 24)
    d.text((PANEL_W // 2, PANEL_H + LABEL_H // 2), label, fill=(70, 70, 70), font=f, anchor="mm")
    return cell


def collage(rows, out):
    cells = [(panel(i, f"{name} · вход"), panel(o, f"{name} · результат")) for i, o, name in rows]
    n = len(cells)
    w = MARGIN * 2 + PANEL_W * 2 + GAP
    h = MARGIN * 2 + n * (PANEL_H + LABEL_H) + (n - 1) * GAP
    canvas = Image.new("RGB", (w, h), "white")
    for r, (left, right) in enumerate(cells):
        y = MARGIN + r * (PANEL_H + LABEL_H + GAP)
        canvas.paste(left, (MARGIN, y))
        canvas.paste(right, (MARGIN + PANEL_W + GAP, y))
    canvas.save(out)
    print(out, canvas.size)


if __name__ == "__main__":
    collage([("input1.png", "output1.png", "data3_1"),
             ("input2.png", "output2.png", "data3_2"),
             ("input3.png", "output3.png", "data3_3")], "fig2d_a.png")
    collage([("input4.png", "output4.png", "data4_1"),
             ("input5.png", "output5.png", "data4_2"),
             ("input000.png", "output000.png", "data000")], "fig2d_b.png")
    collage([("input001.png", "output001.png", "data001"),
             ("input002.png", "output002.png", "data002")], "fig2d_c.png")
    collage([("input003.png", "output003.png", "data003"),
             ("input003_1.png", "output003_1.png", "data003_1")], "fig2d_d.png")
