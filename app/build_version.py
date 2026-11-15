from pathlib import Path
import re

import config


ROOT = Path(__file__).resolve().parent


def version_numbers(version):
    parts = [int(value) for value in re.findall(r"\d+", version)][:3]
    return parts + [0] * (3 - len(parts))


def version_tuple(version=None, build=None):
    version = config.APP_VERSION if version is None else version
    build = config.APP_BUILD if build is None else build
    build_number = int(build) if str(build).isdigit() else 0
    return tuple(version_numbers(version) + [build_number])


def render_version_info(version=None, build=None):
    version = config.APP_VERSION if version is None else version
    build = config.APP_BUILD if build is None else build
    filevers = version_tuple(version, build)
    return f"""VSVersionInfo(
  ffi=FixedFileInfo(
    filevers={filevers},
    prodvers={filevers},
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo([
      StringTable(
        '040904B0',
        [
          StringStruct('CompanyName', 'Дьяченко Алексей'),
          StringStruct('FileDescription', 'Огранка — восстановление формы'),
          StringStruct('FileVersion', '{version}'),
          StringStruct('InternalName', 'Ogranka'),
          StringStruct('LegalCopyright', '© 2026 Дьяченко Алексей'),
          StringStruct('OriginalFilename', 'Ogranka.exe'),
          StringStruct('ProductName', 'Огранка'),
          StringStruct('ProductVersion', '{version}'),
          StringStruct('Comments', 'Научный руководитель: Валединский Владимир Дмитриевич')
        ]
      )
    ]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""


def main():
    path = ROOT / "version_info.txt"
    path.write_text(render_version_info(), encoding="utf-8")
    print(f"version_info.txt: {config.APP_VERSION} build {config.APP_BUILD}")


if __name__ == "__main__":
    main()
