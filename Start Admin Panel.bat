@echo off
title BS Motors - Admin Panel

:: Start server only if not already running
tasklist /fi "imagename eq node.exe" | find /i "node.exe" > nul
if errorlevel 1 (
    start "BS Motors Server" /min cmd /k "C:\Users\gamer\node\node.exe "D:\Program Data\Coding\bsmotor\server.js""
    timeout /t 3 /nobreak > nul
)

:: Open admin panel
start chrome "http://localhost:3000/admin/login.html"

exit
