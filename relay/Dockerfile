FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY server.js .
EXPOSE 8787
CMD ["node", "server.js"]
