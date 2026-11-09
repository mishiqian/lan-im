# lan-im 枢纽：单进程、无外部依赖
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY bin ./bin
ENV NODE_ENV=production
EXPOSE 8787
VOLUME ["/data"]
# 默认监听 0.0.0.0:8787，数据在 /data
ENTRYPOINT ["node", "bin/lanim-hub.mjs", "--host", "0.0.0.0", "--port", "8787", "--data", "/data"]
