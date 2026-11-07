# Build context: repository root (docker build -f web/Dockerfile .)

# ---- build ----
# TODO(pin): floating tag; pin the exact tag/digest on a machine with registry access.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY web/package.json web/
COPY e2e/package.json e2e/
RUN npm ci
COPY shared shared
COPY web web
RUN npm run build -w @jobproof/web

# ---- serve ----
# Tag cannot be verified from the build workspace (Docker Hub blocked); `stable-alpine` follows
# the nginx stable branch. Pin to an exact tag (e.g. 1.xx-alpine) once checked.
# TODO(pin): floating tag; pin the exact tag/digest on a machine with registry access.
FROM nginxinc/nginx-unprivileged:stable-alpine
COPY web/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 web/nginx/40-jobproof-config.sh /docker-entrypoint.d/40-jobproof-config.sh
COPY --from=build --chown=101:101 /app/web/dist /usr/share/nginx/html
ENV API_BASE_URL=http://localhost:8000
EXPOSE 8080
USER 101
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD ["wget", "-qO-", "http://127.0.0.1:8080/"]
CMD ["nginx", "-g", "daemon off;"]
