FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install && npm install @rollup/rollup-linux-x64-musl --save-optional

FROM deps AS build
WORKDIR /app
COPY . .
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV SERVE_WEB=true
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
RUN npm install --omit=dev --workspace apps/server
COPY --from=build /app/apps/server/src apps/server/src
COPY --from=build /app/apps/web/dist apps/web/dist
EXPOSE 4000
CMD ["npm", "run", "start", "--workspace", "apps/server"]
