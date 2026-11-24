export interface Stage2RouteSpec {
  order: number;
  id: string;
  href: string;
  label: string;
  title: string;
  description: string;
}

export const APP_CONFIG = {
  /**
   * Centralized configurable application label.
   * Can be updated in one place without touching UI components.
   */
  appName: 'Personal Finance App',
  appVersion: '0.2.0',
  appDescription:
    'A privacy-first personal finance workspace built on local IndexedDB storage for cashflow, investments, analytics, and budgeting.',
  architectureLabel: 'Local-First (Browser IndexedDB)',
  consoleTitle: 'Stage 1 Foundation Console',
  consoleSubtitle: 'Local-First IndexedDB Architecture & Verification',
  databaseName: 'personal_finance_local_db',
  currentSchemaVersion: 7,
  defaultInvestmentPoolAccountId: 'acc_default_investment_pool',
  backupFormatVersion: '1.0.0',
  backupAppIdentifier: 'personal-finance-local-first',
  defaultCurrency: 'IDR' as const,
  defaultLocale: 'id-ID' as const,
  defaultNumberFormat: 'id-ID' as const,
  defaultDateFormat: 'DD/MM/YYYY' as const,
  defaultFirstDayOfWeek: 'monday' as const,
  defaultLanguage: 'en' as const,
  defaultTimezone: 'Asia/Jakarta' as const,
  defaultTheme: 'system' as const,
  defaultFiscalMonthStart: 1,
  supportedCurrencies: [
    { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', decimals: 0 },
    { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
    { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
    { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', decimals: 2 },
    { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', decimals: 2 },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0 },
    { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2 },
    { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimals: 2 },
  ] as const,
  supportedTimezones: [
    { value: 'Asia/Jakarta', label: 'Asia/Jakarta (WIB, UTC+7)' },
    { value: 'Asia/Makassar', label: 'Asia/Makassar (WITA, UTC+8)' },
    { value: 'Asia/Jayapura', label: 'Asia/Jayapura (WIT, UTC+9)' },
    { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT, UTC+8)' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST, UTC+9)' },
    { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
    { value: 'America/New_York', label: 'America/New_York (EST/EDT)' },
    { value: 'UTC', label: 'UTC' },
  ] as const,
  navigationRoutes: [
    {
      order: 1,
      id: 'transaction',
      href: '/transactions',
      label: 'Transaction',
      title: 'Transactions',
      description: 'Manage income, expenses, and internal transfers.',
    },
    {
      order: 2,
      id: 'investment',
      href: '/investments',
      label: 'Investment',
      title: 'Investments',
      description: 'Monitor investment portfolios, platforms, holdings, and performance.',
    },
    {
      order: 3,
      id: 'dashboard',
      href: '/dashboard',
      label: 'Dashboard',
      title: 'Dashboard',
      description: 'Get an overview of your financial position and activities.',
    },
    {
      order: 4,
      id: 'analytics',
      href: '/analytics',
      label: 'Analytics',
      title: 'Analytics',
      description: 'Understand your financial patterns and financial performance.',
    },
    {
      order: 5,
      id: 'budget',
      href: '/budget',
      label: 'Budget',
      title: 'Budget',
      description: 'Plan, monitor, and manage your monthly spending limits.',
    },
  ] satisfies Stage2RouteSpec[],
  stage2BottomNavOrder: [
    {
      order: 1,
      id: 'transaction',
      href: '/transactions',
      label: 'Transaction',
      title: 'Transactions',
      description: 'Manage income, expenses, and internal transfers.',
    },
    {
      order: 2,
      id: 'investment',
      href: '/investments',
      label: 'Investment',
      title: 'Investments',
      description: 'Monitor investment portfolios, platforms, holdings, and performance.',
    },
    {
      order: 3,
      id: 'dashboard',
      href: '/dashboard',
      label: 'Dashboard',
      title: 'Dashboard',
      description: 'Get an overview of your financial position and activities.',
    },
    {
      order: 4,
      id: 'analytics',
      href: '/analytics',
      label: 'Analytics',
      title: 'Analytics',
      description: 'Understand your financial patterns and financial performance.',
    },
    {
      order: 5,
      id: 'budget',
      href: '/budget',
      label: 'Budget',
      title: 'Budget',
      description: 'Plan, monitor, and manage your monthly spending limits.',
    },
  ] satisfies Stage2RouteSpec[],
  stage2HeaderProfileTarget: 'Profile & Settings (accessed via header profile section)',
} as const;
