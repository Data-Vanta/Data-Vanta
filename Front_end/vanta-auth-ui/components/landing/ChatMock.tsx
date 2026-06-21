"use client";
import { useEffect, useState } from "react";

type Turn = {
  role: "user" | "assistant";
  text: string;
  chart?: "bar" | "line" | "pie";
};

const script: Turn[] = [
  { role: "user", text: "What drove Q3 revenue growth by region?" },
  {
    role: "assistant",
    text: "Northeast grew 34% on new enterprise deals. West Coast flat. Here's the breakdown:",
    chart: "bar",
  },
  { role: "user", text: "Show me the monthly trend for Northeast only." },
  {
    role: "assistant",
    text: "Sharp inflection in August — two large contracts closed that week.",
    chart: "line",
  },
];

const barHeights = [28, 52, 88, 44, 68, 36];
const linePath = "M 0 60 L 32 58 L 64 54 L 96 46 L 128 30 L 160 18 L 192 14 L 224 10";

export default function ChatMock() {
  const [visible, setVisible] = useState(0);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (visible >= script.length) {
      const reset = setTimeout(() => {
        setVisible(0);
        setTyped("");
      }, 3500);
      return () => clearTimeout(reset);
    }

    const turn = script[visible];
    const delay = turn.role === "user" ? 400 : 700;
    const step = turn.role === "user" ? 28 : 14;

    const start = setTimeout(() => {
      let i = 0;
      const interval = setInterval(() => {
        i += 1;
        setTyped(turn.text.slice(0, i));
        if (i >= turn.text.length) {
          clearInterval(interval);
          setTimeout(() => {
            setVisible((v) => v + 1);
            setTyped("");
          }, turn.chart ? 1400 : 600);
        }
      }, step);
      return () => clearInterval(interval);
    }, delay);

    return () => clearTimeout(start);
  }, [visible]);

  return (
    <div className="relative w-full max-w-md">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="absolute -inset-8 rounded-[48px] blur-3xl opacity-40 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 30% 20%, rgba(188,255,60,0.35), transparent 60%), radial-gradient(circle at 80% 80%, rgba(188,255,60,0.18), transparent 55%)",
        }}
      />

      <div className="relative rounded-3xl border border-(--border-primary) bg-(--bg-secondary)/95 backdrop-blur-xl p-5 shadow-2xl">
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 pb-4 border-b border-(--border-secondary)">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-vanta-neon/70" />
          <span className="ml-3 text-xs text-(--text-muted) font-mono">vanta — sales.xlsx</span>
        </div>

        <div className="mt-4 flex flex-col gap-3 min-h-[340px]">
          {script.slice(0, visible).map((turn, i) => (
            <Bubble key={i} turn={turn} full />
          ))}
          {visible < script.length && typed && (
            <Bubble turn={{ ...script[visible], text: typed } as Turn} full={false} />
          )}
          {visible < script.length && !typed && (
            <div className="flex items-center gap-1.5 px-3 py-2 text-(--text-muted) text-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-(--text-muted)/50 animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-(--text-muted)/50 animate-pulse [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-(--text-muted)/50 animate-pulse [animation-delay:300ms]" />
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-(--border-primary) bg-(--bg-primary)/60 px-3 py-2.5">
          <span className="text-(--text-muted) text-sm">Ask anything about your data…</span>
          <span className="ml-auto text-xs text-vanta-neon/70 font-mono">⌘↵</span>
        </div>
      </div>
    </div>
  );
}

function Bubble({ turn, full }: { turn: Turn; full: boolean }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-vanta-neon text-black px-3.5 py-2 text-sm font-medium">
          {turn.text}
          {!full && <BlinkingCursor />}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2 max-w-[90%]">
      <div className="rounded-2xl rounded-tl-sm bg-(--bg-tertiary) border border-(--border-primary) px-3.5 py-2 text-sm text-(--text-primary)">
        {turn.text}
        {!full && <BlinkingCursor />}
      </div>
      {full && turn.chart === "bar" && <MiniBarChart />}
      {full && turn.chart === "line" && <MiniLineChart />}
    </div>
  );
}

function BlinkingCursor() {
  return <span className="inline-block w-[2px] h-3.5 bg-current ml-0.5 align-middle animate-pulse" />;
}

function MiniBarChart() {
  return (
    <div className="rounded-xl border border-(--border-primary) bg-(--bg-primary)/60 p-3 w-full">
      <div className="flex items-end justify-between h-24 gap-2 px-1">
        {barHeights.map((h, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full rounded-t bg-vanta-neon/80 transition-all"
              style={{
                height: `${h}%`,
                animation: `grow-${i} 800ms ease-out ${i * 60}ms both`,
              }}
            />
          </div>
        ))}
      </div>
      <style>{`
        ${barHeights
          .map(
            (h, i) =>
              `@keyframes grow-${i}{from{height:0}to{height:${h}%}}`
          )
          .join("\n")}
      `}</style>
    </div>
  );
}

function MiniLineChart() {
  return (
    <div className="rounded-xl border border-(--border-primary) bg-(--bg-primary)/60 p-3 w-full">
      <svg viewBox="0 0 224 80" className="w-full h-20">
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#BCFF3C" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#BCFF3C" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${linePath} L 224 80 L 0 80 Z`}
          fill="url(#lineGrad)"
        />
        <path
          d={linePath}
          fill="none"
          stroke="#BCFF3C"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 400,
            strokeDashoffset: 400,
            animation: "draw 1000ms ease-out 100ms forwards",
          }}
        />
      </svg>
      <style>{`@keyframes draw{to{stroke-dashoffset:0}}`}</style>
    </div>
  );
}
