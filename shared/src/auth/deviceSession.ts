import {
  createDeviceSession,
  endDeviceSession,
  refreshDeviceSession,
  type DeviceSession,
  type DeviceSessionRequest,
} from "../generated";
import { callApi } from "../api/client";

/**
 * The three session operations of the operative app (T-003b), through the Adapter with
 * `refresh: false`: they are what refresh itself is made of, so a 401 here must never start
 * another refresh (it would wait on itself) or run `onUnauthorized` (the session manager owns
 * that state).
 */
export interface DeviceSessionApi {
  create(request: DeviceSessionRequest): Promise<DeviceSession>;
  refresh(refreshToken: string): Promise<DeviceSession>;
  end(): Promise<void>;
}

export const deviceSessionApi: DeviceSessionApi = {
  create: (request) => callApi(() => createDeviceSession({ body: request }), { refresh: false }),
  refresh: (refreshToken) =>
    callApi(() => refreshDeviceSession({ body: { refresh_token: refreshToken } }), { refresh: false }),
  end: async () => {
    await callApi(() => endDeviceSession(), { refresh: false });
  },
};
