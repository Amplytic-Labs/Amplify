#!/usr/bin/env python3
"""
Extract specific icons from installed @iconify-json packages
and save them as individual SVG files in /icons/.

This avoids loading the full multi-megabyte JSON collections
during the UnoCSS build (which caused OOM) while still using
Iconify's official icon shapes.

After running this, all provider icons are part of the local
`amplify` UnoCSS collection (loaded from /icons/*.svg) and the
build only needs to read those small individual SVG files.
"""
import json
import os
import re

PROJECT_ROOT = '/home/z/my-project/Open_Claude'
ICONS_DIR = os.path.join(PROJECT_ROOT, 'icons')

# Map: provider name → (collection, icon name in collection, output filename)
# VERIFIED from earlier inspection of @iconify-json/logos/icons.json
# and @iconify-json/simple-icons/icons.json.
EXTRACTIONS = [
    # From @iconify-json/logos (official brand logos with original colors)
    ('logos', 'anthropic-icon', 'Anthropic-iconify.svg'),
    ('logos', 'openai-icon', 'OpenAI-iconify.svg'),
    ('logos', 'google-gemini', 'Google-iconify.svg'),
    ('logos', 'deepseek-icon', 'Deepseek-iconify.svg'),
    ('logos', 'x-ai', 'xAI-iconify.svg'),
    ('logos', 'mistral-ai-icon', 'Mistral-iconify.svg'),
    ('logos', 'perplexity-icon', 'Perplexity-iconify.svg'),
    ('logos', 'hugging-face-icon', 'HuggingFace-iconify.svg'),
    ('logos', 'moonshot-ai-icon', 'Moonshot-iconify.svg'),
    ('logos', 'github-icon', 'Github-iconify.svg'),
    ('logos', 'aws', 'AmazonBedrock-iconify.svg'),
    # From @iconify-json/simple-icons
    ('simple-icons', 'ollama', 'Ollama-iconify.svg'),
    ('simple-icons', 'openrouter', 'OpenRouter-iconify.svg'),
    ('simple-icons', 'lmstudio', 'LMStudio-iconify.svg'),
    ('simple-icons', 'zdotai', 'Zai-iconify.svg'),
]


def load_collection(name):
    """Load an @iconify-json collection's icons.json."""
    path = os.path.join(
        PROJECT_ROOT, 'node_modules', '@iconify-json', name, 'icons.json'
    )
    with open(path) as f:
        return json.load(f)


def render_icon_svg(icon_data, collection_name):
    """
    Render an Iconify icon as a standalone SVG.

    Iconify icons have:
      - body: the inner SVG content (paths, circles, etc.)
      - width / height (optional, default 16 or 24)
      - viewBox (optional)

    For 'logos' collection icons, the body usually contains its own
    fill colors (multi-color brand logos). For 'simple-icons', the
    body uses a single path with no fill (defaults to currentColor).
    """
    body = icon_data.get('body', '')
    width = icon_data.get('width', 24)
    height = icon_data.get('height', 24)
    viewBox = icon_data.get('viewBox', f'0 0 {width} {height}')

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{viewBox}" width="{width}" height="{height}">'
        f'{body}</svg>'
    )


def main():
    os.chdir(PROJECT_ROOT)
    collections_cache = {}

    for coll, icon_name, out_name in EXTRACTIONS:
        if coll not in collections_cache:
            print(f'Loading collection: {coll}...')
            collections_cache[coll] = load_collection(coll)

        data = collections_cache[coll]
        icons = data.get('icons', {})

        if icon_name not in icons:
            # Try aliases
            aliases = data.get('aliases', {})
            if icon_name in aliases:
                # Resolve alias
                parent = aliases[icon_name].get('parent')
                if parent and parent in icons:
                    icon_data = {**icons[parent], **aliases[icon_name]}
                    icon_data.pop('parent', None)
                else:
                    print(f'  ✗ {coll}:{icon_name} alias unresolvable')
                    continue
            else:
                print(f'  ✗ {coll}:{icon_name} NOT FOUND')
                continue
        else:
            icon_data = icons[icon_name]

        svg = render_icon_svg(icon_data, coll)
        out_path = os.path.join(ICONS_DIR, out_name)
        with open(out_path, 'w') as f:
            f.write(svg)
        print(f'  ✓ {coll}:{icon_name} → {out_name} ({len(svg)} bytes)')

    print('\nDone. All icons saved to', ICONS_DIR)


if __name__ == '__main__':
    main()
