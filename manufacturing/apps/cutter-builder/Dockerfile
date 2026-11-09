FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY vendor/dana-ui/package ./vendor/dana-ui/package
ENV HUSKY=0
RUN npm install -g npm@11.6.2
RUN npm ci

COPY . .
RUN npx nx build cutter-builder --configuration=production

FROM nginx:1.27-alpine AS runtime

COPY apps/cutter-builder/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/apps/cutter-builder /usr/share/nginx/html

EXPOSE 80
