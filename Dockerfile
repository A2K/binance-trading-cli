FROM a2k0001/tradebot:baseimg

COPY ./init/init.timescaledb.sql /docker-entrypoint-initdb.d/init.sql
COPY dist /app

WORKDIR /app
