FROM ghcr.io/puppeteer/puppeteer:22.8.2

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Bundle app source
COPY . .

# Expose port
EXPOSE 3000

# Start command
CMD ["node", "src/index.js"]