# Securities Law Schema

Machine-readable U.S. securities regulations in JSON-LD format, with OSCAL control mappings for compliance automation.

## Overview

This repository provides:

1. **Regulatory Text** (JSON-LD) — Verbatim CFR text in a structured, queryable format
2. **Control Catalog** (OSCAL) — Compliance controls mapped to regulatory requirements
3. **Architecture Docs** — Reference design for a compliance evidence management system

## Quick Start

### Browse Regulations

```bash
# View Regulation D definitions (accredited investor, etc.)
cat schemas/regulation-d/17cfr230.501.jsonld | jq '.subsection[0].paragraph[] | {designation, text}'
```

### Find a Specific Provision

```bash
# Find accredited investor income threshold
cat schemas/regulation-d/17cfr230.501.jsonld | jq '
  .subsection[0].paragraph[] |
  select(.designation == "(6)") |
  .text
'
```

### List Controls for a Regulation

```bash
# Get all controls referencing 17 CFR 230.501
cat controls/regulation-d-controls.json | jq '
  .catalog.groups[].controls[] |
  select(.props[]? | select(.name == "regulation-citation" and (.value | contains("230.501")))) |
  {id, title, citation: .props[] | select(.name == "regulation-citation") | .value}
'
```

## Repository Structure

```
securities-law-schema/
├── contexts/
│   └── securities-context.jsonld    # JSON-LD vocabulary definitions
├── schemas/
│   └── regulation-d/
│       ├── 17cfr230.500.jsonld      # Use of Regulation D
│       ├── 17cfr230.501.jsonld      # Definitions and terms
│       ├── 17cfr230.502.jsonld      # General conditions
│       ├── 17cfr230.503.jsonld      # Filing of notice of sales
│       ├── 17cfr230.504.jsonld      # $10M exemption
│       ├── 17cfr230.505.jsonld      # [Reserved]
│       ├── 17cfr230.506.jsonld      # Rule 506(b)/506(c)
│       ├── 17cfr230.507.jsonld      # Disqualification
│       └── 17cfr230.508.jsonld      # Insignificant deviations
├── controls/
│   └── regulation-d-controls.json   # OSCAL control catalog
├── source/
│   └── cfr/
│       └── ECFR-title17.xml         # Source CFR bulk data
├── docs/
│   ├── architecture/
│   │   ├── overview.md              # System architecture
│   │   ├── data-flow.md             # Data flow diagrams
│   │   ├── security.md              # Security architecture
│   │   ├── evidence-locker.md       # Evidence storage design
│   │   └── decisions/               # Architecture Decision Records
│   │       └── adr-001-*.md         # Audit trail technology
│   └── for-developers/
│       └── [coming soon]
├── CONTRIBUTING.md                   # Contribution guidelines
├── UNDERSTANDING.md                  # Guide for lawyers
└── LICENSE                           # MIT License
```

## Data Formats

### JSON-LD Regulations

Regulations follow the CFR hierarchy:

```
Section → Subsection → Paragraph → Clause → Subclause
  501       (a)          (1)        (i)       (A)
```

Each element includes:
- `@id` — Unique identifier (e.g., `cfr:17/230.501(a)(6)`)
- `@type` — Element type (Section, Subsection, etc.)
- `citation` — Human-readable citation
- `designation` — The letter/number designation
- `text` — Verbatim regulatory text

### OSCAL Controls

Controls follow NIST OSCAL format with extensions:
- `regulation-citation` — Links to CFR provision
- `regulation-ref` — JSON-LD reference for machine linking
- `evidence-requirements` — What evidence satisfies the control

## Use Cases

### 1. Compliance Checklists

Generate checklists directly from control requirements:

```bash
cat controls/regulation-d-controls.json | jq '
  [.catalog.groups[].controls[].controls[]? |
   select(.parts[]?.name == "evidence-requirements") |
   {control: .title, evidence: [.parts[] | select(.name == "evidence-requirements") | .parts[].prose]}]
'
```

### 2. Regulatory Mapping

Map internal procedures to regulatory provisions:

```json
{
  "procedure": "Investor Qualification Review",
  "procedure_id": "PROC-4.2.1",
  "implements": [
    "cfr:17/230.501(a)(5)",
    "cfr:17/230.501(a)(6)",
    "cfr:17/230.506(c)(2)(ii)"
  ]
}
```

### 3. Evidence Management

Link evidence artifacts to control requirements (see architecture docs).

### 4. AI/LLM Grounding

Use as authoritative source for AI systems answering securities law questions.

## Architecture Reference

The `docs/architecture/` folder contains a reference design for building a complete compliance management system:

| Document | Description |
|----------|-------------|
| [overview.md](docs/architecture/overview.md) | System layers and components |
| [data-flow.md](docs/architecture/data-flow.md) | How data moves through the system |
| [security.md](docs/architecture/security.md) | Authentication, encryption, audit |
| [evidence-locker.md](docs/architecture/evidence-locker.md) | Database schema and API design |

Key features of the reference architecture:
- **Immutable audit trails** with Merkle tree verification
- **Cryptographically signed** catalog versions
- **Time-limited auditor access** (read-only)
- **Evidence integrity verification** with proof generation

## Current Status

**This is a reference architecture with complete Regulation D schema coverage.**

| Component | Status | Notes |
|-----------|--------|-------|
| JSON-LD Context | Complete | Vocabulary for regulatory text |
| 17 CFR 230.500 | Complete | Use of Regulation D, subsections (a)-(g) |
| 17 CFR 230.501 | Complete | All 10 subsections (a)-(j), notes, amendment history |
| 17 CFR 230.502 | Complete | General conditions to be met |
| 17 CFR 230.503 | Complete | Filing of notice of sales |
| 17 CFR 230.504 | Complete | $10M exemption |
| 17 CFR 230.505 | Complete | [Reserved] |
| 17 CFR 230.506 | Complete | Rule 506(b) and 506(c) exemptions, bad actor provisions |
| 17 CFR 230.507 | Complete | Disqualification provisions |
| 17 CFR 230.508 | Complete | Insignificant deviations |
| OSCAL Controls | Complete | 100% of controls link to valid schemas |
| Architecture Docs | Complete | Reference design with QLDB alternatives documented |
| Implementation Code | None | Documentation and data only, no working software |

## Roadmap

### Phase 1: Foundation (Complete)
- [x] JSON-LD context vocabulary
- [x] Regulation D Sections 500-508 (all sections)
- [x] OSCAL control catalog with valid links
- [x] Architecture documentation
- [x] QLDB alternative documented (Aurora PostgreSQL + S3 Object Lock)

### Phase 2: Tooling
- [ ] Basic validation scripts
- [ ] CLI tool to query regulations
- [ ] Evidence locker database schema

### Phase 3: Additional Regulations
- [ ] Regulation A (230.251-263)
- [ ] Regulation S (230.901-905)
- [ ] Regulation Crowdfunding

### Phase 4: Advanced Tooling
- [ ] JSON-LD validation scripts
- [ ] OSCAL validation scripts
- [ ] Compliance status calculator
- [ ] Evidence gap analyzer

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:
- Adding new regulations
- Schema standards
- Pull request process

## For Lawyers

New to JSON-LD? See [UNDERSTANDING.md](UNDERSTANDING.md) for a guide explaining:
- What this project is
- Why machine-readable regulations matter
- How to read the schema files
- Practical applications

## License

MIT License — see [LICENSE](LICENSE)

## Related Standards

- [OSCAL](https://pages.nist.gov/OSCAL/) — NIST Open Security Controls Assessment Language
- [JSON-LD](https://json-ld.org/) — JSON for Linked Data
- [eCFR](https://www.ecfr.gov/) — Electronic Code of Federal Regulations
