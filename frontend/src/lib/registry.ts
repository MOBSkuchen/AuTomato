import { create } from "zustand";
import type { CustomTypeDef, ModuleDef, ModuleSource } from "./types";

const BACKEND_URL =
  (import.meta as unknown as { env?: { VITE_BACKEND_URL?: string } }).env
    ?.VITE_BACKEND_URL ?? "http://localhost:7878";

export type RegistryStatus = "loading" | "ready" | "error";

interface RegistryState {
  modules: ModuleDef[];
  customTypes: CustomTypeDef[];
  status: RegistryStatus;
  error: string | null;
  reload: () => Promise<void>;
}

async function fetchModules(): Promise<ModuleDef[]> {
  const res = await fetch(`${BACKEND_URL}/modules`);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${BACKEND_URL}/modules`);
  const json = (await res.json()) as ModuleDef[] | null;
  return json ?? [];
}

export const useRegistryStore = create<RegistryState>((set) => ({
  modules: [],
  customTypes: [],
  status: "loading",
  error: null,
  reload: async () => {
    try {
      const modules = await fetchModules();
      const customTypes = modules.flatMap((m) => m.exportedTypes);
      set({ modules, customTypes, status: "ready", error: null });
    } catch (e) {
      set({ status: "error", error: (e as Error).message });
    }
  },
}));

let started = false;
let eventSource: EventSource | null = null;

export function startRegistrySync(): void {
  if (started) return;
  started = true;
  void useRegistryStore.getState().reload();
  try {
    eventSource = new EventSource(`${BACKEND_URL}/modules/events`);
    eventSource.addEventListener("changed", () => {
      void useRegistryStore.getState().reload();
    });
  } catch {
    /* SSE unsupported; reload happens via manual retry */
  }
}

export interface RegistryFallback {
  findModule(id: string): ModuleDef | undefined;
  customTypes(): CustomTypeDef[];
}

let fallback: RegistryFallback | null = null;

export function setRegistryFallback(next: RegistryFallback | null): void {
  fallback = next;
}

export function findModule(id: string): ModuleDef | undefined {
  const live = useRegistryStore.getState().modules.find((m) => m.id === id);
  return live ?? fallback?.findModule(id);
}

export function findComponent(moduleId: string, componentName: string) {
  return findModule(moduleId)?.components.find((c) => c.name === componentName);
}

export function allKnownCustomTypes(): CustomTypeDef[] {
  const live = useRegistryStore.getState().customTypes;
  const extras = fallback?.customTypes() ?? [];
  if (extras.length === 0) return live;
  const seen = new Set(live.map((t) => t.name));
  const merged: CustomTypeDef[] = [...live];
  for (const t of extras) {
    if (!seen.has(t.name)) {
      seen.add(t.name);
      merged.push(t);
    }
  }
  return merged;
}

export function findCustomType(name: string): CustomTypeDef | undefined {
  return allKnownCustomTypes().find((t) => t.name === name);
}

export interface InstallSuccess {
  id: string;
  alreadyPresent: boolean;
  module: ModuleDef;
}

export async function installFromSource(
  source: ModuleSource,
): Promise<InstallSuccess> {
  const resp = await fetch(`${BACKEND_URL}/modules/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(source),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `HTTP ${resp.status} ${resp.statusText}`);
  }
  const body = (await resp.json()) as {
    id: string;
    already_present: boolean;
    module: ModuleDef;
  };
  return {
    id: body.id,
    alreadyPresent: body.already_present,
    module: body.module,
  };
}
