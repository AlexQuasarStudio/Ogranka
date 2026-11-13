# Восстановление облака точек по зашумлённым горизонтальным сечениям

Курсовая работа: восстановление выпуклого тела по набору горизонтальных
сечений и построение по нему минимального многогранника.

Автор: Дьяченко Алексей, 5 курс, механико-математический факультет МГУ,
кафедра вычислительной математики.
Научный руководитель: Валединский Владимир Дмитриевич.

## Что лежит в репозитории

- `Dyachenko_AM.pdf` — собранная курсовая работа (37 страниц).
- `point-cloud-3d-recovery.pptx` — презентация (24 слайда).
- `Отчет/` — LaTeX-исходник отчёта, рисунки и скрипт сборки коллажей.
- `app/` — приложение «Огранка»: полный конвейер в интерактивном окне.
- `reconstruct3D/` — 3D-эксперименты: сечения, шум, сглаживание,
  минимальные многогранники, реальные модели, экспорт в OBJ.
- Корневые `*.py` — ранние 2D-эксперименты по сглаживанию опорной функции.

## Метод кратко

1. Тело режется горизонтальными плоскостями `z = z_k`; на каждой высоте
   получается выпуклое сечение.
2. Сечение описывается опорной функцией
   `r(α) = max_j (x_j cos α + y_j sin α)`.
3. В измерения добавляется шум r8 (0.008) или r80 (0.08).
4. Шум подавляется рядом Фурье с МНК или адаптивным методом «ближайших
   соседей».
5. По сглаженным опорным функциям восстанавливаются точки
   (`x = r cos α`, `y = r sin α`) и строится выпуклая оболочка.
6. Минимальный многогранник получается квадратичной декцимацией Open3D;
   после декцимации оболочка перестраивается, а вершины возвращаются на
   плоскости исходных фасетов, чтобы убрать уступы на плоских гранях.
7. Качество сравнивается с эталоном по MSE, RMSE и `d_max`.

## Быстрый старт

### Отчёт

Нужен TeX Live (или TinyTeX) с русской поддержкой. Сборка — два прохода:

```bash
cd Отчет
pdflatex -interaction=nonstopmode Dyachenko_AM.tex
pdflatex -interaction=nonstopmode Dyachenko_AM.tex
```

Готовый PDF — `Отчет/Dyachenko_AM.pdf`; копия лежит в корне.

### Презентация

```bash
node deck.js
```

`deck.js` использует бандл навыка `pptxgenjs-presentation` из MultiTool
(`~/.config/gigatool/skills/pptxgenjs-presentation`). Если этого бандла нет,
проще открыть готовый `point-cloud-3d-recovery.pptx`.

### Приложение «Огранка»

```bash
python3 -m pip install -r app/requirements.txt
python3 app/app.py
```

По умолчанию окно открывается на порту 8765. Полезные ключи:
`--port 8770`, `--no-window` (только браузер).

Open3D не обязателен: без него минимальный многогранник строится собственной
QEM-декцимацией или кластеризацией. Чтобы получить движок как в отчёте:

```bash
python3 -m pip install open3d
```

Готовые сборки в репозиторий не входят из-за размера. macOS-бандл
`Огранка.app` (около 1.3 ГБ) и Windows-файл `Ogranka.exe` (около 156 МБ)
собираются локально; инструкции ниже.

### 3D-эксперименты

```bash
cd reconstruct3D
python3 run_bodies3D.py          # сечения, шум, сглаживание
python3 minimal3D.py             # минимальные многогранники и CSV
python3 visualize_minimal3D.py --figs
python3 export3D_obj.py          # выгрузка OBJ
```

## Карта каталога

| Путь | Назначение |
|---|---|
| `Dyachenko_AM.pdf` | Собранная курсовая работа, 37 страниц |
| `point-cloud-3d-recovery.pptx` | Презентация, 24 слайда |
| `deck.js` | Исходник презентации (PptxGenJS) |
| `img/` | Картинки и фоны для презентации |
| `Отчет/` | LaTeX-исходник, рисунки, PDF, `make_collages.py` |
| `Отчет/Dyachenko_AM.tex` | Основной текст курсовой |
| `Отчет/fig*.png`, `Отчет/app_ui.jpg` | Рисунки для отчёта |
| `app/` | Приложение «Огранка» |
| `app/app.py` | HTTP-сервер, задания, API, сохранение прогонов |
| `app/core/pipeline.py` | Геометрия, сглаживание, оболочки, минимальный многогранник |
| `app/static/` | Интерфейс: HTML, CSS, JS, локальный three.js |
| `app/static/app.js` | Вьюпорты, камера, выделение, экспорт PNG/OBJ |
| `app/requirements.txt` | Зависимости приложения |
| `app/build_windows.bat` | Сборка `Ogranka.exe` на Windows (onefile) |
| `app/icon.icns`, `app/icon.ico` | Иконки macOS и Windows |
| `reconstruct3D/` | 3D-конвейер и эксперименты |
| `reconstruct3D/run_bodies3D.py` | Генерация сечений и зашумлённых данных |
| `reconstruct3D/visualization.py` | Сглаживание опорных функций на сечениях |
| `reconstruct3D/minimal3D.py` | Автоматический минимальный многогранник |
| `reconstruct3D/visualize_minimal3D.py` | Рисунки и GIF минимальных многогранников |
| `reconstruct3D/real_data3D.py` | Конвейер для реальных моделей |
| `reconstruct3D/export3D_obj.py` | Экспорт оболочек и многогранников в OBJ |
| `reconstruct3D/view3D.py` | Просмотр OBJ в окне с вращением |
| `reconstruct3D/data3D/` | Синтетические точечные данные |
| `reconstruct3D/data3D_real/` | Данные реальных моделей |
| `reconstruct3D/out3D/`, `out3D_real/` | Результаты экспериментов (не в git) |
| `reconstruct3D/real_data/` | Исходные OBJ сканера (не в git) |
| `denoise.py`, `denoise_FFT.py`, `denoise_uniform.py` | 2D-сглаживание |
| `reconstruct.py`, `compare.py`, `visualize.py` | 2D-восстановление и сравнение |
| `3D_models_obj.zip` | Набор OBJ-моделей |
| `Огранка.app` | Готовая macOS-сборка (не в git) |
| `Ogranka.exe` | Готовая Windows-сборка (не в git) |

> Карта каталога поддерживается в актуальном состоянии. При добавлении,
> удалении или переименовании файлов обновляйте этот раздел.

## Что не хранится в git

- `Огранка.app` (1.3 ГБ) и `Ogranka.exe` (156 МБ) — превышают лимит GitHub
  на файл; собираются командами ниже.
- `app/build/`, `app/dist/`, `app/dist_new/` — промежуточные артефакты
  PyInstaller.
- `reconstruct3D/real_data/` — сырые OBJ со сканера (179 МБ).
- `reconstruct3D/out3D/`, `out3D_real/` — результаты экспериментов;
  воспроизводятся скриптами.
- `Отчет.zip` — дубликат каталога отчёта.
- `app/runs/`, `app/uploads/`, `__pycache__/`, `.DS_Store`.

## Сборка приложений

### macOS

```bash
cd app
python3 -m PyInstaller --noconfirm --clean --windowed --onedir --name Ogranka \
  --icon icon.icns --add-data "static:static" --exclude-module pkg_resources \
  --collect-all open3d --hidden-import webview.platforms.cocoa app.py
```

Готовый бандл — `app/dist_new/Ogranka.app`; его можно переименовать в
`Огранка.app` и положить в корень.

### Windows

На Windows (Python 3.9+, WebView2) запустить:

```bat
app\build_windows.bat
```

Скрипт ставит зависимости и собирает один файл `dist\Ogranka.exe`
(`--onefile`, Open3D внутри, иконка `icon.ico`). Первый запуск onefile
распаковывается 15–30 секунд; SmartScreen может предупредить о неизвестном
издателе.

## Использование материалов

Учебная работа. При использовании текста, кода или рисунков ссылайтесь на
автора и научного руководителя.
