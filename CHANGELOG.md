# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Under Review

<!-- Public change list for community input. Add suggestions via GitHub Issues. -->

### Planned

<!-- Items accepted for next release. -->

---

## Roadmap

The following items are planned for future releases. Community contributions welcome.

### Evidence Management

- [ ] S3 Object Lock integration for WORM compliance
- [ ] Multi-region evidence replication
- [ ] Evidence expiration policies with 7-year retention

### Additional Regulations

- [ ] Regulation A+ (17 CFR 230.251-263)
- [ ] Regulation CF (17 CFR 227)
- [ ] Investment Company Act controls
- [ ] Broker-Dealer compliance (15c3-3, 17a-4)

### Integrations

- [ ] AWS Textract for document OCR
- [ ] DocuSign/Adobe Sign webhook receivers
- [ ] Salesforce compliance object sync
- [ ] Bloomberg PolarLake integration

### Compliance Frameworks

- [ ] SOC 2 Type II control mapping
- [ ] ISO 27001 Annex A alignment
- [ ] NIST CSF 2.0 profile

### Developer Experience

- [ ] OpenAPI 3.1 specification
- [ ] SDK generation (TypeScript, Python)
- [ ] Postman collection with examples

---

## [0.2.0] - 2026-01-25

### Added

- OSCAL 1.2.0 control catalog for Regulation D (17 CFR 230.500-508)
- JSON-LD schemas for all Regulation D provisions
- Evidence Locker API with PostgreSQL persistence
- Immutable audit trail with SHA-256 hash chain
- Gap detection service for control coverage analysis
- Red team security analysis test suite
- Terraform infrastructure for AWS ECS deployment
- Pre-commit hooks with Prettier and ESLint

### Documentation

- Architecture Decision Records (ADRs)
- Framework extension recipes for 11 compliance domains
- Developer quick start guide
- Implementation checklist for compliance teams

---

## [0.1.0] - 2026-01-10

### Added

- Initial JSON-LD schema structure
- Basic OSCAL control catalog
- Project scaffolding

[Unreleased]: https://github.com/GrottoAndrew/securities-law-schema/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/GrottoAndrew/securities-law-schema/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/GrottoAndrew/securities-law-schema/releases/tag/v0.1.0
