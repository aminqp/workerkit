// First, make sure to install the required packages:
// npm install date-fns date-fns-tz
// import { parseISO } from 'date-fns';
// import { formatInTimeZone } from 'date-fns-tz';

import type { DateObj, ItemData, Options, UserProfile } from './types';

export function listTransformArray({
  data,
  options,
}: {
  data: ItemData[];
  options: Options;
}): string[][]{
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
      // Parse the UTC string to a Date object
      // const parsedDate = options.parseISO(dateObj.dateTime);
      //
      // // Format the date according to the specified timezone and format
      // // Format: (timezone) MonthName DayNumber Year, hour:minute AM/PM
      // const formattedDate = options.formatInTimeZone(
      //   parsedDate,
      //   dateObj.timezone,
      //   `(${dateObj.timezone}) MMMM d yyyy, h:mm a`
      // );
      //
      // return formattedDate;

      return `(${dateObj.timezone}) ${dateObj.dateTime}`
    } catch (error) {
      console.error('Error formatting date:', error);
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
        maximumFractionDigits: 2
      }).format(price);

      // This will produce outputs like:
      // $10.99 (for USD)
      // €10.99 (for EUR)
      // £10.99 (for GBP)
      // etc.
    } catch (error) {
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

};
