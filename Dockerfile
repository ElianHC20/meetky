FROM ghcr.io/puppeteer/puppeteer:21.7.0

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["node", "src/index.js"]