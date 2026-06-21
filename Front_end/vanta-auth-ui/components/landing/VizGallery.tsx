"use client";
import { useState } from "react";

type Tab = "bar" | "line" | "donut" | "area" | "scatter" | "heatmap";

const tabs: { id: Tab; label: string }[] = [
    { id: "bar", label: "Bar" },
    { id: "line", label: "Line" },
    { id: "area", label: "Area" },
    { id: "donut", label: "Donut" },
    { id: "scatter", label: "Scatter" },
    { id: "heatmap", label: "Heatmap" },
];

export default function VizGallery() {
    const [active, setActive] = useState<Tab>("bar");

    return (
        <div className="rounded-3xl border border-(--border-primary) bg-(--bg-secondary)/60 backdrop-blur-xl p-6 md:p-8 shadow-xl">
            {/* Tabs */}
            <div className="flex flex-wrap gap-2 mb-6">
                {tabs.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setActive(t.id)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${active === t.id
                                ? "bg-vanta-neon text-black shadow-md shadow-vanta-neon/30"
                                : "bg-(--bg-tertiary) text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)"
                            }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Viz area */}
            <div className="relative h-80 md:h-96 rounded-2xl bg-(--bg-primary)/50 border border-(--border-secondary) p-4 md:p-6 overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center">
                    {active === "bar" && <BarViz />}
                    {active === "line" && <LineViz />}
                    {active === "area" && <AreaViz />}
                    {active === "donut" && <DonutViz />}
                    {active === "scatter" && <ScatterViz />}
                    {active === "heatmap" && <HeatmapViz />}
                </div>
                {/* Corner ambient */}
                <div
                    aria-hidden
                    className="absolute -top-24 -right-24 w-64 h-64 rounded-full blur-3xl opacity-40 pointer-events-none"
                    style={{ background: "radial-gradient(circle, rgba(188,255,60,0.18), transparent 70%)" }}
                />
            </div>

            <p className="mt-4 text-xs text-(--text-muted) text-center">
                Every chart rendered from a single chat turn — no dashboard wiring required.
            </p>
        </div>
    );
}

// -------- Individual mini visualisations --------

function BarViz() {
    const heights = [40, 65, 48, 82, 56, 92, 70, 38, 55];
    return (
        <svg viewBox="0 0 320 200" className="w-full h-full">
            {heights.map((h, i) => {
                const x = 20 + i * 32;
                const y = 180 - h;
                return (
                    <g key={i}>
                        <rect
                            x={x}
                            y={y}
                            width="22"
                            height={h}
                            rx="3"
                            fill="#BCFF3C"
                            opacity={0.85}
                            style={{ animation: `barIn 650ms ease-out ${i * 60}ms both` }}
                        />
                    </g>
                );
            })}
            <line x1="12" y1="180" x2="310" y2="180" stroke="currentColor" strokeOpacity="0.15" />
            <style>{`@keyframes barIn{from{transform:scaleY(0);transform-origin:bottom}to{transform:scaleY(1);transform-origin:bottom}}`}</style>
        </svg>
    );
}

function LineViz() {
    const pts = [
        [20, 140], [60, 120], [100, 130], [140, 90],
        [180, 70], [220, 85], [260, 50], [300, 35],
    ];
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
    return (
        <svg viewBox="0 0 320 200" className="w-full h-full">
            <defs>
                <linearGradient id="lineG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#BCFF3C" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#BCFF3C" stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={`${d} L 300 180 L 20 180 Z`} fill="url(#lineG)" />
            <path
                d={d}
                fill="none"
                stroke="#BCFF3C"
                strokeWidth="2.5"
                strokeLinecap="round"
                style={{ strokeDasharray: 600, strokeDashoffset: 600, animation: "draw 1400ms ease-out forwards" }}
            />
            {pts.map((p, i) => (
                <circle
                    key={i}
                    cx={p[0]}
                    cy={p[1]}
                    r="4"
                    fill="#BCFF3C"
                    opacity={0}
                    style={{ animation: `fadePt 400ms ease-out ${500 + i * 100}ms forwards` }}
                />
            ))}
            <style>{`@keyframes draw{to{stroke-dashoffset:0}}@keyframes fadePt{to{opacity:1}}`}</style>
        </svg>
    );
}

function AreaViz() {
    const series = [
        [[20, 140], [60, 120], [100, 100], [140, 115], [180, 85], [220, 95], [260, 70], [300, 60]],
        [[20, 160], [60, 150], [100, 140], [140, 145], [180, 125], [220, 130], [260, 110], [300, 100]],
    ];
    return (
        <svg viewBox="0 0 320 200" className="w-full h-full">
            <defs>
                <linearGradient id="areaGa" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#BCFF3C" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#BCFF3C" stopOpacity="0.05" />
                </linearGradient>
                <linearGradient id="areaGb" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.05" />
                </linearGradient>
            </defs>
            {series.map((pts, idx) => {
                const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
                return (
                    <g key={idx} style={{ animation: `fadeIn 700ms ease-out ${idx * 150}ms both` }}>
                        <path d={`${d} L 300 180 L 20 180 Z`} fill={idx === 0 ? "url(#areaGa)" : "url(#areaGb)"} />
                        <path d={d} fill="none" stroke={idx === 0 ? "#BCFF3C" : "#60a5fa"} strokeWidth="2" />
                    </g>
                );
            })}
            <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
        </svg>
    );
}

function DonutViz() {
    const segments = [
        { v: 42, c: "#BCFF3C" },
        { v: 28, c: "#60a5fa" },
        { v: 18, c: "#f59e0b" },
        { v: 12, c: "#a78bfa" },
    ];
    const cx = 160, cy = 100, r = 62, cw = 24;
    let offset = 0;
    const total = 100;
    return (
        <svg viewBox="0 0 320 200" className="w-full h-full">
            <g>
                {segments.map((s, i) => {
                    const start = (offset / total) * 2 * Math.PI;
                    const end = ((offset + s.v) / total) * 2 * Math.PI;
                    const x1 = cx + r * Math.cos(start - Math.PI / 2);
                    const y1 = cy + r * Math.sin(start - Math.PI / 2);
                    const x2 = cx + r * Math.cos(end - Math.PI / 2);
                    const y2 = cy + r * Math.sin(end - Math.PI / 2);
                    const largeArc = s.v > 50 ? 1 : 0;
                    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
                    offset += s.v;
                    return (
                        <path
                            key={i}
                            d={d}
                            fill={s.c}
                            opacity={0.9}
                            style={{ animation: `popIn 500ms ease-out ${i * 120}ms both`, transformOrigin: `${cx}px ${cy}px` }}
                        />
                    );
                })}
                <circle cx={cx} cy={cy} r={r - cw} fill="var(--bg-primary)" />
                <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="700" fill="currentColor" opacity="0.9">$2.4M</text>
                <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.5">total revenue</text>
            </g>
            <style>{`@keyframes popIn{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:0.9}}`}</style>
        </svg>
    );
}

function ScatterViz() {
    const points = Array.from({ length: 34 }, (_, i) => {
        const x = 30 + (i * 7.8) + Math.sin(i * 0.9) * 15;
        const y = 160 - ((i * 3.1) + Math.cos(i * 1.3) * 30);
        const r = 3 + (i % 5);
        return { x, y, r };
    });
    return (
        <svg viewBox="0 0 320 200" className="w-full h-full">
            {points.map((p, i) => (
                <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={p.r}
                    fill="#BCFF3C"
                    opacity={0}
                    style={{ animation: `fadeIn 400ms ease-out ${i * 25}ms forwards` }}
                />
            ))}
            <style>{`@keyframes fadeIn{to{opacity:0.75}}`}</style>
        </svg>
    );
}

function HeatmapViz() {
    const rows = 5, cols = 12;
    return (
        <svg viewBox="0 0 320 200" className="w-full h-full">
            {Array.from({ length: rows }).map((_, r) =>
                Array.from({ length: cols }).map((_, c) => {
                    const intensity = (Math.sin(r * 1.3 + c * 0.6) + 1) / 2; // 0..1
                    return (
                        <rect
                            key={`${r}-${c}`}
                            x={20 + c * 24}
                            y={30 + r * 26}
                            width="20"
                            height="22"
                            rx="2"
                            fill="#BCFF3C"
                            opacity={0}
                            style={{
                                animation: `hmFade 400ms ease-out ${(r + c) * 30}ms forwards`,
                                ["--op" as string]: intensity.toFixed(2),
                            }}
                        />
                    );
                })
            )}
            <style>{`@keyframes hmFade{to{opacity:var(--op)}}`}</style>
        </svg>
    );
}
