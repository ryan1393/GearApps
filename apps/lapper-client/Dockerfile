# Build context: repository root.
# Every MeshForge image starts with the same lines down to "npm ci", so Docker installs the
# build dependencies once and all images reuse that layer.
FROM node:24.22.1-bookworm-slim AS manifests
WORKDIR /manifests
COPY package.json package-lock.json ./
# A release changes only the version in these two files. It is blanked here so that a release
# with unchanged dependencies reuses the installed layer instead of installing again.
RUN node -e "const fs=require('node:fs');for(const f of ['package.json','package-lock.json']){const j=JSON.parse(fs.readFileSync(f,'utf8'));j.version='0.0.0';if(j.packages&&j.packages[''])j.packages[''].version='0.0.0';fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')}"

FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
ENV HUSKY=0 CYPRESS_INSTALL_BINARY=0 NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_NO_CLOUD=true
RUN npm install -g npm@11.9.0
COPY --from=manifests /manifests/ ./
# Building compiles no native module, so install scripts (and the compiler they need) are skipped.
RUN npm ci --ignore-scripts
COPY . .
RUN npx nx build lapper-client --configuration=production

FROM nginx:1.27-alpine
COPY apps/lapper-client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/apps/lapper-client/browser /usr/share/nginx/html
# Extracted source archives may have restrictive file permissions.
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s CMD wget -qO- http://127.0.0.1/healthz || exit 1
