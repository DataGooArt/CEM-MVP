#!/usr/bin/env bash
# full-scan.sh — Escaneo completo y envío al CEM Platform
#
# Uso:
#   ./full-scan.sh [opciones] [TARGET...]
#
# Opciones:
#   -a, --api URL         URL base del CEM API  [env CEM_API, default: http://localhost:3001]
#   -i, --id ID           Collector ID          [env COLLECTOR_ID, default: kali]
#   -p, --profile PERFIL  Perfil de escaneo: quick|standard|deep  [default: standard]
#   -s, --skip HERR       Saltar herramienta (nmap|nuclei|nikto|whatweb|gobuster|sslscan|ffuf|subfinder|httpx|testssl|dalfox|sqlmap|katana|trufflehog|amass). Repetible.
#   -l, --log DIR         Directorio de logs    [default: /var/log/cem-scans]
#   -h, --help            Mostrar ayuda
#
# Si no se pasan TARGETs, usa la lista hardcodeada más abajo.
#
# Ejemplos:
#   ./full-scan.sh target.com
#   ./full-scan.sh -a http://192.168.1.10:3001 target.com otro.com
#   ./full-scan.sh --skip nikto --skip whatweb target.com
#   CEM_API=http://10.0.0.5:3001 ./full-scan.sh target.com
#
# Instalar en Kali:
#   sudo cp full-scan.sh /opt/cem-scripts/ && chmod +x /opt/cem-scripts/full-scan.sh
#
# Cron cada 6h:
#   0 */6 * * * root CEM_API=http://TU_IP:3001 /opt/cem-scripts/full-scan.sh >> /var/log/cem-scan.log 2>&1

set -euo pipefail

# ─── Defaults ─────────────────────────────────────────────────────────────────
CEM_API="${CEM_API:-http://localhost:3001}"
COLLECTOR_ID="${COLLECTOR_ID:-kali}"
LOG_DIR="/var/log/cem-scans"
PROFILE="standard"
SKIP_TOOLS=()
CLI_TARGETS=()

# ─── Argparse ─────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    -a|--api)    CEM_API="$2";        shift 2 ;;
    -i|--id)     COLLECTOR_ID="$2";   shift 2 ;;
    -p|--profile) PROFILE="$2";       shift 2 ;;
    -s|--skip)   SKIP_TOOLS+=("$2");  shift 2 ;;
    -l|--log)    LOG_DIR="$2";        shift 2 ;;
    -h|--help)   grep '^#' "$0" | sed 's/^# \?//'; exit 0 ;;
    -*)          echo "[ERROR] Opción desconocida: $1" >&2; exit 1 ;;
    *)           CLI_TARGETS+=("$1"); shift ;;
  esac
done

# Targets por defecto si no se pasaron por CLI
if [[ ${#CLI_TARGETS[@]} -eq 0 ]]; then
  TARGETS=(
    "testphp.vulnweb.com"
    "demo.testfire.net"
    # ← agrega tus dominios aquí, o pásalos como argumentos al script
  )
else
  TARGETS=("${CLI_TARGETS[@]}")
fi

# ─── Perfil de escaneo ───────────────────────────────────────────────────────
case "$PROFILE" in
  quick)
    PERFIL="quick"
    NMAP_ARGS="-T4 --top-ports 100 -sV"
    NUCLEI_SEVERITY="critical,high"
    NUCLEI_RATE=50
    NIKTO_ENABLED=false   ; SSLSCAN_ENABLED=false  ; FFUF_ENABLED=false
    GOBUSTER_ENABLED=false
    SUBFINDER_ENABLED=false; HTTPX_ENABLED=false    ; TESTSSL_ENABLED=false
    DALFOX_ENABLED=false  ; SQLMAP_ENABLED=false   ; KATANA_ENABLED=false
    TRUFFLEHOG_ENABLED=false; AMASS_ENABLED=false
    ;;
  deep)
    PERFIL="deep"
    NMAP_ARGS="-T4 -p- -sV -sC --open"
    NUCLEI_SEVERITY="critical,high,medium,low"
    NUCLEI_RATE=100
    NIKTO_ENABLED=true    ; SSLSCAN_ENABLED=true   ; FFUF_ENABLED=true
    GOBUSTER_ENABLED=true
    SUBFINDER_ENABLED=true ; HTTPX_ENABLED=true     ; TESTSSL_ENABLED=true
    DALFOX_ENABLED=true   ; SQLMAP_ENABLED=true    ; KATANA_ENABLED=true
    TRUFFLEHOG_ENABLED=true; AMASS_ENABLED=true
    ;;
  *)  # standard
    PERFIL="standard"
    NMAP_ARGS="-T4 --top-ports 1000 -sV"
    NUCLEI_SEVERITY="critical,high,medium"
    NUCLEI_RATE=75
    NIKTO_ENABLED=true    ; SSLSCAN_ENABLED=true   ; FFUF_ENABLED=false
    GOBUSTER_ENABLED=true
    SUBFINDER_ENABLED=true ; HTTPX_ENABLED=true     ; TESTSSL_ENABLED=true
    DALFOX_ENABLED=false  ; SQLMAP_ENABLED=false   ; KATANA_ENABLED=true
    TRUFFLEHOG_ENABLED=true; AMASS_ENABLED=false
    ;;
esac

# ─── Helpers ──────────────────────────────────────────────────────────────────
should_skip() {
  local t="$1"
  for s in "${SKIP_TOOLS[@]}"; do [[ "$s" == "$t" ]] && return 0; done
  return 1
}

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR=$(mktemp -d /tmp/cem-scan-XXXXXX)
DATE=$(date +%Y%m%d_%H%M%S)
SCAN_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null \
         || python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null \
         || echo "scan-${DATE}")

UPLOAD_URL="${CEM_API}/api/v1/collectors/upload"
TOTAL_ACCEPTED=0
TOTAL_ERRORS=0

mkdir -p "$LOG_DIR"

echo "╔═══════════════════════════════════════════╗"
printf  "║  CEM Full Scan  %-27s║\n" "$DATE"
printf  "║  API      %-32s║\n" "$CEM_API"
printf  "║  Perfil   %-32s║\n" "$PERFIL"
printf  "║  Targets  %-32s║\n" "${TARGETS[*]}"
printf  "║  Session  %-32s║\n" "${SCAN_ID:0:30}"
echo "╚═══════════════════════════════════════════╝"

# Verificar conectividad
if ! curl -sf "$CEM_API/api/v1/collectors/plugins" > /dev/null; then
  echo "[ERROR] No se puede alcanzar $CEM_API"
  echo "  Verifica que el CEM esté corriendo y accesible desde Kali"
  rm -rf "$TMP_DIR"
  exit 1
fi
echo "[✓] Conexión con CEM verificada"
echo ""

# ─── upload_file ──────────────────────────────────────────────────────────────
# Envía el archivo raw al backend; el servidor hace el parsing con sus plugins.
# x-scan-id permite trazabilidad del historial de scans en versiones futuras.
upload_file() {
  local tool="$1"
  local file="$2"
  local label="$3"

  if [[ ! -f "$file" || ! -s "$file" ]]; then
    echo "    [SKIP] $label: sin output"
    return
  fi

  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: text/plain" \
    -H "x-collector-id: $COLLECTOR_ID" \
    -H "x-scan-id: $SCAN_ID" \
    --data-binary "@$file" \
    "$UPLOAD_URL/$tool" 2>/dev/null)

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | head -1)

  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
    ACCEPTED=$(echo "$BODY" | grep -o '"accepted":[0-9]*' | cut -d: -f2 || echo "0")
    ERRORS=$(echo "$BODY"  | grep -o '"errors":[0-9]*'   | cut -d: -f2 || echo "0")
    TOTAL_ACCEPTED=$(( TOTAL_ACCEPTED + ${ACCEPTED:-0} ))
    TOTAL_ERRORS=$(( TOTAL_ERRORS + ${ERRORS:-0} ))
    echo "    [OK] $label → ${ACCEPTED} hallazgos (HTTP $HTTP_CODE)"
  else
    echo "    [WARN] $label → HTTP $HTTP_CODE: $BODY"
    TOTAL_ERRORS=$(( TOTAL_ERRORS + 1 ))
  fi
}

# ─── Escaneo por target ───────────────────────────────────────────────────────
for TARGET in "${TARGETS[@]}"; do
  echo "┌─────────────────────────────────────────────"
  echo "│  Target: $TARGET"
  echo "└─────────────────────────────────────────────"
  SAFE="${TARGET//./_}"

  # ── 1. Nmap — puertos y servicios ─────────────────────────────────────────
  if ! should_skip nmap; then
    NMAP_XML="$TMP_DIR/nmap_${SAFE}.xml"
    if command -v nmap &>/dev/null; then
      echo "[*] Nmap ($PERFIL): puertos y servicios..."
      # shellcheck disable=SC2086
      nmap $NMAP_ARGS -oX "$NMAP_XML" "$TARGET" >/dev/null 2>&1 || true
      upload_file "nmap" "$NMAP_XML" "Nmap → $TARGET"
      [[ -f "$NMAP_XML" ]] && cp "$NMAP_XML" "$LOG_DIR/nmap_${SAFE}_${DATE}.xml"
    else
      echo "    [SKIP] nmap no instalado — sudo apt install nmap"
    fi
  fi

  # ── 2. Nuclei — CVEs y vulnerabilidades ───────────────────────────────────
  if ! should_skip nuclei; then
    NUCLEI_JSON="$TMP_DIR/nuclei_${SAFE}.jsonl"
    if command -v nuclei &>/dev/null; then
      echo "[*] Nuclei ($PERFIL): CVEs y vulnerabilidades..."
      nuclei -u "https://$TARGET" \
             -severity "$NUCLEI_SEVERITY" \
             -rate-limit "$NUCLEI_RATE" \
             -json -silent \
             -o "$NUCLEI_JSON" 2>/dev/null || true
      upload_file "nuclei" "$NUCLEI_JSON" "Nuclei → $TARGET"
      [[ -f "$NUCLEI_JSON" ]] && cp "$NUCLEI_JSON" "$LOG_DIR/nuclei_${SAFE}_${DATE}.jsonl"
    else
      echo "    [SKIP] nuclei no instalado — go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest"
    fi
  fi

  # ── 3. Nikto — vulnerabilidades web ───────────────────────────────────────
  if [[ "$NIKTO_ENABLED" == true ]] && ! should_skip nikto; then
    NIKTO_JSON="$TMP_DIR/nikto_${SAFE}.json"
    if command -v nikto &>/dev/null; then
      echo "[*] Nikto: vulnerabilidades web..."
      nikto -h "http://$TARGET" \
            -Format json \
            -output "$NIKTO_JSON" \
            -nointeractive \
            -timeout 10 2>/dev/null || true
      upload_file "nikto" "$NIKTO_JSON" "Nikto → $TARGET"
      [[ -f "$NIKTO_JSON" ]] && cp "$NIKTO_JSON" "$LOG_DIR/nikto_${SAFE}_${DATE}.json"
    else
      echo "    [SKIP] nikto no instalado — sudo apt install nikto"
    fi
  fi

  # ── 4. WhatWeb — fingerprinting tecnológico ───────────────────────────────
  if ! should_skip whatweb; then
    WHATWEB_JSON="$TMP_DIR/whatweb_${SAFE}.json"
    if command -v whatweb &>/dev/null; then
      echo "[*] WhatWeb: fingerprinting tecnológico..."
      whatweb --aggression 3 --log-json="$WHATWEB_JSON" "http://$TARGET" >/dev/null 2>&1 || true
      upload_file "whatweb" "$WHATWEB_JSON" "WhatWeb → $TARGET"
      [[ -f "$WHATWEB_JSON" ]] && cp "$WHATWEB_JSON" "$LOG_DIR/whatweb_${SAFE}_${DATE}.json"
    else
      echo "    [SKIP] whatweb no instalado — sudo apt install whatweb"
    fi
  fi

  # ── 5b. Gobuster — directory & vhost brute-force ─────────────────────────────

  # ── 5b. Gobuster — directory & vhost brute-force ────────────────────────────
  if [[ "$GOBUSTER_ENABLED" == true ]] && ! should_skip gobuster; then
    GOBUSTER_OUT="$TMP_DIR/gobuster_${SAFE}.txt"
    if command -v gobuster &>/dev/null; then
      WORDLIST="${GOBUSTER_WORDLIST:-/usr/share/wordlists/dirb/common.txt}"
      echo "[*] Gobuster: directory brute-force..."
      gobuster dir -u "https://$TARGET" -w "$WORDLIST" -q -o "$GOBUSTER_OUT" 2>/dev/null || true
      upload_file "gobuster" "$GOBUSTER_OUT" "Gobuster → $TARGET"
      [[ -f "$GOBUSTER_OUT" ]] && cp "$GOBUSTER_OUT" "$LOG_DIR/gobuster_${SAFE}_${DATE}.txt"
    else
      echo "    [SKIP] gobuster no instalado — sudo apt install gobuster"
    fi
  fi

  # ── 6. SSLScan — auditoría TLS/SSL ───────────────────────────────────────────
  if [[ "$SSLSCAN_ENABLED" == true ]] && ! should_skip sslscan; then
    SSLSCAN_TXT="$TMP_DIR/sslscan_${SAFE}.txt"
    if command -v sslscan &>/dev/null; then
      echo "[*] SSLScan: auditoría TLS/SSL..."
      sslscan --no-colour "$TARGET":443 > "$SSLSCAN_TXT" 2>&1 || true
      upload_file "sslscan" "$SSLSCAN_TXT" "SSLScan → $TARGET"
      [[ -f "$SSLSCAN_TXT" ]] && cp "$SSLSCAN_TXT" "$LOG_DIR/sslscan_${SAFE}_${DATE}.txt"
    else
      echo "    [SKIP] sslscan no instalado — sudo apt install sslscan"
    fi
  fi

  # ── 7. Ffuf — web fuzzing ────────────────────────────────────────────────────
  if [[ "$FFUF_ENABLED" == true ]] && ! should_skip ffuf; then
    FFUF_OUT="$TMP_DIR/ffuf_${SAFE}.json"
    if command -v ffuf &>/dev/null; then
      WORDLIST="${FFUF_WORDLIST:-/usr/share/wordlists/dirb/common.txt}"
      echo "[*] Ffuf: web fuzzing (deep)..."
      ffuf -u "https://$TARGET/FUZZ" -w "$WORDLIST" -of json -o "$FFUF_OUT" -s 2>/dev/null || true
      upload_file "ffuf" "$FFUF_OUT" "Ffuf → $TARGET"
      [[ -f "$FFUF_OUT" ]] && cp "$FFUF_OUT" "$LOG_DIR/ffuf_${SAFE}_${DATE}.json"
    else
      echo "    [SKIP] ffuf no instalado — sudo apt install ffuf"
    fi
  fi

  # ── 8. Subfinder — passive subdomain discovery ───────────────────────────────
  if [[ "$SUBFINDER_ENABLED" == true ]] && ! should_skip subfinder; then
    SUBFINDER_OUT="$TMP_DIR/subfinder_${SAFE}.json"
    if command -v subfinder &>/dev/null; then
      echo "[*] Subfinder: descubrimiento pasivo de subdominios..."
      subfinder -d "$TARGET" -json -silent -o "$SUBFINDER_OUT" 2>/dev/null || true
      upload_file "subfinder" "$SUBFINDER_OUT" "Subfinder → $TARGET"
      [[ -f "$SUBFINDER_OUT" ]] && cp "$SUBFINDER_OUT" "$LOG_DIR/subfinder_${SAFE}_${DATE}.json"
    else
      echo "    [SKIP] subfinder no instalado — go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest"
    fi
  fi

  # ── 9. Httpx — HTTP probing & fingerprinting ─────────────────────────────────
  if [[ "$HTTPX_ENABLED" == true ]] && ! should_skip httpx; then
    HTTPX_OUT="$TMP_DIR/httpx_${SAFE}.json"
    if command -v httpx &>/dev/null; then
      echo "[*] Httpx: HTTP probing y fingerprinting de tecnologías..."
      httpx -u "$TARGET" -json -silent -tech-detect -status-code -title -web-server \
            -o "$HTTPX_OUT" 2>/dev/null || true
      upload_file "httpx" "$HTTPX_OUT" "Httpx → $TARGET"
      [[ -f "$HTTPX_OUT" ]] && cp "$HTTPX_OUT" "$LOG_DIR/httpx_${SAFE}_${DATE}.json"
    else
      echo "    [SKIP] httpx no instalado — go install github.com/projectdiscovery/httpx/cmd/httpx@latest"
    fi
  fi

  # ── 10. Testssl.sh — deep TLS/SSL audit ──────────────────────────────────────
  if [[ "$TESTSSL_ENABLED" == true ]] && ! should_skip testssl; then
    TESTSSL_OUT="$TMP_DIR/testssl_${SAFE}.json"
    TESTSSL_BIN="$(command -v testssl.sh 2>/dev/null || echo /opt/testssl/testssl.sh)"
    if [[ -x "$TESTSSL_BIN" ]]; then
      echo "[*] Testssl.sh: auditoría TLS/SSL detallada..."
      "$TESTSSL_BIN" --jsonfile "$TESTSSL_OUT" --quiet "$TARGET":443 2>/dev/null || true
      upload_file "testssl" "$TESTSSL_OUT" "Testssl.sh → $TARGET"
      [[ -f "$TESTSSL_OUT" ]] && cp "$TESTSSL_OUT" "$LOG_DIR/testssl_${SAFE}_${DATE}.json"
    else
      echo "    [SKIP] testssl.sh no instalado — git clone https://github.com/drwetter/testssl.sh.git /opt/testssl && ln -s /opt/testssl/testssl.sh /usr/local/bin/testssl.sh"
    fi
  fi

  # ── 11. Dalfox — XSS scanner ─────────────────────────────────────────────────
  if [[ "$DALFOX_ENABLED" == true ]] && ! should_skip dalfox; then
    DALFOX_OUT="$TMP_DIR/dalfox_${SAFE}.json"
    if command -v dalfox &>/dev/null; then
      echo "[*] Dalfox: XSS scanning (deep)..."
      dalfox url "https://$TARGET" --format json --output "$DALFOX_OUT" 2>/dev/null || true
      upload_file "dalfox" "$DALFOX_OUT" "Dalfox → $TARGET"
      [[ -f "$DALFOX_OUT" ]] && cp "$DALFOX_OUT" "$LOG_DIR/dalfox_${SAFE}_${DATE}.json"
    else
      echo "    [SKIP] dalfox no instalado — go install github.com/hahwul/dalfox/v2@latest"
    fi
  fi

  # ── 12. SQLMap — SQL injection detection ─────────────────────────────────────
  if [[ "$SQLMAP_ENABLED" == true ]] && ! should_skip sqlmap; then
    SQLMAP_LOG="$TMP_DIR/sqlmap_${SAFE}.log"
    SQLMAP_CMD="$(command -v sqlmap 2>/dev/null || echo 'python3 /opt/sqlmap/sqlmap.py')"
    if $SQLMAP_CMD --version &>/dev/null 2>&1; then
      echo "[*] SQLMap: SQL injection detection (deep)..."
      $SQLMAP_CMD -u "https://$TARGET" --batch --forms --crawl=2 --level=1 --risk=1 \
        2>&1 | tee "$SQLMAP_LOG" >/dev/null || true
      upload_file "sqlmap" "$SQLMAP_LOG" "SQLMap → $TARGET"
      [[ -f "$SQLMAP_LOG" ]] && cp "$SQLMAP_LOG" "$LOG_DIR/sqlmap_${SAFE}_${DATE}.log"
    else
      echo "    [SKIP] sqlmap no instalado — sudo apt install sqlmap"
    fi
  fi

  # ── 13. Katana — web crawler & endpoint discovery ────────────────────────────
  if [[ "$KATANA_ENABLED" == true ]] && ! should_skip katana; then
    KATANA_OUT="$TMP_DIR/katana_${SAFE}.json"
    if command -v katana &>/dev/null; then
      echo "[*] Katana: web crawling y descubrimiento de endpoints..."
      katana -u "https://$TARGET" -d 3 -jc -json -silent \
             -o "$KATANA_OUT" 2>/dev/null || true
      upload_file "katana" "$KATANA_OUT" "Katana → $TARGET"
      [[ -f "$KATANA_OUT" ]] && cp "$KATANA_OUT" "$LOG_DIR/katana_${SAFE}_${DATE}.json"
    else
      echo "    [SKIP] katana no instalado — go install github.com/projectdiscovery/katana/cmd/katana@latest"
    fi
  fi

  # ── 14. TruffleHog — secret & credential detection ───────────────────────────
  if [[ "$TRUFFLEHOG_ENABLED" == true ]] && ! should_skip trufflehog; then
    TRUFFLEHOG_OUT="$TMP_DIR/trufflehog_${SAFE}.jsonl"
    TRUFFLEHOG_TMP="$TMP_DIR/thog_files_${SAFE}"
    mkdir -p "$TRUFFLEHOG_TMP"
    if command -v trufflehog &>/dev/null; then
      echo "[*] TruffleHog: detección de secretos y credenciales..."
      for _path in /.env /robots.txt /.git/config /.gitignore /config.js /app.js /.env.production; do
        curl -sk --max-time 5 "https://$TARGET$_path" \
          -o "$TRUFFLEHOG_TMP/${_path//\//_}" 2>/dev/null || true
      done
      trufflehog filesystem "$TRUFFLEHOG_TMP" --json 2>/dev/null > "$TRUFFLEHOG_OUT" || true
      upload_file "trufflehog" "$TRUFFLEHOG_OUT" "TruffleHog → $TARGET"
      [[ -f "$TRUFFLEHOG_OUT" ]] && cp "$TRUFFLEHOG_OUT" "$LOG_DIR/trufflehog_${SAFE}_${DATE}.jsonl"
    else
      echo "    [SKIP] trufflehog no instalado — curl -sSfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh | sh -s -- -b /usr/local/bin"
    fi
  fi

  # ── 15. Amass — passive subdomain enumeration ────────────────────────────────
  if [[ "$AMASS_ENABLED" == true ]] && ! should_skip amass; then
    AMASS_OUT="$TMP_DIR/amass_${SAFE}.json"
    if command -v amass &>/dev/null; then
      echo "[*] Amass: enumeración pasiva de subdominios (deep)..."
      amass enum -passive -d "$TARGET" -json "$AMASS_OUT" -timeout 5 2>/dev/null || true
      upload_file "amass" "$AMASS_OUT" "Amass → $TARGET"
      [[ -f "$AMASS_OUT" ]] && cp "$AMASS_OUT" "$LOG_DIR/amass_${SAFE}_${DATE}.json"
    else
      echo "    [SKIP] amass no instalado — go install github.com/owasp-amass/amass/v4/...@master"
    fi
  fi

  echo ""
done

# ─── Limpieza ─────────────────────────────────────────────────────────────────
rm -rf "$TMP_DIR"

echo "╔═══════════════════════════════════════════╗"
printf  "║  Completado  %-29s║\n" "$DATE"
printf  "║  Hallazgos aceptados:  %-18s║\n" "$TOTAL_ACCEPTED"
printf  "║  Errores de parser:    %-18s║\n" "$TOTAL_ERRORS"
printf  "║  Logs:  %-34s║\n" "$LOG_DIR"
printf  "║  Dashboard: http://localhost:5173        ║\n"
echo "╚═══════════════════════════════════════════╝"
