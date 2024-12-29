
SELECT 'CREATE DATABASE transactions' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'transactions')\gexec

\c transactions

CREATE TABLE IF NOT EXISTS transactions (
    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    id BIGINT,
    symbol TEXT,
    "orderId" BIGINT,
    "orderListId" BIGINT,
    price FLOAT,
    qty FLOAT,
    "quoteQty" FLOAT,
    commission FLOAT,
    "commissionAsset" TEXT,
    "isBuyer" BOOLEAN,
    "isMaker" BOOLEAN,
    "isBestMatch" BOOLEAN
)\gexec

SELECT create_hypertable('transactions', by_range('time'));

CREATE INDEX ON transactions (symbol, time DESC)\gexec

CREATE MATERIALIZED VIEW PNL
WITH (timescaledb.continuous) AS
    SELECT time_bucket('1 day', time) as bucket,
           symbol,
           SUM(CASE WHEN "isBuyer" THEN -"quoteQty" ELSE "quoteQty" END) AS total
    FROM transactions
    GROUP BY bucket, symbol\gexec
