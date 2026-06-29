// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

const REPO_OWNER = "claude-server";
const REPO_NAME = "claude-nim";
const API_BASE = "https://api.github.com";

interface GitHubFileResponse {
  content: string;
  sha: string;
  name: string;
}

interface UserData {
  users: Array<{ id: string; joined: string }>;
  totalUsers: number;
}

export async function readFile(
  path: string,
  token?: string,
): Promise<{ content: string; sha: string } | null> {
  try {
    const url = `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "claude-nim-proxy",
    };
    if (token) headers.Authorization = `token ${token}`;

    const res = await fetch(url, { headers });
    if (!res.ok) return null;

    const data = (await res.json()) as GitHubFileResponse;
    return {
      content: Buffer.from(data.content, "base64").toString("utf8"),
      sha: data.sha,
    };
  } catch {
    return null;
  }
}

export async function updateFile(
  path: string,
  content: string,
  sha: string,
  message: string,
  token: string,
): Promise<boolean> {
  try {
    const url = `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "claude-nim-proxy",
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString("base64"),
        sha,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface MessageEntry {
  id: string;
  text: string;
  hardwareId: string;
  timestamp: string;
}

export async function appendMessage(
  text: string,
  hardwareId: string,
  token: string,
): Promise<boolean> {
  const path = "data/messages.json";
  const existing = await readFile(path, token);
  let data: { messages: MessageEntry[] };
  let sha: string;

  if (existing) {
    data = JSON.parse(existing.content) as { messages: MessageEntry[] };
    sha = existing.sha;
  } else {
    data = { messages: [] };
    sha = "";
  }

  data.messages.push({
    id: `msg_${Date.now()}`,
    text,
    hardwareId,
    timestamp: new Date().toISOString(),
  });

  const newContent = JSON.stringify(data, null, 2);
  const message = sha
    ? `chore: add message #${data.messages.length}`
    : "chore: initialize messages file";

  if (sha) {
    return updateFile(path, newContent, sha, message, token);
  }

  try {
    const url = `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "claude-nim-proxy",
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(newContent).toString("base64"),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function appendUser(
  path: string,
  hardwareId: string,
  token: string,
): Promise<boolean> {
  const existing = await readFile(path, token);
  let data: UserData;
  let sha: string;

  if (existing) {
    data = JSON.parse(existing.content) as UserData;
    sha = existing.sha;
  } else {
    data = { users: [], totalUsers: 0 };
    sha = "";
  }

  if (data.users.some((u) => u.id === hardwareId)) {
    return true;
  }

  data.users.push({
    id: hardwareId,
    joined: new Date().toISOString(),
  });
  data.totalUsers = data.users.length;

  const newContent = JSON.stringify(data, null, 2);
  const message = sha
    ? `chore: add user #${data.totalUsers}`
    : "chore: initialize users file";

  if (sha) {
    return updateFile(path, newContent, sha, message, token);
  }

  try {
    const url = `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "claude-nim-proxy",
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(newContent).toString("base64"),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
