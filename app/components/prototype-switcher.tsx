// PROTOTYPE — throwaway. Floating variant switcher for UI prototypes.
// Lives on the `prototype/notifications-ui` branch only; never merge to main.
import { useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PrototypeVariant {
  key: string;
  name: string;
}

export function usePrototypeVariant(variants: PrototypeVariant[]) {
  const [searchParams] = useSearchParams();
  const raw = searchParams.get("variant");
  return variants.find((v) => v.key === raw) ?? variants[0];
}

// The variant lives in the URL. Sidebar links drop the search param, so after
// every navigation re-append the last variant the user chose in this tab.
export function useStickyVariantParam() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const current = params.get("variant");
    try {
      if (current) {
        sessionStorage.setItem("prototype-variant", current);
        return;
      }
      const remembered = sessionStorage.getItem("prototype-variant");
      if (remembered) {
        params.set("variant", remembered);
        navigate(
          { pathname: location.pathname, search: `?${params}`, hash: location.hash },
          { replace: true, preventScrollReset: true }
        );
      }
    } catch {}
  }, [location.pathname, location.search, location.hash, navigate]);
}

export function PrototypeSwitcher({
  variants,
  current,
  children,
}: {
  variants: PrototypeVariant[];
  current: PrototypeVariant;
  children?: React.ReactNode;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const index = variants.findIndex((v) => v.key === current.key);

  function go(delta: number) {
    const next = variants[(index + delta + variants.length) % variants.length];
    const params = new URLSearchParams(searchParams);
    params.set("variant", next.key);
    setSearchParams(params, { replace: true, preventScrollReset: true });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-fuchsia-500 bg-zinc-950 px-2 py-1.5 text-xs text-white shadow-2xl">
      <span className="rounded-full bg-fuchsia-500 px-2 py-0.5 font-bold uppercase tracking-wider">
        Prototype
      </span>
      <button
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-white/15"
        title="Previous variant (←)"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-56 text-center font-medium">
        {current.key} ({current.name})
      </span>
      <button
        onClick={() => go(1)}
        className="rounded-full p-1 hover:bg-white/15"
        title="Next variant (→)"
      >
        <ChevronRight className="size-4" />
      </button>
      {children}
    </div>
  );
}
