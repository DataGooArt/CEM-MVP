# CEM Local Setup Orchestrator

Write-Host "0. Verificando motor de Docker..." -ForegroundColor Cyan
docker info >$null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker Desktop no está corriendo. Inícialo y vuelve a ejecutar el script." -ForegroundColor Red
    exit
}

Write-Host "1. Limpiando procesos de Postgres nativos en Windows..." -ForegroundColor Yellow
Get-Process postgres -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "2. Liberando puertos y limpiando infraestructura Docker..." -ForegroundColor Cyan
docker compose down -v

Write-Host "3. Levantando base de datos y cache..." -ForegroundColor Cyan
docker compose up -d postgres redis

Write-Host "4. Esperando a que PostgreSQL este listo..." -ForegroundColor Cyan
do {
    $containerId = docker compose ps -q postgres
    if ($containerId) {
        $status = docker inspect -f '{{.State.Health.Status}}' $containerId
    } else {
        $status = "starting"
    }
    Start-Sleep -Seconds 2
} until ($status -eq "healthy")

Write-Host "5. Sincronizando Base de Datos (Prisma)..." -ForegroundColor Cyan
cd backend
npx prisma generate
npx prisma migrate dev --name init

Write-Host "6. Entorno listo." -ForegroundColor Green
Write-Host "Ejecuta 'npm run start:dev' en /backend y 'npm run dev' en /frontend"
cd ..