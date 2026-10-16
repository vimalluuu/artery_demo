FROM node:22-alpine AS build
WORKDIR /app
COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci
COPY frontend-react/ ./
ARG VITE_API_URL=/api/v1
ARG VITE_HEALTH_URL=/health
ENV VITE_API_URL=$VITE_API_URL VITE_HEALTH_URL=$VITE_HEALTH_URL
RUN npm run build

FROM nginx:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
