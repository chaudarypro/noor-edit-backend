FROM node:18-bullseye

RUN apt-get update && apt-get install -y \
    fonts-arabeyes \
    fonts-noto-core \
    fonts-noto-extra \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

RUN fc-cache -fv

EXPOSE 3001
CMD ["node", "worker/index.js"]
