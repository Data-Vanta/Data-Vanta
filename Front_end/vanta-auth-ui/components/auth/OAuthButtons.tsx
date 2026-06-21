"use client";
import Image from "next/image";
import styles from "@/app/(auth)/auth.module.css";
import { Button } from "@/components/ui/Button";

export function OAuthButtons() {
  return (
    <div className={styles.oauthRow}>
      <Button type="button" variant="ghost" full style={{ gap: 8 }}>
        <Image
          src="/logos/google.svg"
          alt=""
          width={18}
          height={18}
          style={{ opacity: 0.9 }}
        />
        Google
      </Button>
      <Button type="button" variant="ghost" full style={{ gap: 8 }}>
        <Image
          src="/logos/apple.svg"
          alt=""
          width={18}
          height={18}
          style={{ opacity: 0.9 }}
        />
        Apple
      </Button>
    </div>
  );
}
