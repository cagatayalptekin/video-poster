"use client";

import { useEffect, useState } from "react";

interface Settings {
  posting_interval_hours: string;
  auto_delete_after_success: string;
  max_retry_count: string;
  app_timezone: string;
  default_caption_suffix: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    posting_interval_hours: "24",
    auto_delete_after_success: "true",
    max_retry_count: "3",
    app_timezone: "UTC",
    default_caption_suffix: "",
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setSettings(data));
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setToast("Settings saved");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-md text-sm font-medium shadow-lg bg-green-500 text-white">
          {toast}
        </div>
      )}

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      <div className="bg-white rounded-lg shadow p-6 max-w-xl">
        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Posting Interval (hours)</label>
            <input
              type="number"
              min="1"
              value={settings.posting_interval_hours}
              onChange={(e) => setSettings({ ...settings, posting_interval_hours: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
            />
            <p className="text-xs text-gray-400 mt-1">How often the scheduler processes the next queued video</p>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={settings.auto_delete_after_success === "true"}
                onChange={(e) => setSettings({ ...settings, auto_delete_after_success: e.target.checked ? "true" : "false" })}
              />
              Auto-delete file after successful posting
            </label>
            <p className="text-xs text-gray-400 mt-1">Remove local video file once posted to all platforms</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Max Retry Count</label>
            <input
              type="number"
              min="0"
              max="10"
              value={settings.max_retry_count}
              onChange={(e) => setSettings({ ...settings, max_retry_count: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
            />
            <p className="text-xs text-gray-400 mt-1">How many times to retry a failed post before marking as failed</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
            <input
              type="text"
              value={settings.app_timezone}
              onChange={(e) => setSettings({ ...settings, app_timezone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
              placeholder="UTC"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Default Caption Suffix</label>
            <input
              type="text"
              value={settings.default_caption_suffix}
              onChange={(e) => setSettings({ ...settings, default_caption_suffix: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
              placeholder="e.g. 🔥 Follow for more!"
            />
            <p className="text-xs text-gray-400 mt-1">Appended to every video caption automatically</p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </form>
      </div>
    </div>
  );
}
