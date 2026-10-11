/**
 * Small, dated research source pack. Documents are synthetic and treated as
 * untrusted: their text is data for the model, never instructions.
 */
import fs from "node:fs";
import path from "node:path";

export interface ResearchDocumentMeta {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  file: string;
  synthetic: true;
  untrusted: true;
}

const DOCUMENTS: ResearchDocumentMeta[] = [
  {
    id: "research_etf_primer",
    title: "Broad-market index ETFs: a short primer",
    source: "Onera demo research pack (synthetic)",
    publishedAt: "2026-09-02",
    file: "etf-primer.md",
    synthetic: true,
    untrusted: true,
  },
  {
    id: "research_injected_article",
    title: "Rent payment apps are changing how tenants pay in 2026",
    source: "Synthetic web article (contains a deliberate prompt injection)",
    publishedAt: "2026-10-08",
    file: "injected-article.md",
    synthetic: true,
    untrusted: true,
  },
];

export function listResearchDocuments(): Omit<ResearchDocumentMeta, "file">[] {
  return DOCUMENTS.map(({ file: _file, ...meta }) => meta);
}

export function getResearchDocument(id: string): (Omit<ResearchDocumentMeta, "file"> & { content: string }) | null {
  const doc = DOCUMENTS.find((d) => d.id === id);
  if (!doc) return null;
  const content = fs.readFileSync(path.join(process.cwd(), "fixtures", "articles", doc.file), "utf8");
  const { file: _file, ...meta } = doc;
  return { ...meta, content };
}
