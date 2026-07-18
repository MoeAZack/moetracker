FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# NOTE: db.json is intentionally NOT copied. Production reads DB_PATH (the mounted
# GCS bucket / Firestore); bundling a seed file would risk masking real data.
EXPOSE 8080
CMD ["node", "dist/server.cjs"]
