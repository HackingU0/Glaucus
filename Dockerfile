# Keep /app/data on a volume. On first start, the logs give a token for the setup page at /setup.
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY shared shared
COPY web web
RUN npm run build

FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY shared shared
COPY server server
COPY --from=build /app/web/dist web/dist
# Owned by node here so a new named volume on it starts out writable.
RUN mkdir data && chown node:node data
USER node
EXPOSE 8787
CMD ["node", "server/main.ts"]
