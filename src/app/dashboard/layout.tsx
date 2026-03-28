"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/dashboard/accounts", label: "Accounts", icon: "👥" },
  { href: "/dashboard/queue", label: "Queue", icon: "📹" },
  { href: "/dashboard/logs", label: "Logs", icon: "📋" },
  { href: "/dashboard/settings", label: "Settings", icon: "⚙️" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-lg font-bold">📹 Video Poster</h1>
          <p className="text-xs text-gray-400 mt-1">Admin Panel</p>
        </div>
        <nav className="flex-1 py-4">
          {navItems.map((item) => {
            const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center px-4 py-2.5 text-sm transition-colors ${
                  active ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`}
              >
                <span className="mr-3">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="w-full text-left text-sm text-gray-400 hover:text-white transition-colors"
          >
            ← Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
