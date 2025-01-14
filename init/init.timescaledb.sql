SET client_min_messages = warning;
ALTER ROLE postgres SET client_min_messages=WARNING;
ALTER SYSTEM SET client_min_messages=WARNING;
SELECT 'CREATE DATABASE transactions' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'transactions')\gexec
ALTER DATABASE transactions SET client_min_messages=WARNING;

\c transactions

CREATE TABLE IF NOT EXISTS transactions (
    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    id BIGINT ,
    symbol TEXT,
    currency TEXT,
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

-- CREATE INDEX ON transactions (symbol, time DESC)\gexec
CREATE UNIQUE INDEX ON transactions (id, time)\gexec
CREATE INDEX ON transactions ("isBuyer")\gexec

CREATE MATERIALIZED VIEW transactions_agg
WITH (timescaledb.continuous) AS
    SELECT time_bucket('1 second', time) as bucket,
           symbol, currency,
           sum(price * qty) / sum(qty) as price,
           sum(qty) as qty,
           sum("quoteQty") as "quoteQty",
           sum(commission) as commission,
           "commissionAsset",
           "isBuyer",
           "isMaker",
           "isBestMatch",
           SUM(CASE WHEN "isBuyer" THEN -"quoteQty" ELSE "quoteQty" END) AS total
    FROM transactions
    GROUP BY bucket, symbol, currency, "commissionAsset", "isBuyer", "isMaker", "isBestMatch", price \gexec

CREATE MATERIALIZED VIEW PNL_Day
WITH (timescaledb.continuous) AS
    SELECT time_bucket('1 day', time) as bucket,
           symbol,
           SUM(CASE WHEN "isBuyer" THEN -"quoteQty" ELSE "quoteQty" END) AS total
    FROM transactions
    GROUP BY bucket, symbol\gexec

CREATE MATERIALIZED VIEW PNL_Week
WITH (timescaledb.continuous) AS
    SELECT time_bucket('1 week', time) as bucket,
           symbol,
           SUM(CASE WHEN "isBuyer" THEN -"quoteQty" ELSE "quoteQty" END) AS total
    FROM transactions
    GROUP BY bucket, symbol\gexec

CREATE MATERIALIZED VIEW PNL_Month
WITH (timescaledb.continuous) AS
    SELECT time_bucket('1 month', time) as bucket,
           symbol,
           SUM(CASE WHEN "isBuyer" THEN -"quoteQty" ELSE "quoteQty" END) AS total
    FROM transactions
    GROUP BY bucket, symbol\gexec

CREATE MATERIALIZED VIEW PNL_AllTime
WITH (timescaledb.continuous) AS
    SELECT time_bucket('1000 years', time) as bucket,
           symbol,
           SUM(CASE WHEN "isBuyer" THEN -"quoteQty" ELSE "quoteQty" END) AS total
    FROM transactions
    GROUP BY bucket, symbol\gexec