FROM node:22-alpine

WORKDIR /app

COPY src/ src/
COPY public/ public/
COPY package.json .

USER node

EXPOSE 8080

CMD ["node", "src/server.js"]
