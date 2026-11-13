const os = require("os");
const path = require("path");
const CFG = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
const SKILL = path.join(CFG, "gigatool", "skills", "pptxgenjs-presentation");
const PptxGenJS = require(path.join(SKILL, "vendor", "pptxgenjs.bundle.cjs"));
const H = require(path.join(SKILL, "helpers", "index.cjs"));

const P = H.getPalette("slate");
const FONT = "Inter";
const CARD = "172331";
const IMG = path.join(__dirname, "img");

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
const K = H.designKit(pptx, P, FONT);

function finish(slide) {
  H.warnIfSlideTextOverflows(slide, pptx);
  H.warnIfSlideHasOverlaps(slide, pptx);
  H.warnIfSlideElementsOutOfBounds(slide, pptx);
}

const OUT = "point-cloud-3d-recovery.pptx";

async function tex(slide, src, x, y, size, color) {
  const dim = H.latexSize(src, { fontSizePt: size });
  slide.addImage(await H.latexToImageOptions(src, {
    x, y, fontSizePt: size, color: color || P.ink,
  }));
  return dim;
}

function bullets(slide, items, opts) {
  slide.addText(
    items.map((t) => ({ text: t, options: { bullet: { code: "2013" }, breakLine: true } })),
    Object.assign({ fontFace: FONT, color: P.ink, valign: "top", paraSpaceAfter: 10 }, opts),
  );
}

function table(slide, rows, opts) {
  const plan = H.calcTableHeight(rows, {
    colW: opts.colW, fontFace: FONT, fontSize: opts.fontSize, y: opts.y,
  });
  if (!plan.fits) throw new Error("table too tall: " + opts.y);
  slide.addTable(rows, Object.assign({}, opts, { rowH: plan.rowH }));
  return plan;
}

function cell(text, extra) {
  return { text: String(text), options: Object.assign({ color: P.ink, fill: { color: CARD } }, extra || {}) };
}

function head(text) {
  return { text, options: { bold: true, color: P.bg, fill: { color: P.accent } } };
}

async function main() {
  // 1 — Cover
  const s1 = pptx.addSlide();
  s1.addImage(H.imageSizingCrop(`${IMG}/cover-pointcloud.jpg`, 0, 0, 13.33, 7.5));
  s1.addShape(pptx.ShapeType.rect, {
    x: 0, y: 3.85, w: 13.33, h: 3.65, fill: { color: "000000", transparency: 40 },
  });
  s1.addText("НАУЧНЫЙ ДОКЛАД · ВЫЧИСЛИТЕЛЬНАЯ ГЕОМЕТРИЯ", {
    x: 0.72, y: 3.95, w: 11.9, h: 0.35,
    fontFace: FONT, fontSize: 12, bold: true, color: P.accent, charSpacing: 2, valign: "top",
  });
  s1.addText("Восстановление 3D-форм по зашумлённым горизонтальным сечениям", {
    x: 0.72, y: 4.3, w: 11.7, h: 1.2,
    fontFace: FONT, fontSize: 28, bold: true, color: "FFFFFF", valign: "top",
  });
  s1.addText("Опорная функция · ряд Фурье и МНК · метод «ближайших соседей»", {
    x: 0.72, y: 5.55, w: 11.9, h: 0.4,
    fontFace: FONT, fontSize: 15, bold: true, color: P.accent, valign: "top",
  });
  s1.addText("Дьяченко Алексей · студент 5 курса мехмата, кафедра вычислительной математики", {
    x: 0.72, y: 6.05, w: 11.9, h: 0.32,
    fontFace: FONT, fontSize: 12, color: "EEEEEE", valign: "top",
  });
  s1.addText("Научный руководитель — Валединский Владимир Дмитриевич", {
    x: 0.72, y: 6.42, w: 11.9, h: 0.32,
    fontFace: FONT, fontSize: 12, color: "EEEEEE", valign: "top",
  });
  s1.addText("ноябрь 2026", {
    x: 0.72, y: 6.82, w: 11.9, h: 0.3,
    fontFace: FONT, fontSize: 11, color: "BBBBBB", valign: "top",
  });
  finish(s1);

  // 2 — Введение
  const s2 = pptx.addSlide();
  s2.background = { color: P.bg };
  K.addHeader(s2, "Введение", "Задача восстановления 3D-моделей");
  const intro = [
    { icon: "camera", title: "Фотограмметрия", text: "Строит облако точек и 3D-модель объекта по набору изображений и силуэтов." },
    { icon: "box", title: "Облако точек", text: "Восстанавливается по горизонтальным сечениям тела на разных высотах." },
    { icon: "layers", title: "Методология", text: "Подход отрабатывается на геометрических примитивах — правильных многогранниках." },
  ];
  const cw = 3.81, gap = 0.35, cy = 1.65, ch = 3.4;
  for (const [i, c] of intro.entries()) {
    const x = 0.6 + i * (cw + gap);
    K.card(s2, x, cy, cw, ch, CARD);
    await K.iconBadge(s2, c.icon, x + cw / 2 - 0.4, cy + 0.4, 0.8, P.accent, "101820");
    s2.addText(c.title, { x: x + 0.3, y: cy + 1.4, w: cw - 0.6, h: 0.45, fontFace: FONT, fontSize: 17, bold: true, color: P.ink, align: "center", valign: "top" });
    s2.addText(c.text, { x: x + 0.3, y: cy + 2.0, w: cw - 0.6, h: 1.2, fontFace: FONT, fontSize: 13, color: P.ink, align: "center", valign: "top" });
  }
  s2.addText("Главный вопрос работы — насколько устойчиво алгоритм восстанавливает форму при шуме измерений.", {
    x: 0.9, y: 5.35, w: 11.5, h: 0.8, fontFace: FONT, fontSize: 16, bold: true, color: P.accent, align: "center", valign: "top",
  });
  K.addFooter(s2, 2);
  finish(s2);

  // 3 — Постановка задачи
  const s3 = pptx.addSlide();
  s3.background = { color: P.bg };
  K.addHeader(s3, "Постановка задачи", "Что именно восстанавливается");
  K.card(s3, 0.6, 1.5, 5.9, 4.75, CARD);
  s3.addText("Дано", { x: 0.95, y: 1.8, w: 5.2, h: 0.5, fontFace: FONT, fontSize: 19, bold: true, color: P.accent, valign: "top" });
  bullets(s3, [
    "Вершины выпуклого многоугольника на фиксированной высоте z",
    "Дискретная опорная функция r(α): набор пар (α_i, r_i)",
    "Значения искажены шумом измерений",
    "В 3D — набор таких сечений на разных высотах",
  ], { x: 0.95, y: 2.45, w: 5.2, h: 3.6, marginLeft: 0.3, fontSize: 14 });
  K.card(s3, 6.75, 1.5, 5.95, 4.75, CARD);
  s3.addText("Опорная функция", { x: 7.1, y: 1.8, w: 5.3, h: 0.5, fontFace: FONT, fontSize: 19, bold: true, color: P.accent, valign: "top" });
  s3.addText("Расстояние до опорной прямой с нормалью α; для многоугольника — максимум проекций вершин:", {
    x: 7.1, y: 2.35, w: 5.3, h: 0.75, fontFace: FONT, fontSize: 13, color: P.ink, valign: "top",
  });
  await tex(s3, "r(\\alpha)=\\max_j\\left(x_j\\cos\\alpha+y_j\\sin\\alpha\\right)", 7.1, 3.15, 19);
  s3.addText("В точках локальных максимумов r(α) вершина восстанавливается: x_i = r_i cos α_i, y_i = r_i sin α_i. В 3D — для каждого слоя z_k.", {
    x: 7.1, y: 4.0, w: 5.3, h: 1.6, fontFace: FONT, fontSize: 13, color: P.ink, valign: "top",
  });
  K.addFooter(s3, 3);
  finish(s3);

  // 4 — Обозначения
  const s4 = pptx.addSlide();
  s4.background = { color: P.bg };
  K.addHeader(s4, "Обозначения", "Что означает каждый символ");
  const left = [
    [head("Символ"), head("Смысл")],
    [cell("α_i"), cell("направление наблюдения (угол)")],
    [cell("h = 2π/n"), cell("шаг сетки по углу")],
    [cell("n"), cell("число направлений (720)")],
    [cell("r(α)"), cell("опорная функция тела")],
    [cell("R(α_i)"), cell("опорная функция слоя")],
    [cell("p_i"), cell("проекция вершины на α_i")],
    [cell("z_k"), cell("высота слоя")],
  ];
  const right = [
    [head("Символ"), head("Смысл")],
    [cell("r_v"), cell("амплитуда шума: 0.008 / 0.08")],
    [cell("ξ"), cell("случайная величина на [−1, 1]")],
    [cell("M"), cell("число гармоник ряда (8 / 12)")],
    [cell("k"), cell("число итераций усреднения")],
    [cell("k_i"), cell("своё k для зоны i")],
    [cell("E_i(k)"), cell("ошибка максимумов в зоне")],
    [cell("e_min"), cell("согласованная ошибка зон")],
  ];
  table(s4, left, { x: 0.6, y: 1.5, w: 5.9, colW: [1.4, 4.4], fontSize: 12, fontFace: FONT, color: P.ink, border: { pt: 0.5, color: P.line }, valign: "middle" });
  table(s4, right, { x: 6.8, y: 1.5, w: 5.9, colW: [1.4, 4.4], fontSize: 12, fontFace: FONT, color: P.ink, border: { pt: 0.5, color: P.line }, valign: "middle" });
  s4.addText("Метрики ошибки — MSE, RMSE, d_max — определены на слайде «Как измеряется ошибка».", {
    x: 0.6, y: 6.25, w: 12.1, h: 0.45, fontFace: FONT, fontSize: 13, color: P.accent, align: "center", valign: "top",
  });
  K.addFooter(s4, 4);
  finish(s4);

  // 5 — Карта формул
  const s5 = pptx.addSlide();
  s5.background = { color: P.bg };
  K.addHeader(s5, "Карта формул", "Какая формула к чему относится");
  const map = [
    [head("Формула"), head("Где работает"), head("Что даёт")],
    [cell("r(α) = max ⱼ(xⱼ·cos α + yⱼ·sin α)"), cell("постановка"), cell("опорная функция тела")],
    [cell("α_i = i·h,  h = 2π/n"), cell("генерация"), cell("сетка направлений")],
    [cell("R(α_i) = max проекций вершин"), cell("генерация"), cell("опорная функция слоя")],
    [cell("R̃ = R + r_v·ξ"), cell("шум"), cell("зашумлённые данные")],
    [cell("d1 ≥ 0,  d2 < 0"), cell("восстановление"), cell("вершина = локальный максимум")],
    [cell("ряд Фурье + МНК"), cell("сглаживание 1"), cell("коэффициенты c = (AᵀA)⁻¹Aᵀr")],
    [cell("r̃ = (2r_i + r_i−1 + r_i+1)/4"), cell("сглаживание 2"), cell("скользящее среднее")],
    [cell("k_i = argmin E_i,  K*"), cell("зональный метод"), cell("своё число итераций")],
    [cell("MSE, RMSE, d_max"), cell("оценка"), cell("качество восстановления")],
  ];
  table(s5, map, { x: 0.6, y: 1.45, w: 12.1, colW: [4.3, 2.6, 5.2], fontSize: 11, fontFace: FONT, color: P.ink, border: { pt: 0.5, color: P.line }, valign: "middle" });
  K.addFooter(s5, 5);
  finish(s5);

  // 6 — Пайплайн
  const s6 = pptx.addSlide();
  s6.background = { color: P.bg };
  K.addHeader(s6, "Схема обработки", "Путь от сечения до 3D-модели");
  const steps = [
    ["1", "Сечения", "Горизонтальные слои z_k, контур тела"],
    ["2", "Опорная функция", "R(α_i) по вершинам слоя"],
    ["3", "Шум", "R̃ = R + r_v·ξ, уровни r8 / r80"],
    ["4", "Сглаживание", "Фурье + МНК или соседи"],
    ["5", "Вершины", "Локальные максимумы по слою"],
    ["6", "Оболочка", "Выпуклая оболочка облака точек"],
  ];
  const w6 = 1.87, g6 = 0.14, y6 = 1.75, h6 = 3.3;
  for (const [i, [n, t, d]] of steps.entries()) {
    const x = 0.6 + i * (w6 + g6);
    K.card(s6, x, y6, w6, h6, CARD);
    s6.addShape(pptx.ShapeType.ellipse, { x: x + 0.2, y: y6 + 0.25, w: 0.5, h: 0.5, fill: { color: P.accent } });
    s6.addText(n, { x: x + 0.2, y: y6 + 0.28, w: 0.5, h: 0.44, fontFace: "Georgia", fontSize: 16, bold: true, color: "101820", align: "center", valign: "middle" });
    s6.addText(t, { x: x + 0.15, y: y6 + 0.95, w: w6 - 0.3, h: 0.75, fontFace: FONT, fontSize: 12, bold: true, color: P.ink, valign: "top" });
    s6.addText(d, { x: x + 0.15, y: y6 + 1.75, w: w6 - 0.3, h: 1.3, fontFace: FONT, fontSize: 10.5, color: P.muted, valign: "top" });
  }
  s6.addText("2D: один слой. 3D: 60 слоёв по высоте — сглаживание и поиск вершин выполняются для каждого слоя отдельно.", {
    x: 0.9, y: 5.45, w: 11.5, h: 0.8, fontFace: FONT, fontSize: 14, bold: true, color: P.accent, align: "center", valign: "top",
  });
  K.addFooter(s6, 6);
  finish(s6);

  // 7 — Генерация данных и шум
  const s7 = pptx.addSlide();
  s7.background = { color: P.bg };
  K.addHeader(s7, "Генерация данных", "Сечения, опорная функция и шум");
  K.card(s7, 0.6, 1.5, 6.0, 4.7, CARD);
  s7.addText("Данные слоя", { x: 0.95, y: 1.8, w: 5.3, h: 0.45, fontFace: FONT, fontSize: 17, bold: true, color: P.accent, valign: "top" });
  s7.addText("Для каждого направления α_i берётся максимум проекций вершин слоя:", {
    x: 0.95, y: 2.3, w: 5.3, h: 0.6, fontFace: FONT, fontSize: 12.5, color: P.ink, valign: "top",
  });
  await tex(s7, "R(\\alpha_i)=\\max_j\\left(x_j\\cos\\alpha_i+y_j\\sin\\alpha_i\\right)", 0.95, 2.95, 17);
  bullets(s7, [
    "Сетка: α_i = i·h,  h = 2π/n,  n = 720 (шаг 0.5°)",
    "3D: 60 слоёв, Δz = 0.05, высота H = 3",
    "Файл: 43 200 строк (α_i, R, z_k) на тело",
  ], { x: 0.95, y: 3.85, w: 5.3, h: 2.1, marginLeft: 0.3, fontSize: 12 });
  K.card(s7, 6.9, 1.5, 5.8, 4.7, CARD);
  s7.addText("Шум", { x: 7.25, y: 1.8, w: 5.1, h: 0.45, fontFace: FONT, fontSize: 17, bold: true, color: P.accent, valign: "top" });
  await tex(s7, "\\widetilde R=R+r_v\\xi,\\quad \\xi\\in[-1,1]", 7.25, 2.45, 22);
  s7.addText("r_v = 0.008 → r8     r_v = 0.08 → r80", {
    x: 7.25, y: 3.15, w: 5.1, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: P.ink, valign: "top",
  });
  s7.addText("Шум независим для каждой пары (α_i, z_k). Он моделирует ошибки измерений, дискретизацию и неточности восстановления контуров.", {
    x: 7.25, y: 3.7, w: 5.1, h: 1.4, fontFace: FONT, fontSize: 12.5, color: P.ink, valign: "top",
  });
  s7.addText("r8 — умеренный шум, r80 — сильный (в 10 раз больше).", {
    x: 7.25, y: 5.2, w: 5.1, h: 0.7, fontFace: FONT, fontSize: 12, bold: true, color: P.accent, valign: "top",
  });
  K.addFooter(s7, 7);
  finish(s7);

  // 8 — Вершины
  const s8 = pptx.addSlide();
  s8.background = { color: P.bg };
  K.addHeader(s8, "Восстановление вершин", "Вершина — локальный максимум опорной функции");
  K.card(s8, 0.6, 1.5, 12.1, 2.1, CARD);
  await tex(s8, "d_1=r_i-r_{i-1},\\qquad d_2=r_{i+1}-r_i", 1.1, 1.75, 20);
  await tex(s8, "d_1\\ge 0\\ \\text{ и }\\ d_2<0", 7.4, 1.75, 20);
  s8.addText("рост", { x: 1.1, y: 2.55, w: 1.5, h: 0.35, fontFace: FONT, fontSize: 12, color: P.muted, align: "center", valign: "top" });
  s8.addText("спад", { x: 7.4, y: 2.55, w: 2.2, h: 0.35, fontFace: FONT, fontSize: 12, color: P.muted, align: "center", valign: "top" });
  s8.addText("Точка i — вершина, если перед ней функция росла, а после неё убывает.", {
    x: 0.95, y: 2.95, w: 11.4, h: 0.45, fontFace: FONT, fontSize: 13, color: P.ink, valign: "top",
  });
  K.card(s8, 0.6, 3.85, 5.9, 2.4, CARD);
  s8.addText("Координаты вершины", { x: 0.95, y: 4.1, w: 5.2, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: P.accent, valign: "top" });
  await tex(s8, "x_i=r_i\\cos\\alpha_i,\\quad y_i=r_i\\sin\\alpha_i", 0.95, 4.7, 18);
  s8.addText("z берётся из слоя z_k.", { x: 0.95, y: 5.45, w: 5.2, h: 0.35, fontFace: FONT, fontSize: 12, color: P.muted, valign: "top" });
  K.card(s8, 6.8, 3.85, 5.9, 2.4, CARD);
  s8.addText("В 3D", { x: 7.15, y: 4.1, w: 5.2, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: P.accent, valign: "top" });
  s8.addText("Поиск максимумов выполняется внутри каждого слоя отдельно: замыкание массива по кругу не переходит на соседнюю высоту. Иначе вершины разных слоёв перемешались бы.", {
    x: 7.15, y: 4.6, w: 5.2, h: 1.5, fontFace: FONT, fontSize: 12.5, color: P.ink, valign: "top",
  });
  K.addFooter(s8, 8);
  finish(s8);

  // 9 — Фурье + МНК
  const s9 = pptx.addSlide();
  s9.background = { color: P.bg };
  K.addHeader(s9, "Сглаживание 1", "Ряд Фурье и метод наименьших квадратов");
  K.card(s9, 0.6, 1.5, 6.1, 4.7, CARD);
  s9.addText("Как работает", { x: 0.95, y: 1.8, w: 5.4, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: P.accent, valign: "top" });
  bullets(s9, [
    "r(α) периодична, поэтому раскладывается в ряд Фурье",
    "Коэффициенты a_m, b_m находятся из МНК: «подогнать ряд под зашумлённые точки»",
    "M = 8 в 2D (8 вершин сечения)",
    "M = 12 в 3D (до 10 вершин в сечении)",
    "Правило: M не меньше числа вершин",
  ], { x: 0.95, y: 2.35, w: 5.4, h: 3.5, marginLeft: 0.3, fontSize: 12.5 });
  K.card(s9, 6.9, 1.5, 5.8, 4.7, CARD);
  s9.addText("Формулы", { x: 7.25, y: 1.8, w: 5.1, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: P.accent, valign: "top" });
  await tex(s9, "r(\\alpha)\\approx a_0+\\sum_{m=1}^{M}\\left(a_m\\cos m\\alpha+b_m\\sin m\\alpha\\right)", 7.25, 2.45, 13);
  s9.addText("Система A·c ≈ r, где A — столбцы 1, cos, sin:", {
    x: 7.25, y: 3.35, w: 5.1, h: 0.4, fontFace: FONT, fontSize: 12, color: P.ink, valign: "top",
  });
  await tex(s9, "c=(A^TA)^{-1}A^Tr", 7.25, 3.95, 22);
  s9.addText("c — вектор коэффициентов ряда; именно он даёт сглаженную r̃(α).", {
    x: 7.25, y: 4.75, w: 5.1, h: 0.6, fontFace: FONT, fontSize: 12, color: P.muted, valign: "top",
  });
  K.addFooter(s9, 9);
  finish(s9);

  // 10 — Соседи
  const s10 = pptx.addSlide();
  s10.background = { color: P.bg };
  K.addHeader(s10, "Сглаживание 2", "Метод «ближайших соседей» и зональный выбор k");
  K.card(s10, 0.6, 1.5, 6.1, 4.7, CARD);
  s10.addText("Усреднение", { x: 0.95, y: 1.8, w: 5.4, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: P.accent, valign: "top" });
  await tex(s10, "\\widetilde r(\\alpha_i)=\\frac{2r(\\alpha_i)+r(\\alpha_{i-1})+r(\\alpha_{i+1})}{4}", 0.95, 2.4, 16);
  s10.addText("Усреднение повторяется k раз. k подбирается по RMSE относительно эталона, нижний порог k = 5.", {
    x: 0.95, y: 3.35, w: 5.4, h: 1.0, fontFace: FONT, fontSize: 12.5, color: P.ink, valign: "top",
  });
  s10.addText("Простой метод: не требует числа гармоник, но оставляет ложные максимумы.", {
    x: 0.95, y: 4.6, w: 5.4, h: 0.9, fontFace: FONT, fontSize: 12, color: P.muted, valign: "top",
  });
  K.card(s10, 6.9, 1.5, 5.8, 4.7, CARD);
  s10.addText("Зональный вариант", { x: 7.25, y: 1.8, w: 5.1, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: P.accent, valign: "top" });
  s10.addText("Область делится на зоны между соседними минимумами; в каждой зоне своё k_i ∈ [5, 30].", {
    x: 7.25, y: 2.3, w: 5.1, h: 0.85, fontFace: FONT, fontSize: 12.5, color: P.ink, valign: "top",
  });
  await tex(s10, "k_i=\\arg\\min_k E_i(k),\\qquad e_i=e_{\\min}", 7.25, 3.25, 15);
  await tex(s10, "K^{*}=\\arg\\min_{k_1,\\dots,k_N}\\sum_{i=1}^{N}E_i(k_i)", 7.25, 4.0, 15);
  s10.addText("E_i(k) — ошибка совпадения максимумов в зоне; e_min — минимальная ошибка, общая для всех зон.", {
    x: 7.25, y: 4.85, w: 5.1, h: 1.0, fontFace: FONT, fontSize: 12, color: P.muted, valign: "top",
  });
  K.addFooter(s10, 10);
  finish(s10);

  // 11 — Метрики
  const s11 = pptx.addSlide();
  s11.background = { color: P.bg };
  K.addHeader(s11, "Как измеряется ошибка", "Метрики качества восстановления");
  K.card(s11, 0.6, 1.5, 6.1, 4.7, CARD);
  s11.addText("2D: расстояние между точками", { x: 0.95, y: 1.8, w: 5.4, h: 0.45, fontFace: FONT, fontSize: 15, bold: true, color: P.accent, valign: "top" });
  await tex(s11, "d_i=\\sqrt{(x_i-\\hat x_i)^2+(y_i-\\hat y_i)^2}", 0.95, 2.4, 16);
  await tex(s11, "\\mathrm{MSE}=\\frac1N\\sum_{i=1}^{N}d_i^2,\\qquad d_{\\max}=\\max_i d_i", 0.95, 3.15, 14);
  s11.addText("(x_i, y_i) — точная модель, (x̂_i, ŷ_i) — восстановленная.", {
    x: 0.95, y: 3.95, w: 5.4, h: 0.5, fontFace: FONT, fontSize: 12, color: P.muted, valign: "top",
  });
  s11.addText("3D: те же формулы с координатой z и RMSE = √MSE.", {
    x: 0.95, y: 4.5, w: 5.4, h: 0.6, fontFace: FONT, fontSize: 12, color: P.ink, valign: "top",
  });
  K.card(s11, 6.9, 1.5, 5.8, 4.7, CARD);
  s11.addText("3D: ошибка по опорной функции", { x: 7.25, y: 1.8, w: 5.1, h: 0.45, fontFace: FONT, fontSize: 15, bold: true, color: P.accent, valign: "top" });
  await tex(s11, "\\varepsilon(\\alpha_i,z_k)=\\widehat R(\\alpha_i,z_k)-R(\\alpha_i,z_k)", 7.25, 2.45, 14);
  s11.addText("Сравниваются опорные функции восстановленного и точного сечения на одной сетке углов. Метрика не зависит от числа найденных вершин — это важно, потому что после шума оно меняется в десятки раз.", {
    x: 7.25, y: 3.2, w: 5.1, h: 1.5, fontFace: FONT, fontSize: 12.5, color: P.ink, valign: "top",
  });
  s11.addText("MSE = среднее ε², RMSE = √MSE, d_max = max|ε|.", {
    x: 7.25, y: 4.9, w: 5.1, h: 0.5, fontFace: FONT, fontSize: 12, color: P.muted, valign: "top",
  });
  K.addFooter(s11, 11);
  finish(s11);

  // 12 — Результаты 2D
  const s12 = pptx.addSlide();
  s12.background = { color: P.bg };
  K.addHeader(s12, "Результаты 2D", "Сравнение методов на восьмиугольнике");
  const rows2d = [
    [head("Метод"), head("MSE r8"), head("d_max r8"), head("MSE r80"), head("d_max r80")],
    [cell("Фурье + МНК"), cell("0.00594"), cell("0.0773"), cell("0.00820"), cell("0.1261")],
    [cell("Ближайшие соседи"), cell("0.00222"), cell("0.0737"), cell("9.81"), cell("4.56")],
    [cell("Модифицированные соседи"), cell("0.00222"), cell("0.0737"), cell("—"), cell("—")],
  ];
  table(s12, rows2d, { x: 0.6, y: 1.55, w: 12.1, colW: [3.9, 2.05, 2.05, 2.05, 2.05], fontSize: 13, fontFace: FONT, color: P.ink, border: { pt: 0.5, color: P.line }, valign: "middle" });
  K.card(s12, 0.6, 4.0, 5.9, 2.2, CARD);
  s12.addText("Что видно", { x: 0.95, y: 4.25, w: 5.2, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: P.accent, valign: "top" });
  s12.addText("При r8 ближайшие соседи точнее: MSE 0.00222 против 0.00594. При r80 они расходятся (MSE 9.81), а МНК остаётся устойчивым.", {
    x: 0.95, y: 4.75, w: 5.2, h: 1.3, fontFace: FONT, fontSize: 12, color: P.ink, valign: "top",
  });
  K.card(s12, 6.8, 4.0, 5.9, 2.2, CARD);
  s12.addText("Вывод по 2D", { x: 7.15, y: 4.25, w: 5.2, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: P.accent, valign: "top" });
  s12.addText("Фурье + МНК — для большой дисперсии; соседи — для умеренной. В 3D это уточняется (см. далее).", {
    x: 7.15, y: 4.75, w: 5.2, h: 1.3, fontFace: FONT, fontSize: 12, color: P.ink, valign: "top",
  });
  K.addFooter(s12, 12);
  finish(s12);

  // 13 — 3D тела
  const s13 = pptx.addSlide();
  s13.background = { color: P.bg };
  K.addHeader(s13, "3D-эксперимент", "Четыре тела с переменным сечением");
  const bodies = [
    ["Октаэдр", "6 вершин · 8 граней", "Сечение — квадрат (4 вершины)"],
    ["Икосаэдр", "12 вершин · 20 граней", "Сечение — 5–10 вершин"],
    ["Додекаэдр", "20 вершин · 12 граней", "Сечение — 3–6 вершин"],
    ["Бриллиант", "40 вершин · 32 грани", "Десятиугольники, корона вверх"],
  ];
  const bw = 2.8, bg2 = 0.31, by = 1.6, bh = 2.6;
  for (const [i, [t, sub, txt]] of bodies.entries()) {
    const x = 0.6 + i * (bw + bg2);
    K.card(s13, x, by, bw, bh, CARD);
    s13.addText(t, { x: x + 0.2, y: by + 0.3, w: bw - 0.4, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: P.accent, align: "center", valign: "top" });
    s13.addText(sub, { x: x + 0.2, y: by + 0.85, w: bw - 0.4, h: 0.6, fontFace: FONT, fontSize: 11, bold: true, color: P.ink, align: "center", valign: "top" });
    s13.addText(txt, { x: x + 0.2, y: by + 1.5, w: bw - 0.4, h: 0.95, fontFace: FONT, fontSize: 11, color: P.muted, align: "center", valign: "top" });
  }
  K.card(s13, 0.6, 4.45, 12.1, 1.9, CARD);
  s13.addText("Параметры генерации", { x: 0.95, y: 4.65, w: 5.0, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: P.accent, valign: "top" });
  s13.addText(
    [
      { text: "60 слоёв по высоте, Δz = 0.05, H = 3", options: { bullet: { code: "2013" }, breakLine: true } },
      { text: "n = 720 направлений, шаг 0.5° — меньше минимального углового зазора между вершинами (2.3°)", options: { bullet: { code: "2013" } } },
    ],
    { x: 0.95, y: 5.05, w: 11.4, h: 1.1, fontFace: FONT, fontSize: 12.5, color: P.ink, valign: "top", marginLeft: 0.3, paraSpaceAfter: 8 },
  );
  K.addFooter(s13, 13);
  finish(s13);

  // 14 — 3D эталон
  const s14 = pptx.addSlide();
  s14.background = { color: P.bg };
  K.addHeader(s14, "3D: эталон", "Восстановление по точным сечениям");
  const names = [["octa", "Октаэдр · 240 точек"], ["icosa", "Икосаэдр · 430 точек"], ["dodeca", "Додекаэдр · 312 точек"], ["diamond", "Бриллиант · 600 точек"]];
  const wI = 2.9, gI = 0.3, xI = (13.33 - (4 * wI + 3 * gI)) / 2;
  for (const [i, [b, cap]] of names.entries()) {
    const x = xI + i * (wI + gI);
    s14.addImage(H.imageSizingCrop(path.join(IMG, `deck_${b}_r0.png`), x, 1.5, wI, wI));
    s14.addText(cap, { x, y: 1.5 + wI + 0.12, w: wI, h: 0.4, fontFace: FONT, fontSize: 11, bold: true, color: P.ink, align: "center", valign: "top" });
  }
  s14.addText("Ошибка относительно аналитических сечений: MSE ≤ 9.4·10⁻⁷ — эталон восстанавливается практически точно.", {
    x: 1.2, y: 5.5, w: 10.9, h: 0.5, fontFace: FONT, fontSize: 13, bold: true, color: P.accent, align: "center", valign: "top",
  });
  K.addFooter(s14, 14);
  finish(s14);

  // 15 — 3D шум
  const s15 = pptx.addSlide();
  s15.background = { color: P.bg };
  K.addHeader(s15, "3D: зашумлённые модели", "Без сглаживания: 12–14 тысяч ложных вершин");
  const wG = 2.3, gG = 0.24, xG = 1.705;
  for (const [r, v] of ["r8", "r80"].entries()) {
    const y = 1.5 + r * 2.45;
    s15.addText(v, { x: 0.35, y: y + 0.9, w: 1.15, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: P.accent, align: "right", valign: "top" });
    for (const [c, b] of ["octa", "icosa", "dodeca", "diamond"].entries()) {
      s15.addImage(H.imageSizingCrop(path.join(IMG, `deck_${b}_${v}.png`), xG + c * (wG + gG), y, wG, wG));
    }
  }
  s15.addText("Точки: 12 493 / 13 204 / 12 235 / 13 830 (r8) и 14 374 / 14 388 / 14 382 / 14 465 (r80) вместо 240–600. MSE: 0.00378 / 0.00140 / 0.00392 / 0.000293 и 0.01334 / 0.00912 / 0.01358 / 0.006382.", {
    x: 0.8, y: 6.45, w: 11.8, h: 0.45, fontFace: FONT, fontSize: 10.5, color: P.muted, align: "center", valign: "top",
  });
  K.addFooter(s15, 15);
  finish(s15);

  // 16 — 3D Фурье
  const s16 = pptx.addSlide();
  s16.background = { color: P.bg };
  K.addHeader(s16, "3D: Фурье + МНК", "Сглаживание по слоям, M = 12");
  for (const [r, v] of ["fft_r8", "fft_r80"].entries()) {
    const y = 1.5 + r * 2.45;
    s16.addText(v === "fft_r8" ? "r8" : "r80", { x: 0.35, y: y + 0.9, w: 1.15, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: P.accent, align: "right", valign: "top" });
    for (const [c, b] of ["octa", "icosa", "dodeca", "diamond"].entries()) {
      s16.addImage(H.imageSizingCrop(path.join(IMG, `deck_${b}_${v}.png`), xG + c * (wG + gG), y, wG, wG));
    }
  }
  s16.addText("Точек: 247 / 311, 436 / 457, 313 / 348, 600 / 599 — практически эталонное число. MSE: 0.000014–0.00099.", {
    x: 0.8, y: 6.45, w: 11.8, h: 0.45, fontFace: FONT, fontSize: 10.5, color: P.muted, align: "center", valign: "top",
  });
  K.addFooter(s16, 16);
  finish(s16);

  // 17 — 3D соседи
  const s17 = pptx.addSlide();
  s17.background = { color: P.bg };
  K.addHeader(s17, "3D: метод соседей", "Сглаживание по слоям с зональным k_i");
  for (const [r, v] of ["uni_r8", "uni_r80"].entries()) {
    const y = 1.5 + r * 2.45;
    s17.addText(v === "uni_r8" ? "r8" : "r80", { x: 0.35, y: y + 0.9, w: 1.15, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: P.accent, align: "right", valign: "top" });
    for (const [c, b] of ["octa", "icosa", "dodeca", "diamond"].entries()) {
      s17.addImage(H.imageSizingCrop(path.join(IMG, `deck_${b}_${v}.png`), xG + c * (wG + gG), y, wG, wG));
    }
  }
  s17.addText("Точек: 1 177 / 3 498, 1 363 / 3 638, 871 / 3 497, 1 745 / 3 787 — ложные максимумы сохраняются. MSE: 0.000060–0.00431.", {
    x: 0.8, y: 6.45, w: 11.8, h: 0.45, fontFace: FONT, fontSize: 10.5, color: P.muted, align: "center", valign: "top",
  });
  K.addFooter(s17, 17);
  finish(s17);

  // 18 — 3D метрики
  const s18 = pptx.addSlide();
  s18.background = { color: P.bg };
  K.addHeader(s18, "3D: метрики", "MSE и d_max относительно аналитического эталона");
  const rows3d = [
    [head("Тело · метрика"), head("r8"), head("r80"), head("Фурье r8"), head("Фурье r80"), head("Соседи r8"), head("Соседи r80")],
    [cell("Октаэдр · MSE"), cell("0.00378"), cell("0.01334"), cell("0.000014"), cell("0.000290"), cell("0.000563"), cell("0.00418")],
    [cell("Октаэдр · dmax"), cell("0.223"), cell("0.288"), cell("0.013"), cell("0.095"), cell("0.115"), cell("0.238")],
    [cell("Икосаэдр · MSE"), cell("0.00140"), cell("0.00912"), cell("0.000205"), cell("0.000766"), cell("0.000271"), cell("0.00176")],
    [cell("Икосаэдр · dmax"), cell("0.135"), cell("0.203"), cell("0.105"), cell("0.165"), cell("0.089"), cell("0.154")],
    [cell("Додекаэдр · MSE"), cell("0.00392"), cell("0.01358"), cell("0.000380"), cell("0.000990"), cell("0.000568"), cell("0.00431")],
    [cell("Додекаэдр · dmax"), cell("0.252"), cell("0.313"), cell("0.061"), cell("0.194"), cell("0.146"), cell("0.265")],
    [cell("Бриллиант · MSE"), cell("0.000293"), cell("0.006382"), cell("0.000016"), cell("0.000149"), cell("0.000060"), cell("0.000508")],
    [cell("Бриллиант · dmax"), cell("0.049"), cell("0.120"), cell("0.011"), cell("0.148"), cell("0.038"), cell("0.074")],
  ];
  table(s18, rows3d, { x: 0.6, y: 1.45, w: 12.1, colW: [2.7, 1.5, 1.5, 1.6, 1.6, 1.6, 1.6], fontSize: 10.5, fontFace: FONT, color: P.ink, border: { pt: 0.5, color: P.line }, valign: "middle" });
  s18.addText("МНК снижает MSE в 7–266 раз, соседи — в 3–13 раз. По MSE МНК точнее в 1.3–40 раз; на икосаэдре при r8 соседи дают меньший d_max (0.089 против 0.105).", {
    x: 0.8, y: 5.35, w: 11.8, h: 0.9, fontFace: FONT, fontSize: 12, bold: true, color: P.accent, align: "center", valign: "top",
  });
  K.addFooter(s18, 18);
  finish(s18);

  // 19 — Минимальный многогранник (auto)
  const s19 = pptx.addSlide();
  s19.background = { color: P.bg };
  K.addHeader(s19, "3D: минимальный многогранник", "Автоматический режим: декцимация и слияние граней");
  const mins = [
    ["octa", "6 вершин · 8 граней"],
    ["icosa", "12 вершин · 20 граней"],
    ["dodeca", "20 вершин · 12 граней"],
    ["diamond", "17 вершин · 25 граней"],
  ];
  const wM = 2.5, gM = 0.3, xM = (13.33 - (4 * wM + 3 * gM)) / 2;
  for (const [i, [b, cap]] of mins.entries()) {
    const x = xM + i * (wM + gM);
    s19.addImage(H.imageSizingCrop(path.join(IMG, `deck_min3d_${b}_r0.png`), x, 1.5, wM, wM));
    s19.addText(cap, { x, y: 4.15, w: wM, h: 0.35, fontFace: FONT, fontSize: 11, bold: true, color: P.ink, align: "center", valign: "top" });
  }
  s19.addText("Декцимация (упрощение сетки): убираем вершины с наименьшей «ценой» — квадратичным отклонением от плоскостей соседних граней. Площадь сохраняется с точностью 0.1%, грани с углом до 1° сливаются.", {
    x: 1.0, y: 4.7, w: 11.3, h: 0.75, fontFace: FONT, fontSize: 12, color: P.ink, align: "center", valign: "top",
  });
  s19.addText("Точные сечения и сглаженные модели: 6/8 и 12/20 — точно. Додекаэдр: 18–19 вершин, пятиугольники не сливаются. Бриллиант: теряются рундист и колет. Шум r8/r80: до 244 вершин и 438 граней.", {
    x: 0.9, y: 5.55, w: 11.5, h: 1.0, fontFace: FONT, fontSize: 12, bold: true, color: P.accent, align: "center", valign: "top",
  });
  K.addFooter(s19, 19);
  finish(s19);

  // 20 — 6 уровней упрощения
  const sLevels = pptx.addSlide();
  sLevels.background = { color: P.bg };
  K.addHeader(sLevels, "6 уровней упрощения", "Доля оставленных треугольников: 100 → 15 %");
  sLevels.addImage(H.imageSizingCrop(path.join(IMG, ["deck_levels", "png"].join(".")), 0.55, 1.45, 5.6, 5.6));
  K.card(sLevels, 6.9, 1.55, 5.8, 4.9, CARD);
  sLevels.addText("Как меняется форма", { x: 7.25, y: 1.8, w: 5.1, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: P.accent, valign: "top" });
  bullets(sLevels, [
    "Октаэдр: 6 → 4 вершины",
    "Икосаэдр: 12 → 4",
    "Додекаэдр: 20 → 4",
    "Бриллиант: 40 → 7",
    "Куб: 8 → 4 · призма: 16 → 4",
  ], { x: 7.25, y: 2.3, w: 5.1, h: 3.0, marginLeft: 0.3, fontSize: 13 });
  sLevels.addText("Число граней может меняться немонотонно: почти компланарные треугольники сливаются по-разному.", {
    x: 7.0, y: 5.55, w: 5.6, h: 0.8, fontFace: FONT, fontSize: 11.5, color: P.muted, valign: "top",
  });
  K.addFooter(sLevels, 20);
  finish(sLevels);

  // 21 — Реальные данные
  const s20 = pptx.addSlide();
  s20.background = { color: P.bg };
  K.addHeader(s20, "Реальные данные", "Три модели сканера");
  const stones = [
    ["real1", "Образец 1", "552 вершины · 278 граней"],
    ["real2", "Образец 2", "436 вершин · 220 граней"],
    ["real3", "Образец 3", "490 вершин · 247 граней"],
  ];
  const wS = 2.4, gS = 0.45, xS = (13.33 - (3 * wS + 2 * gS)) / 2;
  for (const [i, [b, t, cap]] of stones.entries()) {
    const x = xS + i * (wS + gS);
    s20.addImage(H.imageSizingCrop(path.join(IMG, `deck_true_${b}.png`), x, 1.45, wS, wS));
    s20.addText(t, { x, y: 3.9, w: wS, h: 0.3, fontFace: FONT, fontSize: 12, bold: true, color: P.accent, align: "center", valign: "top" });
    s20.addText(cap, { x, y: 4.18, w: wS, h: 0.3, fontFace: FONT, fontSize: 10, color: P.muted, align: "center", valign: "top" });
  }
  s20.addText("Корона вверх, высота нормирована к 3; 60 слоёв × 720 направлений (0.5°).", {
    x: 0.9, y: 4.55, w: 11.5, h: 0.35, fontFace: FONT, fontSize: 12, color: P.ink, align: "center", valign: "top",
  });
  K.card(s20, 0.6, 5.0, 12.1, 1.55, CARD);
  s20.addText("Сечения содержат 8–217 вершин (микро-грани сканера). Поэтому режим максимумов даёт 3–4 точки на слой (MSE 0.12 и 0.077), а восстановление выполняется как пересечение полуплоскостей: MSE 1e-13 на точных данных.\nНа рисунках — минимальные многогранники (auto-режим); все варианты выгружены в OBJ (out3D_real/obj).", {
    x: 1.0, y: 5.15, w: 11.3, h: 1.3, fontFace: FONT, fontSize: 12, color: P.ink, align: "center", valign: "top",
  });
  K.addFooter(s20, 21);
  finish(s20);

  // 21 — Реальные данные: результаты
  const s21 = pptx.addSlide();
  s21.background = { color: P.bg };
  K.addHeader(s21, "Реальные данные: восстановление", "Фурье + МНК после обобщённого восстановления");
  const wR = 2.3, gR = 0.25, xR = (13.33 - (3 * wR + 2 * gR)) / 2;
  for (const [r, v] of ["fft_r8", "fft_r80"].entries()) {
    const y = 1.4 + r * 2.45;
    s21.addText(v === "fft_r8" ? "r8" : "r80", { x: 0.5, y: y + 0.9, w: 2.2, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: P.accent, align: "right", valign: "top" });
    for (const [c, b] of ["real1", "real2", "real3"].entries()) {
      s21.addImage(H.imageSizingCrop(path.join(IMG, `deck_real_${b}_${v}.png`), xR + c * (wR + gR), y, wR, wR));
    }
  }
  s21.addText("Фурье: MSE 8e-6 – 5.5e-4. Соседи: 6e-5 при r8 и 3e-2 при r80. Без сглаживания: 0.32–5.4 (система полуплоскостей вырождается).", {
    x: 0.8, y: 6.4, w: 11.8, h: 0.45, fontFace: FONT, fontSize: 11, color: P.muted, align: "center", valign: "top",
  });
  K.addFooter(s21, 22);
  finish(s21);

  // 22 — Программа-конвейер
  const sApp = pptx.addSlide();
  sApp.background = { color: P.bg };
  K.addHeader(sApp, "Программа «Огранка»", "Весь конвейер в одном окне");
  bullets(sApp, [
    "Демо-тела, OBJ, TXT и папки с моделями",
    "Шум r8, r80 и свои уровни — сразу несколько",
    "Фурье+МНК и «соседи», максимумы и полуплоскости",
    "Минимальный многогранник: допуск площади и угол слияния вручную",
    "Окна 2–6, общая камера, выделение граней и вершин",
    "Оценка качества, пакетная таблица, экспорт OBJ/PNG/CSV",
  ], { x: 0.6, y: 1.55, w: 5.6, h: 4.7, marginLeft: 0.3, fontSize: 12.5 });
  K.card(sApp, 6.45, 1.45, 6.25, 5.1, CARD);
  sApp.addImage({ path: `${IMG}/deck_app_ui.jpg`, x: 7.22, y: 1.6, w: 4.68, h: 4.8 });
  K.addFooter(sApp, 23);
  finish(sApp);

  // 22 — Выводы
  const s22 = pptx.addSlide();
  s22.background = { color: P.bg };
  K.addHeader(s22, "Выводы", "Что показали 2D- и 3D-эксперименты");
  K.card(s22, 0.6, 1.5, 6.0, 4.3, CARD);
  s22.addText("Результаты", { x: 0.95, y: 1.75, w: 5.3, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: P.accent, valign: "top" });
  bullets(s22, [
    "Оба метода восстанавливают форму на всех четырёх телах",
    "МНК точнее по MSE и возвращает правильное число вершин",
    "Соседи проще и иногда лучше по d_max, но оставляют ложные вершины",
    "Число гармоник должно быть не меньше числа вершин сечения",
    "Ошибка растёт с шумом, но форма сохраняется",
  ], { x: 0.95, y: 2.25, w: 5.3, h: 3.3, marginLeft: 0.3, fontSize: 12.5 });
  K.card(s22, 6.9, 1.5, 5.8, 4.3, CARD);
  s22.addText("Ограничения и дальше", { x: 7.25, y: 1.75, w: 5.1, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: P.accent, valign: "top" });
  bullets(s22, [
    "Метод работает для выпуклых тел",
    "Ложные вершины при сильном шуме",
    "Auto-режим чувствителен к мелким граням",
    "Порог погрешности зависит от сложности формы",
    "Возможное развитие — нейросетевые алгоритмы",
  ], { x: 7.25, y: 2.25, w: 5.1, h: 3.3, marginLeft: 0.3, fontSize: 12 });
  s22.addText("Возможно, будущее — за нейросетевыми алгоритмами.", {
    x: 0.6, y: 6.05, w: 12.1, h: 0.55, fontFace: "Georgia", fontSize: 20, italic: true, bold: true,
    color: P.accent, align: "center", valign: "top",
  });
  K.addFooter(s22, 24);
  finish(s22);

  // 21 — Финал
  const s23 = pptx.addSlide();
  s23.background = { color: P.bg };
  const t21 = "Спасибо за внимание";
  const sub21 = "Дьяченко Алексей · вопросы и обсуждение";
  const c21 = H.titleSubtitleLayout(t21, sub21, FONT, {
    x: 0.6, y: 2.6, w: 12.1, titleMaxH: 1.2, gap: 0.35,
    title: { fontSize: 44, bold: true, color: P.ink },
    subtitle: { fontSize: 17, color: P.muted, h: 0.5 },
  });
  s23.addText(t21, c21.title);
  s23.addText(sub21, c21.subtitle);
  s23.addText("Студент 5 курса мехмата, кафедра вычислительной математики\nНаучный руководитель — Валединский Владимир Дмитриевич", {
    x: 0.6, y: 5.15, w: 12.1, h: 0.75,
    fontFace: FONT, fontSize: 13, color: P.muted, align: "center", valign: "top",
  });
  finish(s23);

  await pptx.writeFile({ fileName: OUT });
  await H.recompressPptx(OUT);
  console.log("written: " + OUT);
}
main().catch((e) => { console.error(e); process.exit(1); });
