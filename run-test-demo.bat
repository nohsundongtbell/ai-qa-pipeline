@echo off
chcp 65001 >nul
setlocal
title 테스트 자동화 데모
cd /d "%~dp0"

rem ============================================================
rem  테스트 자동화 데모 (교육용)
rem  더블클릭하면 메뉴가 나옵니다.
rem  번호를 미리 지정할 수도 있어요:   run-test-demo.bat 3
rem  번호 뒤에 시험 번호를 붙이면 그 시험만 실행합니다:   run-test-demo.bat 2 TC-102
rem ============================================================

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo [오류] Node.js가 설치되어 있지 않습니다.
  echo        https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo 처음 실행이라 필요한 프로그램을 설치합니다. 몇 분 걸릴 수 있어요...
  echo.
  call npm install
  if errorlevel 1 goto :fail
)

echo.
echo 시험용 브라우저 준비를 확인합니다. 처음에는 다운로드에 시간이 걸릴 수 있어요...
call npx playwright install chromium
if errorlevel 1 goto :fail

set "FILTER="
if not "%~2"=="" set "FILTER=-g %~2"

if not "%~1"=="" (
  call :act%~1
  exit /b %errorlevel%
)

:menu
cls
echo ==================================================================
echo    테스트 자동화 데모  -  게시판 앱을 로봇이 검사하는 모습
echo ==================================================================
echo.
echo    1. Playwright UI 모드로 보기      추천! 시험을 골라 실행하고 화면을 되감아 볼 수 있어요
echo    2. 브라우저 창을 띄워 천천히 실행  로봇이 클릭하고 입력하는 모습을 그대로 봐요
echo    3. 전체 자동 실행                  창 없이 빠르게 107개 시험 결과를 확인해요
echo    4. 게시판 앱만 실행하기            npm start 후 브라우저로 열어요
echo    5. 마지막 결과 리포트 열기         통과 실패 화면 캡처를 볼 수 있어요
echo    0. 종료
echo.
choice /c 123450 /n /m "번호를 선택하세요: "
set "SEL=%errorlevel%"
if "%SEL%"=="6" goto :end
call :act%SEL%
echo.
pause
goto :menu

:act1
echo.
echo [UI 모드] 잠시 뒤 Playwright 창이 열립니다.
echo   - 왼쪽 목록에서 시험을 고르고 삼각형 실행 버튼을 누르세요.
echo   - 가운데 화면에서 브라우저가 움직이는 모습이 보입니다.
echo   - 창을 닫으면 이 화면으로 돌아옵니다.
echo.
call npx playwright test tests/ui --ui %FILTER%
exit /b 0

:act2
echo.
echo [천천히 실행] 브라우저 창이 열리고 시험이 하나씩 실행됩니다. 창을 닫지 마세요.
echo.
set "SLOWMO=600"
call npx playwright test tests/ui --project=main --headed --workers=1 %FILTER%
if errorlevel 1 (
  echo.
  echo 실패한 시험이 있습니다. 메뉴 5번에서 리포트를 열어 확인하세요.
) else (
  echo.
  echo 모든 시험이 통과했습니다.
)
exit /b 0

:act3
echo.
echo [전체 자동 실행] 창 없이 빠르게 실행합니다. 약 30초 걸려요.
echo.
call npx playwright test %FILTER%
if errorlevel 1 (
  echo.
  echo 실패한 시험이 있습니다. 메뉴 5번에서 리포트를 열어 확인하세요.
) else (
  echo.
  echo 모든 시험이 통과했습니다.
)
exit /b 0

:act4
echo.
echo 게시판 앱을 새 창에서 실행합니다. 그 창을 닫으면 앱도 종료됩니다.
start "게시판 앱 - 닫으면 종료됩니다" cmd /k "cd /d %~dp0 && npm start"
timeout /t 3 /nobreak >nul
start "" http://localhost:3000
echo 브라우저에서 http://localhost:3000 이 열립니다.
exit /b 0

:act5
echo.
echo 리포트 화면이 브라우저에 열립니다. 다 보셨으면 이 창에서 Ctrl+C 를 누르세요.
echo.
call npx playwright show-report
exit /b 0

:fail
echo.
echo [오류] 준비 중 문제가 생겼습니다. 위의 메시지를 확인해 주세요.
echo        인터넷 연결이 필요합니다. 이전에 연 데모 창이 남아 있다면 닫고 다시 실행해 보세요.
echo.
pause
exit /b 1

:end
endlocal
exit /b 0
