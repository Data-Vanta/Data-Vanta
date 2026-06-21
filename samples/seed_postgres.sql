-- One-shot Postgres seed. Creates two tables and ~5000 rows of demo data
-- so the connector wizard has something interesting to ingest and chart.
--
-- Usage (Docker):
--   docker exec -i vanta-test-pg psql -U postgres -d vanta_demo < seed_postgres.sql
--
-- Usage (any Postgres):
--   psql "$DATABASE_URL" -f seed_postgres.sql

DROP TABLE IF EXISTS sales;
DROP TABLE IF EXISTS customers;

CREATE TABLE customers (
    customer_id    SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    segment        TEXT NOT NULL,
    country        TEXT NOT NULL,
    signed_up_at   DATE NOT NULL
);

INSERT INTO customers (name, segment, country, signed_up_at)
SELECT
    'Customer ' || i,
    (ARRAY['B2B','B2C','Enterprise'])[1 + (i % 3)],
    (ARRAY['US','UK','DE','FR','BR','JP','IN','AU','CA','MX'])[1 + (i % 10)],
    CURRENT_DATE - ((random() * 720)::int)
FROM generate_series(1, 200) AS i;

CREATE TABLE sales (
    order_id        TEXT PRIMARY KEY,
    customer_id     INTEGER REFERENCES customers(customer_id),
    sold_at         DATE NOT NULL,
    region          TEXT NOT NULL,
    category        TEXT NOT NULL,
    product         TEXT NOT NULL,
    quantity        INTEGER NOT NULL,
    unit_price      NUMERIC(10,2) NOT NULL,
    total_amount    NUMERIC(12,2) NOT NULL,
    payment_method  TEXT NOT NULL
);

INSERT INTO sales (
    order_id, customer_id, sold_at, region, category, product,
    quantity, unit_price, total_amount, payment_method
)
SELECT
    'ORD-' || LPAD(i::text, 6, '0'),
    1 + (i % 200),
    CURRENT_DATE - ((random() * 365)::int),
    (ARRAY['North','South','East','West'])[1 + (i % 4)],
    cat,
    prod,
    q,
    p,
    ROUND((q * p)::numeric, 2),
    (ARRAY['Card','Wire','Cash','Check'])[1 + (i % 4)]
FROM (
    SELECT
        i,
        cat,
        prod,
        1 + (random() * 8)::int AS q,
        CASE cat
            WHEN 'Electronics' THEN 60 + random() * 1740
            WHEN 'Apparel'     THEN 15 + random() * 205
            WHEN 'Home'        THEN 25 + random() * 1475
            WHEN 'Books'       THEN  8 + random() *  52
            WHEN 'Sports'      THEN 20 + random() * 880
        END::numeric(10,2) AS p
    FROM generate_series(1, 5000) AS i,
    LATERAL (
        SELECT (ARRAY['Electronics','Apparel','Home','Books','Sports'])[1 + (i % 5)] AS cat
    ) c,
    LATERAL (
        SELECT CASE c.cat
            WHEN 'Electronics' THEN (ARRAY['Headphones','Laptop','Phone','Tablet','Smart Watch'])[1 + (i % 5)]
            WHEN 'Apparel'     THEN (ARRAY['Jacket','Sneakers','Jeans','T-shirt','Cap'])[1 + (i % 5)]
            WHEN 'Home'        THEN (ARRAY['Kettle','Lamp','Sofa','Mattress','Cookware'])[1 + (i % 5)]
            WHEN 'Books'       THEN (ARRAY['Novel','Cookbook','Biography','Children','Tech Manual'])[1 + (i % 5)]
            WHEN 'Sports'      THEN (ARRAY['Yoga Mat','Bike','Tennis Racket','Dumbbells','Running Shoes'])[1 + (i % 5)]
        END AS prod
    ) p
) seeded;

CREATE INDEX idx_sales_sold_at  ON sales(sold_at);
CREATE INDEX idx_sales_region   ON sales(region);
CREATE INDEX idx_sales_category ON sales(category);

SELECT 'customers' AS table_name, COUNT(*) AS rows FROM customers
UNION ALL
SELECT 'sales',     COUNT(*)               FROM sales;
