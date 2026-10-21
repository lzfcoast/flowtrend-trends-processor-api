FROM node:20-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json .env.example ./
COPY server ./server
COPY automation ./automation
COPY public ./public
COPY requirements.txt ./requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt \
    && pnpm build

ENV NODE_ENV=production
EXPOSE 3000
VOLUME ["/var/lib/flowtrend"]
CMD ["pnpm", "start"]
