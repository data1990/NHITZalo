FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
COPY . .
RUN npm install --omit=dev

EXPOSE 3177
CMD ["node", "server.js"]
