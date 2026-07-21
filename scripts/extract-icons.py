#!/usr/bin/env python3
"""
Extract the icon portion from wordmark SVGs.

For each provider SVG that contains both an icon and wordmark text,
crop the viewBox and keep only the paths that fall within the icon area.
"""
import re
import os

# Each entry: (filename, new_viewBox, max_x_for_icon_paths)
# Paths whose first coordinate exceeds max_x_for_icon_paths are dropped
# (they belong to the wordmark text portion).
EXTRACTIONS = [
    # Cohere: icon is in first ~22 units, wordmark at x=33+
    ('icons/Cohere.svg', '22 20', 25),
    # Together: icon is in first ~30 units, wordmark at x=32+
    ('icons/Together.svg', '30 26', 31),
    # Hyperbolic: icon is in first ~30 units, wordmark at x=49+
    ('icons/Hyperbolic.svg', '30 29', 32),
    # Cerebras: icon is in first ~48 units, wordmark at x=50+
    ('icons/Cerebras.svg', '48 48', 50),
]


def extract_icon_portion(svg_path, new_viewbox, max_icon_x):
    """Crop an SVG to just the icon portion (left side)."""
    with open(svg_path) as f:
        svg = f.read()

    # Find all <path> elements with their full attributes
    path_tag_pattern = re.compile(r'<path\b([^>]*)\bd="([^"]+)"([^>]*)>')
    path_tags = path_tag_pattern.findall(svg)

    kept_path_xml = []
    for attrs_before, d, attrs_after in path_tags:
        m = re.match(r'\s*M([\d.]+)', d)
        if not m:
            kept_path_xml.append(f'<path{attrs_before} d="{d}"{attrs_after}/>')
            continue
        x = float(m.group(1))
        if x <= max_icon_x:
            kept_path_xml.append(f'<path{attrs_before} d="{d}"{attrs_after}/>')
        else:
            print(f'  dropping wordmark path starting at x={x}')

    # Pick a sensible default fill color
    fill_match = re.search(r'<svg[^>]*fill="([^"]+)"', svg)
    fill_color = fill_match.group(1) if fill_match else 'currentColor'

    new_svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {new_viewbox}" '
        f'fill="{fill_color}">\n' + '\n'.join(kept_path_xml) + '\n</svg>'
    )

    # Backup the original
    backup_path = svg_path + '.wordmark.bak'
    if not os.path.exists(backup_path):
        with open(backup_path, 'w') as f:
            f.write(svg)

    with open(svg_path, 'w') as f:
        f.write(new_svg)

    print(f'Wrote {svg_path}: {len(kept_path_xml)} paths, viewBox 0 0 {new_viewbox}')


def extract_groq_lightning(svg_path):
    """Groq's SVG has a lightning bolt as the last sub-path. Extract it."""
    with open(svg_path) as f:
        svg = f.read()

    path_match = re.search(r'<path[^>]*d="([^"]+)"', svg)
    if not path_match:
        print('No path found in Groq.svg')
        return
    full_d = path_match.group(1)

    # Split into sub-paths by 'M' (but keep the M)
    sub_paths = re.findall(r'M[^M]*?z', full_d)
    print(f'  Groq has {len(sub_paths)} sub-paths')
    for i, sp in enumerate(sub_paths):
        m = re.match(r'M([\d.]+)', sp)
        if m:
            print(f'    [{i}] starts at x={m.group(1)}')

    # The lightning bolt is the last sub-path: M165.98...z
    lightning = sub_paths[-1]
    print(f'  Using last sub-path as lightning bolt')

    # The lightning bolt spans x=0 to 369.6, y=0 to 562.32
    new_svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 370 562.5" '
        'fill="currentColor">'
        f'<path d="{lightning}"/></svg>'
    )

    backup_path = svg_path + '.wordmark.bak'
    if not os.path.exists(backup_path):
        with open(backup_path, 'w') as f:
            f.write(svg)

    with open(svg_path, 'w') as f:
        f.write(new_svg)

    print(f'Wrote {svg_path}: lightning bolt only, viewBox 0 0 370 562.5')


if __name__ == '__main__':
    os.chdir('/home/z/my-project/Open_Claude')
    for fname, vb, mx in EXTRACTIONS:
        print(f'=== {fname} ===')
        extract_icon_portion(fname, vb, mx)
    print('=== icons/Groq.svg ===')
    extract_groq_lightning('icons/Groq.svg')
