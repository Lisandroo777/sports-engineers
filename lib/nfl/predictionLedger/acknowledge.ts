export async function acknowledgeNFLPresentation(receipt: string, candidateIds: string[], request: typeof fetch = fetch): Promise<void> {
  const body = JSON.stringify({ receipt, candidateIds: [...new Set(candidateIds)] });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await request('/api/nfl/ledger/capture', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      if (attempt === 0) continue;
      throw new Error('NFL presentation capture unavailable.');
    }
    if (response.ok) return;
    if (attempt === 0 && (response.status >= 500 || response.status === 429)) continue;
    throw new Error('NFL presentation capture rejected.');
  }
}