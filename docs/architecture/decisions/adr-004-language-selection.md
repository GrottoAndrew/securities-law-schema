# ADR-004: Programming Language Selection

**Status**: Proposed
**Date**: 2026-01-20
**Deciders**: Architecture Team
**Context**: Audit trail, compliance engine, and API implementation

---

## Decision Criteria (Per Requirements)

1. Industry standard among financial services compliance platforms
2. Analogous to mature GRC architectures (don't reinvent wheel)
3. Least likely for AI-assisted development errors
4. Most efficient tradeoff (cost, speed, maintainability)
5. Tiebreaker: Highest likelihood of adoption

---

## Candidates Evaluated

| Language | Considered For |
|----------|----------------|
| Go | Core engine, audit trail, crypto |
| Python | Data pipelines, RAG, scripting |
| TypeScript | API, JSON-LD, OSCAL tooling, UI |
| Rust | Performance-critical components |
| Erlang/Elixir | High-concurrency systems |
| Java | Enterprise GRC legacy |

---

## Analysis Matrix

### Criterion 1: Financial Services Compliance Industry Standard

| Language | Usage in Compliance Platforms | Score |
|----------|------------------------------|-------|
| **Java** | Legacy GRC (Archer, ServiceNow backend), OSCAL-CLI | 8/10 |
| **Go** | Modern compliance-as-code (OPA, Falco, HashiCorp), audit systems | 8/10 |
| **Python** | Automation, SIEM integrations, data analysis | 7/10 |
| **TypeScript** | Modern SaaS compliance (Vanta, Drata, Secureframe backends) | 7/10 |
| **Rust** | Emerging in security tooling, not mainstream | 4/10 |
| **Erlang** | Telecom/messaging, rare in compliance | 2/10 |

**Analysis**: Java and Go tie for enterprise compliance. Java is legacy, Go is modern trajectory. Modern compliance SaaS (Vanta, Drata, Secureframe, Laika) predominantly use TypeScript backends with Go for performance-critical paths.

### Criterion 2: GRC/Compliance Platform Architecture Patterns

Surveyed implementations: Vanta, Drata, Secureframe, Laika, ACA ComplianceAlpha

| Language | GRC Ecosystem Fit | Score |
|----------|------------------|-------|
| **Go** | Control assessment engines, policy enforcement | 9/10 |
| **TypeScript** | API layers, OSCAL processing, integrations | 8/10 |
| **Python** | Evidence collection scripts, reporting | 7/10 |
| **Java** | Legacy integrations only | 5/10 |
| **Rust** | Not observed in compliance tooling | 2/10 |
| **Erlang** | Not observed | 1/10 |

**Analysis**: Modern GRC architectures use Go for core engines, TypeScript for APIs. This pattern applies directly to securities compliance systems.

### Criterion 3: AI Development Error Likelihood

Based on training data availability, language complexity, and common failure modes:

| Language | AI Error Rate | Common AI Failures | Score (lower=better) |
|----------|--------------|--------------------|-----------------------|
| **Python** | Lowest | Indentation (rare), dynamic typing edge cases | 9/10 |
| **TypeScript** | Low | Type inference errors, async/await misuse | 8/10 |
| **Go** | Medium | Interface satisfaction, goroutine leaks, error handling verbosity | 7/10 |
| **Java** | Medium | Boilerplate errors, null handling | 6/10 |
| **Rust** | High | Borrow checker, lifetime annotations | 4/10 |
| **Erlang** | Very High | Pattern matching, OTP behaviors, limited training data | 2/10 |

**Analysis**: Python has lowest AI error rate due to massive training corpus and simple syntax. TypeScript second due to type system guardrails. Rust/Erlang have insufficient training data for reliable AI-assisted development.

### Criterion 4: Efficiency Tradeoff (Cost/Speed/Maintainability)

| Language | Runtime Perf | Dev Speed | Ops Cost | Talent Cost | Total Score |
|----------|-------------|-----------|----------|-------------|-------------|
| **Go** | 9/10 | 7/10 | 9/10 (single binary) | 6/10 | 7.75 |
| **Python** | 4/10 | 9/10 | 6/10 | 9/10 | 7.0 |
| **TypeScript** | 6/10 | 8/10 | 7/10 | 8/10 | 7.25 |
| **Rust** | 10/10 | 4/10 | 8/10 | 4/10 | 6.5 |
| **Java** | 7/10 | 5/10 | 5/10 | 7/10 | 6.0 |
| **Erlang** | 7/10 | 5/10 | 6/10 | 3/10 | 5.25 |

**Analysis**: Go wins on efficiency when considering full lifecycle. Python wins on development speed and talent availability. TypeScript is balanced.

### Criterion 5: Adoption Likelihood (Tiebreaker)

| Language | Developer Pool | Learning Curve | Ecosystem Momentum | Score |
|----------|---------------|----------------|-------------------|-------|
| **Python** | Massive | Gentle | Strong | 10/10 |
| **TypeScript** | Large | Moderate | Very Strong | 9/10 |
| **Go** | Growing | Moderate | Strong | 7/10 |
| **Java** | Large but aging | Steep (modern) | Declining | 5/10 |
| **Rust** | Small, passionate | Steep | Growing | 4/10 |
| **Erlang** | Tiny | Very Steep | Niche | 2/10 |

---

## Technology-Specific Requirements

### JSON-LD Support

| Language | Library | Maturity | Score |
|----------|---------|----------|-------|
| **TypeScript** | jsonld.js (Digital Bazaar) | Reference implementation | 10/10 |
| **Python** | pyld | Maintained, complete | 8/10 |
| **Java** | jsonld-java | Complete | 7/10 |
| **Go** | go-jsonld | Incomplete, limited maintainers | 4/10 |
| **Rust** | json-ld (sophia) | Partial | 3/10 |

**Critical Finding**: Go has weak JSON-LD support. This is a significant constraint given JSON-LD is core to the regulatory schema design.

### OSCAL Tooling

| Language | Official Support | Score |
|----------|-----------------|-------|
| **Java** | oscal-cli (NIST official) | 9/10 |
| **TypeScript** | oscal-js (community, growing) | 7/10 |
| **Python** | pyOSCAL (limited) | 5/10 |
| **Go** | None official | 3/10 |

### Merkle Tree / Cryptographic Operations

| Language | Library Quality | Performance | Score |
|----------|----------------|-------------|-------|
| **Go** | crypto/sha256 (stdlib), merkletree libs | Excellent | 9/10 |
| **Rust** | rs-merkle, ring | Best | 10/10 |
| **Python** | merkletools, hashlib | Adequate | 6/10 |
| **TypeScript** | merkletreejs | Good | 7/10 |

### S3/AWS Integration

All languages have mature AWS SDKs. No differentiation.

---

## Composite Scores

| Language | Criterion 1 | Criterion 2 | Criterion 3 | Criterion 4 | Criterion 5 | JSON-LD | OSCAL | Crypto | **TOTAL** |
|----------|-------------|-------------|-------------|-------------|-------------|---------|-------|--------|-----------|
| **Go** | 8 | 9 | 7 | 7.75 | 7 | 4 | 3 | 9 | **54.75** |
| **TypeScript** | 7 | 8 | 8 | 7.25 | 9 | 10 | 7 | 7 | **63.25** |
| **Python** | 7 | 7 | 9 | 7.0 | 10 | 8 | 5 | 6 | **59.0** |
| **Java** | 8 | 5 | 6 | 6.0 | 5 | 7 | 9 | 7 | **53.0** |
| **Rust** | 4 | 2 | 4 | 6.5 | 4 | 3 | 2 | 10 | **35.5** |
| **Erlang** | 2 | 1 | 2 | 5.25 | 2 | 1 | 1 | 5 | **19.25** |

---

## Recommendation

### Primary: TypeScript (Node.js 20+ LTS)

**Rationale**:
1. Highest composite score (63.25)
2. Reference JSON-LD implementation (critical for this project)
3. Best OSCAL community tooling trajectory
4. Direct bolt.new/Vite/React integration for dashboard
5. Low AI error rate with type safety
6. High adoption likelihood (financial services increasingly TypeScript)

### Secondary: Go for Performance-Critical Modules

**Where Go is justified**:
- Merkle tree computation (if processing >100K records/sec)
- Cryptographic signing hot path
- CLI binary distribution

**Implementation**: Build as separate Go modules, call via:
- FFI bindings (napi-rs pattern)
- gRPC microservice
- CLI subprocess

### Python Role: Data Pipelines Only

**Limited to**:
- RAG/ML integration
- Regulatory text extraction scripts
- One-off data migrations

**Not for**: Core application logic, API, audit trail

---

## Hybrid Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        PRESENTATION                              │
│                  React + Vite (TypeScript)                       │
│                  (or bolt.new generated)                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API LAYER                                │
│              TypeScript (Express/Fastify/Hono)                   │
│                                                                  │
│  • JSON-LD processing (jsonld.js)                               │
│  • OSCAL parsing/validation                                      │
│  • REST/GraphQL endpoints                                        │
│  • Authentication/Authorization                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CORE ENGINE                                 │
│                      TypeScript                                  │
│                                                                  │
│  • Audit trail writer                                           │
│  • Hash chain management                                         │
│  • Merkle tree (TS implementation, Go optional)                 │
│  • Evidence locker logic                                         │
│  • Control assessment engine                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DATA / STORAGE                                │
│                                                                  │
│  PostgreSQL          S3 Object Lock         Redis (optional)    │
│  (Aurora)            (COMPLIANCE mode)      (caching)           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DATA PIPELINES                                │
│                    Python 3.13+                                  │
│                                                                  │
│  • eCFR XML extraction                                          │
│  • RAG embeddings                                                │
│  • Regulatory change detection                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| TypeScript Merkle tree performance | Benchmark first; Go module if needed |
| JSON-LD library bugs | jsonld.js is reference impl, low risk |
| Node.js memory for large evidence sets | Stream processing, pagination |
| Team unfamiliar with TypeScript | Python familiarity transfers; types optional initially |

---

## Decision

**Approved**: TypeScript (primary) + Python (data pipelines)

**Rejected**:
- Go as primary (JSON-LD support insufficient)
- Rust/Erlang (adoption risk too high)
- Java (legacy trajectory)

**Conditional**: Go modules for crypto hot paths if benchmarks justify

---

## References

- Digital Bazaar jsonld.js: https://github.com/digitalbazaar/jsonld.js
- OSCAL TypeScript: https://github.com/oscal-compass
- Vanta/Drata architecture patterns (public talks, blog posts)
- NIST OSCAL tooling survey
