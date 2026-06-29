// ── Model routing ────────────────────────────────────────────────────────
//
// Resolve incoming Claude model names to configured NIM model pairs.
// Supports gateway-encoded model IDs (anthropic/nvidia_nim/<model>) for
// model discovery and multi-provider routing.

import { decodeNimGatewayModelId } from "./gateway-model-ids";

export interface ResolvedModel {
  originalModel: string;
  providerModel: string;
}

export class ModelRouter {
  private _nimModel: string;
  private _availableModels: string[] = [];

  constructor(nimModel: string) {
    this._nimModel = nimModel;
  }

  get nimModel(): string {
    return this._nimModel;
  }

  get availableModels(): string[] {
    return this._availableModels;
  }

  setNimModel(model: string): void {
    if (!model) throw new Error("Model name cannot be empty");
    this._nimModel = model;
  }

  setAvailableModels(models: string[]): void {
    this._availableModels = models;
  }

  resolve(claudeModel: string): ResolvedModel {
    const nimId = decodeNimGatewayModelId(claudeModel);
    if (nimId) {
      return { originalModel: claudeModel, providerModel: nimId };
    }
    return { originalModel: claudeModel, providerModel: this._nimModel };
  }
}
