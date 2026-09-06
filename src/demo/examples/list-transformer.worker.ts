export interface TransformOptions {
  multiplier?: number;
  round?: boolean;
  currency?: string;
  uppercase?: boolean;
  lowercase?: boolean;
  prefix?: string;
  suffix?: string;
  join?: string;
}

export function transformArray<T>(params: {
  data: T[];
  index: number;
  options: TransformOptions;
}): (number | string)[] {
  function transformItem<T>(
    item: T,
    options: TransformOptions,
  ): number | string {
    if (typeof item === 'number') {
      return transformNumber(item as number, options);
    } else if (typeof item === 'string') {
      return transformString(item as string);
    }

    // Apply prefix and suffix to all types
    let result: number | string = String(item);
    result = applyPrefix(result, options.prefix);
    result = applySuffix(result, options.suffix);

    return result;
  }

  function transformNumber(
    value: number,
    options: TransformOptions,
  ): number | string {
    let transformed = value;
    const probability = Math.random();

    // Apply multiplier (50% chance)
    if (probability < 0.5) {
      transformed = applyMultiplier(transformed, options?.multiplier ?? 33);
    }

    // Apply random mathematical operations (30% chance)
    if (probability >= 0.5 && probability < 0.8) {
      transformed = applyRandomMathOperation(transformed);
    }

    // Round numbers (40% chance if round option is true)
    if (Math.random() < 0.4) {
      transformed = applyRandomRounding(transformed);
    }

    // Format as currency (60% chance if currency option is true)
    if (Math.random() < 0.6) {
      return formatAsCurrency(transformed);
    }

    return transformed;
  }

  function applyMultiplier(value: number, optionMultiplier: number): number {
    const probability = Math.random();
    // Either use the provided multiplier or a random one
    const actualMultiplier =
      probability < 0.25
        ? optionMultiplier
        : Math.random() * 10 * (Math.random() < 0.5 ? 1 : -1);

    return value * actualMultiplier;
  }

  function applyRandomMathOperation(value: number): number {
    const operations = [
      (n: number) => Math.sqrt(Math.abs(n)),
      (n: number) => Math.pow(n, 2),
      (n: number) => Math.pow(n, 3),
      (n: number) => n + Math.floor(Math.random() * 100),
      (n: number) => n - Math.floor(Math.random() * 100),
      (n: number) => 1 / (n !== 0 ? n : 1), // Inverse, avoiding division by zero
      (n: number) => Math.abs(n),
    ];

    const randomOperation =
      operations[Math.floor(Math.random() * operations.length)];
    return randomOperation(value);
  }

  function applyRandomRounding(value: number): number {
    const roundingMethods = [
      Math.round,
      Math.floor,
      Math.ceil,
      (n: number) => Number(n.toFixed(1)),
      (n: number) => Number(n.toFixed(2)),
      (n: number) => Number(n.toFixed(3)),
    ];

    const randomRounding =
      roundingMethods[Math.floor(Math.random() * roundingMethods.length)];
    return randomRounding(value);
  }

  function formatAsCurrency(value: number, currencyOption?: string): string {
    const currencyFormats = [
      (c: string, n: number) => `${c}${n}`,
      (c: string, n: number) => `${c} ${n}`,
      (c: string, n: number) => `${n}${c}`,
      (c: string, n: number) => `${n} ${c}`,
      (c: string, n: number) => {
        const formatted = new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(n);
        return `${c}${formatted}`;
      },
    ];

    // Randomly choose a currency symbol if none provided
    const currencies = ['$', '€', '£', '¥', '₹'];
    const currencySymbol =
      currencyOption ||
      currencies[Math.floor(Math.random() * currencies.length)];
    const randomFormat =
      currencyFormats[Math.floor(Math.random() * currencyFormats.length)];

    return randomFormat(currencySymbol, value);
  }

  function transformString(value: string): string {
    const probability = Math.random();
    let transformed = value;

    if (probability < 0.25) {
      transformed = transformed.toUpperCase();
    }
    // 25% chance: Apply lowercase if specified
    else if (probability >= 0.25 && probability < 0.5) {
      transformed = transformed.toLowerCase();
    }
    // 20% chance: Apply title case
    else if (probability >= 0.5 && probability < 0.7) {
      transformed = transformToTitleCase(transformed);
    }
    // 15% chance: Apply alternating case
    else if (probability >= 0.7 && probability < 0.85) {
      transformed = transformToAlternatingCase(transformed);
    }

    return transformed;
  }

  function transformToTitleCase(value: string): string {
    return value
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  function transformToAlternatingCase(value: string): string {
    return value
      .split('')
      .map((char, i) => (i % 2 === 0 ? char.toLowerCase() : char.toUpperCase()))
      .join('');
  }

  function applyPrefix(
    value: number | string,
    prefix?: string,
  ): number | string {
    if (!prefix || Math.random() <= 0.2) {
      return value;
    }

    const prefixVariations = [
      prefix,
      prefix.repeat(Math.floor(Math.random() * 3) + 1),
      prefix.toUpperCase(),
      prefix.toLowerCase(),
      prefix + Math.floor(Math.random() * 100),
    ];

    const randomPrefix =
      prefixVariations[Math.floor(Math.random() * prefixVariations.length)];
    return `${randomPrefix}${value}`;
  }

  function applySuffix(
    value: number | string,
    suffix?: string,
  ): number | string {
    if (!suffix || Math.random() <= 0.2) {
      return value;
    }

    const suffixVariations = [
      suffix,
      suffix.repeat(Math.floor(Math.random() * 3) + 1),
      suffix.toUpperCase(),
      suffix.toLowerCase(),
      Math.floor(Math.random() * 100) + suffix,
    ];

    const randomSuffix =
      suffixVariations[Math.floor(Math.random() * suffixVariations.length)];
    return `${value}${randomSuffix}`;
  }

  const { data, options } = params;

  let result = data.map((item) => transformItem(item, options));

  // Join the array if specified
  if (options.join !== undefined) {
    return [result.join(options.join)];
  }

  return result;
}
