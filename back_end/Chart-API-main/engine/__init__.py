"""
Vanta data engine — DuckDB-over-Parquet, local-disk warehouse.

Replaces the Spring/Spark/Iceberg/MinIO/RabbitMQ stack with a single
in-process query engine. The public surface matches what the rest of
Chart-API (the agent, the chart suggester) already expects, so the
integration swap is a one-line change at the call sites.
"""
from .engine import Engine, get_engine  # noqa: F401
from .catalog import Catalog            # noqa: F401
from .storage import Storage            # noqa: F401
