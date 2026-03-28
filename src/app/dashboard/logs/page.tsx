"use client";

import { useEffect, useState, useCallback } from "react";

interface LogEntry {
  id: string;
  level: string;
  context: string | null;
  message: string;
  details: string | null;
  platform: string | null;
  createdAt: string;
  socialAccount: { accountName: string; platform: string } | null;
  videoQueueItem: { originalFilename: string } | null;
}

const levelColors: Record<string, string> = {
  info: "bg-blue-100 text-blue-800",
  success: "bg-green-100 text-green-800",
  warn: "bg-yellow-100 text-yellow-800",
  error: "bg-red-100 text-red-800",
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [levelFilter, setLevelFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    const params = new URLSearchParams();
    if (levelFilter) params.set("level", levelFilter);
    if (platformFilter) params.set("platform", platformFilter);
    params.set("limit", "100");

    const res = await fetch(`/api/logs?${params}`);
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
    }
  }, [levelFilter, platformFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Logs</h1>
        <span className="text-sm text-gray-400">{total} total entries</span>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900"
        >
          <option value="">All Levels</option>
          <option value="info">Info</option>
          <option value="success">Success</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900"
        >
          <option value="">All Platforms</option>
          <option value="youtube">YouTube</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
        </select>
        <button onClick={loadLogs} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700">
          Refresh
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 text-gray-600 font-medium w-20">Level</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium w-36">Time</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium w-24">Context</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium w-24">Platform</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Message</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium w-32">Related</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No logs found</td></tr>
            ) : (
              logs.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                >
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${levelColors[entry.level] || "bg-gray-100"}`}>
                      {entry.level}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{new Date(entry.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-gray-600">{entry.context || "-"}</td>
                  <td className="px-4 py-2.5 text-gray-600">{entry.platform || "-"}</td>
                  <td className="px-4 py-2.5 text-gray-800">{entry.message}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {entry.socialAccount && <span>{entry.socialAccount.accountName}</span>}
                    {entry.videoQueueItem && <span className="block">{entry.videoQueueItem.originalFilename}</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {/* Expanded details */}
        {expanded && (() => {
          const entry = logs.find((l) => l.id === expanded);
          if (!entry?.details) return null;
          let parsed: string;
          try { parsed = JSON.stringify(JSON.parse(entry.details), null, 2); } catch { parsed = entry.details; }
          return (
            <div className="px-4 py-3 bg-gray-50 border-t">
              <p className="text-xs font-mono text-gray-600 whitespace-pre-wrap">{parsed}</p>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
