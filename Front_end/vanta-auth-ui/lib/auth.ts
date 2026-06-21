"use client";

export function logout() {
    // 1. Clear cookie (client-side)
    // Note: Middleware also clears if it detects invalid token, but explicit logout is checking "max-age=0"
    document.cookie = "token=; path=/; max-age=0; SameSite=Strict";

    // 2. Clear localStorage if used
    if (typeof window !== "undefined") {
        localStorage.removeItem("authToken");
        localStorage.removeItem("user");
    }

    // 3. Redirect to login
    window.location.href = "/login";
}
