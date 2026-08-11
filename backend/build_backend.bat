@echo off
echo ========================================================
echo Building Python Backend with PyInstaller
echo ========================================================

:: Create the bin directory in the Tauri frontend if it doesn't exist
if not exist "..\frontend\src-tauri\bin" mkdir "..\frontend\src-tauri\bin"

:: Run Pyinstaller
echo Compiling main.py into a standalone executable...
call .\.venv\Scripts\pyinstaller --onefile --noconsole --name backend-x86_64-pc-windows-msvc main.py

:: Move the generated executable to the Tauri sidecar folder
echo Moving the executable to the Tauri bin folder...
move /y "dist\backend-x86_64-pc-windows-msvc.exe" "..\frontend\src-tauri\bin\backend-x86_64-pc-windows-msvc.exe"

echo Cleaning up build folders...
rmdir /s /q build
rmdir /s /q dist
del backend-x86_64-pc-windows-msvc.spec

echo.
echo ========================================================
echo Backend Build Complete!
echo It is now ready to be bundled into the LisaFlow .exe
echo ========================================================
pause
