FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY database ./database

RUN pnpm install --frozen-lockfile

ARG SERVICE
RUN test -n "$SERVICE" && pnpm --filter "$SERVICE" build

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV SERVICE=$SERVICE

# Build steps run as root, but the runtime must not. Next.js may write runtime
# cache files, so ownership is transferred before dropping privileges.
RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["sh", "-lc", "exec pnpm --filter \"$SERVICE\" start"]
