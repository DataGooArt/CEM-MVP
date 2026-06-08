# 🛡️ CEM Platform — MVP v2

**Continuous Exposure Management & Offensive Security Orchestrator**

Plataforma de microservicios para la gestión continua de la exposición de seguridad, que orquesta herramientas de seguridad ofensiva líderes con análisis predictivo e informes generados por IA (Gemini/Ollama).

> Hecho con ❤️ por **Art Comunicaciones AMD**

---

## 🏗️ Arquitectura de Microservicios

CEM MVP v2 está diseñado como un conjunto de **microservicios independientes** que se comunican a través de HTTP/REST, WebSockets y colas asíncronas (BullMQ/Redis). Cada servicio tiene una responsabilidad única y puede desplegarse, escalarse y desarrollarse de forma independiente.

```
┌─────────────┐     HTTP/WS      ┌──────────────────┐
│   Frontend  │ ◄──────────────► │   API (NestJS)   │
│  React+Vite │  :5173 → :3001   │    :3001         │
└─────────────┘                  └────────┬─────────┘
                                          │
                    ┌─────────────────────┼────────────────────┐
                    │                     │                    │
             ┌──────▼──────┐    ┌─────────▼──────┐   ┌────────▼───────┐
             │  Collector  │    │  Worker (BullMQ│   │   PostgreSQL   │
             │  (Python)   │    │  + AI Engine)  │   │   + Redis      │
             │  :5000      │    │  bg process    │   │  :5432 / :6379 │
             └─────────────┘    └────────────────┘   └────────────────┘
                    │
            15 Security Plugins
     (nmap, nuclei, nikto, dalfox...)
```

### Microservicios

| Servicio | Tecnología | Puerto | Responsabilidad |
|---|---|---|---|
| **api** | NestJS 10 + Prisma | `3001` | REST API, WebSocket Gateway, orquestación de scans |
| **worker** | NestJS (BullMQ) | — | Normalización de resultados, análisis IA, generación de reportes |
| **collector** | Python 3 + Flask | `5000` | Plugin engine con 15 herramientas de seguridad ofensiva |
| **web** | React 18 + Vite | `5173` | Dashboard SPA con tiempo real |
| **postgres** | PostgreSQL 16 | `5432` | Almacenamiento persistente (Prisma ORM) |
| **redis** | Redis 7 | `6379` | Cola de mensajes (BullMQ) + pub/sub para WebSockets |
| **ollama** | Ollama | `11434` | Inferencia IA local (modelo `qwen3:4b`) |

---

## Stack
### 🚀 Tecnologías Principales
- **API Backend:** [NestJS](https://nestjs.com/) 10 (Node.js 20) con [Prisma ORM](https://www.prisma.io/) 5.
- **Frontend:** [React](https://reactjs.org/) 18 (Vite 5) + TypeScript + Tailwind CSS.
- **Procesamiento Asíncrono:** [Redis](https://redis.io/) 7 + [BullMQ](https://docs.bullmq.io/) 5 (Worker independiente).
- **Comunicación en Tiempo Real:** [Socket.IO](https://socket.io/) 4 (WebSockets con Rooms por organización).
- **IA Híbrida:** Google Gemini (nube) con fallback automático a Ollama (local/autoalojado). Circuit breaker incluido.
- **Motor Collector:** Python 3 + Flask + Waitress (15 plugins de seguridad).
- **Infraestructura:** Docker Compose v2 (orquestación completa de microservicios).

### 🛠️ Plugins de Seguridad (Collector)
- **Red y Descubrimiento:** Nmap, Subfinder, Amass, Httpx
- **Vulnerabilidades Web:** Nuclei, Nikto, SSLScan, Testssl.sh, Dalfox, SQLMap
- **Fuzzing y Rastreo:** Ffuf, Gobuster, Katana
- **Secretos y OSINT:** TruffleHog, WhatWeb

---

## 📂 Estructura del Proyecto

```text
├── backend/              # Microservicio API (NestJS) + Worker BullMQ
│   ├── src/
│   │   ├── main.ts                 # Entry point API
│   │   ├── worker.ts               # Entry point Worker
│   │   ├── app.module.ts           # Módulo raíz
│   │   ├── *controller.ts          # Controladores REST
│   │   ├── *service.ts             # Servicios de negocio
│   │   ├── *.worker.ts             # Procesadores BullMQ
│   │   ├── realtime.gateway.ts     # WebSocket Gateway
│   │   └── alert.engine.ts         # Motor de alertas
│   └── prisma/schema.prisma        # Esquema de base de datos
├── frontend/             # Microservicio Web (React SPA)
│   └── src/
│       ├── api.ts                  # Cliente HTTP centralizado
│       ├── socket.ts               # Cliente WebSocket
│       ├── store.ts                # Estado global (Zustand)
│       └── *.tsx                   # Componentes y vistas
├── collector/            # Microservicio Collector (Python)
│   ├── collector.py                # Server Flask + orchestrator
│   └── plugins/                    # 15 plugins de herramientas
├── kali-scripts/         # Scripts opcionales para Kali Linux
└── docker-compose.yml    # Orquestación completa de microservicios
```
---

## Requisitos previos
- **Docker Desktop** con motor corriendo
- **Node.js 20+** (recomendado: nvm)
- **PowerShell** (Windows) o bash (Linux/macOS)

---

## 🛠️ Modos de Ejecución

### Modo Full Docker ✅ (Recomendado — todo en contenedores)

```powershell
# 1. Copia y configura las variables de entorno
Copy-Item .env.example .env
# Edita .env: GEMINI_API_KEY, SMTP_USER, SMTP_PASS

# 2. Construye y levanta todos los servicios
docker compose up -d --build

# 3. Aplica el esquema de base de datos (solo la primera vez)
docker compose exec api npx prisma db push

# Ver logs en tiempo real
docker compose logs -f api worker collector
```

### Modo Híbrido (Desarrollo con hot-reload)

Infraestructura en Docker, código fuente con hot-reload nativo.

```powershell
# 1. Infraestructura + Collector en Docker
docker compose up -d postgres redis collector

# 2. API con hot-reload (Terminal 1 — desde backend/)
cd backend
npm install
npx prisma db push
npm run start:dev        # Carga .env automáticamente via dotenv-cli

# 3. Worker con hot-reload (Terminal 2 — desde backend/)
npm run start:dev:worker

# 4. Frontend con hot-reload (Terminal 3 — desde frontend/)
cd frontend
npm install
$env:VITE_API_URL="http://localhost:3001"; node_modules\.bin\vite
```

> Los scripts `start:dev` y `start:dev:worker` cargan el `.env` de la raíz del proyecto automáticamente usando `dotenv-cli`, igual que Docker Compose.

### Variables de Entorno Clave (`.env`)

| Variable | Valor local (híbrido) | Descripción |
|---|---|---|
| `DATABASE_URL` | `postgresql://cem:cem_secret@127.0.0.1:5432/cem_db` | Conexión PostgreSQL (nativo) |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Conexión Redis |
| `GEMINI_API_KEY` | `tu_api_key` | API Key de Google Gemini (opcional) |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Modelo de análisis IA |
| `SMTP_USER` | `tu@gmail.com` | Email para alertas |
| `SMTP_PASS` | `app_password` | Contraseña de app Gmail |
| `API_INTERNAL_URL` | `http://host.docker.internal:3001` | URL que usa el Collector Docker para llamar al API nativo |

> **Docker Full:** `DATABASE_URL` y `REDIS_URL` se sobreescriben automáticamente en el `docker-compose.yml` usando los nombres de los servicios (`postgres`, `redis`). No es necesario cambiar el `.env`.

---

## 🌐 URLs de Acceso

| Servicio | URL | Descripción |
|---|---|---|
| Dashboard | http://localhost:5173 | Interfaz principal |
| API REST | http://localhost:3001 | Backend NestJS |
| Swagger UI | http://localhost:3001/api/docs | Documentación interactiva de la API |
| Collector Health | http://localhost:5000/health | Estado del microservicio Collector (15 plugins) |

---

## 🧠 Funcionalidades Clave

### 1. Pipeline de Findings Completo
Collector → API → Redis → Worker → PostgreSQL → WebSocket → Dashboard en tiempo real.
- **Deduplicación:** Hash de contenido por finding (`contentHash`) — no se duplican hallazgos repetidos.
- **Detección inteligente de activos:** Diferencia IPs (`192.168.1.1`) de dominios (`example.com`) automáticamente.
- **Correlación multi-scan:** `seenCount` incrementa por cada scan que confirma el mismo hallazgo.

### 2. Diferenciación Técnica (Deltas)
El sistema no solo reporta hallazgos, sino que los clasifica en:
- **Nuevo:** Detectado por primera vez en el escaneo actual.
- **Recurrente:** Vulnerabilidad que persiste desde escaneos anteriores.
- **Resuelto:** Hallazgos previos que no se confirmaron en el último escaneo.

### 3. Análisis IA con Circuit Breaker
- Proveedor principal: **Google Gemini** (`gemini-2.0-flash` o el modelo configurado en `GEMINI_MODEL`).
- Fallback automático a **Ollama** si Gemini falla 3 veces consecutivas.
- Circuit breaker: pausa Gemini 5 minutos antes de reintentar.
- Endpoints disponibles:
  - `GET /api/v1/findings/:id/analysis` — obtener análisis IA de un finding
  - `POST /api/v1/findings/:id/analyze` — lanzar análisis IA manual
  - `POST /api/v1/findings/reanalyze-batch` — re-analizar múltiples findings

### 4. Informes Ejecutivos y Técnicos
- **Informe técnico:** Delta de hallazgos por scan (nuevos vs recurrentes vs resueltos).
- **Informe ejecutivo IA:** Resumen en lenguaje natural para gerencia, generado automáticamente al finalizar cada scan.
- Endpoints: `GET /api/v1/reports/:scanId`, `GET /api/v1/reports/:scanId/ai-report`.

### 5. Cálculo de Riesgo Dinámico
Cada activo tiene un `exposureScore` (0–100) que se actualiza tras cada scan según la severidad acumulada de sus hallazgos abiertos.

### 6. Alertas en Tiempo Real
Motor de alertas configurable por reglas (severidad, categoría, tipo de activo). Notificaciones por email (SMTP) y WebSocket.

---

## 🔄 Flujo de Datos

```
Collector (Python)
    └─► POST /api/v1/collectors/upload/:tool
            └─► API encola en BullMQ (findings-ingest)
                    └─► Worker: normaliza + deduplica + persiste en PostgreSQL
                            └─► Worker: encola en BullMQ (findings-ai)
                                    └─► AiAnalysisWorker: analiza con Gemini/Ollama
                                            └─► Socket.IO → Dashboard en tiempo real
Scan completado
    └─► scan:done event
            └─► CollectorsService: genera informe técnico + encola informe ejecutivo IA
```

---

## 🛡️ Seguridad
- Aislamiento por organización (`orgId`) en todos los endpoints y eventos WebSocket.
- Los eventos de WebSocket se filtran mediante "Rooms" de Socket.IO.
- Swagger UI desactivable en producción con `SWAGGER_DISABLED=true`.
- Validación de entradas con `class-validator` + `ValidationPipe` global.

---

## 📊 Monitoreo de Scans

```powershell
# Estado de todos los scans (RUNNING, DONE, CANCELLED)
Invoke-RestMethod "http://localhost:3001/api/v1/reports/jobs" | ConvertTo-Json -Depth 3

# Logs del worker (findings procesados en tiempo real)
docker compose logs worker -f

# Logs del collector (herramientas ejecutándose)
docker compose logs collector -f

# Stats de findings por organización
Invoke-RestMethod "http://localhost:3001/api/v1/findings/stats?organizationId=org_demo" | ConvertTo-Json
```

---

## 🤝 Créditos

Desarrollado con ❤️ por el equipo de **[Art Comunicaciones AMD](https://artcom.com.co)**  
*Soluciones en Ciberseguridad, Infraestructura y Transformación Digital*


## 🏗️ Arquitectura de Microservicios

CEM MVP v2 está diseñado como un conjunto de **microservicios independientes** que se comunican a través de HTTP/REST, WebSockets y colas asíncronas (BullMQ/Redis). Cada servicio tiene una responsabilidad única y puede desplegarse, escalarse y desarrollarse de forma independiente.

```
┌─────────────┐     HTTP/WS      ┌──────────────────┐
│   Frontend  │ ◄──────────────► │   API (NestJS)   │
│  React+Vite │  :5173 → :3001   │    :3001         │
└─────────────┘                  └────────┬─────────┘
                                          │
                    ┌─────────────────────┼────────────────────┐
                    │                     │                    │
             ┌──────▼──────┐    ┌─────────▼──────┐   ┌────────▼───────┐
             │  Collector  │    │  Worker (BullMQ│   │   PostgreSQL   │
             │  (Python)   │    │  + AI Engine)  │   │   + Redis      │
             │  :5000      │    │  bg process    │   │  :5432 / :6379 │
             └─────────────┘    └────────────────┘   └────────────────┘
                    │
            15 Security Plugins
     (nmap, nuclei, nikto, dalfox...)
```

### Microservicios

| Servicio | Tecnología | Puerto | Responsabilidad |
|---|---|---|---|
| **api** | NestJS 10 + Prisma | `3001` | REST API, WebSocket Gateway, orquestación de scans |
| **worker** | NestJS (BullMQ) | — | Normalización de resultados, análisis IA, generación de reportes |
| **collector** | Python 3 + Flask | `5000` | Plugin engine con 15 herramientas de seguridad ofensiva |
| **web** | React 18 + Vite | `5173` | Dashboard SPA con tiempo real |
| **postgres** | PostgreSQL 16 | `5432` | Almacenamiento persistente (Prisma ORM) |
| **redis** | Redis 7 | `6379` | Cola de mensajes (BullMQ) + pub/sub para WebSockets |
| **ollama** | Ollama | `11434` | Inferencia IA local (modelo `qwen3:4b`) |

---

## Stack
### 🚀 Tecnologías Principales
- **API Backend:** [NestJS](https://nestjs.com/) 10 (Node.js 20) con [Prisma ORM](https://www.prisma.io/) 5.
- **Frontend:** [React](https://reactjs.org/) 18 (Vite 5) + TypeScript + Tailwind CSS.
- **Procesamiento Asíncrono:** [Redis](https://redis.io/) 7 + [BullMQ](https://docs.bullmq.io/) 5 (Worker independiente).
- **Comunicación en Tiempo Real:** [Socket.IO](https://socket.io/) 4 (WebSockets con Rooms por organización).
- **IA Híbrida:** Google Gemini (nube) con fallback automático a Ollama (local/autoalojado).
- **Motor Collector:** Python 3 + Flask + Waitress (15 plugins de seguridad).
- **Infraestructura:** Docker Compose v2 (orquestación de todos los microservicios).

### 🛠️ Plugins de Seguridad (Collector)
- **Red y Descubrimiento:** Nmap, Subfinder, Amass, Httpx
- **Vulnerabilidades Web:** Nuclei, Nikto, SSLScan, Testssl.sh, Dalfox, SQLMap
- **Fuzzing y Rastreo:** Ffuf, Gobuster, Katana
- **Secretos y OSINT:** TruffleHog, WhatWeb

---

## 📂 Estructura del Proyecto

```text
├── backend/              # Microservicio API (NestJS) + Worker BullMQ
│   ├── src/
│   │   ├── main.ts                 # Entry point API
│   │   ├── worker.ts               # Entry point Worker
│   │   ├── app.module.ts           # Módulo raíz
│   │   ├── *controller.ts          # Controladores REST
│   │   ├── *service.ts             # Servicios de negocio
│   │   ├── *.worker.ts             # Procesadores BullMQ
│   │   ├── realtime.gateway.ts     # WebSocket Gateway
│   │   └── alert.engine.ts         # Motor de alertas
│   └── prisma/schema.prisma        # Esquema de base de datos
├── frontend/             # Microservicio Web (React SPA)
│   └── src/
│       ├── api.ts                  # Cliente HTTP centralizado
│       ├── socket.ts               # Cliente WebSocket
│       ├── store.ts                # Estado global
│       └── *.tsx                   # Componentes y vistas
├── collector/            # Microservicio Collector (Python)
│   ├── collector.py                # Server Flask + orchestrator
│   └── plugins/                    # 15 plugins de herramientas
├── kali-scripts/         # Scripts opcionales para Kali Linux
└── docker-compose.yml    # Orquestación completa de microservicios
```
---

## Requisitos previos
- **Docker Desktop** con motor corriendo
- **Node.js 20+** (recomendado: nvm)
- **PowerShell** (Windows) o bash (Linux/macOS)

---

## 🛠️ Modos de Ejecución

### Modo Híbrido (Recomendado para desarrollo)

Ejecuta la infraestructura en Docker y los microservicios de código nativamente con hot-reload.

```powershell
# 1. Copia las variables de entorno
Copy-Item .env.example .env   # Edita GEMINI_API_KEY si quieres IA cloud

# 2. Levanta infraestructura (PostgreSQL + Redis)
docker compose up -d postgres redis

# 3. Levanta el Collector (microservicio Python con todas las herramientas)
docker compose up -d --no-deps --build collector

# 4. Backend API (con hot-reload)
cd backend
npm install
npx prisma generate
npx prisma db push
$env:DATABASE_URL="postgresql://cem:cem_secret@127.0.0.1:5432/cem_db?schema=public"
$env:REDIS_URL="redis://127.0.0.1:6379"
$env:COLLECTOR_URL="http://localhost:5000"
$env:API_INTERNAL_URL="http://localhost:3001"
$env:NODE_ENV="development"
npm run start:dev

# 5. Frontend (en otra terminal)
cd frontend
npm install
$env:VITE_API_URL="http://localhost:3001"
npm run dev
```

### Modo Full Docker (Producción / CI)

```powershell
# Construye y levanta todos los microservicios
docker compose up -d --build

# Ver logs de todos los servicios
docker compose logs -f

# Ver logs de un servicio específico
docker compose logs -f api
docker compose logs -f collector
```

### Variables de Entorno Clave (`.env`)

| Variable | Valor local | Descripción |
|---|---|---|
| `DATABASE_URL` | `postgresql://cem:cem_secret@127.0.0.1:5432/cem_db?schema=public` | Conexión PostgreSQL |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Conexión Redis |
| `COLLECTOR_URL` | `http://localhost:5000` | URL del microservicio Collector |
| `API_INTERNAL_URL` | `http://localhost:3001` | URL interna que el Collector usa para devolver findings |
| `GEMINI_API_KEY` | `tu_api_key` | API Key de Google Gemini (opcional) |
| `VITE_API_URL` | `http://localhost:3001` | URL del API para el frontend |

> **Modo híbrido con Collector en Docker:** El Collector usa `API_URL=http://host.docker.internal:3001` para alcanzar el backend nativo desde dentro del contenedor.

## 🌐 URLs de Acceso

| Servicio | URL | Descripción |
|---|---|---|
| Dashboard | http://localhost:5173 | Interfaz principal |
| API REST | http://localhost:3001 | Backend NestJS |
| Swagger UI | http://localhost:3001/api/docs | Documentación interactiva de la API |
| Collector Health | http://localhost:5000/health | Estado del microservicio Collector |

---

## 🧠 Funcionalidades Clave

### 1. Diferenciación Técnica (Deltas)
El sistema no solo reporta hallazgos, sino que los clasifica en:
- **Nuevo:** Detectado por primera vez en el escaneo actual.
- **Recurrente:** Vulnerabilidad que persiste desde escaneos anteriores.
- **Obsoleto:** Hallazgos previos que no se confirmaron en el último escaneo (potencialmente resueltos).

### 2. Cálculo de Riesgo Dinámico
Cada activo posee un `exposureScore` que se actualiza tras cada scan. El sistema calcula un `riskScoreDelta` comparando el score actual contra el último reporte generado para ese dominio.

### 3. IA-Driven Executive Reports
Utiliza modelos de lenguaje para transformar hallazgos técnicos complejos en resúmenes ejecutivos digeribles, priorizando acciones de remediación.

---

## 🔄 Flujo de Datos

1.  **Collector:** Ejecuta herramientas → Envía datos crudos a la API vía `POST /upload/:tool`.
2.  **API:** Recibe datos → Valida → Encola en **BullMQ (Redis)**.
3.  **Worker:**
    - Consume la cola.
    - **Normaliza:** Convierte XML/JSON de las herramientas al formato estándar CEM.
    - **Analiza:** Compara contra hallazgos anteriores.
    - **Persiste:** Guarda en PostgreSQL.
4.  **Telemetría:** Emite el evento `scan:report_ready` vía **Socket.IO**.
5.  **Frontend:** Recibe la actualización en tiempo real y refresca el Dashboard.

---

## 🛡️ Seguridad
El sistema utiliza aislamiento por organización (`orgId`). Los eventos de WebSocket se filtran mediante "Rooms" de Socket.IO, garantizando que cada usuario únicamente reciba actualizaciones de su propia infraestructura.
