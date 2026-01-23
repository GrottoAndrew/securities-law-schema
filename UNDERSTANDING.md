# Understanding the Schema: A Guide for Lawyers

## What This Is

This repository contains U.S. securities regulations transcribed into a structured data format called JSON-LD. Think of it as the CFR in a format that computers can read and reason about, while preserving the exact regulatory text.

## Why This Matters

### The Problem

When you need to verify compliance with Regulation D, you typically:

1. Read the regulation
2. Identify applicable requirements
3. Check each requirement against your facts
4. Document your analysis
5. Hope you didn't miss anything

This process is manual, error-prone, and difficult to audit.

### The Solution

With machine-readable regulations, you can:

1. **Query specific requirements** - "List all conditions for Rule 506(c) exemption"
2. **Map controls to rules** - "This investor verification procedure satisfies 17 CFR 230.506(c)(2)(ii)"
3. **Automate checklists** - Generate compliance checklists directly from regulatory text
4. **Create audit trails** - Link evidence to specific regulatory provisions

## How to Read the Files

### The Structure Mirrors the CFR

The Code of Federal Regulations has a consistent hierarchy:

```
Title → Part → Section → Subsection → Paragraph → Clause → Subclause
  17     230    501        (a)          (1)        (i)       (A)
```

Our JSON-LD files preserve this exact structure:

```
Section
  └── Subsection (a), (b), (c)...
        └── Paragraph (1), (2), (3)...
              └── Clause (i), (ii), (iii)...
                    └── Subclause (A), (B), (C)...
```

### Example: Finding Accredited Investor Categories

In the CFR, accredited investor is defined at 17 CFR 230.501(a).

In our schema:

```
File: schemas/regulation-d/17cfr230.501.jsonld

Path: sections[0].subsection[0]  →  This is 230.501(a)
      sections[0].subsection[0].paragraph[0]  →  This is 230.501(a)(1)
      sections[0].subsection[0].paragraph[4]  →  This is 230.501(a)(5)
```

The `text` field contains the verbatim regulatory language.

## What You Can Do With This

### 1. Build Compliance Checklists

Extract all requirements for a specific exemption and generate a checklist automatically.

### 2. Map Internal Controls

Link your firm's procedures directly to regulatory provisions:

> "Procedure 4.2.1 (Investor Qualification) implements 17 CFR 230.506(c)(2)(ii)(A)-(E)"

### 3. Automate Verification

Build tools that check whether collected investor information satisfies specific accredited investor categories.

### 4. Train AI Systems

Ground AI assistants in authoritative regulatory text rather than summaries or interpretations.

## Questions?

Open an issue on GitHub or consult the technical documentation in `docs/for-developers/`.
