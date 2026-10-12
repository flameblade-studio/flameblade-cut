/**
 * "Search moments by words": type a word, see matching transcript lines,
 * click one to jump the source preview there. Traditional/Simplified Chinese
 * match each other once the OpenCC normalizer has loaded.
 */
import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "@/icons/lucide-compat";
import { basicNormalizer, createScriptNormalizer, searchTranscript, type TextNormalizer } from "../../services/highlights/search";
import { formatTimestamp } from "../../services/highlights/transcript";
import type { TranscriptSegment } from "../../services/highlights/types";

export interface TranscriptSearchProps {
  readonly segments: readonly TranscriptSegment[];
  readonly onJump: (seconds: number) => void;
}

export function TranscriptSearch(props: TranscriptSearchProps): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [normalize, setNormalize] = useState<{ fn: TextNormalizer }>({ fn: basicNormalizer });

  useEffect(() => {
    let alive = true;
    createScriptNormalizer().then(
      (fn) => {
        if (alive) setNormalize({ fn });
      },
      (error: unknown) => console.warn("[highlights] OpenCC unavailable; using basic matching", error),
    );
    return () => {
      alive = false;
    };
  }, []);

  const matches = useMemo(() => searchTranscript(props.segments, query, normalize.fn), [props.segments, query, normalize]);
  const trimmed = query.trim();

  return (
    <section className="flex flex-col gap-2">
      <label className="relative block">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" aria-hidden />
        <input
          type="search"
          className="fc-input !pl-9"
          placeholder={t("highlights.search.placeholder")}
          aria-label={t("highlights.search.placeholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {trimmed && (
        <div className="fc-card fc-scroll max-h-[220px] overflow-y-auto !shadow-none">
          {matches.length === 0 ? (
            <p className="px-4 py-3 text-[12.5px] text-fg-3">{t("highlights.search.none", { query: trimmed })}</p>
          ) : (
            <>
              <p className="px-4 pt-2.5 text-[11.5px] font-semibold text-fg-3">{t("highlights.search.count", { count: matches.length })}</p>
              <ul className="py-1">
                {matches.map((match) => (
                  <li key={match.segmentIndex}>
                    <button
                      type="button"
                      className="flex w-full items-baseline gap-3 px-4 py-2 text-left transition-colors hover:bg-[var(--hover)]"
                      onClick={() => props.onJump(match.start)}
                    >
                      <span className="shrink-0 font-mono text-[12px] tabular-nums text-[var(--gold)]">{formatTimestamp(match.start)}</span>
                      <span className="text-[13px] leading-relaxed text-fg-2">{match.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
