@echo off
cd /d "%~dp0"
echo Starting Backend and Frontend...

:: Start Backend
cd backend
start cmd /k "npm run dev"

:: Start Frontend
cd ../frontend
start cmd /k "npm run dev"

echo Both applications are starting...
exit
