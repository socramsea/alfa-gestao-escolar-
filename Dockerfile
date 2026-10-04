# Imagem única: API + interface compilada, pronta para qualquer serviço de containers.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY . .
RUN npm run build && cd web && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    WEB_DIST_DIR=/app/web/dist \
    PORT=4000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
USER node
EXPOSE 4000
# Aplica as migrations pendentes e sobe a API.
CMD ["sh", "-c", "node dist/database/migrate.js && node dist/server.js"]
