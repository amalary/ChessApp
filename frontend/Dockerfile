# Build stage
FROM node:20-alpine AS build

# ✅ Add glibc compatibility so Next.js SWC native binary works on Alpine
RUN apk add --no-cache libc6-compat libstdc++

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime
FROM node:20-alpine

# ✅ Also add glibc compatibility in the runtime image
RUN apk add --no-cache libc6-compat libstdc++

WORKDIR /app
ENV NODE_ENV=production

# Copy the built app from the build stage
COPY --from=build /app ./

EXPOSE 3000
CMD ["npm", "start"]
