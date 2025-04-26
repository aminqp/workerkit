export interface UserInfo {
  firstName: string;
  lastName: string;

  [key: string]: string;
}

export type TaskStatus = 'pending' | 'ongoing' | 'done';
export type DateObj = { dateTime: string; timezone: string };

export interface UserProfile {
  contactInfo?: any;
  userDetails?: any;
  account?: any;
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
