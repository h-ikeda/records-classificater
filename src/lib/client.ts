'use client';

import { useEffect, useState } from 'react';
import type { MeDTO, SnapshotDTO, TripDTO, TripInput, VehicleDTO } from './types';

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getMe: () => request<MeDTO>('/api/me'),
  setCurrentVehicle: (currentVehicleId: string) =>
    request<MeDTO>('/api/me', { method: 'PATCH', body: JSON.stringify({ currentVehicleId }) }),
  listVehicles: () => request<VehicleDTO[]>('/api/vehicles'),
  createVehicle: (name: string, classes: string[]) =>
    request<VehicleDTO>('/api/vehicles', { method: 'POST', body: JSON.stringify({ name, classes }) }),
  getVehicle: (id: string) => request<VehicleDTO>(`/api/vehicles/${id}`),
  updateVehicle: (id: string, data: { name?: string; classes?: string[] }) =>
    request<VehicleDTO>(`/api/vehicles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  shareVehicle: (id: string, shareUserId: string) =>
    request<VehicleDTO>(`/api/vehicles/${id}`, { method: 'PATCH', body: JSON.stringify({ shareUserId }) }),
  listTrips: (vehicleId: string) => request<TripDTO[]>(`/api/vehicles/${vehicleId}/trips`),
  createTrip: (vehicleId: string, trip: TripInput) =>
    request<TripDTO>(`/api/vehicles/${vehicleId}/trips`, { method: 'POST', body: JSON.stringify(trip) }),
};

// Subscribe to the live snapshot stream for the given vehicle. Passing a new
// vehicleId transparently reconnects to a stream scoped to that vehicle's trips.
export function useSnapshot(vehicleId: string | null): SnapshotDTO | null {
  const [snapshot, setSnapshot] = useState<SnapshotDTO | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (vehicleId) params.set('vehicleId', vehicleId);
    const source = new EventSource(`/api/events?${params.toString()}`);
    source.addEventListener('snapshot', (event) => {
      setSnapshot(JSON.parse((event as MessageEvent).data) as SnapshotDTO);
    });
    return () => source.close();
  }, [vehicleId]);

  return snapshot;
}
