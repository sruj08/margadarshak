"""Margdarshak token contrast check (WCAG 2.x relative luminance).

Reads packages/ui/tokens.json (DTCG), resolves {aliases}, computes every pair in
$extensions["in.margdarshak"].contrastPairs and prints a Markdown table.
Exit code 1 if any pair not listed in expectedFailures is below its minimum, or
if an expected failure unexpectedly passes (so the audit list stays honest).
Usage: python -I scripts/check_contrast.py [path/to/tokens.json] [--md]
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
path = pathlib.Path(next((a for a in sys.argv[1:] if not a.startswith('--')), ROOT / 'packages/ui/tokens.json'))
tokens = json.loads(path.read_text(encoding='utf-8'))

def get(ref):
    node = tokens
    for part in ref.strip('{}').split('.'):
        node = node[part]
    val = node['$value'] if isinstance(node, dict) else node
    return get(val) if isinstance(val, str) and val.startswith('{') else val

def lum(h):
    h = h.lstrip('#')[:6]
    def ch(c):
        c = int(c, 16) / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = ch(h[0:2]), ch(h[2:4]), ch(h[4:6])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)

ext = tokens['$extensions']['in.margdarshak']
expected = set(ext.get('expectedFailures', []))
bad = []
print('| ID | Theme | Foreground | Background | Ratio | Min | Result | Use |')
print('|---|---|---|---|---|---|---|---|')
for p in ext['contrastPairs']:
    fg, bg = get(p['fg']), get(p['bg'])
    r = ratio(fg, bg)
    ok = r >= p['min']
    if p['id'] in expected:
        res = 'expected fail' if not ok else 'UNEXPECTED PASS'
        if ok: bad.append(p['id'])
    else:
        res = 'pass' if ok else 'FAIL'
        if not ok: bad.append(p['id'])
    name = lambda ref: ref.strip('{}').replace('color.', '')
    print(f"| {p['id']} | {p['theme']} | `{name(p['fg'])}` {fg.upper()} | `{name(p['bg'])}` {bg.upper()} | **{r:.2f}** | {p['min']} | {res} | {p['use']} |")
if bad:
    print(f"\nContrast check failed for: {', '.join(bad)}", file=sys.stderr)
    sys.exit(1)
