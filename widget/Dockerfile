# Static build, served by nginx-unprivileged (uid 101, listens on 8080 by
# default) — matches the chart at Kube/chat-summary/charts/chat-summary-widget,
# which runs this under readOnlyRootFilesystem with only /var/cache/nginx,
# /var/run and /tmp mounted writable. No runtime env injection: settings
# come from Matrix state events (see src/matrix/settingsSync.ts), not
# container env vars, so unlike some other widgets in this cluster there's
# no docker-entrypoint.d templating step needed here.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
