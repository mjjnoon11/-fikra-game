FROM node:22-alpine
WORKDIR /app
COPY index.html game.js server.js question-bank.js learn-data.js qrcode.min.js manifest.webmanifest favicon.ico ./
COPY assets ./assets
ENV NODE_ENV=production
EXPOSE 8000
CMD ["node", "server.js"]
