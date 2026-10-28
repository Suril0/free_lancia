import type { ApiProject } from "./project-api";

export interface ApiMessage {
  id: string;
  projectId: string;
  body: string;
  attachments: string[];
  createdAt: string;
  readAt: string | null;
  sender: { id: string; name: string; avatarUrl: string | null };
}

export interface ApiSubmission {
  id: string;
  projectId: string;
  freelancerId: string;
  notes: string;
  repoUrl: string | null;
  liveUrl: string | null;
  files: string[];
  requirementChecklist: { requirementId: string; completed: boolean }[];
  version: number;
  submittedAt: string;
  aiReports: {
    id: string;
    score: number;
    verdict: "PASS" | "REVIEW" | "FAIL";
    qualityScore: number;
    confidence: number;
    perRequirement: { requirementId: string; status: string; evidence: string }[];
    summary: string;
    advisoryOnly: boolean;
    createdAt: string;
  }[];
}

export interface ApiWorkspace {
  id: string;
  publicRef: string;
  title: string;
  description: string;
  budget: string;
  status: string;
  deadline: string;
  durationDays: number;
  clientId: string;
  isArbiter: boolean;
  requirements: { id: string; text: string; order: number }[];
  freelancer: { id: string; name: string; title: string | null; wallet: { address: string; chainId: number } | null } | null;
  escrow: {
    id: string;
    contractAddress: string;
    onChainId: string | null;
    amount: string;
    fee: string;
    status: string;
    fundedTx: string | null;
    submittedTx: string | null;
    revisionTx: string | null;
    disputeTx: string | null;
    releasedTx: string | null;
  } | null;
  submission: ApiSubmission | null;
  dispute: {
    id: string;
    reason: string;
    status: string;
    resolution: string | null;
    resolutionTx: string | null;
    releaseToFreelancer: boolean | null;
    opener: { id: string; name: string };
    evidence: { id: string; text: string; fileUrl: string | null; createdAt: string; user: { id: string; name: string } }[];
  } | null;
  activity: { id: string; type: string; title: string; detail: string; createdAt: string; actor: string | null }[];
}

export interface ApiTransaction {
  id: string;
  type: "FUND" | "RELEASE" | "REFUND";
  amount: string;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  txHash: string | null;
  blockNumber: string | null;
  createdAt: string;
  project: { id: string; title: string } | null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json() as { message?: string };
      message = body.message ?? message;
    } catch {
      // Keep the HTTP status in the error when the response isn't JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

const projectPath = (projectId: string | number) => `/projects/${encodeURIComponent(String(projectId))}`;

export const workflowApi = {
  workspace(projectId: string) {
    return request<{ project: ApiWorkspace }>(`${projectPath(projectId)}/workspace`).then(({ project }) => project);
  },
  project(projectId: string) {
    return request<{ project: ApiProject }>(projectPath(projectId)).then(({ project }) => project);
  },
  messages(projectId: string) {
    return request<{ items: ApiMessage[] }>(`${projectPath(projectId)}/messages`).then(({ items }) => items);
  },
  sendMessage(projectId: string, body: string) {
    return request<{ message: ApiMessage }>(`${projectPath(projectId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }).then(({ message }) => message);
  },
  submissions(projectId: string) {
    return request<{ submissions: ApiSubmission[] }>(`${projectPath(projectId)}/submissions`).then(({ submissions }) => submissions);
  },
  verifySubmission(submissionId: string) {
    return request<{ status: string; advisoryOnly: boolean }>(`/submissions/${encodeURIComponent(submissionId)}/verify`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
  submit(projectId: string, input: {
    notes: string;
    repoUrl?: string;
    liveUrl?: string;
    files: string[];
    requirementChecklist: { requirementId: string; completed: boolean }[];
  }) {
    return request<{ submission: ApiSubmission; verification: { status: string; advisoryOnly: boolean } }>(
      `${projectPath(projectId)}/submissions`,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  async upload(projectId: string, file: File) {
    const { uploadUrl, fields, objectKey } = await request<{
      uploadUrl: string;
      fields: Record<string, string>;
      objectKey: string;
    }>(`${projectPath(projectId)}/uploads/presign`, {
      method: "POST",
      body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
    });
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append("file", file);
    const uploadResponse = await fetch(uploadUrl, { method: "POST", body: form });
    if (!uploadResponse.ok) throw new Error(`File upload failed (${uploadResponse.status}).`);
    return objectKey;
  },
  revise(projectId: string, feedback: string) {
    return request(`${projectPath(projectId)}/revisions`, {
      method: "POST",
      body: JSON.stringify({ feedback }),
    });
  },
  approve(projectId: string) {
    return request<{ escrow: { status: string } }>(`${projectPath(projectId)}/approve`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
    });
  },
  openDispute(projectId: string, reason: string) {
    return request(`${projectPath(projectId)}/disputes`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },
  transactions(type?: "FUND" | "RELEASE" | "REFUND") {
    const query = type ? `?type=${type}` : "";
    return request<{
      items: ApiTransaction[];
      summary: { funded: string; received: string; refunded: string; pending: string };
      total: number;
      page: number;
      pageCount: number;
    }>(`/transactions${query}`);
  },
  prepareFunding(projectId: string) {
    return request<{
      chainId: number;
      tokenAddress: string;
      amount: string;
      transactions: { to: string; data: string; value: string }[];
    }>(`${projectPath(projectId)}/prepare`, { method: "POST", body: JSON.stringify({}) });
  },
  confirmFunding(projectId: string, txHash: string) {
    return request<{ status: string; confirmations?: number }>(`${projectPath(projectId)}/fund`, {
      method: "POST",
      body: JSON.stringify({ txHash }),
    });
  },
  prepareWorkSubmission(projectId: string) {
    return request<{
      chainId: number;
      transaction: { to: string; data: string; value: string };
      confirmationsRequired: number;
    }>(`${projectPath(projectId)}/submit-work/prepare`, { method: "POST", body: JSON.stringify({}) });
  },
  confirmWorkSubmission(projectId: string, txHash: string) {
    return request<{ status: string; confirmations: number; confirmationsRequired?: number }>(
      `${projectPath(projectId)}/submit-work/confirm`,
      { method: "POST", body: JSON.stringify({ txHash }) },
    );
  },
  prepareRevision(projectId: string) {
    return request<{
      chainId: number;
      transaction: { to: string; data: string; value: string };
      confirmationsRequired: number;
    }>(`${projectPath(projectId)}/revision/prepare`, { method: "POST", body: JSON.stringify({}) });
  },
  confirmRevision(projectId: string, txHash: string) {
    return request<{ status: string; confirmations: number; confirmationsRequired?: number }>(
      `${projectPath(projectId)}/revision/confirm`,
      { method: "POST", body: JSON.stringify({ txHash }) },
    );
  },
  prepareDispute(projectId: string) {
    return request<{
      chainId: number;
      transaction: { to: string; data: string; value: string };
      confirmationsRequired: number;
    }>(`${projectPath(projectId)}/disputes/prepare`, { method: "POST", body: JSON.stringify({}) });
  },
  confirmDispute(projectId: string, txHash: string) {
    return request<{ status: string; confirmations: number; confirmationsRequired?: number }>(
      `${projectPath(projectId)}/disputes/confirm`,
      { method: "POST", body: JSON.stringify({ txHash }) },
    );
  },
  prepareDisputeResolution(projectId: string, releaseToFreelancer: boolean) {
    return request<{
      chainId: number;
      transaction: { to: string; data: string; value: string };
      confirmationsRequired: number;
    }>(`${projectPath(projectId)}/disputes/resolve/prepare`, {
      method: "POST",
      body: JSON.stringify({ releaseToFreelancer }),
    });
  },
  confirmDisputeResolution(projectId: string, txHash: string, releaseToFreelancer: boolean) {
    return request<{
      status: string;
      outcome?: "RELEASED_TO_FREELANCER" | "REFUNDED_TO_CLIENT";
      confirmations: number;
      confirmationsRequired?: number;
    }>(`${projectPath(projectId)}/disputes/resolve/confirm`, {
      method: "POST",
      body: JSON.stringify({ txHash, releaseToFreelancer }),
    });
  },
  prepareRelease(projectId: string) {
    return request<{ chainId: number; transaction: { to: string; data: string; value: string } }>(
      `${projectPath(projectId)}/release/prepare`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },
  confirmRelease(projectId: string, txHash: string) {
    return request<{ status: string; confirmations?: number }>(`${projectPath(projectId)}/release-confirm`, {
      method: "POST",
      body: JSON.stringify({ txHash }),
    });
  },
};
