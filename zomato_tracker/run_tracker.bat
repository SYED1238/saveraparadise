@echo off
title Zomato Autonomous Order Recorder
cd /d "%~dp0"
echo ============================================================
echo   STARTING ZOMATO ORDER RECORDER (EVERY 15 SECONDS)
echo ============================================================
echo.
python -u tracker.py
pause
