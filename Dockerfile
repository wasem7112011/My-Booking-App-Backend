FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .س

ENV NODE_ENV=production

CMD ["npm", "start"]