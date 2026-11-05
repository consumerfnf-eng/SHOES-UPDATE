"""Deterministic coarse names for an already measured sRGB shoe-body color.

This does not inspect photos or infer an official colorway. Hue families are
separated before light/dark naming, so a dark chromatic upper is not matched to
an unrelated black/grey RGB reference. Only low-chroma colors are neutral.
"""

import colorsys
import re


def color_name(value):
    """Return a basic English color label for a strict #RRGGBB sample.

    HSV supplies hue, relative saturation and brightness; RGB channel spread
    supplies absolute chroma. All cutoffs describe color regions, with no SKU,
    brand or individual-hex exceptions. The result is an approximate visual
    label, not a replacement for a reviewed or official color name.
    """
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise ValueError("Expected an sRGB color in #RRGGBB format")
    rgb = tuple(int(value[i:i + 2], 16) / 255 for i in (1, 3, 5))
    hue, saturation, brightness = colorsys.rgb_to_hsv(*rgb)
    hue *= 360
    chroma = max(rgb) - min(rgb)
    lightness = (max(rgb) + min(rgb)) / 2

    # Pale warm yellows retain Cream rather than collapsing into White.
    if 30 <= hue < 70 and chroma > 0.045 and saturation <= 0.35 and lightness >= 0.78:
        return "Cream"
    if chroma <= 0.045 or saturation <= 0.10:
        if brightness <= 0.20:
            return "Black"
        return "White" if brightness >= 0.90 else "Grey"

    # Warm, muted light colors are Beige; deeper orange/red earth tones Brown.
    if 15 <= hue < 65 and saturation <= 0.48 and brightness >= 0.70 and lightness >= 0.60:
        return "Beige"
    if 10 <= hue < 45:
        return "Brown" if brightness < 0.75 or lightness < 0.45 else "Orange"
    if 45 <= hue < 70:
        return "Yellow"
    if 70 <= hue < 175:
        return "Green"
    if 175 <= hue < 255:
        return "Navy" if hue >= 195 and brightness < 0.50 else "Blue"
    if 255 <= hue < 320:
        return "Purple"
    # Low-saturation light reds and rose/magenta hues are Pink, not Beige.
    if lightness >= 0.55 and (hue >= 320 or saturation <= 0.45):
        return "Pink"
    return "Red"
