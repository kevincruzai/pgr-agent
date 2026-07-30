@echo off
:: Lanza actualizar-local.ps1 pidiendo elevacion (UAC). Doble clic para ejecutar.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"%~dp0actualizar-local.ps1\"'"
