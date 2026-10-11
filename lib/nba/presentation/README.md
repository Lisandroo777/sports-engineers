# NBA Pick Presentation Contract

This namespace is a standalone presentation adapter. It consumes upstream candidate values and an authoritative six-tier decision; it does not classify, qualify, price, or rank picks.

`buildPickPresentation` copies player-prop or game-line identity, tier reasons and requirements, sportsbook quote fields, supplied probability/EV/scores, season-phase context, and evidence references. Null values stay null. Missing odds are exposed as `pricing.state: 'UNPRICED'`; missing tier decisions or research evidence are displayed as `RESEARCH_ONLY`. A source `PASS` remains `PASS`. These display states do not replace or mutate the source tier decision.

Game-line markets are `MONEYLINE`, `SPREAD`, `TOTAL`, and `TEAM_TOTAL`. Their support here describes card shape only; it does not claim that any upstream model or data source can produce a market.

The requested sort is descriptive. Pass authoritative candidate ID orders from the upstream BEST, MOST LIKELY, or BEST VALUE selectors in `upstreamRankings`, keyed by that sort mode. Only the matching mode is applied. Without it, input order is preserved and `sortStatus` is `SOURCE_ORDER`. Unlisted IDs remain in their original relative order. No local probability, EV, tier score, or other metric is used to sort.

An empty input yields `NO_QUALIFIED_PICKS`; no placeholder pick or PASS card is synthesized. PASS inputs are omitted by default and included only when `includePasses` is true.