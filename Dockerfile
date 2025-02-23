FROM node:18-slim

# Instalar dependencias necesarias para Puppeteer
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Crear usuario no root
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser

# Crear directorio de la app
WORKDIR /home/pptruser/app

# Copiar archivos del proyecto
COPY package*.json ./

# Cambiar propiedad de los archivos
RUN chown -R pptruser:pptruser .

# Cambiar a usuario no root
USER pptruser

# Instalar dependencias
RUN npm install --omit=dev

# Copiar el resto de archivos
COPY --chown=pptruser:pptruser . .

# Puerto que usará la app
EXPOSE 3000

# Comando para iniciar la app
CMD ["node", "src/index.js"]