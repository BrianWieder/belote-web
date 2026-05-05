# Use the Node alpine official image
# https://hub.docker.com/_/node
FROM node:lts-alpine AS build

# Set config
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV NPM_CONFIG_FUND=false

ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=$VITE_SERVER_URL

ARG VITE_TURN_USERNAME
ENV VITE_TURN_USERNAME=$VITE_TURN_USERNAME

ARG VITE_TURN_CREDENTIAL
ENV VITE_TURN_CREDENTIAL=$VITE_TURN_CREDENTIAL

# Create and change to the app directory.
WORKDIR /app

# Copy the files to the container image
COPY ./ ./

# Install packages
RUN npm ci

# Build the app.
RUN npm run build --workspace=client

# Use the Caddy image
FROM caddy

# Create and change to the app directory.
WORKDIR /app

# Copy Caddyfile to the container image.
COPY ./client/Caddyfile ./

# Copy local code to the container image.
RUN caddy fmt Caddyfile --overwrite

# Copy files to the container image.
COPY --from=build /app/client/dist ./dist

# Use Caddy to run/serve the app
CMD ["caddy", "run", "--config", "Caddyfile", "--adapter", "caddyfile"]