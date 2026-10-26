@echo off
cd /d "%~dp0"
node scripts\local.mjs %*
if errorlevel 1 pause
