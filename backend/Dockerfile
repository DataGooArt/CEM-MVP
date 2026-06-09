# ---------- STAGE: API ----------
FROM node:20-slim AS api
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copiar solo lo necesario, NUNCA node_modules del host
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install && npx prisma generate

# Copiar código fuente explícitamente (no usar COPY . .)
COPY src/ ./src/
COPY tsconfig.json ./
COPY nest-cli.json ./
RUN npm run build

EXPOSE 3001
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/src/main"]

# ---------- STAGE: WORKER ----------
FROM node:20-slim AS worker
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/
RUN npm install && npx prisma generate

COPY src/ ./src/
COPY tsconfig.json ./
COPY nest-cli.json ./
RUN npm run build

CMD ["node", "dist/src/worker"]
