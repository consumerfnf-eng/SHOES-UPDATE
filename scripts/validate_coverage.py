from pathlib import Path
import json, sys
def validate(state, required):
    if not state.get('products'):
        raise ValueError('Empty snapshot; previous dashboard retained')
    if state.get('crawler', {}).get('scope') != 'full':
        raise ValueError('Only a full daily run may be published')
    coverage = state.get('coverage') or []
    by = {row.get('brand'): row for row in coverage}
    missing = [brand for brand in required if not by.get(brand, {}).get('attempts')]
    failed = [brand for brand in required if not by.get(brand, {}).get('responses')]
    if missing:
        raise ValueError('MANDATORY_BRANDS_NOT_ATTEMPTED: ' + ', '.join(missing))
    if len(failed) == len(required):
        raise ValueError('ALL_MANDATORY_SOURCES_UNAVAILABLE: previous dashboard retained')
    return failed

if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    try:
        config = json.loads((root/'config/mandatory_brands.json').read_text(encoding='utf-8'))
        state = json.loads((root/'data/runtime_state.json').read_text(encoding='utf-8'))
        required = [row['canonical'] for row in config['brands']]
        failed = validate(state, required)
        print(f'Mandatory attempted: {len(required)}/{len(required)}; no response: {len(failed)}')
        if failed: print('NO_RESPONSE (previous records retained):', ', '.join(failed))
    except (ValueError, OSError) as error:
        print(error, file=sys.stderr)
        sys.exit(2)
