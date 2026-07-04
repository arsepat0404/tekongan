import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { loadContent, type GameContent } from "@/lib/sheets";
import { Loader2 } from "lucide-react";

const Ctx = createContext<GameContent | null>(null);

export function ContentProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<GameContent | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let alive = true;
    // Fake progress for visual feedback while the real fetch happens
    const tick = setInterval(() => {
      if (!alive) return;
      setProgress(p => Math.min(90, p + 7 + Math.random() * 8));
    }, 180);
    loadContent().then(c => {
      if (!alive) return;
      setProgress(100);
      setTimeout(() => alive && setContent(c), 120);
    });
    return () => { alive = false; clearInterval(tick); };
  }, []);

  if (!content) {
    return (
      <div className="min-h-dvh grid place-items-center px-6 bg-background">
        <div className="w-full max-w-xs text-center space-y-4">
          <Loader2 className="mx-auto animate-spin text-primary" size={28} />
          <div className="font-display text-[10px] tracking-widest text-primary text-glow">
            MEMUAT KONTEN...
          </div>
          <div className="h-1.5 rounded-full bg-card overflow-hidden border border-border">
            <div
              className="h-full bg-primary glow-cyan transition-[width] duration-200 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-[10px] text-muted-foreground italic">
            Sabar... Entenono disek...
          </div>
        </div>
      </div>
    );
  }
  return <Ctx.Provider value={content}>{children}</Ctx.Provider>;
}

export function useContent(): GameContent {
  const c = useContext(Ctx);
  if (!c) throw new Error("useContent outside provider");
  return c;
}
