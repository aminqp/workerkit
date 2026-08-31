export interface UserInfo {
  firstName: string;
  lastName: string;

  [key: string]: string;
}

export type TaskStatus = 'pending' | 'ongoing' | 'done';
export type DateObj = { dateTime: string; timezone: string };

export interface UserProfile {
  contactInfo?: { email?: string; [key: string]: unknown };
  userDetails?: { email?: string; [key: string]: unknown };
  account?: { email?: string; [key: string]: unknown };
  emails?: string[] | { address: string; primary?: boolean }[];
}

export interface ItemData {
  username: UserInfo;
  rate: number;
  email: UserProfile;
  status: TaskStatus;
  createdAt: DateObj;
  finishedAt: DateObj;
  locale: string;
  country: string;
  price: number;
  currency: string;
}

export interface Options {
  extractUserEmail: (params: UserProfile) => string;
  formatDateWithTimezone: (dateObj: DateObj) => string;
  formatPriceWithCurrency: (price: number, currency: string) => string;
}
/**
 * Generates test data for the transformArray function
 * @param count Number of test items to generate
 * @returns Array of test items matching the ItemData interface
 */
export function generateListTransformArrayTestData({
  data,
}: {
  data: { count: number };
}): ItemData[] {
  const { count } = data ?? { count: 0 };
  // Sample data pools for random selection
  const firstNames = [
    'john',
    'emma',
    'michael',
    'sophia',
    'david',
    'olivia',
    'james',
    'ava',
    'robert',
    'mia',
  ];
  const lastNames = [
    'smith',
    'johnson',
    'williams',
    'brown',
    'jones',
    'miller',
    'davis',
    'garcia',
    'rodriguez',
    'wilson',
  ];
  const statuses: TaskStatus[] = ['pending', 'ongoing', 'done'];
  const timezones = [
    'America/New_York',
    'Europe/London',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];
  const locales = ['en-US', 'fr-FR', 'es-ES', 'de-DE', 'ja-JP', 'zh-CN'];
  const countries = [
    'USA',
    'France',
    'Spain',
    'Germany',
    'Japan',
    'China',
    'Canada',
    'Brazil',
    'India',
    'Australia',
  ];
  const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'INR', 'CNY'];
  const emailDomains = [
    'gmail.com',
    'yahoo.com',
    'outlook.com',
    'company.com',
    'example.org',
  ];

  /**
   * Helper function to get a random item from an array
   */
  const getRandomItem = <T>(arr: T[]): T => {
    return arr[Math.floor(Math.random() * arr.length)];
  };

  /**
   * Helper function to generate a random date within the last year
   */
  const getRandomDate = (): string => {
    const now = new Date();
    const pastDate = new Date(now);
    // Random date within the last year
    pastDate.setDate(pastDate.getDate() - Math.floor(Math.random() * 365));
    return pastDate.toISOString();
  };

  /**
   * Helper function to generate a random future date
   */
  const getRandomFutureDate = (): string => {
    const now = new Date();
    const futureDate = new Date(now);
    // Random date within the next year
    futureDate.setDate(futureDate.getDate() + Math.floor(Math.random() * 365));
    return futureDate.toISOString();
  };

  /**
   * Helper function to create random email data structure
   * Creates different formats to test the email extraction logic
   */
  const generateRandomEmailStructure = (): UserProfile => {
    const firstName = getRandomItem(firstNames);
    const lastName = getRandomItem(lastNames);
    const domain = getRandomItem(emailDomains);
    const emailAddress = `${firstName}.${lastName}@${domain}`;

    // Randomly pick one of the email structure formats
    const format = Math.floor(Math.random() * 4);

    switch (format) {
      case 0:
        // Format: simple emails array with strings
        return {
          emails: [
            emailAddress,
            `${firstName}${Math.floor(Math.random() * 100)}@${domain}`,
          ],
        };
      case 1:
        // Format: emails array with objects
        return {
          emails: [
            { address: emailAddress, primary: true },
            {
              address: `${firstName}${Math.floor(Math.random() * 100)}@${domain}`,
              primary: false,
            },
          ],
        };
      case 2:
        // Format: contactInfo structure
        return {
          contactInfo: {
            email: emailAddress,
            phone: `+1${Math.floor(Math.random() * 10000000000)}`,
          },
        };
      case 3:
        // Format: userDetails structure
        return {
          userDetails: {
            email: emailAddress,
            username: `${firstName}${lastName}`,
          },
        };
      default:
        // Format: account structure
        return {
          account: {
            email: emailAddress,
            id: `user-${Math.floor(Math.random() * 10000)}`,
          },
        };
    }
  };

  // Generate the specified number of test items
  return Array.from({ length: count }, () => {
    const firstName = getRandomItem(firstNames);
    const lastName = getRandomItem(lastNames);
    const timezone = getRandomItem(timezones);

    // 30% chance of having a finished task with finishedAt date
    const isFinished = Math.random() < 0.3;
    const status = isFinished ? 'done' : getRandomItem(statuses);

    return {
      username: {
        firstName,
        lastName,
      },
      rate: Math.random(), // Random rate between 0 and 1
      email: generateRandomEmailStructure(),
      status,
      createdAt: {
        dateTime: getRandomDate(),
        timezone,
      },
      finishedAt: isFinished
        ? {
            dateTime: getRandomFutureDate(),
            timezone,
          }
        : null,
      locale: getRandomItem(locales),
      country: getRandomItem(countries),
      price: parseFloat((Math.random() * 1000).toFixed(2)), // Random price up to 1000
      currency: getRandomItem(currencies),
    } as ItemData;
  });
}

export function listTransformArray({
  data,
}: {
  data: ItemData[];
  options?: Options;
}): string[][] {
  /**
   * Extracts user email from a profile object with a specific structure
   * @param params Object containing contact and account information
   * @returns The user's email or null if not found
   */
  function extractUserEmail(params: UserProfile): string {
    // Check in explicit order of priority

    // 1. Check emails array first (highest priority)
    if (params.emails && params.emails.length > 0) {
      // Handle case where emails is an array of objects with address property
      if (typeof params.emails[0] === 'object') {
        // Try to find primary email first
        const primaryEmail = (
          params.emails as { address: string; primary?: boolean }[]
        ).find((email) => email.primary === true);

        if (primaryEmail) {
          return primaryEmail.address;
        }

        // Fall back to first email if no primary found
        return (params.emails[0] as { address: string }).address;
      }

      // Handle case where emails is an array of strings
      return params.emails[0] as string;
    }

    // 2. Check contact info
    if (params.contactInfo?.email) {
      return params.contactInfo.email;
    }

    // 3. Check user details
    if (params.userDetails?.email) {
      return params.userDetails.email;
    }

    // 4. Check account information
    if (params.account?.email) {
      return params.account.email;
    }

    // No email found in any of the expected locations
    return ' - ';
  }

  /**
   * Transforms a date object with UTC time and timezone into formatted string
   * Format: (timezone) MonthName DayNumber Year, hour:minute AM/PM
   */
  function formatDateWithTimezone(dateObj: DateObj): string {
    if (!dateObj || !dateObj.dateTime || !dateObj.timezone) {
      return '';
    }

    try {
      return `(${dateObj.timezone}) ${dateObj.dateTime}`;
    } catch (_error) {
      console.error('Error formatting date:', _error);
      return dateObj.dateTime; // Return original as fallback
    }
  }

  /**
   * Format price with currency according to locale standards
   * @param price - Numeric price value
   * @param currency - Currency code (e.g., USD, EUR, GBP)
   * @returns Formatted price with currency
   */
  function formatPriceWithCurrency(price: number, currency: string): string {
    try {
      // Get standardized currency code (in case it's passed in different formats)
      const currencyCode = currency.trim().toUpperCase();

      // Format using the Intl.NumberFormat API for proper currency formatting
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        // Adjust decimal places based on currency standards
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(price);

      // This will produce outputs like:
      // $10.99 (for USD)
      // €10.99 (for EUR)
      // £10.99 (for GBP)
      // etc.
    } catch {
      // Fallback to simple format if Intl formatting fails
      return `${price} ${currency}`;
    }
  }

  return data.map((item) => {
    const transformedItem: string[] = [];

    if (item.username) {
      const firstName =
        item.username.firstName.charAt(0).toUpperCase() +
        item.username.firstName.slice(1).toLowerCase();
      const lastName =
        item.username.lastName.charAt(0).toUpperCase() +
        item.username.lastName.slice(1).toLowerCase();
      const fullName = `${firstName} ${lastName}`;
      transformedItem.push(fullName);
    }

    if (item.rate) {
      // Convert rate to percentage format with % symbol
      const percentageValue = `${(item.rate * 100).toFixed(2)} %`;
      transformedItem.push(percentageValue);
    }
    if (item.email) {
      transformedItem.push(extractUserEmail(item.email));
    }
    if (item.status) {
      const validStatus = item.status.toLowerCase();
      const capitalizedStatus =
        validStatus.charAt(0).toUpperCase() + validStatus.slice(1);

      transformedItem.push(capitalizedStatus);
    }
    if (item.createdAt && typeof item.createdAt === 'object') {
      const formattedCreatedAt = formatDateWithTimezone(item.createdAt);
      if (formattedCreatedAt) {
        transformedItem.push(formattedCreatedAt);
      }
    }
    if (item.finishedAt && typeof item.finishedAt === 'object') {
      const formattedFinishedAt = formatDateWithTimezone(item.finishedAt);
      if (formattedFinishedAt) {
        transformedItem.push(formattedFinishedAt);
      }
    }
    if (item.locale) transformedItem.push(item.locale);
    if (item.country) transformedItem.push(item.country);
    if (item.price !== undefined && item.currency) {
      // Format price with the currency
      const formattedPrice = formatPriceWithCurrency(item.price, item.currency);
      transformedItem.push(formattedPrice);
    } else if (item.price !== undefined) {
      // Fallback if only price is available
      transformedItem.push(item.price.toString());
    } else if (item.currency) {
      // Fallback if only currency is available
      transformedItem.push(item.currency);
    }

    return transformedItem;
  });
}
