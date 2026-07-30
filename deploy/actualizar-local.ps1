# ══════════════════════════════════════════════════════════════════
#  PGR Compras Públicas — Actualizar despliegue local
#  - Abre el firewall para los puertos 80 y 3621
#  - Amplía las columnas de correo (migración 009, necesaria por el cifrado)
#  - Reinicia el servicio para cargar el código nuevo (frontend en :80)
#  - Cifra los correos existentes en reposo (paso final del cifrado)
#  - Verifica que quede escuchando en 80 y 3621
#
#  Ejecutar como ADMINISTRADOR (usa actualizar-local.bat para auto-elevar).
# ══════════════════════════════════════════════════════════════════
$root    = 'C:\Services\PGR'
$backend = Join-Path $root 'backend'
$svc     = 'pgrcompraspublicas.exe'
$ok = @(); $warn = @()

function Step($t){ Write-Host "`n== $t ==" -ForegroundColor Cyan }

# 1) Reglas de firewall (entrada TCP 80 y 3621)
Step '1) Firewall'
foreach($port in 80,3621){
  $name = "PGR TCP $port"
  try {
    if(Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue){
      Write-Host "  ya existía: $name"
    } else {
      New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Any -ErrorAction Stop | Out-Null
      Write-Host "  creada: $name" -ForegroundColor Green
    }
    $ok += "firewall $port"
  } catch { $warn += "firewall ${port}: $($_.Exception.Message)"; Write-Host "  FALLO: $($_.Exception.Message)" -ForegroundColor Red }
}

# 2) Migración 009: ampliar columnas de correo para alojar el texto cifrado
Step '2) Migración 009 (ampliar columnas de correo)'
try {
  sqlcmd -S localhost\SQLEXPRESS -E -C -b -i (Join-Path $backend 'sql\009_encrypt_email_columns.sql')
  if($LASTEXITCODE -eq 0){ Write-Host '  OK columnas ampliadas' -ForegroundColor Green; $ok += 'migración 009' }
  else { throw "sqlcmd devolvió código $LASTEXITCODE" }
} catch { $warn += "migración 009: $($_.Exception.Message)"; Write-Host "  FALLO: $($_.Exception.Message)" -ForegroundColor Red }

# 3) Reiniciar el servicio (carga server.js nuevo → escucha también en :80)
Step '3) Reiniciar servicio'
try {
  Restart-Service -Name $svc -Force -ErrorAction Stop
  Start-Sleep -Seconds 6
  $s = Get-Service $svc
  Write-Host "  estado: $($s.Status)" -ForegroundColor Green
  $ok += 'reinicio'
} catch { $warn += "reinicio: $($_.Exception.Message)"; Write-Host "  FALLO: $($_.Exception.Message)" -ForegroundColor Red }

# 4) Cifrar correos existentes en reposo (seguro: el código nuevo ya está activo)
Step '4) Cifrar correos existentes'
try {
  Push-Location $backend
  npm run --silent encrypt-emails
  Pop-Location
  $ok += 'cifrado de datos existentes'
} catch { $warn += "encrypt-emails: $($_.Exception.Message)"; Write-Host "  FALLO: $($_.Exception.Message)" -ForegroundColor Red }

# 5) Verificar puertos en escucha
Step '5) Verificación'
Get-NetTCPConnection -State Listen -LocalPort 80,3621 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,OwningProcess | Sort-Object LocalPort -Unique | Format-Table -AutoSize

Write-Host "`n─────────── RESUMEN ───────────" -ForegroundColor Cyan
Write-Host ("OK:   " + ($ok -join ', ')) -ForegroundColor Green
if($warn.Count){ Write-Host ("AVISO:" + ($warn -join ' | ')) -ForegroundColor Yellow }
Write-Host "`nProbar desde otra máquina:  http://192.168.79.18" -ForegroundColor Green
Write-Host "Presione Enter para cerrar..." ; [void][System.Console]::ReadLine()
