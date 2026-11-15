# Сторонние компоненты и лицензии

Проект «Огранка» распространяется по лицензии MIT (см. `LICENSE`).
Этот файл перечисляет
сторонние компоненты, которые используются при сборке и работе приложения.

## Компоненты

| Компонент | Версия | Лицензия | Где используется |
|---|---:|---|---|
| Python | 3.11 | PSF-2.0 | Среда выполнения |
| NumPy | 1.26.4 | BSD-3-Clause | Вычисления, массивы |
| SciPy / Qhull | 1.15.3 / Qhull | BSD-3-Clause / Qhull License | Выпуклая оболочка, Qhull |
| OpenBLAS / LAPACK | из колёс SciPy/NumPy | BSD-3-Clause-Attribution | Линейная алгебра в бинарных колёсах |
| GCC runtime / libquadmath | из колёс NumPy/SciPy | GPL-3.0-with-GCC-exception / LGPL-2.1-or-later | Бинарные зависимости колёс |
| pywebview | 6.2.1 | BSD-3-Clause | Окно приложения на macOS |
| PyObjC | 13.0 | MIT | Доступ к AppKit/WebKit на macOS |
| fast-simplification | 0.2.0 | MIT | Упрощение сетки |
| certifi | 2026.7.22 | MPL-2.0 | Проверка HTTPS-сертификатов |
| PyInstaller | 6.22.3 | GPL-2.0-or-later with bootloader exception | Сборка исполняемых файлов |
| three.js / OrbitControls / Lines | vendored | MIT | 3D-просмотр в интерфейсе |

WebKit и системные фреймворки macOS не распространяются вместе с проектом:
приложение использует системные компоненты операционной системы.

## Qhull

Qhull включён в бинарную сборку через SciPy. Условия Qhull требуют
сохранять уведомление и распространять этот текст вместе с копиями Qhull.
Полный текст из `qhull_src/COPYING.txt`:

```text
                    Qhull, Copyright (c) 1993-2019

                            C.B. Barber
                           Arlington, MA

                               and

       The National Science and Technology Research Center for
        Computation and Visualization of Geometric Structures
                        (The Geometry Center)
                       University of Minnesota

                       email: qhull@qhull.org

This software includes Qhull from C.B. Barber and The Geometry Center.
Qhull is copyrighted as noted above.  Qhull is free software and may
be obtained via http from www.qhull.org.  It may be freely copied, modified,
and redistributed under the following conditions:

1. All copyright notices must remain intact in all files.

2. A copy of this text file must be distributed along with any copies
   of Qhull that you redistribute; this includes copies that you have
   modified, or copies of programs or other software products that
   include Qhull.

3. If you modify Qhull, you must include a notice giving the
   name of the person performing the modification, the date of
   modification, and the reason for such modification.

4. When distributing modified versions of Qhull, or other software
   products that include Qhull, you must provide notice that the original
   source code may be obtained as noted above.

5. There is no warranty or other guarantee of fitness for Qhull, it is
   provided solely "as is".  Bug reports or fixes may be sent to
   qhull_bug@qhull.org; the authors may or may not act on them as
   they desire.
```

## Полные тексты лицензий

- NumPy — <https://numpy.org/doc/stable/license.html>
- SciPy — <https://scipy.org/license/>
- Qhull — <https://www.qhull.org/COPYING.txt>
- pywebview — <https://github.com/r0x0r/pywebview/blob/master/LICENSE>
- PyObjC — <https://github.com/ronaldoussoren/pyobjc/blob/main/LICENSE.txt>
- fast-simplification — <https://github.com/pyvista/fast-simplification/blob/main/LICENSE>
- certifi — <https://github.com/certifi/python-certifi/blob/master/LICENSE>
- PyInstaller — <https://pyinstaller.org/en/stable/license.html>
- three.js — <https://github.com/mrdoob/three.js/blob/dev/LICENSE>
- Python — <https://docs.python.org/3/license.html>

Для публичного распространения бинарников рекомендуется приложить к релизу
`LICENSE`, `ACKNOWLEDGMENTS.md` и этот файл, а также полные
тексты лицензий перечисленных компонентов.
