# Control-to-Regulation Mapping Example

This document demonstrates how OSCAL controls link to JSON-LD regulations.

## The Relationship

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         OSCAL CONTROL                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Control ID: ctrl-ai-natural-person-income                        │  │
│  │  Title: Natural Person Income Verification                        │  │
│  │                                                                   │  │
│  │  Props:                                                           │  │
│  │    regulation-citation: "17 CFR 230.501(a)(6)"                    │  │
│  │    regulation-ref: "cfr:17/230.501(a)(6)"  ◄─────────────────┐    │  │
│  │                                                              │    │  │
│  │  Statement:                                                  │    │  │
│  │    "Verify individual income exceeds $200,000..."            │    │  │
│  │                                                              │    │  │
│  │  Evidence Requirements:                                      │    │  │
│  │    - IRS forms (W-2, 1099, K-1, 1040)                        │    │  │
│  │    - Third-party verification letter                         │    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                                                  │
                                                                  │ references
                                                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        JSON-LD REGULATION                               │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  @id: "cfr:17/230.501(a)(6)"                                      │  │
│  │  @type: "Paragraph"                                               │  │
│  │  citation: "17 CFR 230.501(a)(6)"                                 │  │
│  │  designation: "(6)"                                               │  │
│  │                                                                   │  │
│  │  text: "Any natural person who had an individual income in        │  │
│  │         excess of $200,000 in each of the two most recent         │  │
│  │         years or joint income with that person's spouse or        │  │
│  │         spousal equivalent in excess of $300,000 in each of       │  │
│  │         those years and has a reasonable expectation of           │  │
│  │         reaching the same income level in the current year;"      │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Extracting the Mapping

### Get Control with Regulation Reference

```bash
cat controls/regulation-d-controls.json | jq '
  .catalog.groups[].controls[].controls[]? |
  select(.id == "ctrl-ai-natural-person-income") |
  {
    control_id: .id,
    control_title: .title,
    regulation_citation: (.props[] | select(.name == "regulation-citation") | .value),
    regulation_ref: (.props[] | select(.name == "regulation-ref") | .value)
  }
'
```

Output:
```json
{
  "control_id": "ctrl-ai-natural-person-income",
  "control_title": "Natural Person Income Verification",
  "regulation_citation": "17 CFR 230.501(a)(6)",
  "regulation_ref": "cfr:17/230.501(a)(6)"
}
```

### Get Regulation Text by Reference

```bash
cat schemas/regulation-d/17cfr230.501.jsonld | jq '
  .subsection[0].paragraph[] |
  select(.["@id"] == "cfr:17/230.501(a)(6)") |
  {
    id: .["@id"],
    citation: .citation,
    text: .text
  }
'
```

Output:
```json
{
  "id": "cfr:17/230.501(a)(6)",
  "citation": "17 CFR 230.501(a)(6)",
  "text": "Any natural person who had an individual income in excess of $200,000 in each of the two most recent years or joint income with that person's spouse or spousal equivalent in excess of $300,000 in each of those years and has a reasonable expectation of reaching the same income level in the current year;"
}
```

## Full Compliance Check Flow

### Step 1: List All Controls Needing Evidence

```bash
cat controls/regulation-d-controls.json | jq '
  [.catalog.groups[].controls[], .catalog.groups[].controls[].controls[]?] |
  map(select(.parts[]?.name == "evidence-requirements")) |
  map({
    id: .id,
    title: .title,
    citation: (.props[]? | select(.name == "regulation-citation") | .value),
    evidence: [.parts[] | select(.name == "evidence-requirements") | .parts[]?.prose]
  })
'
```

### Step 2: For Each Control, Get Regulatory Text

```python
import json

# Load both files
with open('controls/regulation-d-controls.json') as f:
    controls = json.load(f)

with open('schemas/regulation-d/17cfr230.501.jsonld') as f:
    regulation = json.load(f)

# Build index of regulation paragraphs by @id
reg_index = {}
for subsection in regulation.get('subsection', []):
    for paragraph in subsection.get('paragraph', []):
        reg_index[paragraph['@id']] = paragraph

# Extract control with linked regulation
def get_control_with_regulation(control_id):
    for group in controls['catalog']['groups']:
        for control in group.get('controls', []):
            if control['id'] == control_id:
                return enrich_control(control)
            for subcontrol in control.get('controls', []):
                if subcontrol['id'] == control_id:
                    return enrich_control(subcontrol)
    return None

def enrich_control(control):
    result = {
        'id': control['id'],
        'title': control['title'],
        'statement': None,
        'regulation': None
    }

    # Get statement
    for part in control.get('parts', []):
        if part['name'] == 'statement':
            result['statement'] = part['prose']

    # Get regulation reference
    for prop in control.get('props', []):
        if prop['name'] == 'regulation-ref':
            reg_ref = prop['value']
            if reg_ref in reg_index:
                result['regulation'] = {
                    'id': reg_index[reg_ref]['@id'],
                    'citation': reg_index[reg_ref]['citation'],
                    'text': reg_index[reg_ref]['text']
                }

    return result

# Example usage
result = get_control_with_regulation('ctrl-ai-natural-person-income')
print(json.dumps(result, indent=2))
```

### Step 3: Generate Compliance Checklist

```python
def generate_checklist(control_id):
    control = get_control_with_regulation(control_id)
    if not control:
        return None

    checklist = {
        'control': control['title'],
        'regulation': control['regulation']['citation'] if control['regulation'] else 'N/A',
        'regulatory_text': control['regulation']['text'] if control['regulation'] else 'N/A',
        'verification_requirement': control['statement'],
        'checklist_items': []
    }

    # Parse evidence requirements from control
    # (In real implementation, extract from parts with name="evidence-requirements")
    checklist['checklist_items'] = [
        '[ ] Obtain income documentation for two most recent tax years',
        '[ ] Verify individual income > $200,000 OR joint income > $300,000',
        '[ ] Confirm reasonable expectation for current year',
        '[ ] Document verification method used',
        '[ ] Retain evidence per record retention policy'
    ]

    return checklist
```

## Evidence Linking

When evidence is submitted, it links back through this chain:

```
Evidence Record
    │
    ├── control_id: "ctrl-ai-natural-person-income"
    │       │
    │       └──► OSCAL Control
    │               │
    │               └── regulation-ref: "cfr:17/230.501(a)(6)"
    │                       │
    │                       └──► JSON-LD Regulation
    │                               │
    │                               └── text: "Any natural person..."
    │
    ├── metadata:
    │       investor_id: "INV-12345"
    │       tax_year: "2024"
    │       income_type: "individual"
    │       verified_amount: "> $200,000"
    │
    └── artifact:
            s3_uri: "s3://evidence/.../tax_return.pdf"
            sha256: "abc123..."
```

This creates a complete audit trail from evidence → control → regulation.
