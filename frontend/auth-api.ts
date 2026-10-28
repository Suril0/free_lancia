import type { ApiProject } from "./project-api";

export type AppRole = "client" | "freelancer";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  title: string | null;
  bio: string | null;
  location: string | null;
  roles: AppRole[];
  activeRole: AppRole;
  emailVerified: boolean;
  wallet: { address: string; chainId: number; verifiedAt: string } | null;
  clientProfile: { paymentVerified: boolean } | null;
  freelancerProfile: {
    skills: string[];
    ratingAvg: string;
    ratingCount: number;
    completedProjects: number;
    successRate: string;
    totalEarned: string;
    badges: string[];
  } | null;
  settings: {
    email: boolean;
    push: boolean;
    productUpdates: boolean;
  } | null;
}

export interface ApiNotification {
  id: string;
  type: string;
  title: string;
  detail: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  allowRefresh = true,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (
    response.status === 401 &&
    allowRefresh &&
    !["/auth/login", "/auth/signup", "/auth/refresh", "/auth/logout"].includes(path)
  ) {
    try {
      await refreshSession();
      return request<T>(path, init, false);
    } catch {
      throw await readError(response);
    }
  }

  if (!response.ok) throw await readError(response);
  return response.json() as Promise<T>;
}

let refreshInFlight: Promise<void> | undefined;

function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = request("/auth/refresh", { method: "POST" }, false)
      .then(() => undefined)
      .finally(() => {
        refreshInFlight = undefined;
      });
  }
  return refreshInFlight;
}

async function readError(response: Response) {
  let body: { code?: string; message?: string } = {};
  try {
    body = await response.json();
  } catch {
    // Keep the HTTP status as a useful error if the server returned no JSON.
  }
  return new ApiError(
    response.status,
    body.code ?? "REQUEST_FAILED",
    body.message ?? "The request could not be completed. Please try again.",
  );
}

export const authApi = {
  async login(email: string, password: string) {
    return request<{ user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  async signup(email: string, password: string, name: string, role: AppRole) {
    return request<{ user: AuthUser }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, name, role }),
    });
  },

  async restoreSession() {
    await refreshSession();
    return request<{ user: AuthUser }>("/auth/me");
  },

  async logout() {
    return request<{ ok: true }>("/auth/logout", { method: "POST" });
  },

  async setRole(role: AppRole) {
    return request<{ user: AuthUser }>("/auth/me/role", {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
  },

  async updateProfile(input: { name?: string; title?: string | null; bio?: string | null; location?: string | null }) {
    return request<{ user: AuthUser }>("/auth/me", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },

  async notificationSettings() {
    return request<{ settings: { email: boolean; push: boolean; productUpdates: boolean } | null }>("/auth/me/settings");
  },

  async updateNotificationSettings(input: { email?: boolean; push?: boolean; productUpdates?: boolean }) {
    return request<{ settings: { email: boolean; push: boolean; productUpdates: boolean } }>("/auth/me/settings", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },

  async dashboard(role: AppRole) {
    return request<{ role: AppRole; stats: Record<string, string | number | { month: string; amount: string }[]> }>(`/projects/me/dashboard?role=${role}`);
  },

  async myProjects(role: AppRole) {
    return request<{ items: ApiProject[] }>(`/projects/me?role=${role}`);
  },

  async notifications(unread?: boolean) {
    const query = unread === undefined ? "" : `?unread=${unread}`;
    return request<{ items: ApiNotification[]; total: number; unreadCount: number; page: number; pageCount: number }>(`/notifications${query}`);
  },

  async markNotificationRead(notificationId: string) {
    return request<{ ok: true }>(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: "PATCH" });
  },

  async markAllNotificationsRead() {
    return request<{ ok: true; updated: number }>("/notifications/read-all", { method: "POST" });
  },

  async signInWithWallet(role: AppRole = "freelancer") {
    if (!window.ethereum) throw new Error("Install a browser wallet such as MetaMask to continue.");
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
      throw new Error("No wallet account is available.");
    }
    const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
    if (typeof chainIdHex !== "string" || !/^0x[0-9a-f]+$/i.test(chainIdHex)) {
      throw new Error("The wallet returned an invalid chain ID.");
    }
    const { message } = await request<{ message: string }>("/auth/wallet/siwe/nonce", {
      method: "POST",
      body: JSON.stringify({ address: accounts[0], chainId: Number.parseInt(chainIdHex, 16), role }),
    });
    const signature = await window.ethereum.request({
      method: "personal_sign",
      params: [message, accounts[0]],
    });
    if (typeof signature !== "string") throw new Error("The wallet did not return a signature.");
    return request<{ user: AuthUser; walletLinked: boolean }>("/auth/wallet/siwe/verify", {
      method: "POST",
      body: JSON.stringify({ message, signature }),
    });
  },
};
