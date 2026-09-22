import { mlbFetch } from './client';
import type { MLBVenue } from './types';

export async function getMLBVenue(venueId: string): Promise<MLBVenue | null> {
  try {
    const payload = await mlbFetch<{ venue?: Record<string, unknown> }>(`/venues/${venueId}`, {
      revalidate: 3600,
    });

    const venue = payload.venue ?? {};
    return {
      id: String(venue.id ?? venueId),
      stadiumName: String(venue.name ?? 'Unknown Stadium'),
      city: String(venue.city ?? 'Unknown City'),
      state: String(venue.state ?? 'Unknown State'),
      timezone: String(venue.timezone ?? 'America/New_York'),
    };
  } catch (error) {
    console.error('[mlb] Unable to load venue data.', error);
    return null;
  }
}
