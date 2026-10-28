FROM node:20-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl \
  && npm ci \
  && apt-get purge -y --auto-remove python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma
RUN npm run db:generate
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "npm run db:deploy && if [ \"$SEED_DEMO_DATA\" = \"true\" ]; then npm run db:seed; fi && npm start"]
