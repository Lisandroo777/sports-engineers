export type NFLOpportunityAvailability = 'LIVE AVAILABLE' | 'DERIVABLE' | 'HISTORICALLY AVAILABLE' | 'NOT AVAILABLE';

export interface NFLOpportunityDataField {
  group: 'QB' | 'RB' | 'WR / TE';
  field: string;
  availability: NFLOpportunityAvailability;
  source: string;
  note: string;
}

const historical = 'ESPN completed-player game logs';
const absent = 'No connected source';

export const NFL_OPPORTUNITY_DATA_AUDIT: NFLOpportunityDataField[] = [
  { group: 'QB', field: 'Pass attempts', availability: 'HISTORICALLY AVAILABLE', source: historical, note: 'Player attempts per completed game; no upcoming team-volume forecast.' },
  { group: 'QB', field: 'Completions', availability: 'HISTORICALLY AVAILABLE', source: historical, note: 'Player completions per completed game.' },
  { group: 'QB', field: 'Dropbacks', availability: 'NOT AVAILABLE', source: absent, note: 'Attempts plus sacks is not used as a dropback substitute.' },
  { group: 'QB', field: 'Designed rushes', availability: 'NOT AVAILABLE', source: absent, note: 'Not separated in the connected log fields.' },
  { group: 'QB', field: 'Scrambles', availability: 'NOT AVAILABLE', source: absent, note: 'Not separated in the connected log fields.' },
  { group: 'QB', field: 'Red-zone attempts', availability: 'NOT AVAILABLE', source: absent, note: 'No play-location data connected.' },
  { group: 'QB', field: 'Rushing attempts', availability: 'HISTORICALLY AVAILABLE', source: historical, note: 'Total player rushing attempts; designed runs and scrambles are combined.' },
  { group: 'RB', field: 'Carries', availability: 'HISTORICALLY AVAILABLE', source: historical, note: 'Recorded as rushing attempts.' },
  { group: 'RB', field: 'Targets', availability: 'HISTORICALLY AVAILABLE', source: historical, note: 'Recorded per completed game.' },
  { group: 'RB', field: 'Receptions', availability: 'HISTORICALLY AVAILABLE', source: historical, note: 'Recorded per completed game.' },
  { group: 'RB', field: 'Touches', availability: 'DERIVABLE', source: 'Carries + receptions', note: 'Only when both source fields exist; no opportunity share implied.' },
  { group: 'RB', field: 'Snaps', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'RB', field: 'Snap share', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'RB', field: 'Routes', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'RB', field: 'Route participation', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'RB', field: 'Carry share', availability: 'NOT AVAILABLE', source: absent, note: 'Team rushing attempts by game are not connected.' },
  { group: 'RB', field: 'Target share', availability: 'NOT AVAILABLE', source: absent, note: 'Team targets by game are not connected.' },
  { group: 'RB', field: 'Red-zone carries', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'RB', field: 'Goal-line carries', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'RB', field: 'Third-down usage', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'RB', field: 'Two-minute usage', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'WR / TE', field: 'Targets', availability: 'HISTORICALLY AVAILABLE', source: historical, note: 'Recorded per completed game.' },
  { group: 'WR / TE', field: 'Receptions', availability: 'HISTORICALLY AVAILABLE', source: historical, note: 'Recorded per completed game.' },
  { group: 'WR / TE', field: 'Snaps', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'WR / TE', field: 'Snap share', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'WR / TE', field: 'Routes', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'WR / TE', field: 'Route participation', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'WR / TE', field: 'Target share', availability: 'NOT AVAILABLE', source: absent, note: 'Raw targets are available; team targets are not.' },
  { group: 'WR / TE', field: 'Air yards', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'WR / TE', field: 'Air-yard share', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'WR / TE', field: 'aDOT', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'WR / TE', field: 'Red-zone targets', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'WR / TE', field: 'End-zone targets', availability: 'NOT AVAILABLE', source: absent, note: '' },
  { group: 'WR / TE', field: 'Slot / outside alignment', availability: 'NOT AVAILABLE', source: absent, note: '' },
];