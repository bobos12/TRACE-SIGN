"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  type LucideIcon, AlarmClock, CheckCircle2, Clock, FileStack, FileText, Inbox, LayoutGrid, LogOut, Mail, Menu as MenuIcon, PenLine, Plus, Settings, Users, XCircle, Archive,
} from "lucide-react";
import { Mark, Wordmark } from "./Logo";
import { Avatar, Menu } from "./ui";
import { ThemeToggle } from "./Theme";

type Counts = Record<string, number>;

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  view?: string;
  count?: string;
  hot?: boolean;
}

const GROUPS: { label?: string; items: Item[] }[] = [
  { items: [{ href: "/admin", label: "Overview", icon: LayoutGrid }] },
  {
    label: "Documents",
    items: [
      { href: "/admin/documents", label: "All documents", icon: FileText, view: "all", count: "all" },
      { href: "/admin/documents?view=drafts", label: "Drafts", icon: PenLine, view: "drafts", count: "drafts" },
      { href: "/admin/documents?view=waiting_me", label: "Waiting for me", icon: Inbox, view: "waiting_me", count: "waiting_me", hot: true },
      { href: "/admin/documents?view=waiting_others", label: "Waiting for others", icon: Clock, view: "waiting_others", count: "waiting_others" },
      { href: "/admin/documents?view=completed", label: "Completed", icon: CheckCircle2, view: "completed", count: "completed" },
      { href: "/admin/documents?view=declined", label: "Declined", icon: XCircle, view: "declined", count: "declined" },
      { href: "/admin/documents?view=expired", label: "Expired", icon: AlarmClock, view: "expired", count: "expired" },
    ],
  },
  {
    label: "Library",
    items: [
      { href: "/admin/templates", label: "Templates", icon: FileStack },
      { href: "/admin/contacts", label: "Contacts", icon: Users },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/admin/settings", label: "Settings", icon: Settings },
      { href: "/admin/email", label: "Email delivery", icon: Mail },
    ],
  },
];

export function AdminNav({ user, brandName, counts }: { user: { name: string; email: string; role: string }; brandName: string; counts: Counts }) {
  const path = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path, sp]);

  const isActive = (i: Item) => {
    if (i.view) return path === "/admin/documents" && (sp.get("view") ?? "all") === i.view;
    if (i.href === "/admin") return path === "/admin";
    if (i.href === "/admin/email") return path.startsWith("/admin/email");
    return path === i.href || path.startsWith(i.href + "/");
  };

  return (
    <>
      <div className="mobile-bar">
        <button className="btn ghost icon" onClick={() => setOpen(true)} aria-label="Open navigation">
          <MenuIcon size={18} />
        </button>
        <Link href="/admin" className="brand" style={{ padding: 0 }}>
          <Mark size={22} />
          <Wordmark name={brandName} />
        </Link>
        <span className="spacer" />
        <Link href="/admin/documents/new" className="btn primary sm">
          <Plus size={14} /> New
        </Link>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`side ${open ? "open" : ""}`}>
        <Link href="/admin" className="brand">
          <Mark size={24} />
          <Wordmark name={brandName} />
        </Link>
        <div className="side-cta">
          <Link href="/admin/documents/new" className="btn primary block">
            <Plus size={15} /> New document
          </Link>
        </div>
        <nav className="nav" aria-label="Main">
          {GROUPS.map((g, gi) => (
            <div key={gi} style={{ display: "contents" }}>
              {g.label && <div className="nav-label">{g.label}</div>}
              {g.items.map((i) => {
                const n = i.count ? counts[i.count] ?? 0 : 0;
                const Icon = i.icon;
                return (
                  <Link key={i.href} href={i.href} className={isActive(i) ? "active" : ""} aria-current={isActive(i) ? "page" : undefined}>
                    <Icon size={16} />
                    {i.label}
                    {i.count && n > 0 && <span className={`count ${i.hot ? "hot" : ""}`}>{n}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
          <div className="nav-label">Email logs</div>
          <Link href="/admin/email/outbox" className={path === "/admin/email/outbox" ? "active" : ""}>
            <Archive size={16} /> Delivery log
          </Link>
          <Link href="/admin/email/inbox" className={path.startsWith("/admin/email/inbox") ? "active" : ""}>
            <Inbox size={16} /> Replies &amp; bounces
          </Link>
        </nav>
        <div className="side-foot">
          <Menu
            up
            align="left"
            trigger={({ toggle }) => (
              <button className="btn ghost" style={{ height: 40, padding: "0 6px", flex: 1, justifyContent: "flex-start", gap: 10, minWidth: 0 }} onClick={toggle}>
                <Avatar name={user.name === "Owner" ? user.email : user.name} email={user.email} color="#3f3f46" />
                <span className="who" style={{ textAlign: "left" }}>
                  <div className="small strong" style={{ color: "var(--text)" }}>{user.name === "Owner" ? "Owner" : user.name}</div>
                  <div className="xs muted">{user.email}</div>
                </span>
              </button>
            )}
          >
            <div style={{ padding: "6px 8px 8px" }} onClick={(e) => e.stopPropagation()}>
              <div className="xs muted" style={{ marginBottom: 6 }}>Appearance</div>
              <ThemeToggle />
            </div>
            <hr />
            <button
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.href = "/login";
              }}
            >
              <LogOut size={15} /> Sign out
            </button>
          </Menu>
        </div>
      </aside>
    </>
  );
}
