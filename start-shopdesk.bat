@echo off
title ShopDesk
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b
)
if not exist .env copy .env.example .env >nul
findstr /c:"your-project-id" /c:"your-key-here" .env >nul
if not errorlevel 1 (
  echo Paste your Supabase Project URL and publishable key into the .env file that just opened, save it, then run this file again.
  start notepad .env
  pause
  exit /b
)
if not exist node_modules (
  echo Installing ShopDesk. This takes a minute the first time...
  call npm install
)
echo.
echo ShopDesk is starting. Open http://localhost:5173 on this laptop, or the Network address below on your phone.
echo Keep this window open while you use it. Close it to stop.
call npm run dev
pause
