@echo off
echo ========================================================
echo WhisperFlow Native Application Builder
echo ========================================================
echo Compiling Python Backend (this may take a few minutes)...
cd backend
call build_backend.bat
cd ..

echo.
echo Compiling the Tauri frontend into a standalone .exe...
echo This may take a minute or two.
echo.

cd frontend
call npm run tauri build

echo.
echo ========================================================
echo BUILD COMPLETE! 
echo ========================================================
echo Opening your compiled executable folder...
explorer src-tauri\target\release
pause
