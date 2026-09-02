# Shared image for all three workspaces. docker-compose runs the API, customer
# app, and GCS from this one image with different commands.
FROM node:22-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY services/api/package.json services/api/
COPY apps/customer/package.json apps/customer/
COPY apps/gcs/package.json apps/gcs/
RUN npm install

# Copy the rest of the monorepo and build the shared types package.
COPY . .
RUN npm run build:shared

EXPOSE 4000 5173 5174
