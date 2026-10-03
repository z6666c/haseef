# واجهات حصيف (Next.js standalone). التطبيق يُختار بـ APP=client أو APP=admin.
# يُبنى من جذر المستودع:  docker build -f deploy/web.Dockerfile --build-arg APP=client .
FROM node:22-alpine AS build
ARG APP
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_STANDALONE=1
WORKDIR /src
COPY package.json ./
COPY packages/ packages/
COPY apps/client/package.json apps/client/
COPY apps/admin/package.json apps/admin/
RUN npm install --no-audit --no-fund
COPY apps/${APP}/ apps/${APP}/
RUN npm run build -w @haseef/${APP}

FROM node:22-alpine
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=Asia/Riyadh
WORKDIR /app
RUN addgroup -S web && adduser -S web -G web
COPY --from=build --chown=web:web /src/apps/${APP}/.next/standalone ./
COPY --from=build --chown=web:web /src/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build --chown=web:web /src/apps/${APP}/public ./apps/${APP}/public
USER web
ENV APP_DIR=apps/${APP}
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:3000/login || exit 1
CMD ["sh", "-c", "node $APP_DIR/server.js"]
