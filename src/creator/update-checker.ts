// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import chalk from "chalk";
import { readFile } from "./github-client";

const UPDATES_PATH = "data/updates.json";

export interface UpdateAnnouncement {
  id: string;
  date: string;
  type: "benchmark" | "new-model" | "announcement";
  title: string;
  body: string;
}

export interface FastestModel {
  model: string;
  rank: number;
  tokensPerSec: number;
}

export interface CommunityStats {
  totalUsers: number;
  totalRequests: number;
  topModel: string;
}

export interface UpdateData {
  latestVersion: string;
  announcements: UpdateAnnouncement[];
  fastestModels: FastestModel[];
  communityStats: CommunityStats;
}

export async function fetchUpdates(): Promise<UpdateData | null> {
  const file = await readFile(UPDATES_PATH);
  if (!file) return null;

  try {
    return JSON.parse(file.content) as UpdateData;
  } catch {
    return null;
  }
}

function medal(rank: number): string {
  if (rank === 1) return "\uD83E\uDD47";
  if (rank === 2) return "\uD83E\uDD48";
  if (rank === 3) return "\uD83E\uDD49";
  return "  ";
}

export function formatUpdateMessage(
  updates: UpdateData,
  currentVersion: string,
): string | null {
  const lines: string[] = [];
  const accent = chalk.hex("#9B7BF0");
  const dim = chalk.dim;
  const bold = chalk.bold;
  const green = chalk.hex("#4CAF50");

  const hasNewVersion =
    updates.latestVersion && updates.latestVersion !== currentVersion;
  const hasAnnouncements = updates.announcements.length > 0;
  const hasModels = updates.fastestModels.length > 0;
  const hasStats =
    updates.communityStats && updates.communityStats.totalUsers > 0;

  if (!hasNewVersion && !hasAnnouncements && !hasModels && !hasStats) {
    return null;
  }

  lines.push("");
  lines.push(`  ${accent("\u2501".repeat(44))}`);
  lines.push(`  ${accent("\u2503")}  ${bold(accent("Claude-NIM Updates"))}`);
  lines.push(`  ${accent("\u2503")}  ${dim(`v${currentVersion}`)}`);
  lines.push(
    `  ${accent("\u2517")}${accent("\u2500".repeat(44))}${accent("\u251B")}`,
  );

  if (hasNewVersion) {
    lines.push("");
    lines.push(
      `  ${green("\u2714")} New version available: ${bold(updates.latestVersion)}`,
    );
    lines.push(`    ${dim("Run: npm install -g claude-nim@latest")}`);
  }

  if (hasAnnouncements) {
    lines.push("");
    lines.push(`  ${accent("Announcements")}`);
    for (const ann of updates.announcements.slice(0, 3)) {
      const icon =
        ann.type === "benchmark"
          ? "\u26A1"
          : ann.type === "new-model"
            ? "\u2B50"
            : "\u2139";
      lines.push(`  ${icon} ${bold(ann.title)}`);
      if (ann.body) {
        lines.push(`    ${dim(ann.body.slice(0, 120))}`);
      }
    }
  }

  if (hasModels) {
    lines.push("");
    lines.push(`  ${accent("Fastest Models on NIM")}`);
    for (const m of updates.fastestModels.slice(0, 5)) {
      lines.push(
        `  ${medal(m.rank)} #${m.rank} ${m.model} ${dim(`(${m.tokensPerSec} tok/s)`)}`,
      );
    }
  }

  if (hasStats) {
    const s = updates.communityStats;
    lines.push("");
    lines.push(`  ${accent("Community")}`);
    lines.push(
      `  ${dim(`${s.totalUsers} users \u00B7 ${s.totalRequests.toLocaleString()} requests \u00B7 Top: ${s.topModel}`)}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}
