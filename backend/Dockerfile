# SEC-6 hardening:
#  - npm ci (lockfile-exact installs — no silent version drift at build time),
#  - runtime process runs as the unprivileged `node` user, not root,
#  - .env / keys / local state are kept out of the context via .dockerignore,
#  - the local upload dir exists and is writable before the USER switch
#    (STORAGE_DRIVER=local writes here; Cloudinary setups ignore it).
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/main"]
