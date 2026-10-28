export interface ApiProject {
  id: string;
  clientId: string;
  publicRef: string;
  title: string;
  description: string;
  budget: string;
  currency: "PYUSD";
  deadline: string;
  durationDays: number;
  skills: string[];
  experienceLevel: string;
  remote: boolean;
  status: string;
  featured: boolean;
  proposalCount: number;
  createdAt: string;
  client: {
    name: string;
    location: string | null;
    paymentVerified: boolean;
    projectsPosted: number;
    totalSpent: string;
    ratingAvg: string;
  };
  requirements?: { id: string; text: string; order: number }[];
}

export interface ProjectSearchResult {
  items: ApiProject[];
  total: number;
  page: number;
  pageCount: number;
}

export interface ProjectSearch {
  q?: string;
  skills?: string[];
  minBudget?: number;
  maxBudget?: number;
  deadlineBefore?: string;
  sort?: "relevant" | "newest" | "budget";
  page?: number;
  pageSize?: number;
}

export interface ApiProposal {
  id: string;
  projectId: string;
  freelancerId: string;
  price: string;
  deliveryDays: number;
  coverMessage: string;
  status: "PENDING" | "SHORTLISTED" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
  createdAt: string;
  freelancer: {
    id: string;
    name: string;
    title: string | null;
    avatarUrl: string | null;
    freelancerProfile: {
      ratingAvg: string;
      ratingCount: number;
      completedProjects: number;
      successRate: string;
      skills: string[];
    } | null;
    wallet?: { address: string; chainId: number } | null;
  };
  shortlist?: { id: string } | null;
}

export async function fetchProjects(search: ProjectSearch = {}): Promise<ProjectSearchResult> {
  const params = new URLSearchParams();
  if (search.q) params.set("q", search.q);
  if (search.skills?.length) params.set("skills", search.skills.join(","));
  if (search.minBudget !== undefined) params.set("minBudget", String(search.minBudget));
  if (search.maxBudget !== undefined) params.set("maxBudget", String(search.maxBudget));
  if (search.deadlineBefore) params.set("deadlineBefore", search.deadlineBefore);
  if (search.sort) params.set("sort", search.sort);
  if (search.page !== undefined) params.set("page", String(search.page));
  if (search.pageSize !== undefined) params.set("pageSize", String(search.pageSize));

  const response = await fetch(`/api/v1/projects?${params.toString()}`, {
    credentials: "include",
  });
  if (!response.ok) {
    let message = "Could not load projects.";
    try {
      const body = await response.json() as { message?: string };
      message = body.message ?? message;
    } catch {
      // Keep a clear request error when the server returns a non-JSON response.
    }
    throw new Error(message);
  }
  return response.json() as Promise<ProjectSearchResult>;
}

export async function fetchFeaturedProjects(): Promise<ApiProject[]> {
  const response = await fetch("/api/v1/projects/featured", {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Could not load featured projects.");
  const result = await response.json() as { items: ApiProject[] };
  return result.items;
}

export async function fetchProject(projectId: string): Promise<ApiProject> {
  const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
    credentials: "include",
  });
  if (!response.ok) {
    let message = "Could not load this project.";
    try {
      const body = await response.json() as { message?: string };
      message = body.message ?? message;
    } catch {
      // Preserve the default message when an error response has no JSON body.
    }
    throw new Error(message);
  }
  const result = await response.json() as { project: ApiProject };
  return result.project;
}

async function postJson<T>(path: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = "The request could not be completed.";
    try {
      const result = await response.json() as {
        message?: string;
        details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
      };
      message = result.message ?? message;
      const fieldError = Object.entries(result.details?.fieldErrors ?? {})
        .find(([, messages]) => messages.length > 0);
      const validationError = fieldError
        ? `${fieldError[0]}: ${fieldError[1][0]}`
        : result.details?.formErrors?.[0];
      if (validationError) message = `${message} ${validationError}`;
    } catch {
      // Preserve the HTTP error fallback when the server returns no JSON body.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function createProject(input: {
  title: string;
  description: string;
  budget: string;
  durationDays: number;
  deadline: string;
  skills: string[];
  requirements: string[];
}) {
  return postJson<{ project: ApiProject }>("/projects", input);
}

export function submitProposal(projectId: string | number, input: {
  price: string;
  deliveryDays: number;
  coverMessage: string;
}) {
  return postJson(`/projects/${encodeURIComponent(String(projectId))}/proposals`, input);
}

export function fetchProjectProposals(projectId: string | number) {
  return requestJson<{ items: ApiProposal[] }>(`/projects/${encodeURIComponent(String(projectId))}/proposals`);
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { credentials: "include" });
  if (!response.ok) {
    let message = "Could not load this data.";
    try {
      const result = await response.json() as { message?: string };
      message = result.message ?? message;
    } catch {
      // Keep the fallback message when the API returns a non-JSON response.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function updateProposalStatus(proposalId: string, status: "SHORTLISTED" | "REJECTED") {
  return postJson<{ proposal: ApiProposal }>(`/proposals/${encodeURIComponent(proposalId)}`, { status }, "PATCH");
}

export function hireProposal(proposalId: string) {
  return postJson<{ proposal: ApiProposal }>(`/proposals/${encodeURIComponent(proposalId)}/hire`, {}, "POST");
}
