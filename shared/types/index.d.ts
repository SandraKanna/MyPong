// WS message envelope shared between gateway-ws and internal service clients.
export interface WsEnvelope {
  type: string;
  userId?: number;   // injected by gateway-ws on browser→service routing
  to?: number[];     // fan-out targets on service→browser messages; stripped before forwarding
  service?: string;  // present only on service:register
  token?: string;    // present only on service:register
  payload?: unknown;
}

// Canonical reason codes for match:rejected across match-service and game-service.
export type MatchRejectionReason = 'already_in_match' | 'guest_not_allowed';
