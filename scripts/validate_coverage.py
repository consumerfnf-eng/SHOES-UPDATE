from pathlib import Path
import json, sys
root=Path(__file__).resolve().parents[1]
config=json.loads((root/'config'/'mandatory_brands.json').read_text(encoding='utf-8'))
state=json.loads((root/'data'/'runtime_state.json').read_text(encoding='utf-8'))
required=[x['canonical'] for x in config['brands']]
coverage=state.get('coverage') or []
by={x.get('brand'):x for x in coverage}
missing=[b for b in required if b not in by]
failed=[b for b in required if b in by and not by[b].get('responses')]
print(f'Mandatory attempted: {len(required)-len(missing)}/{len(required)}')
print(f'No-response after retries: {len(failed)}')
if missing: print('MISSING:', ', '.join(missing))
if failed: print('NO_RESPONSE:', ', '.join(failed))
# Hard-fail only true omission. Source outages are logged/visible but do not erase last-good product data.
sys.exit(2 if missing else 0)
