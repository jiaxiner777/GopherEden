@echo off
setlocal

set "EXT_DIR=%~dp0"
if "%EXT_DIR:~-1%"=="\" set "EXT_DIR=%EXT_DIR:~0,-1%"

set "TARGET_WORKSPACE=%~1"
if "%TARGET_WORKSPACE%"=="" set "TARGET_WORKSPACE=%CD%"

set "CODE_EXE=%LocalAppData%\Programs\Microsoft VS Code\Code.exe"
if not exist "%CODE_EXE%" set "CODE_EXE=%ProgramFiles%\Microsoft VS Code\Code.exe"
if not exist "%CODE_EXE%" set "CODE_EXE=%ProgramFiles(x86)%\Microsoft VS Code\Code.exe"

if not exist "%CODE_EXE%" (
  echo Could not find VS Code executable.
  echo Please edit open-dev-host.cmd and set CODE_EXE manually.
  exit /b 1
)

echo Launching VS Code with extension development path:
echo   %EXT_DIR%
echo Target workspace:
echo   %TARGET_WORKSPACE%

"%CODE_EXE%" --new-window --extensionDevelopmentPath="%EXT_DIR%" "%TARGET_WORKSPACE%"
