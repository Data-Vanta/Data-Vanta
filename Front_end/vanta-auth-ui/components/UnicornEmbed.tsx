"use client";
import { useEffect } from "react";

// Extend Window interface for UnicornStudio
declare global {
  interface Window {
    UnicornStudio?: {
      init: () => void;
      isInitialized?: boolean;
    };
  }
}

export default function UnicornEmbed() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!document.getElementById("unicorn-sdk")) {
      const script = document.createElement("script");
      script.id = "unicorn-sdk";
      script.type = "text/javascript";
      script.src =
        "https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v1.4.34/dist/unicornStudio.umd.js";

      script.onload = () => {
        if (window.UnicornStudio && !window.UnicornStudio.isInitialized) {
          window.UnicornStudio.init();
          window.UnicornStudio.isInitialized = true;
        }
      };

      script.onerror = () => {
        console.warn("Failed to load UnicornStudio script.");
      };

      (document.head || document.body).appendChild(script);
    } else {
      if (window.UnicornStudio && !window.UnicornStudio.isInitialized) {
        window.UnicornStudio.init();
        window.UnicornStudio.isInitialized = true;
      }
    }
  }, []);

  return (
    <div
      data-us-project="bV89mgjmy3dtUjMrJ09y"
      style={{ width: "135%", height: "125%" }}
    />
  );
}
