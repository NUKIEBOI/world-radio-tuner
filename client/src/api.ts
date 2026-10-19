// Typed RPC client for the standalone server. Mirrors the hosted artifact's
// action-client surface: `api.getCountries({})`, `api.getStations(args)`, etc.
// Each call POSTs JSON to /api/<action> and returns the parsed response.
//
// `import type` of the server actions is type-only by design: the client
// bundle never pulls in any server runtime (bun:sqlite, file APIs, etc.).

import type {
  ActionName,
  ActionRequest,
  ActionResponse,
} from "../../server/actions";

async function callAction<N extends ActionName>(
  name: N,
  args: ActionRequest<N>,
): Promise<ActionResponse<N>> {
  const res = await fetch(`/api/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : `request failed: HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as ActionResponse<N>;
}

export type Api = {
  [N in ActionName]: (args: ActionRequest<N>) => Promise<ActionResponse<N>>;
};

export const api = new Proxy({} as Api, {
  get:
    (_target, name: string) =>
    (args: unknown): Promise<unknown> =>
      callAction(name as ActionName, args as never),
});

// Convenience types matching the old SDK surface used across the app:
// ApiResponse<typeof api, "getCountries">, ApiRequest<typeof api, "getStations">.
export type ApiRequest<_A extends Api, N extends ActionName> =
  ActionRequest<N>;
export type ApiResponse<_A extends Api, N extends ActionName> =
  ActionResponse<N>;
