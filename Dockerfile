FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
RUN useradd --system --uid 10001 --create-home bcso && chown -R bcso:bcso /app
USER bcso

CMD ["node", "src/index.js"]
