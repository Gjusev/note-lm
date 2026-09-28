interface Citation {
  sourceId: string;
  chunkIndex: number;
  text: string;
  fileName?: string;
}

/** Shows the saved evidence snapshot, including after a source is reimported. */
export function CitationList({ citations, sources = [] }: {
  citations: Citation[];
  sources?: { _id: string; fileName: string }[];
}) {
  if (!citations.length) return null;
  return (
    <div className="mt-3 pt-3 border-t border-rule/20 space-y-2" aria-label="Quellenbelege">
      {citations.map((citation, index) => (
        <details key={`${citation.sourceId}:${citation.chunkIndex}:${index}`} className="text-sm">
          <summary className="cursor-pointer text-accent rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 px-1 py-1">
            [{index + 1}] {citation.fileName || sources.find((source) => source._id === citation.sourceId)?.fileName || "Quelle"}
            <span className="ml-2 text-xs text-ink/60">Abschnitt {citation.chunkIndex + 1}</span>
          </summary>
          <blockquote className="mt-2 border-l-2 border-accent/30 pl-3 whitespace-pre-wrap break-words">
            {citation.text}
          </blockquote>
        </details>
      ))}
    </div>
  );
}
