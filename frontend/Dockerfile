# Build stage
FROM node:20-alpine AS build

# glibc compatibility so Next.js SWC native binary works on Alpine
RUN apk add --no-cache libc6-compat libstdc++

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# ✅ Allow build without real Auth0 env vars
ENV SKIP_AUTH0_VALIDATION=1
ARG BACKEND_URL=http://127.0.0.1:8010
ARG NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8010
ENV BACKEND_URL=$BACKEND_URL
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL

RUN npm run build

# Runtime
FROM node:20-alpine

# runtime also needs glibc compat for SWC
RUN apk add --no-cache libc6-compat libstdc++

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./

EXPOSE 3000
CMD ["npm", "start"]
