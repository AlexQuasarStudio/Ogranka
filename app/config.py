"""Application metadata shared by the server and platform helpers."""
try:
    from build_info import BUILD as APP_BUILD
except ImportError:
    # Номер сборки вписывает build_version.py (в CI — число коммитов).
    APP_BUILD = "0"

APP_VERSION = "1.1.2"
APP_REPO = "AlexQuasarStudio/Ogranka"
APP_AUTHOR = "Дьяченко Алексей"
APP_AFFILIATION = "5 курс, мехмат МГУ, кафедра вычислительной математики"
APP_ADVISOR = "Валединский Владимир Дмитриевич"
APP_TITLE = f"Огранка {APP_VERSION} — восстановление формы"
