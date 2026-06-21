import Link from "next/link";
import ChatMock from "@/components/landing/ChatMock";
import ThemeToggle from "@/components/landing/ThemeToggle";
import VizGallery from "@/components/landing/VizGallery";

const connectors = [
  "CSV",
  "Excel",
  "PostgreSQL",
  "MySQL",
  "SQL Server",
  "BigQuery",
  "Snowflake",
  "Redshift",
  "MongoDB",
  "Oracle",
];

const features = [
  {
    title: "Thinking Mode",
    body: "Ask 'why are Q3 sales dropping in the northeast?' and get a written analysis — with the code, the output, and the reasoning. Not just a chart.",
    badge: "Agentic",
  },
  {
    title: "Visual Mode",
    body: "For the quick win, just ask. Vanta picks the right chart from 20+ types automatically and renders it live.",
    badge: "Fast",
  },
  {
    title: "Multi-model chat",
    body: "Claude 4.7, GPT-5, Gemini 2.5 Pro, Llama 4 — or free models from MiniMax, Nemotron, Gemma. Switch per turn.",
    badge: "Flexible",
  },
  {
    title: "Dashboards",
    body: "Pin any chart from a conversation. Drag, resize, share via signed link. Refresh on demand.",
    badge: "Sharable",
  },
  {
    title: "Teams & roles",
    body: "Owner, Admin, Member, Viewer. Invite with email. Share datasets and dashboards with the right people.",
    badge: "Collaborative",
  },
  {
    title: "Any data source",
    body: "CSV, multi-sheet Excel, and six database connectors. Alias tables and columns in business terms the AI uses.",
    badge: "Universal",
  },
];

const steps = [
  {
    n: "01",
    title: "Connect your data",
    body: "Drop a CSV or XLSX, or plug a database into one of six connectors. Vanta ingests it into a fast columnar store.",
  },
  {
    n: "02",
    title: "Ask in plain English",
    body: "Type a question. Pick Visual for a chart, Thinking for analysis with code and reasoning.",
  },
  {
    n: "03",
    title: "Pin, share, iterate",
    body: "Save your best answers to a dashboard. Share by link. Invite the team. Keep asking better questions.",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* NAV */}
      <header className="fixed top-0 inset-x-0 z-50 backdrop-blur-md bg-(--bg-primary)/80 border-b border-(--border-secondary)">
        <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="w-7 h-7 rounded-md bg-vanta-neon text-black flex items-center justify-center font-black text-sm">
              V
            </span>
            <span className="text-lg">Vanta</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm text-(--text-secondary)">
            <a href="#features" className="hover:text-(--text-primary) transition-colors">Features</a>
            <a href="#gallery" className="hover:text-(--text-primary) transition-colors">Gallery</a>
            <a href="#how" className="hover:text-(--text-primary) transition-colors">How it works</a>
            <a href="#pricing" className="hover:text-(--text-primary) transition-colors">Pricing</a>
          </nav>
          <div className="flex items-center gap-2 md:gap-3">
            <ThemeToggle />
            <Link
              href="/login"
              className="text-sm text-(--text-secondary) hover:text-(--text-primary) transition-colors px-3 py-1.5 hidden sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="text-sm font-semibold bg-vanta-neon text-black px-4 py-2 rounded-lg hover:bg-vanta-neon/90 transition-colors"
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative pt-32 pb-24 overflow-hidden">
        {/* Background gradient wash */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(188,255,60,0.12), transparent 60%), radial-gradient(ellipse 40% 30% at 80% 40%, rgba(188,255,60,0.06), transparent 60%)",
          }}
        />
        {/* Grid */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage:
              "radial-gradient(ellipse at center, black 40%, transparent 70%)",
          }}
        />

        <div className="relative mx-auto max-w-7xl px-6 grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-vanta-neon/30 bg-vanta-neon/5 px-3 py-1 text-xs font-medium text-vanta-neon mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-vanta-neon animate-pulse" />
              Thinking Mode is here
            </div>

            <h1
              className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.02] mb-6"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Chat with your data.
              <br />
              <span className="text-vanta-neon">Get answers,</span> not dashboards.
            </h1>

            <p className="text-lg md:text-xl text-(--text-muted) max-w-xl leading-relaxed mb-10">
              Connect any source. Ask anything in plain language. Vanta writes code,
              runs it, and shows you the insight — visual or deep-dive, your call.
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <Link
                href="/signup"
                className="group inline-flex items-center gap-2 bg-vanta-neon text-black font-bold px-6 py-3.5 rounded-xl hover:bg-vanta-neon/90 transition-all hover:scale-[1.02] shadow-lg shadow-vanta-neon/20"
              >
                Start free
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="transition-transform group-hover:translate-x-0.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
              <a
                href="#features"
                className="inline-flex items-center gap-2 border border-(--border-primary) text-(--text-primary) px-6 py-3.5 rounded-xl hover:bg-(--bg-hover) transition-colors"
              >
                See how it works
              </a>
            </div>

            <p className="mt-6 text-sm text-(--text-muted)">
              No credit card. Free models included.
            </p>
          </div>

          <div className="flex justify-center lg:justify-end">
            <ChatMock />
          </div>
        </div>
      </section>

      {/* CONNECTORS STRIP */}
      <section id="connectors" className="py-16 border-y border-(--border-secondary) bg-(--bg-secondary)/50">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-center text-xs uppercase tracking-[0.2em] text-(--text-muted) mb-8">
            Works with everything
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {connectors.map((c) => (
              <span
                key={c}
                className="text-(--text-muted) hover:text-(--text-primary) transition-colors font-medium text-sm md:text-base"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* STATS STRIP */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-10">
            {[
              { n: "20+", l: "Chart types" },
              { n: "6", l: "DB connectors" },
              { n: "13", l: "LLM models" },
              { n: "2M", l: "Token context" },
            ].map((s, i) => (
              <div
                key={s.l}
                className="text-center py-6 rounded-2xl border border-(--border-primary) bg-(--bg-secondary)/40 hover:border-vanta-neon/40 hover:bg-(--bg-secondary) transition-all"
                style={{ animation: `slideUp 600ms ease-out ${i * 100}ms both` }}
              >
                <div
                  className="text-4xl md:text-5xl font-bold text-vanta-neon mb-1"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {s.n}
                </div>
                <div className="text-xs md:text-sm text-(--text-muted) uppercase tracking-wider">
                  {s.l}
                </div>
              </div>
            ))}
          </div>
          <style>{`@keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="py-32">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-2xl mb-16">
            <p className="text-sm font-semibold text-vanta-neon tracking-wider uppercase mb-3">
              Capabilities
            </p>
            <h2
              className="text-4xl md:text-5xl font-bold tracking-tight mb-4"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              From question to insight, in seconds.
            </h2>
            <p className="text-(--text-muted) text-lg">
              Every feature built around the question &ldquo;what&rsquo;s going on with my data?&rdquo;
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f) => (
              <div
                key={f.title}
                className="group relative rounded-2xl border border-(--border-primary) bg-(--bg-secondary) hover:bg-(--bg-hover) hover:border-vanta-neon/30 transition-all p-7 overflow-hidden"
              >
                {/* Corner glow */}
                <div
                  aria-hidden
                  className="absolute -top-20 -right-20 w-40 h-40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  style={{ background: "radial-gradient(circle, rgba(188,255,60,0.2), transparent 70%)" }}
                />
                <div className="relative">
                  <span className="inline-block text-[10px] uppercase tracking-widest font-semibold text-vanta-neon bg-vanta-neon/10 border border-vanta-neon/20 rounded px-2 py-0.5 mb-4">
                    {f.badge}
                  </span>
                  <h3 className="text-xl font-bold mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                    {f.title}
                  </h3>
                  <p className="text-(--text-muted) text-sm leading-relaxed">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* VIZ GALLERY */}
      <section id="gallery" className="py-32 border-t border-(--border-secondary) bg-(--bg-secondary)/30 relative overflow-hidden">
        {/* ambient */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 60% 30% at 50% 0%, rgba(188,255,60,0.06), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-5xl px-6">
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <p className="text-sm font-semibold text-vanta-neon tracking-wider uppercase mb-3">
              Live preview
            </p>
            <h2
              className="text-4xl md:text-5xl font-bold tracking-tight mb-4"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Every chart type, ready on demand.
            </h2>
            <p className="text-(--text-muted) text-lg">
              The agent picks the right visualisation for your question. Here are six common shapes — click to preview.
            </p>
          </div>
          <VizGallery />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="py-32 border-t border-(--border-secondary)">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-2xl mb-16">
            <p className="text-sm font-semibold text-vanta-neon tracking-wider uppercase mb-3">
              How it works
            </p>
            <h2
              className="text-4xl md:text-5xl font-bold tracking-tight"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Three steps. That&rsquo;s it.
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((s) => (
              <div key={s.n} className="relative">
                <div className="text-vanta-neon/80 font-mono text-sm mb-4">{s.n}</div>
                <h3 className="text-2xl font-bold mb-3" style={{ fontFamily: "var(--font-heading)" }}>
                  {s.title}
                </h3>
                <p className="text-(--text-muted) leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-32 border-t border-(--border-secondary)">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center mb-14 max-w-2xl mx-auto">
            <p className="text-sm font-semibold text-vanta-neon tracking-wider uppercase mb-3">
              Pricing
            </p>
            <h2
              className="text-4xl md:text-5xl font-bold tracking-tight mb-4"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Free to start. Pay when you scale.
            </h2>
            <p className="text-(--text-muted) text-lg">
              Free models built in. Bring your own OpenRouter key for the paid frontier models.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {/* Free */}
            <div className="relative rounded-3xl border border-(--border-primary) bg-(--bg-secondary)/60 p-8">
              <h3 className="text-2xl font-bold mb-1" style={{ fontFamily: "var(--font-heading)" }}>
                Free
              </h3>
              <p className="text-(--text-muted) text-sm mb-6">
                Everything you need to start asking questions.
              </p>
              <div className="text-4xl font-bold mb-6" style={{ fontFamily: "var(--font-heading)" }}>
                $0<span className="text-base font-normal text-(--text-muted)"> / forever</span>
              </div>
              <ul className="space-y-3 text-sm text-(--text-secondary) mb-8">
                <li className="flex gap-2"><Check /> 8 free OpenRouter models (MiniMax, Nemotron, Gemma, LFM…)</li>
                <li className="flex gap-2"><Check /> CSV &amp; Excel upload</li>
                <li className="flex gap-2"><Check /> Visual &amp; Thinking mode</li>
                <li className="flex gap-2"><Check /> Personal dashboards</li>
                <li className="flex gap-2"><Check /> Up to 100 MB per file</li>
              </ul>
              <Link
                href="/signup"
                className="block w-full text-center py-3 rounded-xl border border-(--border-primary) hover:border-vanta-neon hover:bg-(--bg-hover) transition-all font-semibold"
              >
                Start free
              </Link>
            </div>

            {/* Pro */}
            <div className="relative rounded-3xl border-2 border-vanta-neon/50 bg-vanta-neon/5 p-8 overflow-hidden">
              <div
                aria-hidden
                className="absolute -top-24 -right-24 w-56 h-56 rounded-full blur-3xl pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(188,255,60,0.25), transparent 70%)" }}
              />
              <div className="relative">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-2xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
                    Pro
                  </h3>
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-vanta-neon bg-vanta-neon/10 border border-vanta-neon/30 rounded px-2 py-0.5">
                    Recommended
                  </span>
                </div>
                <p className="text-(--text-muted) text-sm mb-6">
                  Frontier models, every connector, team sharing.
                </p>
                <div className="text-4xl font-bold mb-6" style={{ fontFamily: "var(--font-heading)" }}>
                  Your key<span className="text-base font-normal text-(--text-muted)"> / pass-through</span>
                </div>
                <ul className="space-y-3 text-sm text-(--text-secondary) mb-8">
                  <li className="flex gap-2"><Check /> Everything in Free</li>
                  <li className="flex gap-2"><Check /> Claude 4.7, GPT-5, Gemini 2.5 Pro, Llama 4</li>
                  <li className="flex gap-2"><Check /> All 6 DB connectors (Postgres, Mongo, BigQuery…)</li>
                  <li className="flex gap-2"><Check /> Team workspaces &amp; role-based access</li>
                  <li className="flex gap-2"><Check /> Share dashboards via signed link</li>
                </ul>
                <Link
                  href="/signup"
                  className="block w-full text-center py-3 rounded-xl bg-vanta-neon text-black font-bold hover:bg-vanta-neon/90 transition-all shadow-md shadow-vanta-neon/30"
                >
                  Start free, upgrade later
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-32">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <div className="relative rounded-3xl border border-vanta-neon/20 bg-linear-to-b from-vanta-neon/5 to-transparent p-12 md:p-16 overflow-hidden">
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none opacity-40"
              style={{
                background:
                  "radial-gradient(ellipse at center, rgba(188,255,60,0.15), transparent 60%)",
              }}
            />
            <div className="relative">
              <h2
                className="text-4xl md:text-5xl font-bold tracking-tight mb-4"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                Ready to see your data talk?
              </h2>
              <p className="text-(--text-muted) text-lg mb-8 max-w-xl mx-auto">
                Start with a free model, upload a CSV, ask your first question.
                Nothing to install.
              </p>
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 bg-vanta-neon text-black font-bold px-7 py-4 rounded-xl hover:bg-vanta-neon/90 transition-all hover:scale-[1.02] shadow-lg shadow-vanta-neon/30"
              >
                Create your account
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-(--border-secondary) py-10">
        <div className="mx-auto max-w-7xl px-6 flex flex-wrap items-center justify-between gap-4 text-sm text-(--text-muted)">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded bg-vanta-neon text-black flex items-center justify-center font-black text-[10px]">
              V
            </span>
            <span>© {new Date().getFullYear()} Vanta</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/login" className="hover:text-(--text-primary) transition-colors">Sign in</Link>
            <Link href="/signup" className="hover:text-(--text-primary) transition-colors">Sign up</Link>
            <a href="https://github.com/Aymona777/Data-Vanta" target="_blank" rel="noreferrer" className="hover:text-(--text-primary) transition-colors">GitHub</a>
          </div>
        </div>
      </footer>
    </>
  );
}

function Check() {
  return (
    <span className="flex-none w-5 h-5 rounded-full bg-vanta-neon/15 border border-vanta-neon/40 flex items-center justify-center">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#BCFF3C" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}
