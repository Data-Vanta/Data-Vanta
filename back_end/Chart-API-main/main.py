import uvicorn
import os
import json
import tempfile
import uuid
import httpx
import asyncio
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Header, Depends
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel, ConfigDict, Field
from openai import AsyncOpenAI
from typing import List, Dict, Any, Union, Optional, Literal
from dotenv import load_dotenv
from charts_config import charts_config
from agent import run_code_agent, AgentContext
from engine import get_engine
from engine.widget_query import build_chart_spec as build_widget_chart_spec
from engine.connectors import get_ingester, REGISTRY as CONNECTOR_REGISTRY
from engine.storage import runs_dir

# --- Load .env ---
load_dotenv()

# --- Configuration & API Client Setup ---
API_KEY = os.getenv("OPENROUTER_API_KEY")
BASE_URL = os.getenv("OPENROUTER_BASE_URL")
MODEL = os.getenv("OPENROUTER_MODEL")
# Kept for the compat shim; the new engine needs no external base URL.
DATALAKE_BASE_URL = os.getenv("DATALAKE_BASE_URL", "http://localhost:8888/api/v1")
USER_AUTH_BASE_URL = os.getenv("USER_AUTH_BASE_URL", "http://localhost:5000/api/v1")

# Defensive cap on /data/query result size. Clients that genuinely need
# the full result set must opt in with `download=true` on the request.
# Tunable via env so ops can dial it without a redeploy.
MAX_ROWS = int(os.getenv("CHART_API_MAX_ROWS", "50000"))


if not API_KEY:
    raise RuntimeError("Missing OPENROUTER_API_KEY in .env!")

CLIENT = AsyncOpenAI(
    base_url=BASE_URL,
    api_key=API_KEY
)

# --- FastAPI App Initialization ---
app = FastAPI(
    title="Chart Generation Assistant API",
    description="An API that suggests charts and builds queries based on user prompts and metadata.",
    version="2.0.0"
)

# --- CORS Middleware (allow frontend access) ---
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001", 
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Auth dependency ------------------------------------------------
# The frontend forwards x-auth-token on every /data/* request. We
# resolve it to a user id by calling user-auth /auth/me. A tiny in-
# memory cache keeps the round-trip off the hot path when the same
# token is used for a burst of requests (e.g. the chat composer).

_TOKEN_CACHE: dict[str, tuple[float, dict]] = {}
_TOKEN_CACHE_TTL = 30.0  # seconds


def _auth_lookup_sync(token: str) -> tuple[int, dict]:
    """Blocking /auth/me call used by require_user via asyncio.to_thread.

    We use stdlib urllib deliberately — on Windows the async httpx
    client was hanging inside uvicorn's event loop. Stdlib urllib +
    asyncio.to_thread is bulletproof and ~5ms per round-trip.
    """
    import urllib.request
    import urllib.error
    import json as _json
    req = urllib.request.Request(
        f"{USER_AUTH_BASE_URL}/auth/me",
        headers={"x-auth-token": token},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, _json.loads(body) if body else {}
            except _json.JSONDecodeError:
                return resp.status, {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, _json.loads(body) if body else {}
        except _json.JSONDecodeError:
            return e.code, {}


def require_internal(x_internal_secret: Optional[str] = Header(None)) -> bool:
    """Gate Chart-API endpoints meant to be called by Node (server-to-server,
    not by browsers). Set INTERNAL_SHARED_SECRET on both services."""
    expected = os.environ.get("INTERNAL_SHARED_SECRET")
    if not expected:
        raise HTTPException(
            status_code=500,
            detail="INTERNAL_SHARED_SECRET is not configured on the engine",
        )
    if not x_internal_secret or x_internal_secret != expected:
        raise HTTPException(status_code=401, detail="Invalid internal secret")
    return True


async def require_user(x_auth_token: Optional[str] = Header(None)) -> dict:
    """FastAPI dependency — returns the authenticated user dict, 401 otherwise."""
    import time
    if not x_auth_token:
        raise HTTPException(status_code=401, detail="Missing x-auth-token")
    now = time.time()
    cached = _TOKEN_CACHE.get(x_auth_token)
    if cached and (now - cached[0]) < _TOKEN_CACHE_TTL:
        return cached[1]
    try:
        status, payload = await asyncio.to_thread(_auth_lookup_sync, x_auth_token)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"user-auth unreachable: {e!r}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"user-auth error: {e!r}")
    if status == 401:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if status == 403:
        raise HTTPException(status_code=403, detail="Email not verified")
    if status >= 400:
        raise HTTPException(status_code=502, detail=f"user-auth returned {status}")
    user = (payload or {}).get("data", {}).get("user")
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="user-auth response missing user")
    _TOKEN_CACHE[x_auth_token] = (now, user)
    return user


# --- Schema Profiler for LLM Grounding ---
def infer_column_type(values: list) -> str:
    """Infer column type from sample values."""
    if not values:
        return "unknown"
    
    # Check for date patterns
    date_patterns = ['-', '/', '2020', '2021', '2022', '2023', '2024', '2025']
    str_values = [str(v) for v in values if v is not None]
    
    if str_values:
        sample = str_values[0]
        # Check if numeric
        try:
            float(sample.replace(',', ''))
            # Check if all values are numeric
            numeric_count = sum(1 for v in str_values if v.replace(',', '').replace('.', '').replace('-', '').isdigit())
            if numeric_count > len(str_values) * 0.8:
                return "numeric"
        except:
            pass
        
        # Check for dates
        if any(p in sample for p in date_patterns) and len(sample) >= 8:
            return "date"
        
        # Check for boolean
        lower_vals = [v.lower() for v in str_values]
        if all(v in ['true', 'false', 'yes', 'no', '0', '1'] for v in lower_vals):
            return "boolean"
    
    # Default to category/string
    unique_ratio = len(set(str_values)) / max(len(str_values), 1)
    if unique_ratio < 0.3:
        return "category"
    return "string"

def build_schema_profile(columns_data: list, sample_rows: list = None, row_count: int = None) -> dict:
    """
    Build a rich schema profile for LLM grounding.
    
    Returns:
    {
        "columns": [
            {"name": "Region", "type": "category", "samples": ["Asia", "Europe", "Americas"]},
            {"name": "Revenue", "type": "numeric", "samples": [1000, 2500, 3200], "stats": {"min": 100, "max": 5000}},
            {"name": "Date", "type": "date", "samples": ["2023-01-05", "2023-01-10"]}
        ],
        "row_count": 100,
        "summary": "3 columns: 1 category (Region), 1 numeric (Revenue), 1 date (Date)"
    }
    """
    profile_columns = []
    type_counts = {"numeric": 0, "date": 0, "category": 0, "string": 0, "boolean": 0, "unknown": 0}
    
    for col in columns_data:
        col_name = col.get("column_name") or col.get("name") or str(col)
        col_type_raw = col.get("data_type") or col.get("type") or ""
        
        # Extract sample values from sample_rows if available
        samples = []
        if sample_rows:
            for row in sample_rows[:5]:
                if isinstance(row, dict) and col_name in row:
                    val = row[col_name]
                    if val is not None and str(val).strip():
                        samples.append(val)
        
        # Infer type from data or use provided type
        if "int" in col_type_raw.lower() or "float" in col_type_raw.lower() or "double" in col_type_raw.lower() or "decimal" in col_type_raw.lower():
            inferred_type = "numeric"
        elif "date" in col_type_raw.lower() or "time" in col_type_raw.lower():
            inferred_type = "date"
        elif "bool" in col_type_raw.lower():
            inferred_type = "boolean"
        elif samples:
            inferred_type = infer_column_type(samples)
        else:
            inferred_type = "string"
        
        type_counts[inferred_type] = type_counts.get(inferred_type, 0) + 1
        
        col_profile = {
            "name": col_name,
            "type": inferred_type,
            "samples": samples[:3] if samples else []
        }
        
        # Add stats for numeric columns
        if inferred_type == "numeric" and samples:
            try:
                numeric_vals = [float(str(v).replace(',', '')) for v in samples if v is not None]
                if numeric_vals:
                    col_profile["stats"] = {
                        "min": min(numeric_vals),
                        "max": max(numeric_vals),
                        "sample_avg": sum(numeric_vals) / len(numeric_vals)
                    }
            except:
                pass
        
        profile_columns.append(col_profile)
    
    # Build summary string for LLM
    type_summary_parts = []
    for t, count in type_counts.items():
        if count > 0:
            col_names = [c["name"] for c in profile_columns if c["type"] == t]
            type_summary_parts.append(f"{count} {t} ({', '.join(col_names[:3])}{'...' if len(col_names) > 3 else ''})")
    
    return {
        "columns": profile_columns,
        "row_count": row_count or 0,
        "column_names": [c["name"] for c in profile_columns]
    }

# --- Data-Lakehouse Integration ---
async def execute_query_on_datalake(
    query_json: Dict, user_id: Optional[str] = None
) -> Dict:
    """
    Execute a query JSON against the local DuckDB engine (when `user_id`
    is supplied) or fall back to the legacy Spring/Spark lakehouse HTTP
    hop. The return shape mimics the old {"status": "completed",
    "resultData": [...]} payload so downstream code (chart-builder,
    transform_to_chartjs_format) doesn't need to change.
    """
    if user_id:
        try:
            result = await asyncio.to_thread(
                get_engine().query, user_id=user_id, spec=query_json
            )
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Query failed: {e!r}")
        return {
            "status": "completed",
            "resultData": result["rows"],
            "rowCount": result["rowCount"],
            "columns": result["columns"],
            "sql": result["sql"],
        }

    # Legacy path — keep the polling loop for any unauthenticated caller
    # still on the lakehouse. Removed entirely when the lakehouse stack is.
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(f"{DATALAKE_BASE_URL}/query", json=query_json)
            response.raise_for_status()
            result = response.json()
            job_id = result.get("jobId")
            if not job_id:
                raise HTTPException(status_code=500, detail="No jobId returned from data-lakehouse")
            for attempt in range(60):
                status_response = await client.get(f"{DATALAKE_BASE_URL}/query/{job_id}")
                status_response.raise_for_status()
                status_data = status_response.json()
                if status_data.get("status") == "completed":
                    return status_data
                elif status_data.get("status") == "failed":
                    raise HTTPException(
                        status_code=500,
                        detail=f"Query failed: {status_data.get('message', 'Unknown error')}",
                    )
                await asyncio.sleep(1)
            raise HTTPException(status_code=500, detail="Query execution timeout")
        except httpx.HTTPError as e:
            raise HTTPException(status_code=500, detail=f"Data-lakehouse error: {str(e)}")


# --- Helper: Transform lakehouse data to Chart.js format ---
def transform_to_chartjs_format(execution_result: dict, chart_config: dict = None) -> dict:
    """
    Transform raw lakehouse query result into Chart.js compatible format.
    
    Input format from lakehouse:
    {
        "status": "completed",
        "resultData": [
            {"column1": "value1", "column2": 123},
            {"column1": "value2", "column2": 456},
            ...
        ]
    }
    
    Output format for Chart.js:
    {
        "labels": ["value1", "value2", ...],
        "datasets": [{
            "label": "column2",
            "data": [123, 456, ...],
            "backgroundColor": ["#BCFF3C", ...]
        }]
    }
    
    Special handling for histograms:
    - Single column of numeric data is binned into ranges
    - Returns bin labels and frequency counts
    """
    result_data = execution_result.get("resultData", [])
    
    # DATA_TRACE: Log raw lakehouse data for debugging
    print(f"[DATA_TRACE] Raw resultData from lakehouse ({len(result_data)} rows):")
    for i, row in enumerate(result_data[:5]):  # Log first 5 rows
        print(f"[DATA_TRACE]   Row {i}: {row}")
    
    if not result_data or not isinstance(result_data, list):
        return {"labels": [], "datasets": []}
    
    # Get column names from first row
    if isinstance(result_data[0], dict):
        columns = list(result_data[0].keys())
    else:
        return {"labels": [], "datasets": []}
    
    if len(columns) < 1:
        return {"labels": [], "datasets": []}
    
    # Generate vibrant color palette
    colors = [
        "#BCFF3C", "#3CBCFF", "#FF3CBC", "#FFBC3C", 
        "#3CFFBC", "#BC3CFF", "#FF6B6B", "#6BFFB8"
    ]
    
    # Check if this is a histogram (single column of numeric data)
    chart_type = chart_config.get("chart_type", "") if chart_config else ""
    if chart_type == "histogram" and len(columns) == 1:
        # Extract numeric values from the single column
        col_name = columns[0]
        numeric_values = []
        for row in result_data:
            val = row.get(col_name, 0)
            if isinstance(val, (int, float)):
                numeric_values.append(float(val))
            else:
                try:
                    numeric_values.append(float(val) if val else 0)
                except (ValueError, TypeError):
                    pass
        
        if not numeric_values:
            return {"labels": [], "datasets": []}
        
        # Create histogram bins
        min_val = min(numeric_values)
        max_val = max(numeric_values)
        num_bins = 10
        
        # Handle edge case where all values are the same
        if min_val == max_val:
            return {
                "labels": [f"{min_val:.0f}"],
                "datasets": [{
                    "label": "Frequency",
                    "data": [len(numeric_values)],
                    "backgroundColor": [colors[0]]
                }]
            }
        
        bin_width = (max_val - min_val) / num_bins
        bins = [0] * num_bins
        bin_labels = []
        
        for i in range(num_bins):
            bin_start = min_val + i * bin_width
            bin_end = min_val + (i + 1) * bin_width
            bin_labels.append(f"{bin_start:.0f}-{bin_end:.0f}")
        
        # Count values in each bin
        for val in numeric_values:
            bin_idx = int((val - min_val) / bin_width)
            # Handle edge case for max value
            if bin_idx >= num_bins:
                bin_idx = num_bins - 1
            bins[bin_idx] += 1
        
        print(f"[DATA_TRACE] Histogram bins: {bin_labels}, counts: {bins}")
        
        return {
            "labels": bin_labels,
            "datasets": [{
                "label": "Frequency",
                "data": bins,
                "backgroundColor": [colors[0]] * num_bins
            }]
        }
    
    # Standard transformation: First column as labels, rest as datasets
    label_col = columns[0]
    labels = [str(row.get(label_col, "")) for row in result_data]
    
    datasets = []
    for i, col in enumerate(columns[1:], start=0):
        data_values = []
        for row in result_data:
            val = row.get(col, 0)
            # Handle numeric conversion - NO SCALING APPLIED
            if isinstance(val, (int, float)):
                data_values.append(val)
            else:
                try:
                    data_values.append(float(val) if val else 0)
                except (ValueError, TypeError):
                    data_values.append(0)
        
        # DATA_TRACE: Log transformed values
        print(f"[DATA_TRACE] Column '{col}' values (raw, no scaling): {data_values[:5]}...")
        
        datasets.append({
            "label": col,
            "data": data_values,
            "backgroundColor": [colors[i % len(colors)]] * len(data_values)
        })
    
    # DATA_TRACE: Log final output
    print(f"[DATA_TRACE] Final Chart.js format - labels: {labels[:5]}, first dataset values: {datasets[0]['data'][:5] if datasets else []}")
    
    return {
        "labels": labels,
        "datasets": datasets
    }



# --- Helper: Clean LLM JSON responses ---
import re

def clean_llm_json(content: str) -> str:
    """
    Clean LLM output to extract pure JSON.
    Handles: <s> tags, markdown fences, [OUT] wrappers, and other common artifacts.
    """
    if not content:
        return "{}"
    
    content = content.strip()
    
    # Remove <s> and </s> tags (common in Mistral outputs)
    content = re.sub(r'</?s>', '', content)
    
    # Remove [OUT]...[/OUT] wrappers
    if "[OUT]" in content and "[/OUT]" in content:
        match = re.search(r'\[OUT\](.*?)\[/OUT\]', content, re.DOTALL)
        if match:
            content = match.group(1).strip()
    
    # Remove markdown code fences
    content = content.strip()
    if content.startswith("```json"):
        content = content[7:]
    elif content.startswith("```"):
        content = content[3:]
    if content.endswith("```"):
        content = content[:-3]
    
    content = content.strip()
    
    # Try to find JSON object/array
    # Find first { or [ and last } or ]
    start_obj = content.find('{')
    start_arr = content.find('[')
    
    if start_obj == -1 and start_arr == -1:
        return "{}"
    
    # Use whichever comes first
    if start_obj == -1:
        start_idx = start_arr
    elif start_arr == -1:
        start_idx = start_obj
    else:
        start_idx = min(start_obj, start_arr)
    
    # Find corresponding end
    if content[start_idx] == '{':
        end_idx = content.rfind('}')
    else:
        end_idx = content.rfind(']')
    
    if end_idx != -1 and end_idx > start_idx:
        content = content[start_idx:end_idx + 1]
    
    return content.strip()


# --- Logic Classes (Adapted from prompt2.py) ---

class ChartSuggester:
    """
    Schema-grounded chart suggester.
    Now requires dataset schema to suggest only charts that match available column types.
    """
    def __init__(self, charts_config: List[Dict], model: str = MODEL):
        self.model = model
        self.minimal_config = [
            {
                "id": chart.get("chart_id"),
                "name": chart.get("name"),
                "data_requirements": chart.get("data_requirements", {})
            }
            for chart in charts_config
        ]
        
        # Schema-grounded system prompt with few-shot examples
        self.system_prompt = """You are a data visualization assistant that ONLY suggests charts matching the dataset schema.

CRITICAL RULES:
1. You MUST use columns that exist in the provided schema
2. Match chart types to column types:
   - date + numeric → line_chart, area_chart
   - category + numeric → bar_chart, pie_chart
   - numeric + numeric → scatter_plot
   - single numeric → histogram, big_number
3. Return EXACTLY 4 chart suggestions (or fewer if data doesn't support)
4. Output ONLY valid JSON, no markdown or explanation

COLUMN TYPE MATCHING:
- "numeric" columns can be aggregated (SUM, AVG, COUNT)
- "date" columns go on x-axis for time series
- "category" columns go on x-axis for comparisons
- "string" columns with few unique values are categories

FEW-SHOT EXAMPLES:

Example 1:
Schema: {"columns": [{"name": "Date", "type": "date"}, {"name": "Revenue", "type": "numeric"}, {"name": "Region", "type": "category"}]}
User: "show me trends"
Output:
{
  "chosen_charts": [
    {"id": 9, "name": "line_chart", "reason": "Date + Revenue for time trend", "encoding": {"x": "Date", "y": "Revenue"}},
    {"id": 1, "name": "bar_chart", "reason": "Region + Revenue for comparison", "encoding": {"x": "Region", "y": "Revenue"}},
    {"id": 6, "name": "pie_chart", "reason": "Revenue distribution by Region", "encoding": {"x": "Region", "y": "Revenue"}},
    {"id": 10, "name": "big_number", "reason": "Total Revenue highlight", "encoding": {"y": "Revenue"}}
  ]
}

Example 2:
Schema: {"columns": [{"name": "Product", "type": "category"}, {"name": "Sales", "type": "numeric"}, {"name": "Quantity", "type": "numeric"}]}
User: "analyze sales"
Output:
{
  "chosen_charts": [
    {"id": 1, "name": "bar_chart", "reason": "Product vs Sales comparison", "encoding": {"x": "Product", "y": "Sales"}},
    {"id": 5, "name": "scatter_plot", "reason": "Sales vs Quantity correlation", "encoding": {"x": "Quantity", "y": "Sales"}},
    {"id": 4, "name": "histogram", "reason": "Sales distribution", "encoding": {"x": "Sales"}},
    {"id": 10, "name": "big_number", "reason": "Total Sales highlight", "encoding": {"y": "Sales"}}
  ]
}

OUTPUT FORMAT (must follow exactly):
{
  "chosen_charts": [
    {"id": <chart_id>, "name": "<chart_name>", "reason": "<why this chart>", "encoding": {"x": "<column>", "y": "<column>"}}
  ]
}
"""

    async def suggest(self, user_prompts: List[str], schema_profile: dict = None) -> List[Dict]:
        """
        Suggest charts based on user prompts AND dataset schema.
        schema_profile should contain: columns, column_names, summary
        """
        results = []
        
        # If no schema provided, return empty (cannot suggest without grounding)
        if not schema_profile or not schema_profile.get("columns"):
            print("[ChartSuggester] WARNING: No schema provided, using fallback suggestions")
            return self._generate_fallback_suggestions(user_prompts, schema_profile)

        for prompt in user_prompts:
            try:
                # Build schema context for LLM
                schema_context = json.dumps({
                    "columns": schema_profile.get("columns", [])
                }, indent=2)
                
                response = await CLIENT.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": self.system_prompt},
                        {
                            "role": "user",
                            "content": f"Schema: {schema_context}\n\nUser request: {prompt}\n\nSuggest 4 appropriate charts using ONLY the columns in the schema."
                        }
                    ],
                    temperature=0,
                    max_tokens=1000,
                )
                content = response.choices[0].message.content
                print(f"[ChartSuggester] Raw response: {content}")
                
                # Clean and parse JSON
                try:
                    cleaned = clean_llm_json(content)
                    print(f"[ChartSuggester] Cleaned JSON: {cleaned}")
                    chosen_charts = json.loads(cleaned).get("chosen_charts", [])
                    
                    # Validate that suggested columns exist
                    valid_columns = set(schema_profile.get("column_names", []))
                    validated_charts = []
                    for chart in chosen_charts:
                        encoding = chart.get("encoding", {})
                        x_col = encoding.get("x", "")
                        y_col = encoding.get("y", "")
                        # Only keep charts with valid column references
                        if (not x_col or x_col in valid_columns) and (not y_col or y_col in valid_columns):
                            validated_charts.append(chart)
                        else:
                            print(f"[ChartSuggester] Rejected chart with invalid columns: x={x_col}, y={y_col}")
                    
                    chosen_charts = validated_charts if validated_charts else chosen_charts[:4]
                    
                except (KeyError, json.JSONDecodeError) as e:
                    print(f"[ChartSuggester] Failed to parse JSON: {e}")
                    chosen_charts = self._generate_fallback_suggestions([prompt], schema_profile)[0].get("chosen_charts", [])

                results.append({
                    "user_prompt": prompt,
                    "chosen_charts": chosen_charts
                })
            except Exception as e:
                print(f"[ChartSuggester] Error processing prompt '{prompt}': {e}")
                # Return fallback on any error (including rate limits)
                fallback = self._generate_fallback_suggestions([prompt], schema_profile)
                results.append(fallback[0] if fallback else {"user_prompt": prompt, "chosen_charts": []})

        return results
    
    def _generate_fallback_suggestions(self, user_prompts: List[str], schema_profile: dict = None) -> List[Dict]:
        """
        Generate rule-based fallback suggestions when LLM fails or rate-limited.
        Uses column types to suggest appropriate charts.
        """
        results = []
        
        if not schema_profile or not schema_profile.get("columns"):
            # No schema at all - return generic suggestions
            for prompt in user_prompts:
                results.append({
                    "user_prompt": prompt,
                    "chosen_charts": [
                        {"id": 1, "name": "bar_chart", "reason": "Default comparison chart", "encoding": {}},
                        {"id": 9, "name": "line_chart", "reason": "Default trend chart", "encoding": {}},
                        {"id": 6, "name": "pie_chart", "reason": "Default distribution chart", "encoding": {}},
                        {"id": 10, "name": "big_number", "reason": "Default KPI chart", "encoding": {}}
                    ]
                })
            return results
        
        columns = schema_profile.get("columns", [])
        date_cols = [c["name"] for c in columns if c.get("type") == "date"]
        numeric_cols = [c["name"] for c in columns if c.get("type") == "numeric"]
        category_cols = [c["name"] for c in columns if c.get("type") in ["category", "string"]]
        
        for prompt in user_prompts:
            suggestions = []
            
            # Rule 1: date + numeric → line_chart
            if date_cols and numeric_cols:
                suggestions.append({
                    "id": 9, "name": "line_chart",
                    "reason": f"Time trend: {date_cols[0]} vs {numeric_cols[0]}",
                    "encoding": {"x": date_cols[0], "y": numeric_cols[0]}
                })
            
            # Rule 2: category + numeric → bar_chart
            if category_cols and numeric_cols:
                suggestions.append({
                    "id": 1, "name": "bar_chart",
                    "reason": f"Comparison: {category_cols[0]} vs {numeric_cols[0]}",
                    "encoding": {"x": category_cols[0], "y": numeric_cols[0]}
                })
            
            # Rule 3: numeric distribution → histogram
            if numeric_cols:
                suggestions.append({
                    "id": 4, "name": "histogram",
                    "reason": f"Distribution of {numeric_cols[0]}",
                    "encoding": {"x": numeric_cols[0]}
                })
            
            # Rule 4: category + numeric → pie_chart
            if category_cols and numeric_cols:
                suggestions.append({
                    "id": 6, "name": "pie_chart",
                    "reason": f"Share by {category_cols[0]}",
                    "encoding": {"x": category_cols[0], "y": numeric_cols[0]}
                })
            
            # Rule 5: numeric vs numeric → scatter
            if len(numeric_cols) >= 2:
                suggestions.append({
                    "id": 5, "name": "scatter_plot",
                    "reason": f"Correlation: {numeric_cols[0]} vs {numeric_cols[1]}",
                    "encoding": {"x": numeric_cols[0], "y": numeric_cols[1]}
                })
            
            # Rule 6: big number for any numeric
            if numeric_cols:
                suggestions.append({
                    "id": 10, "name": "big_number",
                    "reason": f"Total {numeric_cols[0]}",
                    "encoding": {"y": numeric_cols[0]}
                })
            
            results.append({
                "user_prompt": prompt,
                "chosen_charts": suggestions[:4]  # Return max 4
            })
        
        return results


class ChartValidatorAndQueryBuilder:
    def __init__(self, charts_config: List[Dict], model: str = MODEL):
        self.model = model
        self.minimal_config = [
            {
                "id": chart.get("chart_id"),
                "name": chart.get("name"),
                "data_requirements": chart.get("data_requirements", {}),
            }
            for chart in charts_config
        ]
        self.system_prompt = """
        You are a data visualization assistant that outputs only JSON.

        Inputs you will receive:

        user_prompt: the user’s request text

        dataset_metadata: list of columns with name + data_type (+ optional description)

        recommended_charts: list of chart specs. Each spec contains:

        chart_id

        chart_type

        requirements: required roles (e.g., numeric_measure, categorical_dimension, datetime) and any constraints

        encoding_template: which encodings are expected (x, y, color)

        Your job:
        For each chart in recommended_charts:

        Check if dataset_metadata satisfies every requirement.

        If satisfied, choose exact column names from dataset_metadata for each role.

        If not satisfied, skip the chart (do not guess or invent columns).

        Output format:
        Return ONLY this JSON object (no markdown, no commentary):
        {
        "intent": "visualization",
        "charts": []
        }

        If at least one chart is applicable, each item in "charts" MUST be:
        {
        "user_prompt": "<copy user_prompt exactly>",
        "chart_id": "<chart_id>",
        "chart_type": "<chart_type>",
        "query": {
        "source": "uploaded_file",
        "select": [
        {"column": "<dataset_column>", "as": "<alias>"},
        {"column": "<dataset_column>", "aggregation": "<sum|avg|min|max|count|count_distinct>", "as": "<alias>"}
        ],
        "filters": [
        {"column": "<dataset_column>", "operator": "<=|>=|=|!=|in|between|contains>", "value": "<value_or_list>"}
        ],
        "groupBy": ["<alias_or_column>"],
        "orderBy": [
        {"column": "<alias_or_column>", "direction": "asc"}
        ],
        "limit": null
        },
        "encoding": {"x": "<alias_or_column>", "y": "<alias_or_column>", "color": "<alias_or_column_or_empty_string>"}
        }

        Hard rules:

        Output must start with { and end with }.

        Use only columns that exist in dataset_metadata.

        Always include query.select, query.filters, query.groupBy, query.orderBy, query.limit even if empty.

        select MUST be a list of objects, never strings.

        orderBy MUST be a list of objects, never a single object.

        If no charts apply, return {"intent":"visualization","charts":[]} exactly.


        
        """

    async def build_final_charts(self, dataset_metadata: Dict, recommended_charts_with_prompts: List[Dict]) -> Dict:
        try:
            response = await CLIENT.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {
                        "role": "user",
                        "content": f"Dataset metadata: {json.dumps(dataset_metadata)}\nRecommended charts with prompts: {json.dumps(recommended_charts_with_prompts)}\nChart configurations: {json.dumps(self.minimal_config)}"
                    }
                ],
                temperature=0,
                max_tokens=3000,
            )
            content = response.choices[0].message.content
            print(f"Raw response content: {content}")
            # Clean LLM output using helper
            cleaned = clean_llm_json(content)
            print(f"Cleaned JSON: {cleaned}")
            
            return json.loads(cleaned)
        except json.JSONDecodeError:
            return {"intent": "visualization", "charts": []}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error in Query Builder: {str(e)}")

# ...existing code...
async def fetch_table_columns(
    project_id: str,
    table_name: str,
    timeout: int = 30,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Return {"columns": [...]} for a registered table.

    Fast path: the in-process DuckDB engine when `user_id` is supplied.
    Legacy path: the Spring/Spark lakehouse HTTP hop, for callers that
    haven't threaded a user id through yet (we'll retire this branch
    once every caller is updated).
    """
    if user_id:
        def _run() -> Dict[str, Any]:
            schema = get_engine().schema(
                user_id=user_id, project_id=project_id, table_name=table_name
            )
            # Keep the result shape the existing pipeline expects.
            return {"columns": schema}
        try:
            return await asyncio.to_thread(_run)
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"engine schema failed: {e!r}")

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            resp = await client.get(f"{DATALAKE_BASE_URL}/schema/{project_id}/{table_name}")
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Network error contacting data-lakehouse: {e}")

        # try to parse JSON body even on non-2xx so we can show server message
        try:
            payload = resp.json()
        except Exception:
            payload = {"_raw_text": resp.text}

        # Surface server errors with body
        if resp.status_code >= 500:
            detail = payload.get("error") or payload.get("message") or resp.text
            raise HTTPException(status_code=502, detail=f"Data-lakehouse schema endpoint error {resp.status_code}: {detail}")
        if resp.status_code >= 400:
            detail = payload.get("error") or payload.get("message") or resp.text
            raise HTTPException(status_code=400, detail=f"Data-lakehouse schema endpoint returned {resp.status_code}: {detail}")

        # If the request returned a queued job, poll the job status
        job_id = payload.get("jobId")
        status = payload.get("status")
        if job_id and status in ("queued", "running"):
            for _ in range(timeout):
                await asyncio.sleep(1)
                try:
                    status_resp = await client.get(f"{DATALAKE_BASE_URL}/query/{job_id}")
                except httpx.HTTPError as e:
                    raise HTTPException(status_code=502, detail=f"Error polling schema job: {e}")

                try:
                    status_payload = status_resp.json()
                except Exception:
                    status_payload = {"_raw_text": status_resp.text}

                if status_resp.status_code >= 500:
                    raise HTTPException(status_code=502, detail=f"Schema job status endpoint error {status_resp.status_code}: {status_resp.text}")
                if status_payload.get("status") == "completed":
                    payload = status_payload
                    break
                if status_payload.get("status") == "failed":
                    msg = status_payload.get("message") or status_payload.get("error") or status_resp.text
                    raise HTTPException(status_code=400, detail=f"Schema job failed: {msg}")
            else:
                raise HTTPException(status_code=504, detail="Timed out waiting for schema job to complete")

        # Normalize and return the resultData
        result_data = payload.get("resultData") or payload.get("result_data") or []
        return {"columns": result_data}



# --- Pydantic Models ---

class SuggestChartsRequest(BaseModel):
    user_prompts: List[str]

class SuggestChartsResponse(BaseModel):
    suggestions: List[Dict[str, Any]]

class BuildQueriesRequest(BaseModel):
    dataset_metadata: Dict[str, Any]
    suggestions: List[Dict[str, Any]]

class BuildQueriesResponse(BaseModel):
    intent: str
    charts: List[Dict[str, Any]]


# D3: Multi-source chat attachments. The frontend sends one Attachment per
# user-attached source (file or connector table); the agent system prompt
# lists each one with its alias so the LLM can reference sources by name.
# For D3, only the first attachment drives the sandbox data path — true
# multi-source df_for(alias) loading is future work.
class Attachment(BaseModel):
    kind: Literal['file', 'connector_table', 'connector_live'] = 'connector_table'
    project_id: Optional[str] = None
    table_name: Optional[str] = None
    alias: Optional[str] = None
    file_id: Optional[str] = None  # not yet resolved server-side; for forward-compat
    connector_id: Optional[str] = None  # only for kind='connector_live'
    connector_type: Optional[str] = None  # informational, populated by FE for live sources


class ExecutePromptRequest(BaseModel):
    user_prompts: List[str]
    project_id: str
    table_name: str
    attachments: Optional[List[Attachment]] = None
class ExecutePromptResponse(BaseModel):
    intent: str
    charts: List[Dict[str, Any]]


class ExecuteCodePromptRequest(BaseModel):
    prompt: str
    project_id: str
    table_name: str
    model_id: Optional[str] = None
    system_prompt: Optional[str] = None
    memories: Optional[List[str]] = None
    row_limit: Optional[int] = 10000
    attachments: Optional[List[Attachment]] = None


# --- API Endpoints ---

@app.get("/health", summary="Health check")
async def health():
    """Lightweight liveness probe used by the root dev orchestrator."""
    return {"status": "ok", "service": "chart-api", "model_default": MODEL}


@app.get("/models", summary="List curated OpenRouter models")
async def list_models():
    """
    Returns the curated model catalog from models.yaml. The frontend uses
    this to render the model picker in the chat composer.
    """
    import yaml  # local import keeps cold start fast for unrelated endpoints
    catalog_path = os.path.join(os.path.dirname(__file__), "models.yaml")
    try:
        with open(catalog_path, "r", encoding="utf-8") as f:
            catalog = yaml.safe_load(f) or {"paid": [], "free": []}
    except FileNotFoundError:
        catalog = {"paid": [], "free": []}
    return {
        "default": MODEL,
        "paid": catalog.get("paid", []),
        "free": catalog.get("free", []),
    }


@app.get("/charts-config", summary="Get Full Chart Configuration")
async def get_charts_config():
    """Returns the complete charts_config JSON object."""
    return charts_config

@app.post("/suggest-charts", response_model=SuggestChartsResponse, summary="Suggest Charts from Prompts")
async def api_suggest_charts(request: SuggestChartsRequest):
    """
    Takes a list of natural language prompts and returns suggested chart types 
    relevant to each request using 'Model 1' logic.
    """
    suggester = ChartSuggester(charts_config)
    results = await suggester.suggest(request.user_prompts)
    return {"suggestions": results}

# @app.post("/build-queries", response_model=BuildQueriesResponse, summary="Validate & Build Chart Queries")
# async def api_build_queries(request: BuildQueriesRequest):
#     """
#     Takes dataset metadata and suggested charts, validates them against requirements,
#     and builds the final query/encoding JSON using 'Model 2' logic.
#     """
#     builder = ChartValidatorAndQueryBuilder(charts_config)
#     final_result = await builder.build_final_charts(request.dataset_metadata, request.suggestions)
#     return final_result
@app.post("/build-queries", response_model=BuildQueriesResponse, summary="Build & Execute Chart Queries")
async def api_build_queries(request: BuildQueriesRequest):
    """Build queries and execute on data-lakehouse"""
    validator = ChartValidatorAndQueryBuilder(charts_config, MODEL)
    
    # Build queries from suggestions
    # charts_with_prompts = [
    #     {"chart_id": s.chart_id, "chart_name": s.chart_name, "user_prompt": f"Visualize using {s.chart_name}"}
    #     for s in request.suggestions
    # ]
    
    result = await validator.build_final_charts(request.dataset_metadata, request.suggestions)
    
    # Execute each query on data-lakehouse
    # final_charts = []
    # Get projectId and tableName from dataset_metadata
    # project_id = request.dataset_metadata.get("projectId")
    # table_name = request.dataset_metadata.get("tableName")
    
    # if not project_id or not table_name:
    #     raise HTTPException(
    #         status_code=400, 
    #         detail="dataset_metadata must include 'projectId' and 'tableName'"
    #     )
    
    # # Replace source placeholder with actual source
    # source_name = f"{project_id}.{table_name}"
    
    for chart in result.get("charts", []):
        try:
            # Convert to QuerySpec format
            query_spec = chart["query"]
            print(f"Executing query for chart {chart['chart_id']}: {query_spec}")
            execution_result = await execute_query_on_datalake(query_spec)
            print(f"Execution result for chart {chart['chart_id']}: {execution_result}")
            # Transform raw lakehouse data to Chart.js format
            chart["data"] = transform_to_chartjs_format(execution_result)
            chart["error"] = None
        except HTTPException as e:
            print(f"HTTPException during execution for chart {chart['chart_id']}: {e.detail}")
            chart["error"] = str(e.detail)
        except Exception as e:
            print(f"General exception during execution for chart {chart['chart_id']}: {str(e)}")
            chart["error"] = f"Execution error: {str(e)}"
        
        # final_charts.append(ChartWithQuery(**chart))
    
    # return BuildQueriesResponse(intent="visualization", charts=final_charts)
    return result

@app.post("/execute-prompt", response_model=ExecutePromptResponse, summary="Execute Chart of Prompt")
async def api_execute_prompt(
    request: ExecutePromptRequest,
    user: dict = Depends(require_user),
):
    """
    Complete flow: Suggest charts → Build queries → Execute on lakehouse
    Now with schema grounding, validation, and fallback handling.
    """
    print(f"[execute-prompt] Request: project={request.project_id}, table={request.table_name}, prompts={request.user_prompts}")
    user_id = user["id"]

    # STEP 1: Fetch schema FIRST (before any LLM calls) via local engine
    try:
        raw_metadata = await fetch_table_columns(
            request.project_id, request.table_name, user_id=user_id
        )
        columns_data = raw_metadata.get("columns", [])
        print(f"[execute-prompt] Fetched {len(columns_data)} columns from lakehouse")
    except Exception as e:
        print(f"[execute-prompt] Failed to fetch schema: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to fetch table schema: {str(e)}")
    
    # STEP 2: Build rich schema profile with types and samples
    # Also fetch a few sample rows for better type inference
    sample_rows = []
    try:
        sample_query = {
            "source": f"{request.project_id}.{request.table_name}",
            "select": [{"column": c.get("column_name") or c.get("name"), "as": c.get("column_name") or c.get("name")} for c in columns_data[:20]],
            "filters": [],
            "groupBy": [],
            "orderBy": [],
            "limit": 100  # Get more rows for ground truth calculation
        }
        sample_result = await execute_query_on_datalake(sample_query, user_id=user_id)
        all_sample_rows = sample_result.get("resultData", [])
        sample_rows = all_sample_rows[:5]
        
        # GROUND_TRUTH: Log all sample data for verification
        print(f"[GROUND_TRUTH] Total rows in sample: {len(all_sample_rows)}")
        print(f"[GROUND_TRUTH] Sample rows (first 5): {sample_rows}")
        
        # Calculate ground truth sums for verification
        if all_sample_rows:
            for col in columns_data:
                col_name = col.get("column_name") or col.get("name")
                try:
                    values = [float(row.get(col_name, 0)) for row in all_sample_rows if isinstance(row.get(col_name), (int, float, str)) and str(row.get(col_name, '')).replace('.','').replace('-','').isdigit()]
                    if values:
                        print(f"[GROUND_TRUTH] Column '{col_name}': sum={sum(values)}, count={len(values)}, sample_values={values[:5]}")
                except Exception as e:
                    pass  # Non-numeric column
                    
        print(f"[execute-prompt] Fetched {len(sample_rows)} sample rows for profiling")
    except Exception as e:
        print(f"[execute-prompt] Could not fetch sample rows: {e}")
    
    schema_profile = build_schema_profile(columns_data, sample_rows)
    print(f"[execute-prompt] Schema profile: {len(schema_profile.get('columns', []))} columns")
    
    # STEP 3: Suggest charts with schema grounding
    suggester = ChartSuggester(charts_config)
    try:
        suggestions = await suggester.suggest(request.user_prompts, schema_profile)
    except Exception as e:
        print(f"[execute-prompt] ChartSuggester error (using fallback): {e}")
        suggestions = suggester._generate_fallback_suggestions(request.user_prompts, schema_profile)
    
    print(f"[execute-prompt] Got {len(suggestions)} suggestion sets")
    
    # STEP 4: Build queries with schema-aware validator
    validator = ChartValidatorAndQueryBuilder(charts_config, MODEL)
    
    # Add schema profile to metadata for query builder
    enhanced_metadata = {
        "columns": schema_profile.get("columns", []),
        "column_names": schema_profile.get("column_names", []),
        "projectId": request.project_id,
        "tableName": request.table_name
    }
    
    try:
        result = await validator.build_final_charts(enhanced_metadata, suggestions)
    except HTTPException as e:
        # Rate limit or LLM error - return fallback result
        print(f"[execute-prompt] QueryBuilder HTTPException (using fallback): {e.detail}")
        result = _build_fallback_charts(suggestions, schema_profile, request.project_id, request.table_name)
    except Exception as e:
        print(f"[execute-prompt] QueryBuilder error (using fallback): {e}")
        result = _build_fallback_charts(suggestions, schema_profile, request.project_id, request.table_name)
    
    # STEP 5: Validate and execute each query
    valid_charts = []
    valid_column_names = set(schema_profile.get("column_names", []))
    
    for chart in result.get("charts", []):
        try:
            # Validate chart has required fields
            if not chart.get("query"):
                print(f"[execute-prompt] Chart {chart.get('chart_id')} missing query, skipping")
                continue
            
            # Validate columns in query exist
            query_spec = chart["query"]
            query_columns = set()
            for sel in query_spec.get("select", []):
                if isinstance(sel, dict):
                    col = sel.get("column", "")
                    if col:
                        query_columns.add(col)
            
            invalid_cols = query_columns - valid_column_names
            if invalid_cols:
                print(f"[execute-prompt] Chart {chart.get('chart_id')} has invalid columns: {invalid_cols}")
                # Try to fix by removing invalid columns
                query_spec["select"] = [s for s in query_spec.get("select", []) 
                                         if isinstance(s, dict) and s.get("column") in valid_column_names]
                if not query_spec["select"]:
                    continue  # Skip if no valid columns left
            
            # Set source and execute
            query_spec["source"] = f"{request.project_id}.{request.table_name}"
            print(f"[execute-prompt] Executing query for chart {chart.get('chart_id')}: {query_spec}")

            execution_result = await execute_query_on_datalake(query_spec, user_id=user_id)
            print(f"[execute-prompt] Result for chart {chart.get('chart_id')}: {len(execution_result.get('resultData', []))} rows")
            
            # Transform to Chart.js format
            chart["data"] = transform_to_chartjs_format(execution_result, chart)
            chart["error"] = None
            valid_charts.append(chart)
            
        except HTTPException as e:
            print(f"[execute-prompt] HTTPException for chart {chart.get('chart_id')}: {e.detail}")
            chart["error"] = str(e.detail)
            chart["data"] = {"labels": [], "datasets": []}
            valid_charts.append(chart)
        except Exception as e:
            print(f"[execute-prompt] Exception for chart {chart.get('chart_id')}: {str(e)}")
            chart["error"] = f"Execution error: {str(e)}"
            chart["data"] = {"labels": [], "datasets": []}
            valid_charts.append(chart)
    
    result["charts"] = valid_charts
    print(f"[execute-prompt] Returning {len(valid_charts)} charts")
    return result


def _build_fallback_charts(suggestions: List[Dict], schema_profile: dict, project_id: str, table_name: str) -> dict:
    """
    Build fallback chart specifications when LLM fails.
    Uses the suggestions from ChartSuggester and builds simple queries.
    """
    charts = []
    columns = schema_profile.get("columns", [])
    numeric_cols = [c["name"] for c in columns if c.get("type") == "numeric"]
    category_cols = [c["name"] for c in columns if c.get("type") in ["category", "string"]]
    date_cols = [c["name"] for c in columns if c.get("type") == "date"]
    
    for suggestion_set in suggestions:
        for chart in suggestion_set.get("chosen_charts", [])[:4]:
            encoding = chart.get("encoding", {})
            x_col = encoding.get("x") or (category_cols[0] if category_cols else (date_cols[0] if date_cols else None))
            y_col = encoding.get("y") or (numeric_cols[0] if numeric_cols else None)
            
            if not y_col:
                continue
            
            # Build simple query
            select_cols = []
            if x_col:
                select_cols.append({"column": x_col, "as": x_col})
            select_cols.append({"column": y_col, "aggregation": "sum", "as": y_col})
            
            query = {
                "source": f"{project_id}.{table_name}",
                "select": select_cols,
                "filters": [],
                "groupBy": [x_col] if x_col else [],
                "orderBy": [{"column": y_col, "direction": "desc"}] if y_col else [],
                "limit": 20
            }
            
            charts.append({
                "user_prompt": suggestion_set.get("user_prompt", ""),
                "chart_id": chart.get("id"),
                "chart_type": chart.get("name"),
                "query": query,
                "encoding": {"x": x_col or "", "y": y_col, "color": ""}
            })
    
    return {"intent": "visualization", "charts": charts[:4]}

@app.get("/schema/{project_id}/{table_name}/columns", summary="Get table columns as {'columns': resultData}")
async def api_get_table_columns(project_id: str, table_name: str):
    """
    Return {"columns": resultData} where resultData comes from data-lakehouse /query/{jobId}.
    """
    try:
        return await fetch_table_columns(project_id, table_name)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _fetch_table_rows(
    project_id: str,
    table_name: str,
    limit: int = 10000,
    user_id: Optional[str] = None,
) -> list[dict]:
    """
    Select all rows from a registered Parquet table. Uses the local
    DuckDB engine when a `user_id` is supplied (the normal path once
    requests are authenticated end-to-end); falls back to the legacy
    lakehouse HTTP hop otherwise so unauthenticated /execute-prompt
    calls keep working during the migration window.
    """
    if user_id:
        # Fast path: in-process DuckDB.
        def _run():
            return get_engine().query(
                user_id=user_id,
                spec={
                    "source": f"{project_id}.{table_name}",
                    "select": ["*"],
                    "limit": int(limit or 10000),
                },
            )["rows"]
        return await asyncio.to_thread(_run)

    # Legacy path — only used by callers that haven't threaded a user
    # id through. Will 502 cleanly once the lakehouse is retired.
    query = {
        "source": f"{project_id}.{table_name}",
        "select": ["*"],
        "limit": int(limit or 10000),
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(f"{DATALAKE_BASE_URL}/query", json=query)
        resp.raise_for_status()
        payload = resp.json()
        job_id = payload.get("jobId")
        if not job_id:
            return payload.get("resultData") or []
        for _ in range(60):
            await asyncio.sleep(1)
            status_resp = await client.get(f"{DATALAKE_BASE_URL}/query/{job_id}")
            status_resp.raise_for_status()
            sp = status_resp.json()
            if sp.get("status") == "completed":
                return sp.get("resultData") or []
            if sp.get("status") == "failed":
                raise RuntimeError(sp.get("message") or "Query failed")
        raise RuntimeError("Query timed out")


# =============================================================================
# Data engine endpoints — DuckDB-backed, local-disk Parquet warehouse.
# Replaces the Spring/Spark/Iceberg/MinIO/RabbitMQ/Redis stack end-to-end.
# =============================================================================


class DataQuerySpec(BaseModel):
    source: str
    select: Optional[List[Any]] = None
    filters: Optional[List[Dict[str, Any]]] = None
    groupBy: Optional[List[str]] = None
    orderBy: Optional[List[Dict[str, Any]]] = None
    limit: Optional[int] = None
    # Escape hatch for the MAX_ROWS cap applied in /data/query. Clients
    # asking for a CSV export pass download=true to bypass the clamp.
    # The engine itself ignores unknown spec keys, so this just rides
    # along through model_dump() without effect on SQL generation.
    download: bool = False


def _safe_table_name(raw: str) -> str:
    """Sanitise a user-supplied table name to the same alphabet storage accepts."""
    import re as _re
    cleaned = _re.sub(r"[^A-Za-z0-9_]+", "_", (raw or "").strip())
    cleaned = _re.sub(r"_+", "_", cleaned).strip("_").lower()
    return cleaned or "untitled"


@app.post("/data/upload", summary="Upload a CSV/XLSX into the warehouse")
async def api_data_upload(
    file: UploadFile = File(...),
    projectId: str = Form("default"),
    tableName: Optional[str] = Form(None),
    user: dict = Depends(require_user),
):
    """
    Accepts a multipart upload and writes the file into the user's warehouse
    as Parquet. Returns the catalog row immediately (no async job).
    """
    name_from_file = os.path.splitext(file.filename or "upload")[0]
    table = _safe_table_name(tableName or name_from_file)
    suffix = os.path.splitext(file.filename or "")[1].lower() or ".csv"
    contents = await file.read()
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp_path = tmp.name
        tmp.write(contents)

    try:
        def _ingest():
            return get_engine().upload_file(
                tmp_path,
                user_id=user["id"],
                project_id=projectId,
                table_name=table,
            )
        row = await asyncio.to_thread(_ingest)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e!r}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    schema = await asyncio.to_thread(
        get_engine().schema,
        user_id=user["id"],
        project_id=projectId,
        table_name=table,
    )
    return {
        "tableName": table,
        "projectId": projectId,
        "rowCount": row.get("row_count"),
        "columns": schema,
        "source": row.get("source"),
    }


@app.post("/data/query", summary="Query a registered table")
async def api_data_query(
    spec: DataQuerySpec,
    user: dict = Depends(require_user),
):
    try:
        spec_dict = spec.model_dump(exclude_none=True)
        # `download` is a transport-level flag, not part of the engine
        # spec. Strip it before forwarding so the engine's spec surface
        # stays clean (and any future strict-mode parsing won't choke).
        download = bool(spec_dict.pop("download", False))

        # Defensive row cap: /data/query materialises the full result
        # set into pandas + JSON. Without a cap a 5M-row query would
        # OOM the worker. All in-tree callers pass an explicit limit,
        # so the clamp only kicks in for ad-hoc/erroneous requests.
        if not download:
            cur_limit = spec_dict.get("limit")
            if cur_limit is None or int(cur_limit) > MAX_ROWS:
                spec_dict["limit"] = MAX_ROWS

        result = await asyncio.to_thread(
            get_engine().query, user_id=user["id"], spec=spec_dict
        )
        # Engine returns {"rows", "rowCount", "columns", "sql"}.
        # Annotate the response so the FE can warn the user and offer
        # the download=true path when the cap actually clipped data.
        row_count = result.get("rowCount")
        if row_count is None and isinstance(result.get("rows"), list):
            row_count = len(result["rows"])
        capped = (not download) and isinstance(row_count, int) and row_count >= MAX_ROWS
        return {**result, "capped": capped}
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {e!r}")


@app.get("/data/tables/{project_id}", summary="List registered tables in a project")
async def api_data_tables(project_id: str, user: dict = Depends(require_user)):
    rows = await asyncio.to_thread(
        get_engine().list_tables, user_id=user["id"], project_id=project_id
    )
    return {"projectId": project_id, "tables": rows}


@app.get("/data/schema/{project_id}/{table_name}", summary="Get columns for a table")
async def api_data_schema(
    project_id: str,
    table_name: str,
    user: dict = Depends(require_user),
):
    try:
        return {
            "projectId": project_id,
            "tableName": table_name,
            "columns": await asyncio.to_thread(
                get_engine().schema,
                user_id=user["id"],
                project_id=project_id,
                table_name=table_name,
            ),
        }
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/data/tables/{project_id}/{table_name}", summary="Drop a table")
async def api_data_drop(
    project_id: str,
    table_name: str,
    user: dict = Depends(require_user),
):
    removed = await asyncio.to_thread(
        get_engine().drop,
        user_id=user["id"],
        project_id=project_id,
        table_name=table_name,
    )
    if not removed:
        raise HTTPException(status_code=404, detail="Table not found")
    return {"removed": True}


# ----- Compat shims at the legacy /api/v1/* paths -----
# These let the frontend point NEXT_PUBLIC_LAKEHOUSE_URL at Chart-API with
# zero other code changes. Emits a Deprecation header so it's easy to grep.

@app.post("/api/v1/upload", summary="[DEPRECATED] Use POST /data/upload")
async def api_v1_upload_shim(
    file: UploadFile = File(...),
    projectId: str = Form("default"),
    tableName: Optional[str] = Form(None),
    userId: Optional[str] = Form(None),  # ignored — we auth via header
    user: dict = Depends(require_user),
):
    result = await api_data_upload(
        file=file, projectId=projectId, tableName=tableName, user=user
    )
    # Old lakehouse shape was {"jobId","status":"queued"}; the frontend now
    # handles both. We return a synthesised job-id-and-status for back-compat.
    return {
        "jobId": f"{user['id']}::{projectId}::{result['tableName']}",
        "status": "completed",
        **result,
    }


@app.get("/api/v1/jobs/{job_id}", summary="[DEPRECATED] Synthetic job status")
async def api_v1_jobs_shim(job_id: str, user: dict = Depends(require_user)):
    # The new engine is synchronous, so any job a client ever got from
    # /api/v1/upload is already complete. Return 'completed' so the
    # legacy poll loop short-circuits immediately.
    return {"jobId": job_id, "status": "completed"}


@app.post("/api/v1/query", summary="[DEPRECATED] Use POST /data/query")
async def api_v1_query_shim(spec: DataQuerySpec, user: dict = Depends(require_user)):
    result = await api_data_query(spec=spec, user=user)
    return {"jobId": "inline", "status": "completed", "resultData": result["rows"], **result}


@app.get("/api/v1/query/{job_id}", summary="[DEPRECATED] Synthetic query status")
async def api_v1_query_status_shim(job_id: str, user: dict = Depends(require_user)):
    return {"jobId": job_id, "status": "completed", "resultData": []}


@app.get("/api/v1/schema/{project_id}/{table_name}", summary="[DEPRECATED] Use GET /data/schema/...")
async def api_v1_schema_shim(
    project_id: str,
    table_name: str,
    user: dict = Depends(require_user),
):
    result = await api_data_schema(project_id, table_name, user)
    # Legacy shape: {status, resultData:[...]} so ChartSuggester keeps working.
    return {"jobId": "inline", "status": "completed", "resultData": result["columns"]}


# =============================================================================
# Connector endpoints — called by user-auth with the decrypted config.
# The frontend never reaches these directly; user-auth is the gatekeeper.
# =============================================================================


class ConnectorRequest(BaseModel):
    type: str
    config: Dict[str, Any]


class ConnectorIngestRequest(BaseModel):
    type: str
    config: Dict[str, Any]
    projectId: str
    tables: List[Dict[str, Any]]
    connectorName: str = "source"


class ConnectorListColumnsRequest(BaseModel):
    # `schema` is a reserved attribute on BaseModel — alias the field so callers
    # can still send `{"schema": "public"}` while we read it as `schema_name`.
    model_config = ConfigDict(populate_by_name=True)

    type: str
    config: Dict[str, Any]
    schema_name: Optional[str] = Field(default=None, alias="schema")
    name: str


class ConnectorRunSqlRequest(BaseModel):
    type: str
    config: Dict[str, Any]
    sql: str
    row_limit: int = 10000
    timeout_sec: int = 10


@app.get("/connectors/types", summary="Supported connector types")
async def api_connector_types():
    return {"types": sorted(set(CONNECTOR_REGISTRY.keys()))}


# Tiny in-memory TTL cache for /connectors/list-columns. Source DBs don't
# change schema often; caching shaves the round-trip when the user expands
# many tables in the manage drawer in one sitting.
#
# Keyed by (user_id, type, sha256(config_json), schema, name). On
# /connectors/test we wipe the user's cache because test is the natural
# moment a credential change might invalidate cached results.
import hashlib as _hashlib
import json as _json
import time as _time

_COLUMNS_CACHE: Dict[str, tuple[float, list]] = {}
_COLUMNS_CACHE_TTL = float(os.environ.get("COLUMNS_CACHE_TTL_SEC", "300") or 300)


def _columns_cache_key(user_id: str, type_: str, config: dict, schema: Optional[str], name: str) -> str:
    h = _hashlib.sha256(
        _json.dumps(config, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
    return f"{user_id}:{type_}:{h}:{schema or ''}:{name}"


def _columns_cache_invalidate_user(user_id: str) -> None:
    prefix = f"{user_id}:"
    for k in [k for k in _COLUMNS_CACHE if k.startswith(prefix)]:
        _COLUMNS_CACHE.pop(k, None)


@app.post("/connectors/test", summary="Test a connector's credentials")
async def api_connector_test(req: ConnectorRequest, user: dict = Depends(require_user)):
    try:
        ingester = get_ingester(req.type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    result = await asyncio.to_thread(ingester.test, req.config)
    # Credentials may have changed — wipe cached columns for this user so
    # the next /list-columns call goes back to the source.
    _columns_cache_invalidate_user(user["id"])
    return result


@app.post("/connectors/list-tables", summary="List source tables from a connector")
async def api_connector_list_tables(
    req: ConnectorRequest, user: dict = Depends(require_user)
):
    try:
        ingester = get_ingester(req.type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        rows = await asyncio.to_thread(ingester.list_tables, req.config)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"tables": rows}


@app.post("/connectors/list-columns", summary="List columns of a single source table")
async def api_connector_list_columns(
    req: ConnectorListColumnsRequest, user: dict = Depends(require_user)
):
    try:
        ingester = get_ingester(req.type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Cache hit?
    cache_key = _columns_cache_key(user["id"], req.type, req.config, req.schema_name, req.name)
    cached = _COLUMNS_CACHE.get(cache_key)
    if cached is not None:
        ts, cols = cached
        if _time.monotonic() - ts < _COLUMNS_CACHE_TTL:
            return {"columns": cols, "cached": True}

    try:
        cols = await asyncio.to_thread(
            ingester.list_columns, req.config, req.schema_name, req.name
        )
    except NotImplementedError:
        raise HTTPException(
            status_code=501,
            detail=f"list_columns not supported for {req.type}",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    _COLUMNS_CACHE[cache_key] = (_time.monotonic(), cols)
    return {"columns": cols}


@app.post("/connectors/run-sql", summary="Run a read-only SELECT against the source DB")
async def api_connector_run_sql(
    req: ConnectorRunSqlRequest, user: dict = Depends(require_user)
):
    """Live-mode read against the source DB. The SQL is rejected unless it
    starts with SELECT/WITH and contains no obvious write verbs; a LIMIT
    is injected if missing; per-driver timeouts are applied. Mongo refuses."""
    try:
        ingester = get_ingester(req.type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        result = await asyncio.to_thread(
            ingester.run_sql,
            req.config,
            req.sql,
            row_limit=int(req.row_limit or 10000),
            timeout_sec=int(req.timeout_sec or 10),
        )
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return result


class WidgetQueryRequest(BaseModel):
    project_id: str
    table_name: str
    fields: Dict[str, Any]
    chart_type: str
    row_limit: int = 5000
    title: Optional[str] = None


@app.post("/widget/query", summary="Run an aggregated query for a board widget")
async def api_widget_query(
    req: WidgetQueryRequest, user: dict = Depends(require_user)
):
    """Aggregate `(project_id, table_name)` per the request fields and
    return a ChartSpec ready to render. The same shape powers both the
    builder's live preview and the saved widget refresh."""
    engine = get_engine()
    try:
        spec = await asyncio.to_thread(
            build_widget_chart_spec,
            engine=engine,
            user_id=user["id"],
            project_id=req.project_id,
            table_name=req.table_name,
            fields=req.fields,
            chart_type=req.chart_type,
            row_limit=req.row_limit,
            title=req.title,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"chartSpec": spec}


class WidgetQueryInternalRequest(WidgetQueryRequest):
    user_id: str  # explicit owner, since the requester is unauthenticated


@app.post(
    "/widget/query-internal",
    summary="Server-to-server widget query for unauthenticated public boards",
)
async def api_widget_query_internal(
    req: WidgetQueryInternalRequest,
    _ok: bool = Depends(require_internal),
):
    """Same query shape as /widget/query but trusts the caller's `user_id`.
    Used by the Node gateway to fulfill public-board widget refreshes —
    the gateway resolves the dashboard owner, then calls this with their
    user_id and the shared secret."""
    engine = get_engine()
    try:
        spec = await asyncio.to_thread(
            build_widget_chart_spec,
            engine=engine,
            user_id=req.user_id,
            project_id=req.project_id,
            table_name=req.table_name,
            fields=req.fields,
            chart_type=req.chart_type,
            row_limit=req.row_limit,
            title=req.title,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"chartSpec": spec}


@app.post("/connectors/ingest", summary="Ingest source tables into the warehouse")
async def api_connector_ingest(
    req: ConnectorIngestRequest, user: dict = Depends(require_user)
):
    try:
        ingester = get_ingester(req.type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        results = await asyncio.to_thread(
            ingester.ingest,
            req.config,
            req.tables,
            user_id=user["id"],
            project_id=req.projectId,
            connector_name=req.connectorName,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ingest failed: {e!r}")
    return {"ingested": results}


# =============================================================================


@app.post("/execute-code-prompt", summary="Thinking mode: stream agent events over SSE")
async def api_execute_code_prompt(
    request: ExecuteCodePromptRequest,
    user: dict = Depends(require_user),
    x_auth_token: Optional[str] = Header(None),
):
    """
    Run the thinking-mode code agent against a table. Returns an SSE stream.
    Each event is a JSON object; consumers should parse on newline boundaries.
    """
    model_id = request.model_id or MODEL
    user_id = user["id"]

    # D3: Build the sources list from optional attachments[]. The first
    # source drives the sandbox (single-source loading); the full list
    # gets surfaced to the LLM via the system prompt so it can reference
    # sources by alias. Empty/missing attachments fall back to the
    # legacy single (project_id, table_name) pair from the request.
    sources: list[dict] = []
    live_sources: list[dict] = []
    if request.attachments:
        for a in request.attachments:
            if a.kind == 'connector_table' and a.project_id and a.table_name:
                sources.append({
                    'project_id': a.project_id,
                    'table_name': a.table_name,
                    'alias': a.alias or f'{a.project_id}.{a.table_name}',
                })
            elif a.kind == 'connector_live' and a.connector_id:
                # Phase 7 — agent gets a run_sql tool against this connector.
                live_sources.append({
                    'connector_id': a.connector_id,
                    'alias': a.alias or a.connector_id,
                    'type': a.connector_type or 'unknown',
                })
            elif a.kind == 'file' and a.file_id:
                # Future: resolve file_id -> (project_id, table_name) via
                # catalog. For D3 we skip; the existing single-source
                # fallback handles it.
                pass
    if not sources:
        # If the FE sent file attachments (whose project_id/table_name we
        # don't yet resolve via the catalog), at least propagate the alias
        # so the system prompt can refer to the file by its user-set name.
        fallback_alias = None
        if request.attachments:
            files = [a for a in request.attachments if a.kind == 'file' and a.alias]
            if len(files) == 1:
                fallback_alias = files[0].alias
        sources = [{
            'project_id': request.project_id,
            'table_name': request.table_name,
            'alias': fallback_alias,
        }]

    primary = sources[0]
    primary_project_id = primary['project_id']
    primary_table_name = primary['table_name']

    # Per-run artifact directory. The hex run_id keeps Storage._safe happy
    # and avoids any chance of path traversal. We resolve it once at the
    # handler boundary so the SSE generator can reference both values.
    run_id = uuid.uuid4().hex
    try:
        persistent = runs_dir(str(user_id), run_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid run path: {e}")

    async def event_source():
        def sse(evt: dict) -> bytes:
            # Text/event-stream wants `data: <json>\n\n`; we use a single
            # line-per-event encoding that fetch()+getReader on the client
            # can parse.
            return f"data: {json.dumps(evt, default=str)}\n\n".encode("utf-8")

        try:
            # 1. schema (local DuckDB, user-scoped)
            cols_payload = await fetch_table_columns(
                primary_project_id, primary_table_name, user_id=user_id
            )
            schema = cols_payload.get("columns") or []
            # 2. rows (same)
            rows = await _fetch_table_rows(
                primary_project_id,
                primary_table_name,
                limit=request.row_limit or 10000,
                user_id=user_id,
            )
        except HTTPException as e:
            yield sse({"type": "error", "message": str(e.detail)})
            yield sse({"type": "done"})
            return
        except Exception as e:
            yield sse({"type": "error", "message": f"Failed to load data: {e!r}"})
            yield sse({"type": "done"})
            return

        # Phase 7b — pre-fetch rows + schema for non-primary attachments so
        # the sandbox can expose each via df_for(alias). Best-effort: a
        # failed sub-fetch shouldn't block the primary chat.
        extra_sources: list[dict] = []
        for src in sources[1:]:
            try:
                ex_cols = await fetch_table_columns(
                    src["project_id"], src["table_name"], user_id=user_id
                )
                ex_rows = await _fetch_table_rows(
                    src["project_id"],
                    src["table_name"],
                    limit=min(request.row_limit or 10000, 5000),
                    user_id=user_id,
                )
                extra_sources.append({
                    "alias": src.get("alias") or f"{src['project_id']}.{src['table_name']}",
                    "table_name": src["table_name"],
                    "rows": ex_rows,
                    "schema": ex_cols.get("columns") or [],
                })
            except Exception as ex:
                # Don't crash; just note the skip in the stream.
                yield sse({
                    "type": "stderr",
                    "text": f"[df_for] Skipping alias {src.get('alias')!r}: {ex!r}",
                })

        yield sse({
            "type": "ready",
            "table": primary_table_name,
            "rows": len(rows),
            "columns": len(schema),
            "model": model_id,
            "run_id": run_id,
            "extra_sources": [
                {"alias": s["alias"], "table": s["table_name"], "rows": len(s["rows"])}
                for s in extra_sources
            ],
        })

        ctx = AgentContext(
            prompt=request.prompt,
            rows=rows,
            schema=schema,
            table_name=primary_table_name,
            system_prompt=request.system_prompt,
            memories=request.memories,
            live_sources=live_sources or None,
            auth_token=x_auth_token,
            extra_sources=extra_sources or None,
        )

        try:
            async for evt in run_code_agent(
                ctx,
                CLIENT,
                model=model_id,
                run_id=run_id,
                persistent_dir=persistent,
                sources=sources,
            ):
                yield sse(evt)
        except Exception as e:
            yield sse({"type": "error", "message": f"Agent crashed: {e!r}"})
            yield sse({"type": "done"})

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/runs/{user_id}/{run_id}/{filename}", summary="Thinking mode: fetch a run artifact")
async def api_get_run_file(
    user_id: str,
    run_id: str,
    filename: str,
    user=Depends(require_user),
):
    """
    Serve a single artifact (chart PNG, step_N.py, result.md, …) from a
    completed thinking-mode run. Auth-gated, tenant-scoped, and
    path-traversal-safe — the resolved file path must stay inside the
    user's runs directory.
    """
    if str(user["id"]) != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        base = runs_dir(user_id, run_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    target = (base / filename).resolve()
    base_resolved = base.resolve()
    if not str(target).startswith(str(base_resolved)):
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(target)


# --- Run the Application ---
if __name__ == "__main__":
    print("Starting FastAPI server...")
    print("API documentation available at http://localhost:8000/docs")
    # loop="asyncio" forces Python's SelectorEventLoop on Windows instead
    # of the default ProactorEventLoop. Proactor interacts badly with
    # uvicorn's HTTP handling for multipart/form-data uploads — requests
    # arrive but responses never flush. h11 instead of httptools keeps
    # the HTTP parser pure-Python and deterministic on Windows.
    import sys as _sys
    if _sys.platform == "win32":
        import asyncio as _asyncio
        _asyncio.set_event_loop_policy(_asyncio.WindowsSelectorEventLoopPolicy())
    uvicorn.run(app, host="0.0.0.0", port=8000, loop="asyncio", http="h11")
    print(MODEL)