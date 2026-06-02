@echo off
REM ============================================================
REM  DMU Tool - one-click launcher (Windows, no admin needed)
REM ------------------------------------------------------------
REM  1. Download the Node 20 LTS "Windows Binary (.zip)" from
REM     nodejs.org  (NOT the .msi installer).
REM  2. Extract it into a folder named "node" inside this project,
REM     so that "node\node.exe" sits next to this start.bat.
REM     (Or set NODE_HOME below to wherever you extracted it.)
REM  3. Put your key in the .env file:  ANTHROPIC_API_KEY=sk-ant-...
REM  4. Double-click this file.
REM ============================================================

setlocal
cd /d "%~dp0"

REM --- Where is portable Node? Default: a "node" folder beside this script ---
set "NODE_HOME=%~dp0node"

if not exist "%NODE_HOME%\node.exe" (
  echo.
  echo  [!] Could not find node.exe at: %NODE_HOME%
  echo.
  echo      Download the Node 20 LTS "Windows Binary (.zip)" from nodejs.org,
  echo      extract it, and either:
  echo        - rename/move the extracted folder to "node" inside this project, or
  echo        - edit NODE_HOME at the top of this start.bat to point at it.
  echo.
  pause
  exit /b 1
)

REM --- Put portable Node first on PATH, for THIS window only (no system change) ---
set "PATH=%NODE_HOME%;%PATH%"

REM --- Make a .env if it's missing, so the app has something to read ---
if not exist ".env" (
  echo  [i] No .env found - creating one from .env.example
  copy /y ".env.example" ".env" >nul
  echo  [i] Edit .env and add your ANTHROPIC_API_KEY, then run this again.
  pause
  exit /b 0
)

REM --- First run: install dependencies (downloads prebuilt SQLite, no compiler) ---
if not exist "node_modules" (
  echo  [i] First run - installing dependencies, please wait...
  call "%NODE_HOME%\npm.cmd" install
  if errorlevel 1 (
    echo  [!] npm install failed. See messages above.
    pause
    exit /b 1
  )
)

echo.
echo  Starting DMU Tool...  open  http://localhost:3000  in your browser.
echo  (Close this window to stop the server.)
echo.

REM --- Open the browser shortly after the server boots ---
start "" /b cmd /c "timeout /t 3 >nul & start http://localhost:3000"

"%NODE_HOME%\node.exe" server.js

endlocal
