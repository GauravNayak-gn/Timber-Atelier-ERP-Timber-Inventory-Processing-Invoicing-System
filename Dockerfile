FROM oven/bun:1.4-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
COPY prisma ./prisma/
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma Client
RUN bun run db:generate

# Expose port
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=development

CMD ["bun", "run", "dev"]
