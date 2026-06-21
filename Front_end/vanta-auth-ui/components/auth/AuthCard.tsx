import styles from "@/app/(auth)/auth.module.css";

export function AuthCard({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.logoRow}>
        <div className={styles.logoMark} />
        <span className={styles.logoText}>Vanta</span>
      </div>
      <h2 className={styles.heading}>{title}</h2>
      {subtitle && <p className={styles.sub}>{subtitle}</p>}
      {children}
    </div>
  );
}
