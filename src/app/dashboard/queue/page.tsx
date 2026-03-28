"use client";

import { useEffect, useState, useCallback } from "react";

interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
  username: string;
  isActive: boolean;
}

interface PlatformTarget {
  id: string;
  platform: string;
  status: string;
  externalPostId: string | null;
  externalUrl: string | null;
  errorMessage: string | null;
  socialAccount: SocialAccount;
}

interface QueueItem {
  id: string;
  originalFilename: string;
  caption: string | null;
  hashtags: string | null;
  status: string;
  retryCount: number;
  createdAt: string;
  processedAt: string | null;
  targets: PlatformTarget[];
}

const statusColors: Record<string, string> = {
  queued: "bg-blue-100 text-blue-800",
  processing: "bg-yellow-100 text-yellow-800",
  partially_posted: "bg-orange-100 text-orange-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  pending: "bg-gray-100 text-gray-800",
  posting: "bg-yellow-100 text-yellow-800",
  success: "bg-green-100 text-green-800",
};

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [filter, setFilter] = useState("all");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [uploading, setUploading] = useState(false);

  // Upload form state
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, string[]>>({});

  const loadData = useCallback(async () => {
    const [itemsRes, accountsRes] = await Promise.all([
      fetch(`/api/videos${filter !== "all" ? `?status=${filter}` : ""}`),
      fetch("/api/accounts"),
    ]);
    if (itemsRes.ok) setItems(await itemsRes.json());
    if (accountsRes.ok) setAccounts((await accountsRes.json()).filter((a: SocialAccount) => a.isActive));
  }, [filter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  function toggleAccount(platform: string, accountId: string) {
    setSelectedAccounts((prev) => {
      const current = prev[platform] || [];
      if (current.includes(accountId)) {
        return { ...prev, [platform]: current.filter((id) => id !== accountId) };
      }
      return { ...prev, [platform]: [...current, accountId] };
    });
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    const platforms = Object.entries(selectedAccounts)
      .filter(([, ids]) => ids.length > 0)
      .map(([platform, accountIds]) => ({ platform, accountIds }));

    if (platforms.length === 0) {
      setToast({ message: "Select at least one account", type: "error" });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("caption", caption);
      formData.append("hashtags", hashtags);
      formData.append("platforms", JSON.stringify(platforms));

      const res = await fetch("/api/videos", { method: "POST", body: formData });
      if (res.ok) {
        setToast({ message: "Video queued successfully!", type: "success" });
        setShowUpload(false);
        setFile(null);
        setCaption("");
        setHashtags("");
        setSelectedAccounts({});
        loadData();
      } else {
        const data = await res.json();
        setToast({ message: data.error || "Upload failed", type: "error" });
      }
    } catch {
      setToast({ message: "Upload error", type: "error" });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this video from queue?")) return;
    const res = await fetch(`/api/videos/${id}`, { method: "DELETE" });
    if (res.ok) {
      setToast({ message: "Deleted", type: "success" });
      loadData();
    }
  }

  async function handleRetry(id: string) {
    const res = await fetch(`/api/videos/${id}`, { method: "PATCH" });
    if (res.ok) {
      setToast({ message: "Re-queued for retry", type: "success" });
      loadData();
    } else {
      const data = await res.json();
      setToast({ message: data.error || "Retry failed", type: "error" });
    }
  }

  const accountsByPlatform: Record<string, SocialAccount[]> = {};
  for (const a of accounts) {
    if (!accountsByPlatform[a.platform]) accountsByPlatform[a.platform] = [];
    accountsByPlatform[a.platform].push(a);
  }

  return (
    <div>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-md text-sm font-medium shadow-lg ${
          toast.type === "success" ? "bg-green-500 text-white" : "bg-red-500 text-white"
        }`}>{toast.message}</div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Video Queue</h1>
        <button onClick={() => setShowUpload(true)} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium">
          + Upload Video
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {["all", "queued", "processing", "completed", "failed", "partially_posted"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium ${
              filter === s ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            {s === "all" ? "All" : s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Upload modal */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-4 text-gray-900">Upload Video</h2>
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Video File</label>
                <input
                  type="file"
                  accept=".mp4,.mov,.avi,.webm,.mkv,.m4v"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-gray-700"
                  required
                />
                {file && <p className="text-xs text-gray-500 mt-1">{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Caption</label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 text-sm"
                  rows={3}
                  placeholder="Video caption or description"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hashtags</label>
                <input
                  type="text"
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 text-sm"
                  placeholder="#viral #fyp #shorts"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Target Accounts</label>
                {Object.keys(accountsByPlatform).length === 0 ? (
                  <p className="text-sm text-gray-400">No active accounts. Add accounts first.</p>
                ) : (
                  Object.entries(accountsByPlatform).map(([platform, accs]) => (
                    <div key={platform} className="mb-3">
                      <p className="text-xs font-semibold text-gray-600 uppercase mb-1">{platform}</p>
                      {accs.map((acc) => (
                        <label key={acc.id} className="flex items-center gap-2 text-sm text-gray-700 py-0.5">
                          <input
                            type="checkbox"
                            checked={selectedAccounts[platform]?.includes(acc.id) || false}
                            onChange={() => toggleAccount(platform, acc.id)}
                          />
                          {acc.accountName} (@{acc.username})
                        </label>
                      ))}
                    </div>
                  ))
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowUpload(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                <button type="submit" disabled={uploading} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
                  {uploading ? "Uploading..." : "Upload & Queue"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Queue list */}
      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">No videos in queue</div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-medium text-gray-900">{item.originalFilename}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[item.status] || "bg-gray-100"}`}>
                      {item.status.replace("_", " ")}
                    </span>
                    {item.retryCount > 0 && (
                      <span className="text-xs text-gray-400">Retries: {item.retryCount}</span>
                    )}
                  </div>
                  {item.caption && <p className="text-sm text-gray-600 mb-1">{item.caption}</p>}
                  {item.hashtags && <p className="text-sm text-blue-500">{item.hashtags}</p>}
                  <p className="text-xs text-gray-400 mt-1">
                    Uploaded: {new Date(item.createdAt).toLocaleString()}
                    {item.processedAt && ` · Processed: ${new Date(item.processedAt).toLocaleString()}`}
                  </p>
                </div>
                <div className="flex gap-2 ml-4">
                  {(item.status === "failed" || item.status === "partially_posted") && (
                    <button onClick={() => handleRetry(item.id)} className="px-3 py-1 text-xs font-medium text-orange-600 border border-orange-300 rounded hover:bg-orange-50">
                      Retry
                    </button>
                  )}
                  <button onClick={() => handleDelete(item.id)} className="px-3 py-1 text-xs font-medium text-red-600 border border-red-300 rounded hover:bg-red-50">
                    Delete
                  </button>
                </div>
              </div>
              {/* Platform targets */}
              {item.targets.length > 0 && (
                <div className="mt-3 border-t border-gray-100 pt-2">
                  <div className="flex flex-wrap gap-2">
                    {item.targets.map((target) => (
                      <div key={target.id} className="flex items-center gap-1.5 text-xs border border-gray-200 rounded px-2 py-1">
                        <span className="font-medium text-gray-700">{target.platform}</span>
                        <span className="text-gray-400">→</span>
                        <span className="text-gray-600">{target.socialAccount.accountName}</span>
                        <span className={`px-1.5 py-0 rounded ${statusColors[target.status] || "bg-gray-100"}`}>
                          {target.status}
                        </span>
                        {target.externalUrl && (
                          <a href={target.externalUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                            Link
                          </a>
                        )}
                        {target.errorMessage && (
                          <span className="text-red-500" title={target.errorMessage}>⚠</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
