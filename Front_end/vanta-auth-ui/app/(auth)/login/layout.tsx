import AuthScaffold from "../AuthScaffold";

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthScaffold
      heroTitle="Vanta — where data talks back"
      heroText="Continue your journey of smarter analytics. Vanta helps you turn complex data into simple, meaningful insights — all through natural conversation."
    >
      {children}
    </AuthScaffold>
  );
}
