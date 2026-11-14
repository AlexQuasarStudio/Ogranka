/* First-run tour. */
const TOUR_KEY = "ogranka.tour.v1";
const TOUR_STEPS = [
  {
    title: "Добро пожаловать в «Огранку»",
    text: "Версия 1.0.0. Приложение восстанавливает форму по зашумлённым горизонтальным сечениям. Короткий тур покажет основные элементы.",
  },
  {
    title: "Модель",
    text: "Выберите демо-тело, файлы OBJ/TXT или папку с моделями. Куб и призма — в верхнем ряду.",
    target: ".demo-grid",
  },
  {
    title: "Шум и упрощение",
    text: "Двигайте ползунки: второе окно пересчитывается без запуска конвейера. «Упрощение» — сколько процентов убрать.",
    target: "#liveNoise",
  },
  {
    title: "Запуск",
    text: "Кнопка запускает полный расчёт с выбранными шумами и методами. После него появятся метрики и время.",
    target: "#runBtn",
  },
  {
    title: "Вьюпорты",
    text: "Окна сравнения моделей. Кнопка ⤢ разворачивает вьюпорт; F или Esc возвращают сетку. Высоту можно менять разделителем.",
    target: "#viewers",
  },
  {
    title: "Выделение",
    text: "Клик — одна грань, Shift — путь, Ctrl — добавить или убрать. Режим отображения — на нижней панели.",
    target: ".toolbar",
  },
  {
    title: "Результаты и время",
    text: "В таблицах есть столбец «время», под окнами — время варианта, а в шапке после расчёта — общее время.",
    target: "#metricsTable",
  },
  {
    title: "Готово",
    text: "Тур можно пройти снова из окна «О программе». Очистка кеша тоже сбрасывает приветствие.",
  },
];

function tourSeen() {
  try { return localStorage.getItem(TOUR_KEY) === "1"; } catch (e) { return false; }
}

function markTourSeen() {
  try { localStorage.setItem(TOUR_KEY, "1"); } catch (e) { /* ignore */ }
}

function resetTourSeen() {
  try { localStorage.removeItem(TOUR_KEY); } catch (e) { /* ignore */ }
}

function positionTour(target) {
  const tour = $("tour"), hole = $("tourHole"), card = $("tourCard");
  const margin = 12;
  const cw = card.offsetWidth || 390;
  const ch = card.offsetHeight || 240;
  if (!target || !target.getClientRects().length) {
    tour.classList.add("dim");
    hole.hidden = true;
    card.style.left = Math.max(margin, (window.innerWidth - cw) / 2) + "px";
    card.style.top = Math.max(margin, (window.innerHeight - ch) / 2) + "px";
    return;
  }
  tour.classList.remove("dim");
  hole.hidden = false;
  const r = target.getBoundingClientRect();
  const pad = 6;
  hole.style.left = (r.left - pad) + "px";
  hole.style.top = (r.top - pad) + "px";
  hole.style.width = (r.width + pad * 2) + "px";
  hole.style.height = (r.height + pad * 2) + "px";
  let left = r.right + 16;
  if (left + cw > window.innerWidth - margin) left = r.left - cw - 16;
  if (left < margin) left = Math.max(margin, (window.innerWidth - cw) / 2);
  const top = Math.max(margin, Math.min(window.innerHeight - ch - margin, r.top));
  card.style.left = left + "px";
  card.style.top = top + "px";
}

function showTourStep(i) {
  App.tourStep = i;
  const step = TOUR_STEPS[i];
  $("tourStepLabel").textContent = i === 0 ? "Приветствие" : `Шаг ${i} из ${TOUR_STEPS.length - 1}`;
  $("tourTitle").textContent = step.title;
  $("tourText").textContent = step.text;
  $("tourPrev").disabled = i === 0;
  $("tourNext").textContent = i === TOUR_STEPS.length - 1 ? "Готово" : (i === 0 ? "Начать" : "Далее");
  const target = step.target ? document.querySelector(step.target) : null;
  if (target) target.scrollIntoView({ block: "center", inline: "nearest" });
  const stepIndex = i;
  setTimeout(() => { if (App.tourStep === stepIndex) positionTour(target); }, 50);
}

function startTour(force = false) {
  if (!force && tourSeen()) return;
  $("helpModal").classList.add("hidden");
  $("aboutModal").classList.add("hidden");
  $("tour").classList.remove("hidden");
  showTourStep(0);
}

function finishTour() {
  $("tour").classList.add("hidden");
  $("tour").classList.remove("dim");
  $("tourHole").hidden = true;
  markTourSeen();
  App.tourStep = 0;
}

