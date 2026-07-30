@echo off
title PGR - Sistema de Compras Publicas UACP
echo ============================================
echo   PGR - Compras Publicas UACP
echo   Procuraduria General de la Republica
echo   Base de datos: SQL Server (PGR_Compras)
echo ============================================
echo.

:: Verificar SQL Server
sc query "MSSQL$SQLEXPRESS" | find "RUNNING" >nul
if errorlevel 1 (
    echo [!] SQL Server ^(SQLEXPRESS^) no esta corriendo. Intentando iniciar...
    net start "MSSQL$SQLEXPRESS"
    if errorlevel 1 (
        echo [X] No se pudo iniciar SQL Server. Inicielo manualmente y reintente.
        pause
        exit /b 1
    )
)

:: Crear/actualizar esquema. Los scripts son idempotentes, se aplican en orden 001..008.
:: -C = confiar en el certificado autofirmado de SQL Server (obligatorio con sqlcmd/ODBC 18).
sqlcmd -S localhost\SQLEXPRESS -E -C -h -1 -Q "SET NOCOUNT ON; SELECT ISNULL(CONVERT(varchar(10),DB_ID('PGR_Compras')),'NULL')" | find "NULL" >nul
if not errorlevel 1 (
    echo [*] Base de datos no encontrada. Creando PGR_Compras...
) else (
    echo [*] Aplicando migraciones SQL...
)
for /f "delims=" %%f in ('dir /b /on "%~dp0backend\sql\*.sql"') do (
    sqlcmd -S localhost\SQLEXPRESS -E -C -b -i "%~dp0backend\sql\%%f" >nul
    if errorlevel 1 (
        echo [X] Error ejecutando %%f. Abortando.
        pause
        exit /b 1
    )
)

:: Backend
echo [1/2] Iniciando Backend (puerto 3621)...
cd /d "%~dp0backend"
if not exist node_modules (
    echo Instalando dependencias del backend...
    call npm install
)
start "PGR-Backend" cmd /k "node --use-system-ca --watch server.js"

:: Frontend
echo [2/2] Iniciando Frontend (puerto 5176)...
cd /d "%~dp0frontend"
if not exist node_modules (
    echo Instalando dependencias del frontend...
    call npm install
)
start "PGR-Frontend" cmd /k "npx vite"

echo.
echo ============================================
echo   Sistema iniciado correctamente!
echo   Backend:  http://localhost:3621
echo   Frontend: http://localhost:5176
echo.
echo   Admin: DUI 00000000-0 / AdminPGR2024!
echo ============================================
pause
