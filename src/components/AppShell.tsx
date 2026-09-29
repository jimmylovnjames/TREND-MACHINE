"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { trackEvent } from "@/client/analytics";

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const online = useOnline();
  // Dance pages have their own back button + primary CTA bar; admin has its own chrome.
  const hideNav = pathname.startsWith("/admin") || pathname.startsWith("/d/");

  useEffect(() => {
    const installed = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
    trackEvent("app_open", { props: { installed } });
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  return (
    <>
      {!online && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-50 bg-warn px-4 pb-2 pt-[calc(var(--safe-top)+8px)] text-center text-sm font-semibold text-black"
        >
          You&apos;re offline. We&apos;ll pick up where you left off when you reconnect.
        </div>
      )}
      <div className={hideNav ? "" : "pb-nav"}>{children}</div>
      {!hideNav && <BottomNav pathname={pathname} />}
    </>
  );
}

function BottomNav({ pathname }: { pathname: string }) {
  const items = [
    { href: "/", label: "Moves", icon: MovesIcon, active: pathname === "/" || pathname.startsWith("/d/") },
    {
      href: "/me",
      label: "My videos",
      icon: VideosIcon,
      active: pathname.startsWith("/me") || pathname.startsWith("/g/"),
    },
  ];
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/90 pb-safe backdrop-blur-md"
    >
      <ul className="mx-auto flex h-[var(--nav-h)] max-w-lg items-stretch">
        {items.map(({ href, label, icon: Icon, active }) => (
          <li key={href} className="flex-1">
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`pressable flex h-full flex-col items-center justify-center gap-1 text-xs font-semibold ${active ? "text-acid" : "text-muted"}`}
            >
              <Icon />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function MovesIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="4.5" r="2.2" fill="currentColor" />
      <path
        d="M12 8v6m0 0-4 7m4-7 4 7M12 10l-5-3m5 3 5 2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function VideosIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="2.5" width="14" height="19" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M10.5 9.5v5l4-2.5-4-2.5Z" fill="currentColor" />
    </svg>
  );
}
