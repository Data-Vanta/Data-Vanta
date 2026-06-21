import type { ApiErrorResponse, ApiSuccessResponse } from "./types";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function postJSON<T>(
  url: string,
  body: unknown
): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const json: ApiSuccessResponse<T> | ApiErrorResponse = await res
      .json()
      .catch(() => ({}));

    if (!res.ok) {
      let errorMessage = `HTTP Error: ${res.status}`;
      // Prefer the detailed errors array if present, then fall back to message
      if (json && "errors" in json && Array.isArray(json.errors)) {
        errorMessage = json.errors.join(", ");
      } else if (json && "message" in json && typeof json.message === "string") {
        errorMessage = json.message;
      }
      return { ok: false, error: errorMessage };
    }

    // Some backends return 200 with status:"fail" in the body
    if (json.status === "fail" || json.status === "error") {
      const errorMsg =
        (json as ApiErrorResponse).message || "An unknown error occurred.";
      return { ok: false, error: errorMsg };
    }

    return { ok: true, data: (json as ApiSuccessResponse<T>).data };
  } catch (e: unknown) {
    let message = "Network error. Please check your connection.";
    if (e instanceof Error) {
      message = e.message;
    }
    return { ok: false, error: message };
  }
}
