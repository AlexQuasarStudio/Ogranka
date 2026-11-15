"""Application metadata shared by the server and platform helpers."""
import os

APP_VERSION = "1.0.1"
APP_BUILD = os.environ.get("OGRANKA_BUILD") or "44"
APP_REPO = "AlexQuasarStudio/Ogranka"
APP_AUTHOR = "Дьяченко Алексей"
APP_AFFILIATION = "5 курс, мехмат МГУ, кафедра вычислительной математики"
APP_ADVISOR = "Валединский Владимир Дмитриевич"
APP_TITLE = f"Огранка {APP_VERSION} — восстановление формы"
