FROM node:22-bookworm-slim

WORKDIR /app

# Stage 1 is a zero-dependency service: only Node built-ins are used at runtime,
# so there is nothing to install and the image has no network requirement.
COPY package.json ./
COPY src/ ./src/

ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/app.js"]
