# Guía de Desarrollo: Creación de Plugins para el Collector

Esta guía explica cómo añadir una nueva herramienta de seguridad (ej. `subfinder`, `checkov`, `trivy`) al flujo de trabajo de CEM.

## Arquitectura del Plugin

El flujo de un hallazgo es:
1. **Collector (Python):** Ejecuta la herramienta binaria y envía el output RAW a la API.
2. **API (NestJS):** Recibe el payload y lo encola en Redis.
3. **Worker (NestJS):** Consume el job, normaliza el output RAW a formato CEM y lo guarda en la DB.

---

## Paso 1: Instalar la herramienta en el Dockerfile

Debes asegurarte de que el contenedor del colector tenga el binario disponible. Modifica `collector/Dockerfile`:

```dockerfile
# Ejemplo para añadir 'subfinder'
RUN go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
```

---

## Paso 2: Crear el Plugin en Python (`collector/plugins/`)

Crea un archivo llamado `mytool_plugin.py`. Debe heredar de `BasePlugin` y retornar una lista de hallazgos normalizados.

```python
import subprocess
import logging
from plugins.base import BasePlugin

log = logging.getLogger(__name__)

class MyToolPlugin(BasePlugin):
    name = "mytool"
    description = "Descripción breve de lo que hace la herramienta"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        findings = []

        # 1. Ejecutar binario
        cmd = ["mytool", "-d", host]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        except Exception as e:
            log.error(f"Error en MyTool: {e}")
            return []

        # 2. Parsear y normalizar al formato CEM
        # (Este es un ejemplo simplificado)
        findings.append(self._finding(
            asset_id=host,
            title="Vulnerabilidad detectada por MyTool",
            severity="MEDIUM",
            category="VULNERABILITY",
            source_tool=self.name,
            description="Detalles de lo encontrado...",
            evidence={"raw_output": result.stdout[:500]}
        ))
        return findings
```

Luego, regístralo en el orquestador principal (`collector/main.py` o similar) para que se ejecute durante el ciclo de escaneo.

---

## Paso 3: Implementar el Parser en el Worker (`backend/src/worker/`)

El Worker necesita saber cómo leer el output de tu herramienta. Debes añadir un caso en el motor de normalización.

1. Crea un archivo `backend/src/worker/parsers/mytool.parser.ts`.
2. Implementa la lógica para transformar el RAW a objetos `Finding`.

### Formato Estándar CEM (Finding)
El Worker debe generar objetos con esta estructura mínima:

```typescript
{
  assetId: string;      // ID del activo en DB
  title: string;        // Título descriptivo
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'; // Basado en SEV_ORDER
  category: 'VULNERABILITY' | 'MISCONFIGURATION' | 'EXPOSURE';
  description: string;  // Detalles técnicos
  sourceTool: 'mytool'; // Nombre del plugin
  evidence?: Record<string, any>; // Datos crudos útiles para el analista
  cve?: string;         // Formato CVE-YYYY-NNNN
  cvss?: number;        // Puntuación numérica
}
```

---

## Paso 4: Pruebas

1. **Swagger UI:** Abre `http://localhost:3001/api/docs` para ver el esquema esperado por el endpoint `/api/v1/collectors/upload/{tool}`.
2. **Prueba manual:** Puedes usar `curl` para enviar un archivo de ejemplo:

`curl -X POST http://localhost:3001/api/v1/collectors/upload/mytool -H "x-collector-id: debug" -H "Content-Type: application/json" --data @test_output.json`