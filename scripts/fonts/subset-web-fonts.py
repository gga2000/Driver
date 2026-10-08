"""Web fonts for the customer site (speed w3, Ali 2026-10-08): woff2, Arabic + Latin letters only.

Reads the same font files the apps bundle (node_modules/@expo-google-fonts) and writes
apps/customer/public/assets/fonts/<name>.v<N>.woff2, served under /assets/ with a one-year cache,
so bump VERSION whenever the output changes. Needs fonttools and brotli:
    python3 -m pip install fonttools brotli && python3 scripts/fonts/subset-web-fonts.py
"""
import glob
import os
import sys

from fontTools import subset

VERSION = 1
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'apps', 'customer', 'public', 'assets', 'fonts')

# Latin (with Latin-1 for names and the odd symbol), general punctuation (with the bidi marks, ZWJ and
# ZWNJ the Arabic text uses), arrows, minus, the dotted circle for lone marks, and every Arabic block.
UNICODES = (
    'U+0000-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2190-2193,'
    'U+2212,U+25CC,U+0600-06FF,U+0750-077F,U+0870-08FF,U+FB50-FDFF,U+FE70-FEFF'
)

# The weights the site uses. Medium (500) is left out: on the web 500 is drawn with the 600 file.
FACES = {
    'plex-400': 'ibm-plex-sans-arabic/400Regular/IBMPlexSansArabic_400Regular.ttf',
    'plex-600': 'ibm-plex-sans-arabic/600SemiBold/IBMPlexSansArabic_600SemiBold.ttf',
    'plex-700': 'ibm-plex-sans-arabic/700Bold/IBMPlexSansArabic_700Bold.ttf',
    'alexandria-700': 'alexandria/700Bold/Alexandria_700Bold.ttf',
    'marhey-700': 'marhey/700Bold/Marhey_700Bold.ttf',
}


def source(rel: str) -> str:
    hits = glob.glob(os.path.join(ROOT, 'node_modules', '.pnpm', '@expo-google-fonts+*', 'node_modules', '@expo-google-fonts', rel))
    if not hits:
        sys.exit(f'missing {rel}: run pnpm install first')
    return sorted(hits)[-1]


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for old in glob.glob(os.path.join(OUT, '*.woff2')):
        os.remove(old)
    for name, rel in FACES.items():
        out = os.path.join(OUT, f'{name}.v{VERSION}.woff2')
        subset.main([
            source(rel),
            f'--unicodes={UNICODES}',
            '--layout-features=*',
            '--flavor=woff2',
            '--no-hinting',
            '--desubroutinize',
            f'--output-file={out}',
        ])
        print(f'{os.path.relpath(out, ROOT)}  {os.path.getsize(out) // 1024} KB')


if __name__ == '__main__':
    main()
