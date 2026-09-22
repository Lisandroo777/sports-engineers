/**
 * AI Finder service layer — deterministic mock logic.
 * Structure is designed so interpretQuery/rankProps can later be replaced
 * with a real AI model (OpenAI, Anthropic, etc.) without rebuilding the page.
 */

import type { PropResearchItem } from "../../app/research/mockData";
import type { EliteResearchAnalysis } from './eliteResearchFilter';
import type { DeepResearchCard } from '../finder/deepResearchCard';
import { dateIntentFromText, type NaturalDateIntent } from '../dateModel';

// ─── types ────────────────────────────────────────────────────────────────────

export interface AiSearchCriteria {
  sport: string;
  dateIntent: NaturalDateIntent | null;
  playerType: "hitter" | "pitcher" | "any";
  propTypes: string[];
  side: "Over" | "Under" | "any";
  minConfidence: number;
  minL10: number;
  minL5: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "any";
  maxResults: number;
  teams: string[];
  plusMoneyOnly: boolean;
  rawQuery: string;
  summaryText: string;
}

export interface AiResult {
  prop: PropResearchItem;
  eliteResearch?: EliteResearchAnalysis;
  deepResearch?: DeepResearchCard;
  matchScore: number;    // 0-100: how well the prop matches the user's search
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  matchReasons: string[];
  riskNotes: string[];
  aiReason: string;
}

// ─── interpret ────────────────────────────────────────────────────────────────

/** Convert a free-text query into structured search criteria. */
export function interpretQuery(rawQuery: string): AiSearchCriteria {
  const q = rawQuery.toLowerCase();

  // ── sport ────────────────────────────────────────────────────────────────────
  const sport =
    q.includes("nba") || q.includes("basketball") ? "NBA" :
    q.includes("nfl") || q.includes("football") ? "NFL" :
    q.includes("nhl") || q.includes("hockey") ? "NHL" : "MLB";

  // ── player type ───────────────────────────────────────────────────────────
  const pitcherTerms = ["pitcher", "strikeout", "starting pitcher", " ks "];
  const hitterTerms = ["hitter", "batter", "hits", "home run", "total base", "rbi", "bats"];
  const isPitcher = pitcherTerms.some((t) => q.includes(t)) && !hitterTerms.some((t) => q.includes(t));
  const isHitter = hitterTerms.some((t) => q.includes(t));
  const playerType: AiSearchCriteria["playerType"] = isPitcher ? "pitcher" : isHitter ? "hitter" : "any";

  // ── prop types ────────────────────────────────────────────────────────────
  const propTypes: string[] = [];
  if (q.includes("home run") || q.includes("homer") || /\bhr\b/.test(q)) propTypes.push("Home Runs");
  if (q.includes("total base") || /\btb\b/.test(q)) propTypes.push("Total Bases");
  if (/\bhits?\b/.test(q) && !q.includes("homer")) propTypes.push("Hits");
  if (q.includes("strikeout") || /\bk\b/.test(q)) propTypes.push("Strikeouts");
  if (q.includes("rbi")) propTypes.push("RBIs");
  if (/\bruns?\b/.test(q) && !q.includes("home run")) propTypes.push("Runs");

  // ── side ──────────────────────────────────────────────────────────────────
  const side: AiSearchCriteria["side"] =
    /\bovers?\b/.test(q) ? "Over" : /\bunders?\b/.test(q) ? "Under" : "any";

  // ── confidence threshold ──────────────────────────────────────────────────
  let minConfidence = 65;
  if (/high confidence|best plays|strongest|premium/i.test(q)) minConfidence = 78;
  if (/low.?risk|safe|conservative|careful/i.test(q)) minConfidence = 72;
  const confMatch = q.match(/(\d{2,3})%?\s*(?:confidence|conf|min)/);
  if (confMatch) minConfidence = Math.min(95, parseInt(confMatch[1]));

  // ── L10 hit rate ──────────────────────────────────────────────────────────
  let minL10 = 0;
  if (/strong recent|good recent|hot streak|trending/i.test(q)) minL10 = 65;
  const l10Match = q.match(/(\d{2,3})%?\s*l10/i) || q.match(/l10\s*(\d{2,3})%?/i);
  if (l10Match) minL10 = parseInt(l10Match[1]);

  // ── risk level ────────────────────────────────────────────────────────────
  const riskLevel: AiSearchCriteria["riskLevel"] =
    /low.?risk|safe|conservative|careful/i.test(q) ? "LOW" :
    /high.?risk|volatile|risky|aggressive/i.test(q) ? "HIGH" : "any";

  // ── max results ───────────────────────────────────────────────────────────
  // A ceiling, never a quota — fewer qualifying picks are returned as-is.
  // Allows modifiers between the count and the noun ("15 best MLB plays").
  const numMatch = q.match(/\b(\d+)\s+(?:[a-z][a-z+-]*\s+){0,4}?(?:plays?|props?|picks?|results?|opportunities?)\b/i);
  const maxResults = numMatch ? Math.min(15, Math.max(1, parseInt(numMatch[1]))) : 15;

  // ── plus money ────────────────────────────────────────────────────────────
  const plusMoneyOnly = /plus.?money|\+money|value plays|plus odds/i.test(q);

  // ── team filters ──────────────────────────────────────────────────────────
  const teams: string[] = [];
  if (/yankees?|\bnyy\b/i.test(q)) teams.push("Yankees");
  if (/red sox|\bbos\b/i.test(q)) teams.push("Red Sox");
  if (/dodgers?|\blad\b/i.test(q)) teams.push("Dodgers");
  if (/giants?|\bsfg\b/i.test(q)) teams.push("Giants");
  if (/phillies?|\bphi\b/i.test(q)) teams.push("Phillies");
  if (/marlins?|\bmia\b/i.test(q)) teams.push("Marlins");

  // ── build human-readable summary ──────────────────────────────────────────
  const parts: string[] = [];
  if (maxResults < 15) parts.push(`${maxResults}`);
  if (riskLevel === "LOW") parts.push("low-risk");
  if (plusMoneyOnly) parts.push("plus-money");
  if (minConfidence >= 78) parts.push("high-confidence");
  if (playerType === "hitter") parts.push("hitter");
  if (playerType === "pitcher") parts.push("pitcher");
  if (propTypes.length > 0) parts.push(propTypes.map((p) => p.toLowerCase()).join("/"));
  if (side !== "any") parts.push(`${side.toLowerCase()} props`);
  else parts.push("MLB plays");
  if (teams.length > 0) parts.push(`(${teams.join(", ")})`);
  if (minL10 > 0) parts.push(`with L10 ≥ ${minL10}%`);

  return {
    sport, dateIntent: dateIntentFromText(rawQuery), playerType, propTypes, side,
    minConfidence, minL10, minL5: 0,
    riskLevel, maxResults, teams, plusMoneyOnly,
    rawQuery, summaryText: parts.join(" "),
  };
}

// ─── rank ─────────────────────────────────────────────────────────────────────

/** Score and rank props against interpreted search criteria. */
export function rankProps(props: PropResearchItem[], criteria: AiSearchCriteria): AiResult[] {
  const PITCHER_PROPS = ["Strikeouts", "Walks", "Innings Pitched", "Outs Pitched"];

  const scored = props
    .filter((p) => p.sport === criteria.sport)
    .map((prop): AiResult | null => {
      const reasons: string[] = [];
      const riskNotes: string[] = [];
      let score = 0;
      let maxScore = 0;

      const isPitcherProp = PITCHER_PROPS.includes(prop.propType);
      const propOdds = parseFloat(prop.overOdds);

      // prop type match
      if (criteria.propTypes.length > 0) {
        maxScore += 30;
        if (criteria.propTypes.includes(prop.propType)) {
          score += 30;
          reasons.push(`Matches requested ${prop.propType} market`);
        }
      }

      // player type match
      if (criteria.playerType !== "any") {
        maxScore += 20;
        const match = (criteria.playerType === "pitcher" && isPitcherProp) ||
                      (criteria.playerType === "hitter" && !isPitcherProp);
        if (match) { score += 20; reasons.push(`${criteria.playerType} prop type matches`); }
      }

      // confidence threshold
      maxScore += 25;
      if (prop.confidence >= criteria.minConfidence) {
        score += 25;
        reasons.push(`${prop.confidence}% confidence meets ${criteria.minConfidence}%+ threshold`);
      } else {
        score += Math.max(0, Math.floor(25 * (prop.confidence / criteria.minConfidence)));
      }

      // L10 hit rate
      if (criteria.minL10 > 0) {
        maxScore += 20;
        if (prop.hitRates.last10 >= criteria.minL10) {
          score += 20;
          reasons.push(`L10 hit rate ${prop.hitRates.last10}% exceeds ${criteria.minL10}% threshold`);
        }
      }

      // side
      if (criteria.side !== "any") {
        maxScore += 15;
        if (prop.researchSide === criteria.side) {
          score += 15;
          reasons.push(`${criteria.side} market matches request`);
        }
      }

      // plus money
      if (criteria.plusMoneyOnly) {
        maxScore += 20;
        if (propOdds > 0) { score += 20; reasons.push(`Plus-money odds (${prop.overOdds})`); }
      }

      // team filter
      if (criteria.teams.length > 0) {
        maxScore += 15;
        if (criteria.teams.includes(prop.team) || criteria.teams.some((t) => prop.opponent.includes(t))) {
          score += 15; reasons.push(`Involves ${prop.team}`);
        }
      }

      // projected PA bonus
      if (prop.projectedPlateAppearances && prop.projectedPlateAppearances >= 4) {
        reasons.push(`High projected PA (${prop.projectedPlateAppearances})`);
      }

      // recent form bonus
      if (prop.hitRates.last5 >= 70) reasons.push(`Strong L5 hit rate (${prop.hitRates.last5}%)`);

      const basePct = maxScore > 0 ? (score / maxScore) : 1;
      // Blend with confidence for final score
      const matchScore = Math.min(99, Math.round(basePct * 80 + (prop.confidence / 100) * 20));

      // ── risk ───────────────────────────────────────────────────────────────
      const highVariance = ["HomeRuns", "Home Runs"].includes(prop.propType);
      const riskLevel: "LOW" | "MEDIUM" | "HIGH" =
        highVariance || propOdds > 150 || prop.confidence < 65 ? "HIGH" :
        prop.confidence >= 78 && !highVariance ? "LOW" : "MEDIUM";

      if (highVariance) riskNotes.push("Home run props carry inherent variance");
      if (propOdds > 100) riskNotes.push(`Plus-money reflects lower market implied probability`);
      if (prop.hitRates.last5 < 60) riskNotes.push("Recent L5 trend is below average");
      if (riskNotes.length === 0) riskNotes.push("Standard market risk applies");

      const aiReason = prop.rationale ||
        `${prop.player} shows ${prop.confidence >= 75 ? "strong" : "solid"} ${prop.propType.toLowerCase()} potential based on recent form and matchup context.`;

      if (criteria.riskLevel !== "any" && criteria.riskLevel !== riskLevel) {
        if (matchScore < 50) return null;
      }

      return {
        prop, matchScore, riskLevel,
        matchReasons: reasons.slice(0, 4),
        riskNotes: riskNotes.slice(0, 2),
        aiReason,
      };
    })
    .filter((r): r is AiResult => r !== null);

  return scored
    .sort((a, b) => {
      const scoreDiff = (b.matchScore - a.matchScore) * 0.6;
      const confDiff = (b.prop.confidence - a.prop.confidence) * 0.4;
      return scoreDiff + confDiff;
    })
    .slice(0, criteria.maxResults);
}

/** Generate structured criteria display rows for the AI Interpretation panel. */
export function getCriteriaRows(criteria: AiSearchCriteria) {
  const rows: Array<{ label: string; value: string }> = [];
  rows.push({ label: "Sport", value: criteria.sport });
  if (criteria.playerType !== "any")
    rows.push({ label: "Player Type", value: criteria.playerType.charAt(0).toUpperCase() + criteria.playerType.slice(1) + "s" });
  if (criteria.propTypes.length > 0)
    rows.push({ label: "Markets", value: criteria.propTypes.join(", ") });
  if (criteria.side !== "any")
    rows.push({ label: "Side", value: criteria.side });
  rows.push({ label: "Min Confidence", value: `${criteria.minConfidence}%+` });
  if (criteria.minL10 > 0)
    rows.push({ label: "Min L10 Hit Rate", value: `${criteria.minL10}%+` });
  if (criteria.riskLevel !== "any")
    rows.push({ label: "Risk", value: criteria.riskLevel });
  if (criteria.plusMoneyOnly)
    rows.push({ label: "Odds", value: "Plus-money only" });
  if (criteria.teams.length > 0)
    rows.push({ label: "Teams", value: criteria.teams.join(", ") });
  rows.push({ label: "Max Results", value: String(criteria.maxResults) });
  return rows;
}
