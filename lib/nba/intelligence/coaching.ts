import type { VerifiedClaim } from './types';

export function buildCoaching(claims: VerifiedClaim[]): VerifiedClaim[] {
  return claims.filter(record => record.claim.speaker?.role === 'COACH' && ['STARTING_ROLE', 'MINUTES_RESTRICTION', 'ROTATION', 'ROLE', 'LINEUP'].includes(record.claim.topic));
}