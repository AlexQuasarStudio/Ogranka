"""Application metadata shared by the server and platform helpers."""
try:
    from build_info import BUILD as APP_BUILD
except ImportError:
    APP_BUILD = "44"

APP_VERSION = "1.0.4"
APP_REPO = "AlexQuasarStudio/Ogranka"
APP_AUTHOR = "Дьяченко Алексей"
APP_AFFILIATION = "5 курс, мехмат МГУ, кафедра вычислительной математики"
APP_ADVISOR = "Валединский Владимир Дмитриевич"
APP_TITLE = f"Огранка {APP_VERSION} — восстановление формы"
