# node:18-alpine already publishes multi-arch manifests (linux/amd64, linux/arm64,
# among others) -- no per-arch branching needed here. Build multi-arch images with
# `docker buildx build --platform linux/amd64,linux/arm64` (see build-multiarch.sh).
FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --production

COPY . .

# Container images should not run as root. node:18-alpine ships a non-root "node" user.
RUN chown -R node:node /app
USER node

# HOST must be 0.0.0.0 here: the app defaults to 127.0.0.1 (see CLAUDE.md), which is
# unreachable through Docker's port mapping. ADMIN_ENABLED=false disables /api/admin/*
# entirely so that relaxed binding doesn't expose the admin surface to the network.
ENV HOST=0.0.0.0
ENV ADMIN_ENABLED=false
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
