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

Crea un archivo llamado `mytool_plugin.py`. Su función principal es ejecutar el comando y retornar el output.

```python
import subprocess
import logging

def run_scan(target):
    """
    Ejecuta la herramienta y devuelve el contenido crudo (JSON/XML/TXT)
    """
    try:
        # Ejemplo: ejecutando subfinder
        cmd = ["subfinder", "-d", target, "-silent", "-j"]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return result.stdout
    except Exception as e:
        logging.error(f"Error en MyTool: {e}")
        return None
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
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: 'VULNERABILITY' | 'MISCONFIGURATION' | 'EXPOSURE';
  description: string;  // Detalles técnicos
  sourceTool: 'mytool'; // Nombre del plugin
}
```

---

## Paso 4: Pruebas

Para probar el nuevo plugin sin esperar a un scan completo, puedes usar `curl` para enviar un archivo de ejemplo directamente a la API:

`curl -X POST http://localhost:3001/api/v1/collectors/upload/mytool -H "x-collector-id: debug" -H "Content-Type: application/json" --data @test_output.json`