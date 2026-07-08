@echo off
chcp 65001 >nul 2>nul
echo.
echo   Starting build...
echo.

set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot"
set "ANDROID_HOME=E:\SDK"
set "PATH=%GRADLE_HOME%\bin;%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools;%PATH%"

node "%~dp0build.js"

pause
