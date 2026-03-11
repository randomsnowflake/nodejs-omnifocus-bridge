export function parseNumber(value: string, radix = 10): number | null {
  if (value.trim() === "") {
    return null;
  }

  if (value.includes(".") && radix === 10) {
    const parsedFloat = Number.parseFloat(value);
    return Number.isNaN(parsedFloat) ? null : parsedFloat;
  }

  const parsed = Number.parseInt(value, radix);
  return Number.isNaN(parsed) ? null : parsed;
}

