/**
 * Generates a specified amount of random test data similar to the testData array
 * @param count Number of data items to generate
 * @returns Array of random data elements
 */
export function generateRandomData({ count = 100 }) {
  /**
   * Generates a random number
   */
  function generateRandomNumber(): number {
    const numberTypes = [
      // Integer values
      () => Math.floor(Math.random() * 10000) * (Math.random() < 0.5 ? 1 : -1),
      // Float values
      () =>
        parseFloat(
          (Math.random() * 1000 * (Math.random() < 0.5 ? 1 : -1)).toFixed(4),
        ),
      // Very small values
      () => parseFloat((Math.random() * 0.01).toFixed(5)),
      // Very large values
      () => Math.floor(Math.random() * 1000000) + 100000,
      // Common math constants
      () =>
        [Math.PI, Math.E, 2.718281828459045, 1.618033988749895][
          Math.floor(Math.random() * 4)
        ],
      // Fractional values
      () => {
        const denominators = [2, 3, 4, 5, 6, 8, 10];
        const denominator =
          denominators[Math.floor(Math.random() * denominators.length)];
        const numerator = Math.floor(Math.random() * denominator);
        return numerator / denominator;
      },
    ];

    const generator =
      numberTypes[Math.floor(Math.random() * numberTypes.length)];
    return generator();
  }

  /**
   * Generates a random string
   */
  function generateRandomString(): string {
    const stringCategories = [
      // Programming terms
      [
        'JavaScript',
        'TypeScript',
        'React',
        'Vue.js',
        'Angular',
        'Node',
        'HTML',
        'CSS',
        'SASS',
        'Redux',
        'webpack',
        'babel',
        'vite',
        'eslint',
        'prettier',
        'interface',
        'class',
        'function',
      ],
      // HTTP methods and keywords
      ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HTTP', 'HTTPS', 'REST', 'API'],
      // Common variable naming styles
      ['camelCase', 'snake_case', 'kebab-case', 'PascalCase', 'ALL_CAPS'],
      // Web content
      [
        'email@example.com',
        'https://example.com',
        'User ID: 12345',
        'Price: $99.99',
      ],
      // Common words
      [
        'hello',
        'world',
        'test',
        'data',
        'array',
        'object',
        'string',
        'number',
        'boolean',
      ],
      // Empty or whitespace strings
      ['', ' ', '   '],
      // Code snippets
      [
        'const sum = (a, b) => a + b;',
        'if (condition) { doSomething(); }',
        'for (let i = 0; i < items.length; i++) { console.log(items[i]); }',
      ],
      // Date formats
      ['2023-01-01', '12/31/2024', '15-Apr-2025', '2023-02-15T14:30:45Z'],
    ];

    // Pick a random category
    const category =
      stringCategories[Math.floor(Math.random() * stringCategories.length)];
    // Pick a random string from that category
    const baseString = category[Math.floor(Math.random() * category.length)];

    // Randomly apply case transformations
    const transformation = Math.random();
    if (transformation < 0.25) {
      return baseString.toUpperCase();
    } else if (transformation < 0.5) {
      return baseString.toLowerCase();
    } else {
      return baseString; // Leave as is
    }
  }

  /**
   * Generates a random boolean
   */
  function generateRandomBoolean(): boolean {
    return Math.random() < 0.5;
  }

  /**
   * Generates a random object
   */
  function generateRandomObject(): object {
    const objectTypes = [
      // Product-like objects
      () => {
        const products = [
          'Laptop',
          'Phone',
          'Tablet',
          'Keyboard',
          'Mouse',
          'Monitor',
          'Headphones',
          'Speakers',
        ];
        const id = Math.floor(Math.random() * 100) + 1;
        const product = products[Math.floor(Math.random() * products.length)];
        const price = parseFloat((Math.random() * 1000 + 10).toFixed(2));
        return { id, product, price };
      },
      // Person-like objects
      () => {
        const firstNames = [
          'John',
          'Jane',
          'Alice',
          'Bob',
          'Carol',
          'Dave',
          'Eve',
          'Frank',
        ];
        const lastNames = [
          'Smith',
          'Johnson',
          'Williams',
          'Brown',
          'Davis',
          'Miller',
          'Wilson',
          'Moore',
        ];
        const firstName =
          firstNames[Math.floor(Math.random() * firstNames.length)];
        const lastName =
          lastNames[Math.floor(Math.random() * lastNames.length)];
        const age = Math.floor(Math.random() * 60) + 18;
        return { firstName, lastName, age };
      },
      // Location-like objects
      () => {
        const cities = [
          'New York',
          'London',
          'Tokyo',
          'Paris',
          'Berlin',
          'Sydney',
          'Toronto',
          'Mumbai',
        ];
        const countries = [
          'USA',
          'UK',
          'Japan',
          'France',
          'Germany',
          'Australia',
          'Canada',
          'India',
        ];
        const city = cities[Math.floor(Math.random() * cities.length)];
        const country = countries[Math.floor(Math.random() * countries.length)];
        const population = Math.floor(Math.random() * 10000000) + 500000;
        return { city, country, population };
      },
      // Coordinate-like objects
      () => {
        const x = Math.floor(Math.random() * 200) - 100;
        const y = Math.floor(Math.random() * 200) - 100;
        const z = Math.floor(Math.random() * 200) - 100;
        return { x, y, z };
      },
      // Color objects
      () => {
        const r = Math.floor(Math.random() * 256);
        const g = Math.floor(Math.random() * 256);
        const b = Math.floor(Math.random() * 256);
        return { r, g, b };
      },
      // Simple property object
      () => {
        const props = [
          'enabled',
          'visible',
          'active',
          'selected',
          'highlighted',
        ];
        const prop = props[Math.floor(Math.random() * props.length)];
        return {
          [prop]: Math.random() < 0.5,
          count: Math.floor(Math.random() * 10),
        };
      },
      // Empty object
      () => ({}),
    ];

    const generator =
      objectTypes[Math.floor(Math.random() * objectTypes.length)];
    return generator();
  }

  /**
   * Generates a random array
   */
  function generateRandomArray(): unknown[] {
    // Determine array length (mostly short arrays)
    const length =
      Math.random() < 0.8
        ? Math.floor(Math.random() * 5) + 1
        : Math.floor(Math.random() * 10) + 5;

    const arrayTypes = [
      // Number arrays
      () =>
        Array.from(
          { length },
          () =>
            Math.floor(Math.random() * 100) * (Math.random() < 0.5 ? 1 : -1),
        ),
      // String arrays
      () => {
        const options = [
          'apple',
          'banana',
          'cherry',
          'date',
          'elderberry',
          'fig',
          'grape',
          'honeydew',
          'kiwi',
          'lemon',
        ];
        return Array.from(
          { length },
          () => options[Math.floor(Math.random() * options.length)],
        );
      },
      // Boolean arrays
      () => Array.from({ length }, () => Math.random() < 0.5),
      // Mixed arrays
      () =>
        Array.from({ length }, () => {
          const type = Math.floor(Math.random() * 4);
          if (type === 0) return Math.floor(Math.random() * 100);
          if (type === 1)
            return ['red', 'green', 'blue', 'yellow', 'purple'][
              Math.floor(Math.random() * 5)
            ];
          if (type === 2) return Math.random() < 0.5;
          return null;
        }),
      // Empty array
      () => [],
    ];

    const generator = arrayTypes[Math.floor(Math.random() * arrayTypes.length)];
    return generator();
  }

  /**
   * Generates special number values like Infinity, NaN
   */
  function generateRandomSpecialNumber(): number {
    const specials = [Infinity, -Infinity, NaN];
    return specials[Math.floor(Math.random() * specials.length)];
  }

  /**
   * Generates null or undefined
   */
  function generateRandomNull(): null | undefined {
    return Math.random() < 0.5 ? null : undefined;
  }

  const result: unknown[] = [];

  // Define data type generators
  const generators = [
    generateRandomNumber,
    generateRandomString,
    generateRandomBoolean,
    generateRandomObject,
    generateRandomArray,
    generateRandomSpecialNumber,
    generateRandomNull,
  ];

  // Generate the requested amount of data
  for (let i = 0; i < count; i++) {
    // Select a random generator based on desired distribution
    const randomIndex = Math.floor(Math.random() * 100);
    let generator;

    // Weight the distribution to match typical data
    if (randomIndex < 30) {
      // 30% numbers
      generator = generators[0];
    } else if (randomIndex < 60) {
      // 30% strings
      generator = generators[1];
    } else if (randomIndex < 70) {
      // 10% booleans
      generator = generators[2];
    } else if (randomIndex < 85) {
      // 15% objects
      generator = generators[3];
    } else if (randomIndex < 95) {
      // 10% arrays
      generator = generators[4];
    } else if (randomIndex < 98) {
      // 3% special numbers (Infinity, NaN)
      generator = generators[5];
    } else {
      // 2% null/undefined
      generator = generators[6];
    }

    result.push(generator());
  }

  return result;
}
