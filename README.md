# 🛡️ CEM Platform — MVP v2

**Continuous Exposure Management & Offensive Security Orchestrator**

Plataforma integral para la gestión continua de la exposición, integrando herramientas de seguridad ofensiva líderes con análisis predictivo e informes generados por IA (Gemini/Ollama).

---

## Stack
### 🚀 Core Technologies
- **Backend:** [NestJS](https://nestjs.com/) (Node.js) con [Prisma ORM](https://www.prisma.io/).
- **Frontend:** [React](https://reactjs.org/) (Vite) + TypeScript + Tailwind CSS.
- **Procesamiento Asíncrono:** [Redis](https://redis.io/) + [BullMQ](https://docs.bullmq.io/).
- **Comunicación Real-time:** [Socket.IO](https://socket.io/) (WebSockets).
- **IA:** Google Gemini (Cloud) y Ollama (Local/Self-hosted).
- **Infraestructura:** Docker Compose v2.

### 🛠️ Security Tools Integrated
- **Escaneo de Red:** Nmap
- **Vulnerabilidades Web:** Nuclei, Nikto, SSLScan, Subfinder
- **Fuzzing:** Ffuf, Gobuster

---

## 📂 Estructura del Proyecto

```text
├── backend/              # API NestJS y Lógica de Negocio
├── worker/               # Procesamiento de colas (Normalización e IA)
├── frontend/             # Dashboard en React
├── collector/            # Engine de seguridad (Python + Plugins)
└── docker-compose.yml    # Orquestación de servicios
```
---

## Requisitos previos (Windows)
1. **Docker Desktop** (Asegurar que el motor esté corriendo).
2. **WSL2** (Windows Subsystem for Linux) habilitado.
3. Usar **PowerShell** como Administrador

## Levantar en Windows (PowerShell)

Abre **PowerShell como Administrador** en la carpeta del proyecto:

```powershell
# 1. Verificar que Docker Desktop está corriendo
docker info

# 2. BORRAR TODO LO ANTERIOR (MUY IMPORTANTE)
docker compose down -v
docker rmi cem-mvp-v2-api cem-mvp-v2-worker 2>$null
docker builder prune -af
docker system prune -af

# 3. BORRAR node_modules LOCALES (si existen, Docker los copia)
Remove-Item -Recurse -Force backend/node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force frontend/node_modules -ErrorAction SilentlyContinue

# 4. Reconstruir SIN CACHÉ
docker compose build --no-cache api worker

# 5. Levantar
docker compose up -d

# 6. Esperar 10 segundos y verificar
docker compose ps

# 7. Solo cuando postgres diga (healthy), migrar
docker compose exec api npx prisma migrate dev --name init

# 8. Verificar que api y worker siguen corriendo
docker compose ps
```

## URLs
- **Dashboard:** http://localhost:5173
- **API:** http://localhost:3001

---

## 🧠 Funcionalidades Clave

### 1. Diferenciación Técnica (Deltas)
El sistema no solo reporta hallazgos, sino que los clasifica en:
- **New:** Detectado por primera vez en el escaneo actual.
- **Recurring:** Vulnerabilidad que persiste desde escaneos anteriores.
- **Stale:** Hallazgos previos que no se confirmaron en el último scan (potencialmente resueltos).

### 2. Cálculo de Riesgo Dinámico
Cada activo posee un `exposureScore` que se actualiza tras cada scan. El sistema calcula un `riskScoreDelta` comparando el score actual contra el último reporte generado para ese dominio.

### 3. IA-Driven Executive Reports
Utiliza modelos de lenguaje para transformar hallazgos técnicos complejos en resúmenes ejecutivos digeribles, priorizando acciones de remediación.

---

## 🔄 Flujo de Datos

1.  **Collector:** Ejecuta herramientas $\rightarrow$ Envía RAW Data a la API via `POST /upload/:tool`.
2.  **API:** Recibe datos $\rightarrow$ Valida $\rightarrow$ Encola en **BullMQ (Redis)**.
3.  **Worker:** 
    - Consume la cola.
    - **Normaliza:** Convierte XML/JSON de herramientas a formato estándar CEM.
    - **Analiza:** Compara contra hallazgos previos.
    - **Persiste:** Guarda en PostgreSQL.
4.  **Telemetry:** Emite evento `scan:report_ready` via **Socket.IO**.
5.  **Frontend:** Recibe actualización en tiempo real y refresca el Dashboard.

---

## 🛡️ Seguridad
El sistema utiliza aislamiento por organizaciones (`orgId`). Los eventos de WebSocket se filtran mediante "Rooms" de Socket.IO, asegurando que cada usuario solo reciba actualizaciones de su propia infraestructura.
