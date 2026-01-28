# Developer Quick Start

Get up and running with the securities law schema in 5 minutes.

## Prerequisites

- `jq` for JSON querying (optional but recommended)
- Node.js 18+ or Python 3.9+ for programmatic access

## Installation

```bash
git clone https://github.com/GrottoAndrew/securities-law-schema.git
cd securities-law-schema
```

## Basic Queries

### List All Accredited Investor Categories

```bash
cat schemas/regulation-d/17cfr230.501.jsonld | jq '
  .subsection[0].paragraph[] |
  {
    category: .designation,
    summary: .text[0:100] + "..."
  }
'
```

### Get Specific Provision

```bash
# Get the net worth accredited investor definition
cat schemas/regulation-d/17cfr230.501.jsonld | jq '
  .subsection[0].paragraph[] |
  select(.designation == "(5)")
'
```

### List All Controls

```bash
cat controls/regulation-d-controls.json | jq '
  [.catalog.groups[].controls[], .catalog.groups[].controls[].controls[]?] |
  map({id: .id, title: .title}) |
  .[]
'
```

### Find Controls by Regulation

```bash
# Find all controls related to 230.501(a)
cat controls/regulation-d-controls.json | jq '
  [.catalog.groups[].controls[], .catalog.groups[].controls[].controls[]?] |
  map(select(.props[]?.value | contains?("230.501(a)"))) |
  map({id: .id, title: .title, citation: (.props[] | select(.name == "regulation-citation") | .value)})
'
```

## Programmatic Access

### JavaScript/TypeScript

```javascript
import { readFile } from 'fs/promises';

async function loadRegulation(path) {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content);
}

async function findProvision(regulation, citation) {
  // Flatten all provisions into searchable array
  const provisions = [];

  function traverse(node, path = []) {
    if (node['@id']) {
      provisions.push({ ...node, path: [...path] });
    }
    for (const key of ['subsection', 'paragraph', 'clause', 'subclause']) {
      if (Array.isArray(node[key])) {
        node[key].forEach((child, i) => traverse(child, [...path, key, i]));
      }
    }
  }

  traverse(regulation);
  return provisions.find(p => p.citation === citation || p['@id'].endsWith(citation));
}

// Usage
const reg501 = await loadRegulation('schemas/regulation-d/17cfr230.501.jsonld');
const provision = await findProvision(reg501, '17 CFR 230.501(a)(6)');
console.log(provision.text);
```

### Python

```python
import json
from pathlib import Path

def load_regulation(path: str) -> dict:
    with open(path) as f:
        return json.load(f)

def find_provision(regulation: dict, citation: str) -> dict | None:
    """Find a provision by citation string."""
    provisions = []

    def traverse(node, path=None):
        path = path or []
        if '@id' in node:
            provisions.append({**node, '_path': path})
        for key in ['subsection', 'paragraph', 'clause', 'subclause']:
            if key in node and isinstance(node[key], list):
                for i, child in enumerate(node[key]):
                    traverse(child, path + [(key, i)])

    traverse(regulation)

    for p in provisions:
        if p.get('citation') == citation or p.get('@id', '').endswith(citation.replace(' ', '')):
            return p
    return None

# Usage
reg501 = load_regulation('schemas/regulation-d/17cfr230.501.jsonld')
provision = find_provision(reg501, '17 CFR 230.501(a)(6)')
print(provision['text'])
```

## Validation

### Validate JSON-LD Structure

```bash
# Using jsonld.js CLI
npx jsonld normalize schemas/regulation-d/17cfr230.501.jsonld

# Or validate JSON syntax
jq '.' schemas/regulation-d/17cfr230.501.jsonld > /dev/null && echo "Valid JSON"
```

### Validate OSCAL

```bash
# Using OSCAL CLI (if installed)
oscal-cli catalog validate controls/regulation-d-controls.json
```

## Common Patterns

### Build a Regulation Index

```python
def build_regulation_index(regulation: dict) -> dict:
    """Build a flat index of all provisions by @id."""
    index = {}

    def traverse(node):
        if '@id' in node:
            index[node['@id']] = node
        for key in ['subsection', 'paragraph', 'clause', 'subclause']:
            if key in node and isinstance(node[key], list):
                for child in node[key]:
                    traverse(child)

    traverse(regulation)
    return index

# Usage
reg501 = load_regulation('schemas/regulation-d/17cfr230.501.jsonld')
index = build_regulation_index(reg501)

# Direct lookup
provision = index.get('cfr:17/230.501(a)(6)')
```

### Link Controls to Regulations

```python
def get_control_regulation_pairs(controls: dict, reg_index: dict) -> list:
    """Get all control-regulation pairs."""
    pairs = []

    def process_control(control):
        reg_ref = None
        for prop in control.get('props', []):
            if prop['name'] == 'regulation-ref':
                reg_ref = prop['value']
                break

        if reg_ref and reg_ref in reg_index:
            pairs.append({
                'control_id': control['id'],
                'control_title': control['title'],
                'regulation_id': reg_ref,
                'regulation_text': reg_index[reg_ref].get('text', '')[:200]
            })

        for subcontrol in control.get('controls', []):
            process_control(subcontrol)

    for group in controls['catalog']['groups']:
        for control in group.get('controls', []):
            process_control(control)

    return pairs

# Usage
controls = json.load(open('controls/regulation-d-controls.json'))
reg501 = load_regulation('schemas/regulation-d/17cfr230.501.jsonld')
index = build_regulation_index(reg501)

pairs = get_control_regulation_pairs(controls, index)
for pair in pairs:
    print(f"{pair['control_id']}: {pair['regulation_id']}")
```

### Generate Compliance Matrix

```python
def generate_compliance_matrix(controls: dict) -> list:
    """Generate a compliance matrix from OSCAL controls."""
    matrix = []

    def process_control(control, parent_id=None):
        row = {
            'control_id': control['id'],
            'parent_id': parent_id,
            'title': control['title'],
            'regulation_citation': None,
            'statement': None,
            'evidence_items': []
        }

        for prop in control.get('props', []):
            if prop['name'] == 'regulation-citation':
                row['regulation_citation'] = prop['value']

        for part in control.get('parts', []):
            if part['name'] == 'statement':
                row['statement'] = part.get('prose', '')
            elif part['name'] == 'evidence-requirements':
                for subpart in part.get('parts', []):
                    if subpart['name'] == 'evidence-item':
                        row['evidence_items'].append(subpart.get('prose', ''))

        matrix.append(row)

        for subcontrol in control.get('controls', []):
            process_control(subcontrol, control['id'])

    for group in controls['catalog']['groups']:
        for control in group.get('controls', []):
            process_control(control)

    return matrix

# Export to CSV
import csv

controls = json.load(open('controls/regulation-d-controls.json'))
matrix = generate_compliance_matrix(controls)

with open('compliance-matrix.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=[
        'control_id', 'parent_id', 'title', 'regulation_citation',
        'statement', 'evidence_items'
    ])
    writer.writeheader()
    for row in matrix:
        row['evidence_items'] = '; '.join(row['evidence_items'])
        writer.writerow(row)
```

## Next Steps

1. Read the [Architecture Overview](../architecture/overview.md)
2. See [Control-Regulation Mapping Example](../../examples/control-regulation-mapping.md)
3. Check [CONTRIBUTING.md](../../CONTRIBUTING.md) to add regulations
4. Review [Framework Extensions](../for-compliance/FRAMEWORK-EXTENSIONS.md) for additional compliance domains
