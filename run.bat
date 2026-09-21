@echo off
REM ============================================================
REM  NOMAD - 사막의 거대 도시 : Windows 실행 스크립트
REM  Node.js 설치 확인 -> 패키지 설치 -> 개발 서버 실행 -> 브라우저 열기
REM ============================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo.
echo   NOMAD - 사막의 거대 도시
echo   ------------------------------------------------------
echo.

REM --- 1) Node.js 확인 ---------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo   [오류] Node.js 가 설치되어 있지 않습니다.
    echo.
    echo   https://nodejs.org 에서 LTS 버전을 설치한 뒤
    echo   이 창을 닫고 run.bat 을 다시 실행해 주세요.
    echo.
    start "" "https://nodejs.org/ko/download"
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
echo   Node.js %NODEVER% 확인됨

REM --- 2) 패키지 설치 ----------------------------------------
if not exist "node_modules\vite" (
    echo   패키지를 설치합니다. 처음 한 번만 몇 분 걸립니다...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo   [오류] 패키지 설치에 실패했습니다. 인터넷 연결을 확인해 주세요.
        pause
        exit /b 1
    )
    echo.
    echo   설치 완료
) else (
    echo   패키지 설치됨
)

REM --- 3) 서버 실행 + 브라우저 열기 ---------------------------
echo.
echo   개발 서버를 시작합니다.  http://localhost:5173/
echo   종료하려면 이 창에서 Ctrl+C 를 누르거나 창을 닫으세요.
echo.

start "" /b cmd /c "timeout /t 4 >nul & start "" http://localhost:5173/"
call npx vite --port 5173

endlocal
