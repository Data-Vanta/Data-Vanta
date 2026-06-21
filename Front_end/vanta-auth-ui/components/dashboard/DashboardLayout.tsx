"use client";

import { useState, useEffect, useCallback, useMemo, createContext, useContext } from "react";
import Sidebar from "./Sidebar";
import Header from "./Header";

// Types
interface Dataset {
  id: string;
  name: string;
  // Datalakehouse fields
  projectId?: string;
  tableName?: string;
  source?: 'lakehouse' | 'user-auth';
}

interface User {
  id: string;
  name?: string;
  email: string;
  role?: string;
}

export type ChatAttachment =
  | { kind: 'file'; id: string; fileId: string; alias?: string; originalFilename?: string }
  | { kind: 'connector_table'; id: string; projectId: string; tableName: string; alias?: string }
  // Phase 7 — live SQL: agent receives a run_sql tool that hits this connector
  // directly. Not persisted to the chat_session_attachments junction (the ENUM
  // there only knows file/connector_table); these survive in-memory for the
  // current chat session.
  | { kind: 'connector_live'; id: string; connectorId: string; connectorType?: string; alias?: string };

interface DashboardContextType {
  currentDataset: Dataset | null;
  setCurrentDataset: (dataset: Dataset | null) => void;
  user: User | null;
  refreshUser: () => Promise<void>;
  attachments: ChatAttachment[];
  setAttachments: (a: ChatAttachment[]) => void;
  addAttachment: (a: ChatAttachment) => void;
  removeAttachment: (id: string) => void;
}

const DashboardContext = createContext<DashboardContextType>({
  currentDataset: null,
  setCurrentDataset: () => { },
  user: null,
  refreshUser: async () => { },
  attachments: [],
  setAttachments: () => { },
  addAttachment: () => { },
  removeAttachment: () => { },
});

export const useDashboard = () => useContext(DashboardContext);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // SSR-safe: initial render uses null/[] on both server and client so the
  // first paint matches. localStorage hydration moves to a post-mount effect
  // below. Without this gate any consumer that branches on currentDataset/
  // attachments produces divergent SSR-vs-client HTML and trips React's
  // hydration mismatch warning (seen in Header's dataset selector).
  const [currentDataset, setCurrentDatasetInner] = useState<Dataset | null>(null);
  const [attachments, setAttachmentsInner] = useState<ChatAttachment[]>([]);
  const [user, setUser] = useState<User | null>(null);

  // Hydrate from localStorage exactly once, post-mount, on the client only.
  // Synchronous setState in an effect body is intentional here — this is the
  // canonical "mount-only hydration" pattern that fixes the SSR/client
  // hydration mismatch, not state synchronization. Same disable as fetchUser().
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const rawDs = localStorage.getItem('currentDataset');
      if (rawDs) setCurrentDatasetInner(JSON.parse(rawDs));
    } catch { /* corrupt JSON — ignore */ }
    try {
      const rawAtt = localStorage.getItem('chatAttachments');
      if (rawAtt) setAttachmentsInner(JSON.parse(rawAtt));
    } catch { /* corrupt JSON — ignore */ }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // All setters are useCallback-stable so the context value object is also
  // stable (via useMemo below). Otherwise children that list these setters
  // in effect dep arrays (e.g. dashboard page's session-load effect with
  // `setAttachments` in deps) re-run on every parent render — infinite loop.
  const setCurrentDataset = useCallback((d: Dataset | null) => {
    setCurrentDatasetInner(d);
    if (typeof window === 'undefined') return;
    if (d) localStorage.setItem('currentDataset', JSON.stringify(d));
    else localStorage.removeItem('currentDataset');
  }, []);

  const setAttachments = useCallback((next: ChatAttachment[]) => {
    setAttachmentsInner(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('chatAttachments', JSON.stringify(next));
    }
  }, []);

  const addAttachment = useCallback((a: ChatAttachment) => {
    setAttachmentsInner(prev => {
      const next = prev.some(x => x.id === a.id) ? prev : [...prev, a];
      if (typeof window !== 'undefined') {
        localStorage.setItem('chatAttachments', JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachmentsInner(prev => {
      const next = prev.filter(x => x.id !== id);
      if (typeof window !== 'undefined') {
        localStorage.setItem('chatAttachments', JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";

  const fetchUser = useCallback(async () => {
    try {
      const token = localStorage.getItem("authToken") || "";
      if (!token) return;

      const res = await fetch(`${apiUrl}/auth/me`, {
        headers: { "x-auth-token": token }
      });

      if (res.ok) {
        const json = await res.json();
        setUser(json.data?.user || null);
      }
    } catch (error) {
      console.error("Error fetching user:", error);
    }
  }, [apiUrl]);

  useEffect(() => {
    // Fire-and-forget: async setState inside a fetch handler is the canonical
    // pattern for loading remote data on mount and does not cause cascading renders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchUser();
  }, [fetchUser]);

  // Memoize the context value so consumers don't re-render unless an
  // actual primitive (currentDataset / user / attachments) changes. The
  // setter identities are now stable across renders.
  const contextValue = useMemo(
    () => ({
      currentDataset,
      setCurrentDataset,
      user,
      refreshUser: fetchUser,
      attachments,
      setAttachments,
      addAttachment,
      removeAttachment,
    }),
    [currentDataset, setCurrentDataset, user, fetchUser, attachments, setAttachments, addAttachment, removeAttachment]
  );

  return (
    <DashboardContext.Provider value={contextValue}>
      <div
        className="min-h-screen bg-(--bg-primary) text-(--text-primary) flex"
        style={{ fontFamily: "var(--font-body)" }}
      >
        {/* Fixed Sidebar */}
        <Sidebar user={user} />

        {/* Main Content Area — no outer overflow-y; each page owns its
            own scroll so the chat page can pin its composer to the
            bottom without a nested scroll container eating messages. */}
        <main className="flex-1 ml-[260px] flex flex-col h-screen relative overflow-hidden">
          <Header
            currentDataset={currentDataset}
            onDatasetChange={setCurrentDataset}
          />
          <div className="flex-1 min-h-0">
            {children}
          </div>
        </main>
      </div>
    </DashboardContext.Provider>
  );
}
