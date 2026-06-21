import AuthScaffold from "../AuthScaffold";

export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthScaffold
      heroTitle="Start your data journey — chat, analyze, and predict with Vanta"
      heroText="Join a new way of working with data. With Vanta, you can explore, visualize, and forecast insights just by chatting. No dashboards, no code — just clear answers powered by AI."
    >
      {children}
    </AuthScaffold>
  );
}
