FROM ghcr.io/puppeteer/puppeteer:21.7.0

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install --production

# Bundle app source
COPY . .

# Expose port
EXPOSE 3000

# Start command
CMD ["node", "src/index.js"]