# Восстановление облака точек по зашумлённым горизонтальным сечениям

Курсовая работа: восстановление выпуклого тела по набору горизонтальных
сечений и построение по нему минимального многогранника.

Версия приложения «Огранка» задаётся в `app/config.py` (`APP_VERSION`).

Автор: Дьяченко Алексей, 5 курс, механико-математический факультет МГУ,
кафедра вычислительной математики.
Научный руководитель: Валединский Владимир Дмитриевич.

## Что лежит в репозитории

- `Dyachenko_AM.pdf` — собранная курсовая работа (35 страниц).
- `point-cloud-3d-recovery.pptx` — презентация (25 слайдов).
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
6. Минимальный многогранник получается квадратичной декцимацией (в приложении — компактная библиотека fast-simplification);
   после декцимации оболочка перестраивается, а вершины возвращаются на
   плоскости исходных фасетов, чтобы убрать уступы на плоских гранях.
7. Качество сравнивается с эталоном по MSE, RMSE и `d_max`.

## Быстрый старт

### Отчёт

Нужен TeX Live (или TinyTeX) с русской поддержкой:

```bash
./build_report.sh
```

Скрипт делает два прохода во временном каталоге и кладёт готовый
`Dyachenko_AM.pdf` в корень. В `Отчет/` PDF и служебные файлы LaTeX не создаются.

### Презентация

```bash
node deck.js
```

Если `deck.js` не запускается, откройте готовый
`point-cloud-3d-recovery.pptx`.

### Приложение «Огранка»

```bash
python3 -m pip install -r app/requirements.txt
python3 app/app.py
```

По умолчанию окно открывается на порту 8765. Полезные ключи:
`--port 8770`, `--no-window` (только браузер), `--self-test` (быстрая
проверка установки или сборки, код выхода 0 — всё в порядке).

fast-simplification — обязательный движок декцимации; Open3D для приложения не нужен.
Собственного QEM/кластерного fallback больше нет: без fast-simplification
минимальный многогранник не строится. Для полного совпадения с экспериментами
отчёта можно поставить Open3D:

```bash
python3 -m pip install open3d   # только для повторения экспериментов отчёта
```

Готовые сборки в репозиторий не входят: их публикует CI в GitHub Releases
(macOS, Windows, Linux x86_64 и arm64). Локальная сборка описана ниже.

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
| `Dyachenko_AM.pdf` | Собранная курсовая работа, 35 страниц |
| `point-cloud-3d-recovery.pptx` | Презентация, 25 слайдов |
| `deck.js` | Исходник презентации (PptxGenJS) |
| `img/` | Картинки и фоны для презентации |
| `build_report.sh` | Сборка PDF в корень: два прохода во временном каталоге |
| `LICENSE` | MIT-лицензия на код проекта (английский оригинал) |
| `ACKNOWLEDGMENTS.md` | Благодарности, включая научного руководителя |
| `THIRD_PARTY_NOTICES.md` | Лицензии сторонних компонентов |
| `.github/workflows/ci.yml` | CI: тесты при push и pull request |
| `.github/workflows/release.yml` | Сборка и публикация релиза при push в `main` и по тегу `v*` |
| `release-notes/` | Тексты релизов для GitHub Releases |
| `docs/SIGNING.md` | Подпись и notarization: требования и команды |
| `docs/benchmark-real.md` | Сводка метрик на реальных моделях |
| `Отчет/` | LaTeX-исходник, рисунки, `make_collages.py` |
| `Отчет/Dyachenko_AM.tex` | Основной текст курсовой |
| `Отчет/fig*.png`, `Отчет/app_ui.jpg` | Рисунки для отчёта |
| `app/` | Приложение «Огранка» |
| `app/app.py` | Точка входа: ключи запуска, окно, `--self-test` |
| `app/server.py` | Локальный HTTP-сервер: статика и JSON API, защита от CSRF |
| `app/jobs.py` | Задания конвейера, прогресс, сохранение прогонов, CSV |
| `app/releases.py` | GitHub: обновления, история изменений, issues (с кэшем) |
| `app/native.py` | Мост pywebview: диалоги сохранения, снимки окна и экрана |
| `app/paths.py`, `app/versioning.py` | Пути данных; сравнение версий и сборок |
| `app/config.py` | Версия, автор и подписи приложения |
| `app/sources.py` | Демо-тела, подготовка OBJ/TXT, оценка качества |
| `app/live.py` | Кэш и расчёт живого предпросмотра |
| `app/updater.py`, `app/delta.py` | Установка обновлений, дельта-загрузка |
| `app/platform_ui.py` | Окна Windows/macOS/Linux, About и консоль |
| `app/qhull_compat.py` | Подключение Qhull без полного SciPy |
| `app/qhull_bundle.py` | Сборка Qhull с заглушками LAPACK и array-API для `.spec` |
| `app/ogranka.spec` | Единый PyInstaller-спек для macOS, Windows и Linux |
| `app/core/pipeline.py` | Публичный фасад вычислительного ядра |
| `app/core/variants.py` | Сечения модели, шум, сглаживание, точки — общая часть конвейера и предпросмотра |
| `app/core/geometry.py`, `denoise.py`, `simplify.py`, `minimal.py`, `metrics.py` | Геометрия, сглаживание, QEM, минимальный многогранник, метрики |
| `app/static/` | Интерфейс: HTML, CSS, JS, локальный three.js |
| `app/static/app.js` | Запуск интерфейса: тема, связи элементов, горячие клавиши |
| `app/static/js/` | `core.js`, `viewer.js`, `results.js`, `run.js`, `live.js`, `releases.js`, `shot.js`, `tour.js` |
| `app/requirements.txt`, `app/requirements-build.txt` | Зависимости приложения и сборки |
| `app/build_windows.bat`, `app/build_linux.sh` | Сборка `Ogranka.exe` (onefile) и AppImage с самопроверкой |
| `app/build_version.py` | Генерирует `version_info.txt` и `build_info.py` из `config.py` |
| `app/tests/` | Модульные, регрессионные и E2E-тесты |
| `ruff.toml`, `.editorconfig` | Проверка кода и единый стиль файлов |
| `app/icon.icns`, `app/icon.ico`, `app/icon.png` | Иконки macOS, Windows и Linux |
| `app/AppRun`, `app/ogranka.desktop` | Точка входа и запись меню AppImage |
| `reconstruct3D/` | 3D-конвейер и эксперименты |
| `reconstruct3D/run_bodies3D.py` | Генерация сечений и зашумлённых данных |
| `reconstruct3D/visualization.py` | Сглаживание опорных функций на сечениях |
| `reconstruct3D/minimal3D.py` | Автоматический минимальный многогранник |
| `reconstruct3D/visualize_minimal3D.py` | Рисунки и GIF минимальных многогранников |
| `reconstruct3D/levels_collage.py` | Коллаж 6 тел × 6 уровней упрощения |
| `reconstruct3D/real_data3D.py` | Конвейер для реальных моделей |
| `reconstruct3D/benchmark_real.py` | Сводка ошибок и устойчивости к шуму на реальных данных |
| `reconstruct3D/export3D_obj.py` | Экспорт оболочек и многогранников в OBJ |
| `reconstruct3D/view3D.py` | Просмотр OBJ в окне с вращением |
| `reconstruct3D/data3D/` | Синтетические точечные данные |
| `reconstruct3D/data3D_real/` | Данные реальных моделей |
| `reconstruct3D/out3D/`, `out3D_real/` | Результаты экспериментов (не в git) |
| `reconstruct3D/real_data/` | Исходные OBJ сканера (не в git) |
| `denoise.py`, `denoise_FFT.py`, `denoise_uniform.py` | 2D-сглаживание |
| `reconstruct.py`, `compare.py`, `visualize.py` | 2D-восстановление и сравнение |
| `Огранка.app`, `Ogranka.exe` | Локальные сборки (не в git) |

> Карта каталога поддерживается в актуальном состоянии. При добавлении,
> удалении или переименовании файлов обновляйте этот раздел.

## Что не хранится в git

- `Огранка.app`, `Ogranka.exe` — собираются локально или в CI.
- `app/build/`, `app/dist/`, `app/dist_new/`, `app/build_linux/`,
  `app/dist_linux/` — промежуточные артефакты PyInstaller.
- `app/version_info.txt`, `app/build_info.py` — генерируются перед сборкой.
- `reconstruct3D/real_data/` — сырые OBJ со сканера (179 МБ).
- `reconstruct3D/out3D/`, `out3D_real/` — результаты экспериментов;
  воспроизводятся скриптами.
- `app/runs/`, `app/uploads/`, `__pycache__/`, `.DS_Store`.
- Архивы (`*.zip`, `*.tar.gz`, `*.7z`, `*.rar`) — не хранятся в репозитории.

## Сборка приложений

### macOS

```bash
cd app
python3 -m pip install -r requirements.txt -r requirements-build.txt
python3 build_version.py
python3 -m PyInstaller --noconfirm --clean --distpath dist_new --workpath build ogranka.spec
dist_new/Ogranka.app/Contents/MacOS/Ogranka --self-test
```

Готовый бандл — `app/dist_new/Ogranka.app`; его можно переименовать в
`Огранка.app` и положить в корень. Внутри только Python, NumPy, Qhull-расширение
и fast-simplification; полный SciPy и его OpenBLAS в сборку не входят
(см. `app/qhull_bundle.py`).

### Windows

На Windows (Python 3.9+, WebView2) запустить:

```bat
app\build_windows.bat
```

Скрипт ставит зависимости, собирает один файл `dist\Ogranka.exe` по
`ogranka.spec` и запускает самопроверку. SmartScreen может предупредить о
неизвестном издателе.

### Linux

```bash
bash app/build_linux.sh
```

Скрипт собирает папку PyInstaller, проверяет её, упаковывает AppImage для
текущей архитектуры, проверяет AppImage и готовит `.zsync` и `.delta.json`.

## Проверки

```bash
python -m unittest discover -s app/tests -t app
python app/app.py --self-test
ruff check app
python reconstruct3D/benchmark_real.py
```

E2E-тесты можно прогнать и на собранном приложении:
`OGRANKA_E2E_BINARY=app/dist_linux/Ogranka/Ogranka python -m unittest discover -s app/tests -t app -p test_e2e.py`.

## Использование материалов

Учебная работа. При использовании текста, кода или рисунков ссылайтесь на
автора и научного руководителя.

- Код проекта — MIT: `LICENSE`.
- Благодарности и роли — `ACKNOWLEDGMENTS.md`.
- Лицензии зависимостей и Qhull — `THIRD_PARTY_NOTICES.md`.
