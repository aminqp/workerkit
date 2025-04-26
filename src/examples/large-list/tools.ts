
import { ItemData, TaskStatus, UserProfile } from './types';


/**
 * Generates test data for the transformArray function
 * @param count Number of test items to generate
 * @returns Array of test items matching the ItemData interface
 */
export function generateListTransformArrayTestData({ count }: {
  count: number
}): ItemData[] {
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
    'mia'
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
    'wilson'
  ];
  const statuses: TaskStatus[] = ['pending', 'ongoing', 'done'];
  const timezones = [
    'America/New_York',
    'Europe/London',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland'
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
    'Australia'
  ];
  const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'INR', 'CNY'];
  const emailDomains = [
    'gmail.com',
    'yahoo.com',
    'outlook.com',
    'company.com',
    'example.org'
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
            `${firstName}${Math.floor(Math.random() * 100)}@${domain}`
          ]
        };
      case 1:
        // Format: emails array with objects
        return {
          emails: [
            { address: emailAddress, primary: true },
            {
              address: `${firstName}${Math.floor(Math.random() * 100)}@${domain}`,
              primary: false
            }
          ]
        };
      case 2:
        // Format: contactInfo structure
        return {
          contactInfo: {
            email: emailAddress,
            phone: `+1${Math.floor(Math.random() * 10000000000)}`
          }
        };
      case 3:
        // Format: userDetails structure
        return {
          userDetails: {
            email: emailAddress,
            username: `${firstName}${lastName}`
          }
        };
      default:
        // Format: account structure
        return {
          account: {
            email: emailAddress,
            id: `user-${Math.floor(Math.random() * 10000)}`
          }
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
        lastName
      },
      rate: Math.random(), // Random rate between 0 and 1
      email: generateRandomEmailStructure(),
      status,
      createdAt: {
        dateTime: getRandomDate(),
        timezone
      },
      finishedAt: isFinished
        ? {
          dateTime: getRandomFutureDate(),
          timezone
        }
        : null,
      locale: getRandomItem(locales),
      country: getRandomItem(countries),
      price: parseFloat((Math.random() * 1000).toFixed(2)), // Random price up to 1000
      currency: getRandomItem(currencies)
    } as ItemData;
  });
}
