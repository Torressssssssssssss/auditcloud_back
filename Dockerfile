FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data/uploads && chown node:node /app/data/uploads

USER node

EXPOSE 3000

CMD ["node", "app.js"]
