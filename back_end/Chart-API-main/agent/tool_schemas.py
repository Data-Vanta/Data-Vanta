"""OpenAI/OpenRouter function-call schemas for the thinking-mode agent."""
from __future__ import annotations

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "run_python",
            "description": (
                "Run pandas / matplotlib Python code inside a sandboxed subprocess. "
                "The active dataframe is pre-loaded as `df`. To return structured "
                "output, call `result({'key': value, ...})`. "
                "Import network/subprocess/ctypes modules is not allowed. "
                "Timeout: 20 seconds, memory: 2GB."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "The Python source to execute. df is a pandas DataFrame.",
                    },
                    "thought": {
                        "type": "string",
                        "description": "One sentence explaining why you're running this code. Shown to the user.",
                    },
                },
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_sql",
            "description": (
                "Run a read-only SELECT against a live source database via "
                "the user's saved connector. Returns up to 10000 rows as "
                "{columns, rows}. Use this when the chat has live_sources "
                "listed in the system prompt (each entry has connector_id "
                "and alias). The query is rejected unless it starts with "
                "SELECT or WITH; LIMIT is auto-applied. NOT available for "
                "MongoDB. After getting the result, use run_python to "
                "wrap it in a DataFrame for further analysis."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "connector_id": {
                        "type": "string",
                        "description": "The connector_id from a live_sources entry.",
                    },
                    "sql": {
                        "type": "string",
                        "description": "A read-only SELECT or WITH ... SELECT statement.",
                    },
                    "thought": {
                        "type": "string",
                        "description": "One sentence on what you're querying for.",
                    },
                },
                "required": ["connector_id", "sql"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "final_answer",
            "description": (
                "Emit the final natural-language answer to the user. "
                "Use this ONLY after gathering enough evidence via run_python. "
                "Do not continue generating tool calls after this."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "answer": {
                        "type": "string",
                        "description": "The user-facing explanation. Markdown supported.",
                    },
                },
                "required": ["answer"],
            },
        },
    },
]
