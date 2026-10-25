@echo off
title Zomato Chrome Launcher
echo ============================================================
echo   STARTING GOOGLE CHROME FOR ZOMATO ORDER AUTOMATION
echo ============================================================
echo.
echo Launching Chrome with remote debugging on Port 9222...
echo (You only need to log in ONCE. Your session will stay saved!)
echo.

start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\AutomationProfile" "https://www.zomato.com/partners/onlineordering/orders/"

echo Chrome started. Now you can run "run_tracker.bat" anytime!
timeout /t 5
