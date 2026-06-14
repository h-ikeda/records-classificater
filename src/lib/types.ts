// Wire formats shared between the API routes and the client. Dates are sent as
// ISO-8601 strings (Firestore Timestamps no longer exist).

export interface MeDTO {
  id: string;
  currentVehicleId: string | null;
}

export interface VehicleDTO {
  id: string;
  name: string;
  classes: string[];
  permissions: {
    read: string[];
    write: string[];
  };
}

export interface TripDTO {
  id: string;
  odo: number;
  class: string;
  timestamp: string; // ISO-8601
}

// Full snapshot pushed over SSE (and returned by the bootstrap fetch).
export interface SnapshotDTO {
  me: MeDTO;
  vehicles: VehicleDTO[];
  vehicleId: string | null;
  trips: TripDTO[];
}

export interface TripInput {
  odo: number;
  class: string;
  timestamp: string; // ISO-8601
}
