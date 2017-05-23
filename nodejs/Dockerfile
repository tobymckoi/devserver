FROM node:7.10.0

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

ARG NODE_ENV
ENV NODE_ENV $NODE_ENV
COPY package.json /usr/src/app/
RUN npm install && npm cache clean
COPY package.json /usr/src/app
COPY src /usr/src/app/src

EXPOSE 2500

# CMD [ "/bin/sh"]
CMD [ "node", "src/server.js" ]
