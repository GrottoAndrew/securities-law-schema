# Red Team Analysis Report

**Date**: 2026-01-19
**Scope**: Complete Regulation D schema and OSCAL controls implementation
**Analyst**: Automated code review

---

## Executive Summary

The Regulation D schema implementation (230.500-230.508) and OSCAL control catalog are structurally sound but contain several issues requiring attention. This report identifies bugs, inefficiencies, and recommendations for ongoing maintenance.

---

## CRITICAL ISSUES

### 1. Schema 230.500 - Heading/Text Misalignment

**Severity**: CRITICAL
**File**: `schemas/regulation-d/17cfr230.500.jsonld`
**Issue**: The `headingText` values for subsections (a)-(g) appear misaligned with actual text content.

**Current State**:
| Subsection | headingText | Actual Topic in Text |
|------------|-------------|---------------------|
| (a) | "Antifraud provisions apply" | Non-exclusive election |
| (c) | "Non-exclusive election" | Issuer-only exemption |
| (d) | "Issuer only" | Business combinations |
| (e) | "Business combinations" | Anti-evasion |
| (f) | "Anti-evasion" | Resale restrictions |

**Fix Required**: Verify against eCFR source and correct headingText values OR remove headingText if not in original regulation (230.500 paragraphs may not have official headings).

**Impact**: Incorrect metadata could mislead consumers of the schema.

---

### 2. README Missing 230.500 in File Listing

**Severity**: MEDIUM
**File**: `README.md`
**Issue**: Repository structure section lists 501-508 but omits 230.500.

**Fix Required**: Add `17cfr230.500.jsonld` to file listing and status table.

---

### 3. Duplicate Roadmap Phases in README

**Severity**: LOW
**File**: `README.md` (lines 197-207)
**Issue**: "Phase 3: Additional Regulations" appears twice.

**Fix Required**: Remove duplicate section.

---

## MODERATE ISSUES

### 4. OSCAL Controls - Purchaser Count Control Reference Discrepancy

**Severity**: MODERATE
**File**: `controls/regulation-d-controls.json`
**Issue**: Control `ctrl-purchaser-count-stmt` prose still mentions "230.501(b)" but the regulation-ref was correctly changed to "cfr:17/230.501(e)".

**Current Prose**:

```
"the organization shall maintain a count of purchasers applying the exclusion and counting rules in 17 CFR 230.501(b)"
```

**Should Be**:

```
"the organization shall maintain a count of purchasers applying the exclusion and counting rules in 17 CFR 230.501(e)"
```

---

### 5. Schema Cross-Reference Incompleteness

**Severity**: LOW
**Files**: Various schema files
**Issue**: Cross-references don't consistently include all related sections.

**Examples**:

- 230.500 should reference 230.505 (reserved status affects regulation scope)
- 230.506 should reference 230.503 (Form D filing is required for 506 offerings)

---

### 6. Inconsistent Note Structure

**Severity**: LOW
**Files**: Various schema files
**Issue**: Some notes use `"note": [...]` array, others use `"note": {...}` object.

**Recommendation**: Standardize on array format for consistency, even for single notes.

---

## POTENTIAL IMPROVEMENTS

### 7. Missing Validation Tooling

**Priority**: HIGH
**Issue**: No automated validation for:

- JSON-LD syntax validity
- JSON Schema compliance
- OSCAL schema validation
- Cross-reference link verification

**Recommendation**: Create validation scripts:

```bash
# Suggested tooling
scripts/
  validate-jsonld.sh      # jq + JSON-LD playground
  validate-oscal.sh       # OSCAL CLI validation
  verify-links.sh         # Check all regulation-ref links resolve
  check-amendments.sh     # Verify FR citations are current
```

---

### 8. No Unit Test Coverage

**Priority**: HIGH
**Issue**: No tests to prevent regression.

**Recommended Tests**:

| Test                       | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `test_json_syntax.py`      | All .jsonld files parse as valid JSON                      |
| `test_jsonld_context.py`   | Context file resolves correctly                            |
| `test_schema_structure.py` | Required fields present (citation, @id, @type)             |
| `test_oscal_links.py`      | All regulation-ref values match existing schema @id values |
| `test_citation_format.py`  | Citations follow "17 CFR 230.XXX" format                   |
| `test_no_empty_text.py`    | No empty string values in text fields                      |
| `test_amendment_dates.py`  | Amendment dates are valid FR citations                     |

---

### 9. No Schema Versioning

**Priority**: MEDIUM
**Issue**: No mechanism to track which eCFR version schemas are based on.

**Recommendation**: Add to each schema:

```json
"_source": {
  "ecfrVersion": "2025-12-30",  // Already present as asOfDate
  "schemaVersion": "1.0.0",     // Add semantic version
  "generatedBy": "manual",       // Or automated extraction tool
  "hash": "sha256:..."          // Content hash for change detection
}
```

---

## 20 MOST CRITICAL COMPONENTS NEEDING REGULAR REFACTORING

Components ranked by maintenance priority:

| Rank | Component                      | File                               | Reason for Attention                                         |
| ---- | ------------------------------ | ---------------------------------- | ------------------------------------------------------------ |
| 1    | Accredited Investor Definition | 17cfr230.501.jsonld (subsection a) | Frequently amended (2020, 2025), highest regulatory impact   |
| 2    | Bad Actor Provisions           | 17cfr230.506.jsonld (subsection d) | Complex disqualification rules, frequent enforcement updates |
| 3    | 506(c) Verification Methods    | 17cfr230.506.jsonld (c)(2)(ii)     | Evolving verification standards                              |
| 4    | Form D Filing Requirements     | 17cfr230.503.jsonld                | SEC form updates affect requirements                         |
| 5    | General Solicitation Rules     | 17cfr230.502.jsonld (subsection c) | Digital marketing evolution                                  |
| 6    | OSCAL Control Catalog          | regulation-d-controls.json         | Must track all schema changes                                |
| 7    | Information Requirements       | 17cfr230.502.jsonld (subsection b) | Complex nested structure                                     |
| 8    | Net Worth Calculation          | 17cfr230.501.jsonld (a)(5)         | Primary residence rules                                      |
| 9    | Integration Safe Harbor        | 17cfr230.502.jsonld (subsection a) | References 230.152                                           |
| 10   | Professional Certifications    | 17cfr230.501.jsonld (a)(10)        | SEC designation updates                                      |
| 11   | Purchaser Counting Rules       | 17cfr230.501.jsonld (subsection e) | Calculation complexity                                       |
| 12   | Resale Restrictions            | 17cfr230.502.jsonld (subsection d) | Legend requirements                                          |
| 13   | $10M Offering Limit            | 17cfr230.504.jsonld (b)(2)         | Threshold may change                                         |
| 14   | Anti-Evasion Provision         | 17cfr230.500.jsonld (subsection e) | Foundational rule                                            |
| 15   | Issuer Definition              | 17cfr230.501.jsonld (subsection h) | Bankruptcy provisions                                        |
| 16   | JSON-LD Context                | securities-context.jsonld          | Vocabulary foundation                                        |
| 17   | ADR-001 Technology Decisions   | adr-001-audit-trail-technology.md  | AWS service deprecations                                     |
| 18   | Purchaser Representative       | 17cfr230.501.jsonld (subsection i) | Complex conditions                                           |
| 19   | Family Office Rules            | 17cfr230.501.jsonld (a)(12-13)     | 2020 addition                                                |
| 20   | Knowledgeable Employee         | 17cfr230.501.jsonld (a)(11)        | Investment Company Act refs                                  |

---

## OUTDATED REFERENCES

### References Requiring Verification

| File                | Reference                 | Issue                                |
| ------------------- | ------------------------- | ------------------------------------ |
| 17cfr230.501.jsonld | 90 FR 9687, Feb. 18, 2025 | Verify this is most recent amendment through 2026 |
| 17cfr230.502.jsonld | 86 FR 3598, Jan. 14, 2021 | Check for 2021-2026 amendments                    |
| 17cfr230.506.jsonld | 86 FR 3598, Jan. 14, 2021 | Check for 2021-2026 amendments                    |

---

## NAMING IMPROVEMENTS

### Suggested Renames

| Current                      | Suggested                   | Rationale                                  |
| ---------------------------- | --------------------------- | ------------------------------------------ |
| `17cfr230.XXX.jsonld`        | Keep as-is                  | Matches CFR citation format                |
| `regulation-d-controls.json` | Keep as-is                  | Clear purpose                              |
| `securities-context.jsonld`  | Keep as-is                  | Standard JSON-LD naming                    |
| `_source.asOfDate`           | `_source.ecfrAsOfDate`      | Clarity about what date refers to          |
| `headingText`                | Remove or `officialHeading` | Many CFR paragraphs lack official headings |

---

## CODE EFFICIENCY ANALYSIS

### JSON-LD Structure Efficiency

**Current**: Each subsection repeats full citation information.
**Assessment**: Acceptable - verbosity aids standalone readability.

**Current**: Amendment history as flat array.
**Assessment**: Could be structured with dates, but current format matches FR citations directly. Keep as-is.

### OSCAL Control Structure

**Current**: Deep nesting for sub-controls.
**Assessment**: Follows OSCAL spec. No change recommended.

### File Organization

**Current**: Flat structure for schemas.
**Assessment**: Appropriate for current scale. Consider subdirectories if expanding to multiple regulations.

---

## RECOMMENDED NEXT STEPS

1. **Immediate**: Fix 230.500 headingText misalignment
2. **Immediate**: Update README to include 230.500
3. **Immediate**: Fix purchaser count prose reference
4. **Short-term**: Create validation script suite
5. **Short-term**: Add unit tests
6. **Medium-term**: Automate eCFR change detection
7. **Long-term**: Consider CI/CD for schema validation

---

## APPENDIX: Validation Commands

```bash
# Validate all JSON files
for f in schemas/regulation-d/*.jsonld; do
  jq . "$f" > /dev/null && echo "OK: $f" || echo "FAIL: $f"
done

# Check OSCAL controls JSON
jq . controls/regulation-d-controls.json > /dev/null

# Find empty text fields
jq '.. | select(type == "string" and . == "")' schemas/regulation-d/*.jsonld

# List all @id values
jq -r '.. | ."@id"? // empty' schemas/regulation-d/*.jsonld | sort -u

# Verify regulation-ref values exist as @id
# (would require custom script)
```
