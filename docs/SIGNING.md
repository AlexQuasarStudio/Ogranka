# Подпись и notarization

Сейчас сборки выпускаются так:

- macOS: ad-hoc подпись `codesign --force --deep --sign -`.
- Windows: без подписи.

На машине нет действующих сертификатов Apple Developer ID и Windows
code-signing, поэтому полноценную подпись и notarization здесь сделать нельзя.
Ad-hoc подпись позволяет проверить целостность бандла, но не заменяет
Developer ID и не убирает предупреждение Gatekeeper. SmartScreen для
Windows-exe также останется.

Для публичной раздачи нужны:

## macOS

1. Сертификат `Developer ID Application` в связке ключей.
2. Подпись с hardened runtime:

```bash
codesign --force --deep --options runtime \
  --sign "Developer ID Application: <Имя> (<TEAM_ID>)" "Огранка.app"
codesign --verify --deep --strict "Огранка.app"
```

3. Notarization:

```bash
ditto -c -k --keepParent --norsrc --noextattr "Огранка.app" Ogranka-macos.zip
xcrun notarytool submit Ogranka-macos.zip \
  --apple-id "<APPLE_ID>" --team-id "<TEAM_ID>" --password "<APP_PASSWORD>" --wait
xcrun stapler staple "Огранка.app"
```

4. После stapling ZIP нужно собрать заново.

## Windows

Нужен сертификат code signing и `signtool`:

```bat
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 ^
  /f certificate.pfx /p <PASSWORD> Ogranka.exe
signtool verify /pa Ogranka.exe
```

## GitHub Actions

В workflow `release.yml` сейчас собираются ad-hoc/unsigned артефакты.
Для подписи в CI нужно добавить secrets с сертификатами и паролями, импортировать
их в runner и заменить шаги подписи. Секреты нельзя хранить в репозитории.
