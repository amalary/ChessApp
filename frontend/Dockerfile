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
