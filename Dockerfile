FROM node:12-slim AS build

RUN apt-get -y update && \
    apt-get -y install curl ca-certificates && \
    curl -L https://get.helm.sh/helm-v3.4.1-linux-amd64.tar.gz | tar xvz && \
    mv linux-amd64/helm /usr/bin/helm && \
    chmod +x /usr/bin/helm && \
    rm -rf linux-amd64 && \
    apt-get -y remove curl && \
    rm -f /var/cache/apt-get/*

WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm cache clean --force

ENV NODE_ENV="production"

CMD [ "npm", "start" ]