"use client";

import { useEffect, useState } from "react";

interface DashboardData {
  queued: number;
  completed: number;
  failed: number;
  activeAccounts: number;
  scheduler: { running: boolean; lastRun: string | null; nextRun: string | null };
  recentLogs: { id: string; level: string; context: string; message: string; createdAt: string }[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [runningNow, setRunningNow] = useState(false);

  async function loadData() {
    const res = await fetch("/api/dashboard");
    if (res.ok) setData(await res.json());
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, []);

  async function handleRunNow() {
    setRunningNow(true);
    try {
      await fetch("/api/scheduler", { method: "POST" });
      await loadData();
    } finally {
      setRunningNow(false);
    }
  }

  if (!data) return <div className="text-gray-500">Loading...</div>;

  const cards = [
    { label: "Queued Videos", value: data.queued, color: "bg-blue-500" },
    { label: "Completed", value: data.completed, color: "bg-green-500" },
    { label: "Failed", value: data.failed, color: "bg-red-500" },
    { label: "Active Accounts", value: data.activeAccounts, color: "bg-purple-500" },
  ];

  const levelColors: Record<string, string> = {
    info: "text-blue-600",
    success: "text-green-600",
    warn: "text-yellow-600",
    error: "text-red-600",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <button
          onClick={handleRunNow}
          disabled={runningNow}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
        >
          {runningNow ? "Processing..." : "▶ Run Now"}
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-lg shadow p-5">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{card.value}</p>
            <div className={`h-1 w-12 ${card.color} rounded mt-3`} />
          </div>
        ))}
      </div>

      {/* Scheduler info */}
      <div className="bg-white rounded-lg shadow p-5 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Scheduler</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Status:</span>{" "}
            <span className={data.scheduler.running ? "text-green-600 font-medium" : "text-yellow-600"}>
              {data.scheduler.running ? "Running" : "Stopped"}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Last Run:</span>{" "}
            <span className="text-gray-900">{data.scheduler.lastRun ? new Date(data.scheduler.lastRun).toLocaleString() : "Never"}</span>
          </div>
          <div>
            <span className="text-gray-500">Next Run:</span>{" "}
            <span className="text-gray-900">{data.scheduler.nextRun ? new Date(data.scheduler.nextRun).toLocaleString() : "N/A"}</span>
          </div>
        </div>
      </div>

      {/* Recent logs */}
      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent Logs</h2>
        {data.recentLogs.length === 0 ? (
          <p className="text-gray-400 text-sm">No logs yet</p>
        ) : (
          <div className="space-y-2">
            {data.recentLogs.map((logEntry) => (
              <div key={logEntry.id} className="flex items-start text-sm border-b border-gray-100 pb-2">
                <span className={`font-mono text-xs w-16 shrink-0 uppercase font-medium ${levelColors[logEntry.level] || "text-gray-600"}`}>
                  {logEntry.level}
                </span>
                <span className="text-gray-400 w-20 shrink-0">{logEntry.context || "-"}</span>
                <span className="text-gray-700 flex-1">{logEntry.message}</span>
                <span className="text-gray-400 text-xs ml-2 shrink-0">
                  {new Date(logEntry.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
