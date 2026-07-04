import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { isAuthorized, tryAuthorize } from "@/lib/player";
import { ContentProvider, useContent } from "@/components/ContentProvider";
import { Footer } from "@/components/Footer";
import { Lock, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: (search.redirect as string) ?? "",
  }),
  head: () => ({
    meta: [
      { title: "Tekongan — Petak Umpet Jowo Timuran" },
      { name: "description", content: "Real-time multiplayer Tekongan (East Javanese hide & seek). Gather your friends and play live." },
      { property: "og:title", content: "Tekongan — Petak Umpet Jowo Timuran" },
      { property: "og:description", content: "Real-time multiplayer hide & seek game with persistent chat and tap-duels." },
    ],
  }),
  component: () => <ContentProvider><Gateway /></ContentProvider>,
});

function Gateway() {
  const { t } = useContent();
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [err, setErr] = useState(false);

  const { redirect } = useSearch({ from: "/" });

  useEffect(() => {
    if (isAuthorized()) {
      if (redirect) nav({ to: "/lobby", search: { redirect } });
      else nav({ to: "/lobby" });
    }
  }, [nav, redirect]);

  function submit() {
    if (tryAuthorize(code)) {
      if (redirect) nav({ to: "/lobby", search: { redirect } });
      else nav({ to: "/lobby" });
    } else { setErr(true); if ("vibrate" in navigator) navigator.vibrate(200); }
  }

  return (
    <div className="relative min-h-dvh grid place-items-center px-6 pb-20 scanlines overflow-hidden">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full border-2 border-primary glow-cyan mx-auto">
            <Lock className="text-primary" />
          </div>
          <h1 className="text-2xl text-glow text-primary mt-3">{t("app_title")}</h1>
          <p className="text-xs text-muted-foreground tracking-widest">{t("app_subtitle")}</p>
        </div>

        <div className="rounded-xl bg-card/60 border border-border backdrop-blur p-5 space-y-3">
          <h2 className="font-display text-xs text-foreground/90">{t("gateway_title")}</h2>
          <p className="text-xs text-muted-foreground">{t("gateway_hint")}</p>
          <input
            type="password"
            value={code}
            onChange={e => { setCode(e.target.value); setErr(false); }}
            onKeyDown={e => e.key === "Enter" && submit()}
            className={`w-full text-center bg-input rounded-md px-3 py-2 outline-none focus:ring-2 ring-primary tracking-widest ${err ? "ring-2 ring-destructive animate-flash" : ""}`}
            placeholder="••••••••"
            autoFocus
          />
          {err && <p className="text-xs text-destructive">{t("gateway_wrong")}</p>}
          <button onClick={submit}
            className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-md py-2 font-semibold active:scale-95 transition glow-cyan">
            {t("gateway_btn")} <ArrowRight size={16} />
          </button>
        </div>
      </div>
      <Footer text={t("footer")} />
    </div>
  );
}
