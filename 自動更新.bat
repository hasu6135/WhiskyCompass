@echo off
rem コードページをUTF-8に設定
chcp 65001 > nul

rem ===================================================
rem 📁 ログフォルダの自動作成と詳細な日時の取得
rem ===================================================
if not exist Log mkdir Log

rem 1. 日付を YYYY-MM-DD の形式で取得
for /f "tokens=1-3 delims=/ " %%a in ("%date%") do (
    set CURRENT_DATE=%%a-%%b-%%c
)
set CURRENT_DATE=%CURRENT_DATE:/=-%

rem 2. 時間を HHMMSS の形式で取得 (AMの時にスペースが入る対策込み)
set TIME_STR=%time: =0%
set CURRENT_TIME=%TIME_STR:~0,2%%TIME_STR:~3,2%%TIME_STR:~6,2%

rem 3. ログファイル名を「YYYY-MM-DD_HHMMSS.log」に指定
set LOG_FILE=Log\%CURRENT_DATE%_%CURRENT_TIME%.log

echo ===================================================
echo サイト自動更新システム 起動 (画面＆ログ同時出力)
echo 実行日時: %date% %time%
echo ログ先: %LOG_FILE%
echo ===================================================
echo.

rem ===================================================
rem 🚀 メイン処理 (PowerShellを使って画面に出しつつログに追記)
rem ===================================================

echo [STEP 1/3] 🔄 最新情報を取得してAIレビュー執筆中... | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
echo --------------------------------------------------- | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"

rem 💡 nodeの出力（エラー含む）をリアルタイムに画面に出しつつログへ
node app.js 2>&1 | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"

if errorlevel 1 (
    echo.
    echo ❌ node app.js の実行中にエラーが発生しました。 | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
    echo LM Studioが起動しているか確認してください。     | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
    goto ERROR_END
)

echo. | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
echo [STEP 2/3] 🔗 GitHubへの接続先を最新化中... | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
echo --------------------------------------------------- | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"

git remote set-url origin https://github.com/hasu6135/WhiskyCompass.git 2>&1 | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
if errorlevel 1 (
    git remote add origin https://github.com/hasu6135/WhiskyCompass.git 2>&1 | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
)

echo. | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
echo [STEP 3/3] 🚀 更新されたページをGitHubへプッシュ中... | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
echo --------------------------------------------------- | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"

rem 💡 gitの出力も画面に出しつつログへ
git add . 2>&1 | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
git commit -m "バッチファイルによるサイト自動更新" 2>&1 | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
git push -u origin main 2>&1 | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"

if errorlevel 1 (
    echo.
    echo ❌ GitHubへのアップロードに失敗しました。 | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
    goto ERROR_END
)

echo. | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
echo =================================================== | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
echo ✨ すべての処理が正常に完了しました！               | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
echo Cloudflare Pages側のサイトが自動更新されます。      | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"
echo =================================================== | powershell -Command "$Input | Tee-Object -FilePath '%LOG_FILE%' -Append"

rem 🟢 正常終了時の画面表示
echo.
echo 固定表示：ログの書き込みを含め、すべて正常に完了しました！
timeout /t 30
exit /b

:ERROR_END
rem 🔴 エラー終了時の画面表示
echo.
echo 固定表示：処理中にエラーが発生しました。上のログを確認してください。
pause
exit /b 1

