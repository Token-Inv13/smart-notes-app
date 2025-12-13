"use client";

import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";

export default function LogoutButton() {
  const handleLogout = async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      await signOut(auth);
      window.location.href = "/login";
    }
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="border border-border rounded px-3 py-1 bg-background"
    >
      Logout
    </button>
  );
}
