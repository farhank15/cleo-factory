FROM node:22-slim

WORKDIR /app

COPY src/ src/
COPY package.json .

USER node

EXPOSE 8080

CMD ["node", "src/server.js"]
