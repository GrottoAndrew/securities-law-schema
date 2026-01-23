# Contributing

Thank you for your interest in improving securities law machine-readability.

## How to Contribute

### Reporting Issues

- **Regulatory text errors** - If you find text that doesn't match the CFR, open an issue with the specific citation and correction.
- **Schema structure issues** - If the JSON-LD structure doesn't properly represent the regulatory hierarchy, describe the problem and proposed fix.
- **Feature requests** - Suggest additional regulations, forms, or tooling.

### Adding Regulations

1. **Source from eCFR** - Always use authoritative CFR text from ecfr.gov or govinfo.gov bulk data.
2. **Preserve hierarchy** - Maintain the exact CFR structure (sections, subsections, paragraphs, clauses).
3. **Verbatim text** - Do not paraphrase or summarize. Transcribe exactly.
4. **Include citations** - Every element should reference its CFR citation.

### Pull Request Process

1. Fork the repository
2. Create a branch (`git checkout -b regulation-a-schema`)
3. Make your changes
4. Test JSON-LD validity
5. Submit PR with clear description of what was added/changed

## Schema Standards

### File Naming

- Regulation files: `17cfr{part}.{section}.jsonld` (e.g., `17cfr230.501.jsonld`)
- Context files: `{domain}-context.jsonld` (e.g., `securities-context.jsonld`)

### JSON-LD Structure

```json
{
  "@context": "../contexts/securities-context.jsonld",
  "@id": "cfr:17/230.501",
  "@type": "cfr:Section",
  "citation": "17 CFR 230.501",
  "title": "Section title from CFR",
  "subsection": [...]
}
```

### Required Fields

- `@id` - Unique identifier using CFR citation
- `@type` - Element type (Section, Subsection, Paragraph, etc.)
- `citation` - Human-readable CFR citation
- `text` - Verbatim regulatory text (where applicable)
- `designation` - The letter/number designation ((a), (1), (i), etc.)

## Questions

Open an issue or contact the maintainers.
