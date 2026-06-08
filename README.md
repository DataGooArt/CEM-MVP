# 🛡️ CEM Platform — MVP v2

**Continuous Exposure Management & Offensive Security Orchestrator**

Plataforma de microservicios para la gestión continua de la exposición de seguridad, que orquesta herramientas de seguridad ofensiva líderes con análisis predictivo e informes generados por IA (Gemini/Ollama).

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
