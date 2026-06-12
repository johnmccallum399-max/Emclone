# ---- Build stage -----------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Optional: bake the backend URL into the static build. Leave unset to use
# the relative "/api" path (proxied by nginx to the "backend" service below).
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

# ---- Runtime stage ----------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
