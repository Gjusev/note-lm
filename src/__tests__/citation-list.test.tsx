import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CitationList } from "@/components/notebook/citation-list";
it("keeps the cited excerpt and original title readable after the source changes", () => {
  render(<CitationList citations={[{
    sourceId: "a", chunkIndex: 4, text: "Saved evidence, before reimport.", fileName: "Original.pdf",
  }]} sources={[{ _id: "a", fileName: "Renamed.pdf" }]} />);
  const summary = screen.getByText(/Original.pdf/);
  expect(summary.tagName).toBe("SUMMARY");
  expect(summary).toHaveTextContent("[1]");
  expect(summary).toHaveTextContent("Abschnitt 5");
  expect(screen.getByText("Saved evidence, before reimport.").closest("details")).not.toBeNull();
});
