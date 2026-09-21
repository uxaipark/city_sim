@echo off
REM ============================================================
REM  NOMAD : 배포용 빌드 후 미리보기 서버 실행 (Windows)
REM  dist 폴더를 만들고 정적 서버로 띄웁니다.
REM ============================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul

where node >nul 2>nul
if errorlevel 1 (
    echo   [오류] Node.js 가 필요합니다. https://nodejs.org 에서 설치해 주세요.
    pause
    exit /b 1
)

if not exist "node_modules\vite" (
    echo   패키지를 설치합니다...
    call npm install || (echo   [오류] 설치 실패 & pause & exit /b 1)
)

echo   빌드 중...
call npx vite build
if errorlevel 1 (
    echo   [오류] 빌드에 실패했습니다.
    pause
    exit /b 1
)

echo.
echo   빌드 완료. 미리보기 서버를 시작합니다.  http://localhost:4173/
echo.
start "" /b cmd /c "timeout /t 3 >nul & start "" http://localhost:4173/"
call npx vite preview --port 4173

endlocal
