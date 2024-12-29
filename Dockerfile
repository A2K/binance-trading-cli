FROM timescale/timescaledb:latest-pg17

RUN apk update && apk add nodejs npm tmux
COPY ./init/init.timescaledb.sql /docker-entrypoint-initdb.d/init.sql

COPY dist /app
COPY package.json /app/package.json
RUN cd /app && npm install --production

COPY .tmux.conf /root/.tmux.conf

WORKDIR /app
