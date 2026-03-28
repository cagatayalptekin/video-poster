"use client";

import { useEffect, useState } from "react";

interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
  username: string;
  isActive: boolean;
  authType: string;
  accessToken: string | null;
  refreshToken: string | null;
  metadata: string | null;
  createdAt: string;
}

const PLATFORMS = ["youtube", "instagram", "tiktok"];

const platformColors: Record<string, string> = {
  youtube: "bg-red-100 text-red-800",
  instagram: "bg-pink-100 text-pink-800",
  tiktok: "bg-gray-100 text-gray-800",
};

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SocialAccount | null>(null);
  const [form, setForm] = useState({
    platform: "youtube",
    accountName: "",
    username: "",
    isActive: true,
    authType: "manual",
    accessToken: "",
    refreshToken: "",
  });
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  async function loadAccounts() {
    const res = await fetch("/api/accounts");
    if (res.ok) setAccounts(await res.json());
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  function openAdd() {
    setEditing(null);
    setForm({ platform: "youtube", accountName: "", username: "", isActive: true, authType: "manual", accessToken: "", refreshToken: "" });
    setShowForm(true);
  }

  function openEdit(account: SocialAccount) {
    setEditing(account);
    setForm({
      platform: account.platform,
      accountName: account.accountName,
      username: account.username,
      isActive: account.isActive,
      authType: account.authType,
      accessToken: account.accessToken || "",
      refreshToken: account.refreshToken || "",
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const url = editing ? `/api/accounts/${editing.id}` : "/api/accounts";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setToast({ message: editing ? "Account updated" : "Account added", type: "success" });
        setShowForm(false);
        loadAccounts();
      } else {
        const data = await res.json();
        setToast({ message: data.error || "Failed", type: "error" });
      }
    } catch {
      setToast({ message: "Network error", type: "error" });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this account?")) return;
    const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    if (res.ok) {
      setToast({ message: "Account deleted", type: "success" });
      loadAccounts();
    } else {
      setToast({ message: "Failed to delete", type: "error" });
    }
  }

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-md text-sm font-medium shadow-lg ${
          toast.type === "success" ? "bg-green-500 text-white" : "bg-red-500 text-white"
        }`}>{toast.message}</div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Social Accounts</h1>
        <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium">
          + Add Account
        </button>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-4 text-gray-900">{editing ? "Edit Account" : "Add Account"}</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Platform</label>
                <select
                  value={form.platform}
                  onChange={(e) => setForm({ ...form, platform: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
                >
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                <input type="text" value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900" required />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="isActive" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                <label htmlFor="isActive" className="text-sm text-gray-700">Active</label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Access Token</label>
                <input type="password" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900" placeholder="Optional - for API integration" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Refresh Token</label>
                <input type="password" value={form.refreshToken} onChange={(e) => setForm({ ...form, refreshToken: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900" placeholder="Optional" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium">
                  {editing ? "Update" : "Add"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Platform</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Account Name</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Username</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Status</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Auth</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No accounts yet. Add one to get started.</td></tr>
            ) : (
              accounts.map((account) => (
                <tr key={account.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${platformColors[account.platform] || "bg-gray-100"}`}>
                      {account.platform}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-900 font-medium">{account.accountName}</td>
                  <td className="px-4 py-3 text-gray-600">@{account.username}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block w-2 h-2 rounded-full mr-1 ${account.isActive ? "bg-green-500" : "bg-gray-400"}`} />
                    <span className="text-gray-700">{account.isActive ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{account.authType}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => openEdit(account)} className="text-blue-600 hover:text-blue-800 mr-3 text-xs font-medium">Edit</button>
                    <button onClick={() => handleDelete(account.id)} className="text-red-600 hover:text-red-800 text-xs font-medium">Delete</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
