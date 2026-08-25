export interface LocalFontRecord {
  family: string
}

export function uniqueFontFamilies(fonts: readonly LocalFontRecord[]): string[] {
  return [...new Set(fonts.map((font) => font.family.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
}
