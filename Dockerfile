FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=3000 CAKERY_DATA_DIR=/var/data TRUST_PROXY=1
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
