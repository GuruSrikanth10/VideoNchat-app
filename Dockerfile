# syntax=docker/dockerfile:1
# A small production image: dependencies are installed in their own stage,
# and the app runs as the unprivileged "node" user.
#   docker build -t videonchat .
#   docker run -p 3000:3000 -e PUBLIC_URL=http://localhost:3000 videonchat

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:${NODE_VERSION}-alpine
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json app.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node views ./views
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" > /dev/null || exit 1
# The app handles SIGTERM itself: it tells clients it's restarting, then exits.
CMD ["node", "app.js"]
