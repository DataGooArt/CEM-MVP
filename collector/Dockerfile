# ── Build dalfox from source (avoids GLIBC_2.38 incompatibility in debian:bookworm-slim)
# dalfox latest requires go 1.25+ (unreleased); pin to v2.9.2 which builds with go 1.22
FROM golang:1.22-bookworm AS dalfox-builder
RUN CGO_ENABLED=0 GOFLAGS=-mod=mod go install github.com/hahwul/dalfox/v2@v2.9.2

# Debian bookworm — stable repos
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# ── Base + nmap (sí está en debian) ──────────────────────────────────────
# APT_CACHE_BUST: increment to force re-run of this layer (e.g. after adding packages)
ARG APT_CACHE_BUST=4
RUN echo "apt-layer-bust=$APT_CACHE_BUST" && apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip \
    nmap \
    curl unzip git \
    perl libnet-ssleay-perl libwhisker2-perl libjson-perl libxml-writer-perl \
    ruby \
    openssl \
    ca-certificates \
    bsdmainutils \
    procps \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

# ── nikto (Perl script, GitHub) ───────────────────────────────────────────
RUN git clone --depth 1 https://github.com/sullo/nikto /opt/nikto && \
    printf '#!/bin/sh\ncd /opt/nikto/program && exec perl /opt/nikto/program/nikto.pl "$@"\n' > /usr/local/bin/nikto && \
    chmod +x /usr/local/bin/nikto

# ── whatweb (Ruby script, GitHub) ─────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ruby-dev libffi-dev zlib1g-dev libyaml-dev libssl-dev && \
    rm -rf /var/lib/apt/lists/* && \
    git clone --depth 1 https://github.com/urbanadventurer/WhatWeb /opt/whatweb && \
    ln -sf /opt/whatweb/whatweb /usr/local/bin/whatweb && \
    chmod +x /opt/whatweb/whatweb && \
    cd /opt/whatweb && gem install --no-document bundler && bundle install

# ── gobuster (static binary, GitHub releases) ─────────────────────────────
RUN curl -sL "https://github.com/OJ/gobuster/releases/latest/download/gobuster_Linux_x86_64.tar.gz" \
    | tar xz -C /usr/local/bin gobuster && \
    chmod +x /usr/local/bin/gobuster

# ── nuclei (static binary via GitHub API + python3 JSON parse) ─────────────────
RUN NUCLEI_URL=$(curl -fsSL https://api.github.com/repos/projectdiscovery/nuclei/releases/latest \
      | python3 -c "import sys,json; assets=[a for a in json.load(sys.stdin)['assets'] if 'linux_amd64' in a['name'] and a['name'].endswith('.zip')]; print(assets[0]['browser_download_url'])") && \
    echo "nuclei URL: $NUCLEI_URL" && \
    curl -fsSL "$NUCLEI_URL" -o /tmp/nuclei.zip && \
    unzip /tmp/nuclei.zip nuclei -d /usr/local/bin && \
    chmod +x /usr/local/bin/nuclei && \
    rm /tmp/nuclei.zip

# ── sslscan + dirb (wordlists) ────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends sslscan dirb && \
    rm -rf /var/lib/apt/lists/*

# ── ffuf (static binary via python3 JSON parse) ───────────────────────────────────
RUN FFUF_URL=$(curl -fsSL https://api.github.com/repos/ffuf/ffuf/releases/latest \
      | python3 -c "import sys,json; assets=[a for a in json.load(sys.stdin)['assets'] if 'linux_amd64' in a['name'] and a['name'].endswith('.tar.gz')]; print(assets[0]['browser_download_url'])") && \
    curl -fsSL "$FFUF_URL" -o /tmp/ffuf.tar.gz && \
    tar xz -C /usr/local/bin -f /tmp/ffuf.tar.gz ffuf && \
    chmod +x /usr/local/bin/ffuf && \
    rm /tmp/ffuf.tar.gz

# ── subfinder (static binary) ─────────────────────────────────────────────
RUN SUBFINDER_URL=$(curl -fsSL https://api.github.com/repos/projectdiscovery/subfinder/releases/latest \
      | python3 -c "import sys,json; assets=[a for a in json.load(sys.stdin)['assets'] if 'linux_amd64' in a['name'] and a['name'].endswith('.zip')]; print(assets[0]['browser_download_url'])") && \
    curl -fsSL "$SUBFINDER_URL" -o /tmp/subfinder.zip && \
    unzip /tmp/subfinder.zip subfinder -d /usr/local/bin && \
    chmod +x /usr/local/bin/subfinder && \
    rm /tmp/subfinder.zip

# ── httpx (static binary) ──────────────────────────────────────────────────
RUN HTTPX_URL=$(curl -fsSL https://api.github.com/repos/projectdiscovery/httpx/releases/latest \
      | python3 -c "import sys,json; assets=[a for a in json.load(sys.stdin)['assets'] if 'linux_amd64' in a['name'] and a['name'].endswith('.zip')]; print(assets[0]['browser_download_url'])") && \
    curl -fsSL "$HTTPX_URL" -o /tmp/httpx.zip && \
    unzip /tmp/httpx.zip httpx -d /usr/local/bin && \
    chmod +x /usr/local/bin/httpx && \
    rm /tmp/httpx.zip

# ── katana (static binary) ─────────────────────────────────────────────────
RUN KATANA_URL=$(curl -fsSL https://api.github.com/repos/projectdiscovery/katana/releases/latest \
      | python3 -c "import sys,json; assets=[a for a in json.load(sys.stdin)['assets'] if 'linux_amd64' in a['name'] and a['name'].endswith('.zip')]; print(assets[0]['browser_download_url'])") && \
    curl -fsSL "$KATANA_URL" -o /tmp/katana.zip && \
    unzip /tmp/katana.zip katana -d /usr/local/bin && \
    chmod +x /usr/local/bin/katana && \
    rm /tmp/katana.zip

# ── dalfox (compiled from Go source — avoids GLIBC_2.38 incompatibility) ──
COPY --from=dalfox-builder /go/bin/dalfox /usr/local/bin/dalfox

# ── trufflehog (static binary) ─────────────────────────────────────────────
RUN TRUFFLEHOG_URL=$(curl -fsSL https://api.github.com/repos/trufflesecurity/trufflehog/releases/latest \
      | python3 -c "import sys,json; assets=[a for a in json.load(sys.stdin)['assets'] if 'linux_amd64' in a['name'] and a['name'].endswith('.tar.gz')]; print(assets[0]['browser_download_url'])") && \
    curl -fsSL "$TRUFFLEHOG_URL" -o /tmp/trufflehog.tar.gz && \
    tar xz -C /usr/local/bin -f /tmp/trufflehog.tar.gz trufflehog && \
    chmod +x /usr/local/bin/trufflehog && \
    rm /tmp/trufflehog.tar.gz

# ── amass (static binary) ──────────────────────────────────────────────────
RUN AMASS_URL=$(curl -fsSL https://api.github.com/repos/owasp-amass/amass/releases/latest \
      | python3 -c "import sys,json; assets=[a for a in json.load(sys.stdin)['assets'] if 'linux_amd64' in a['name'] and a['name'].endswith('.tar.gz')]; print(assets[0]['browser_download_url'])") && \
    curl -fsSL "$AMASS_URL" -o /tmp/amass.tar.gz && \
    mkdir -p /tmp/amass_dir && \
    tar xz -C /tmp/amass_dir -f /tmp/amass.tar.gz && \
    find /tmp/amass_dir -type f -name 'amass' -exec mv {} /usr/local/bin/ \; && \
    chmod +x /usr/local/bin/amass && \
    rm -rf /tmp/amass.tar.gz /tmp/amass_dir

# ── amass DNS resolver config (prevents hanging on empty resolver list) ─────
RUN mkdir -p /root/.config/amass && \
    printf '[resolvers]\n- 1.1.1.1\n- 8.8.8.8\n- 9.9.9.9\n' > /root/.config/amass/config.ini

# ── testssl.sh (shell script) ──────────────────────────────────────────────
RUN git clone --depth 1 https://github.com/drwetter/testssl.sh.git /opt/testssl && \
    ln -sf /opt/testssl/testssl.sh /usr/local/bin/testssl.sh && \
    chmod +x /opt/testssl/testssl.sh

# ── sqlmap (Python script) ─────────────────────────────────────────────────
RUN git clone --depth 1 https://github.com/sqlmapproject/sqlmap.git /opt/sqlmap && \
    ln -sf /opt/sqlmap/sqlmap.py /usr/local/bin/sqlmap && \
    chmod +x /usr/local/bin/sqlmap

# ── Wordlists — SecLists (correct filenames as of 2025) ──────────────────
# The legacy "directory-list-2.3-{medium,big}.txt" names were renamed to
# "DirBuster-2007_directory-list-2.3-{medium,big}.txt" in SecLists.
# These are regular files (not Git LFS), so raw.githubusercontent.com works.
#   medium  : 1.98 MB  →  threshold 1 MB
#   raft    : 542 KB   →  threshold 300 KB
#   big     : 14.8 MB  →  threshold 5 MB
RUN mkdir -p /app/wordlists && \
    ln -sf /usr/share/dirb/wordlists/common.txt /app/wordlists/common.txt && \
    { curl -fsSL --retry 3 --retry-delay 10 --connect-timeout 30 --max-time 300 \
          "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/DirBuster-2007_directory-list-2.3-medium.txt" \
          -o /app/wordlists/directory-list-2.3-medium.txt || true; } && \
    { test "$(stat -c%s /app/wordlists/directory-list-2.3-medium.txt 2>/dev/null || echo 0)" -gt 1000000 \
      || { echo "WARN: medium wordlist too small, using dirb fallback" && \
           cp /usr/share/dirb/wordlists/big.txt /app/wordlists/directory-list-2.3-medium.txt; }; } && \
    { curl -fsSL --retry 3 --retry-delay 10 --connect-timeout 30 --max-time 300 \
          "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/raft-large-directories.txt" \
          -o /app/wordlists/raft-large-directories.txt || true; } && \
    { test "$(stat -c%s /app/wordlists/raft-large-directories.txt 2>/dev/null || echo 0)" -gt 300000 \
      || { echo "WARN: raft wordlist too small, using dirb fallback" && \
           cp /usr/share/dirb/wordlists/big.txt /app/wordlists/raft-large-directories.txt; }; } && \
    { curl -fsSL --retry 3 --retry-delay 10 --connect-timeout 30 --max-time 600 \
          "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/DirBuster-2007_directory-list-2.3-big.txt" \
          -o /app/wordlists/directory-list-2.3-big.txt || true; } && \
    { test "$(stat -c%s /app/wordlists/directory-list-2.3-big.txt 2>/dev/null || echo 0)" -gt 5000000 \
      || { echo "WARN: big wordlist too small, using dirb fallback" && \
           cp /usr/share/dirb/wordlists/big.txt /app/wordlists/directory-list-2.3-big.txt; }; } && \
    echo "=== Wordlist sizes ===" && ls -lh /app/wordlists/

# ── Python deps ───────────────────────────────────────────────────────────
WORKDIR /app
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY . .

ENTRYPOINT ["python3", "collector.py"]
CMD ["--config", "/app/config.yml"]
