FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile

ARG SERVICE
RUN test -n "$SERVICE" && pnpm --filter "$SERVICE" build

ENV NODE_ENV=production
ENV SERVICE=$SERVICE

EXPOSE 3000

CMD ["sh", "-lc", "exec pnpm --filter \"$SERVICE\" start"]
