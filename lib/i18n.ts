import type { ReportingPeriodPreset } from '@/lib/dates';
import type { LanguagePreference } from '@/types/entities';

const EN_DICTIONARY = {
  // Navigation
  'nav.transaction': 'Transaction',
  'nav.investment': 'Investment',
  'nav.dashboard': 'Dashboard',
  'nav.analytics': 'Analytics',
  'nav.budget': 'Budget',
  'nav.profile': 'Profile',
  'nav.openProfile': 'Open Profile and Settings',
  'nav.backToDashboard': 'Back to Dashboard',

  // Common actions & states
  'common.save': 'Save',
  'common.saveChanges': 'Save Changes',
  'common.cancel': 'Cancel',
  'common.add': 'Add',
  'common.edit': 'Edit',
  'common.delete': 'Delete',
  'common.archive': 'Archive',
  'common.restore': 'Restore',
  'common.enable': 'Enable',
  'common.disable': 'Disable',
  'common.active': 'Active',
  'common.archived': 'Archived',
  'common.enabled': 'Enabled',
  'common.disabled': 'Disabled',
  'common.all': 'All',
  'common.loading': 'Loading...',
  'common.refresh': 'Refresh',
  'common.reset': 'Reset',
  'common.close': 'Close',
  'common.optional': 'Optional',

  // Reporting periods
  'period.this_month': 'This Month',
  'period.this_year': 'This Year',
  'period.custom': 'Custom Range',

  // Page Titles & Subtitles
  'page.dashboard.overview': 'Financial Overview',
  'page.transactions.title': 'Transactions',
  'page.transactions.description': 'Manage income, expenses, and internal transfers across your local accounts.',
  'page.investments.title': 'Investments',
  'page.investments.description': 'Monitor investment pool, platforms, holdings, and valuation history locally.',
  'page.analytics.title': 'Financial Analytics',
  'page.analytics.description': 'Understand spending behavior, income trends, savings rate, investments, and financial health.',
  'page.budget.title': 'Budget Management',
  'page.budget.description': 'Plan monthly category spending limits, monitor utilization, and manage alerts locally.',
  'page.profile.title': 'Profile & Settings',
  'page.profile.description':
    'Manage your local identity, security transparency, appearance, regional preferences, accounts, categories, investment setup, FX rates, and backups.',

  // Profile & Settings Section Titles (12 sections)
  'settings.group.identity': 'Identity & Privacy',
  'settings.group.regional': 'Display & Preferences',
  'settings.group.taxonomy': 'Accounts & Taxonomy',
  'settings.group.data': 'Integrations & Storage',

  'settings.section.personal': 'Personal Information',
  'settings.section.security': 'Security & Privacy',
  'settings.section.appearance': 'Appearance',
  'settings.section.preferences': 'General Preferences',
  'settings.section.accounts': 'Accounts Management',
  'settings.section.categories': 'Categories Management',
  'settings.section.platforms': 'Investment Platforms',
  'settings.section.assetClasses': 'Asset Classes',
  'settings.section.currencyFx': 'Currency & Exchange Rates',
  'settings.section.email': 'Email Integration',
  'settings.section.storage': 'Storage & Backup',
  'settings.section.about': 'About This App',
  'settings.viewAll': 'All Sections',

  // Personal info
  'settings.personal.edit': 'Edit Profile',
  'settings.personal.fullName': 'Full Name',
  'settings.personal.email': 'Email Address',
  'settings.personal.bio': 'Profile Description',
  'settings.personal.resetAvatar': 'Reset Avatar',
  'settings.personal.uploadAvatar': 'Upload Photo',

  // Appearance & Preferences
  'settings.appearance.theme': 'Color Theme',
  'settings.prefs.currency': 'Default Currency',
  'settings.prefs.numberFormat': 'Number Format',
  'settings.prefs.dateFormat': 'Date Format',
  'settings.prefs.firstDayOfWeek': 'First Day of Week',
  'settings.prefs.language': 'Language',
  'settings.prefs.timezone': 'Timezone',
  'settings.prefs.monday': 'Monday',
  'settings.prefs.sunday': 'Sunday',

  // Backup & Data
  'settings.backup.export': 'Export JSON Backup',
  'settings.backup.import': 'Import & Restore JSON',
  'settings.backup.clear': 'Clear Application Data',
} as const;

export type I18nKey = keyof typeof EN_DICTIONARY;

const ID_DICTIONARY: Record<I18nKey, string> = {
  // Navigation
  'nav.transaction': 'Transaksi',
  'nav.investment': 'Investasi',
  'nav.dashboard': 'Dasbor',
  'nav.analytics': 'Analitik',
  'nav.budget': 'Anggaran',
  'nav.profile': 'Profil',
  'nav.openProfile': 'Buka Profil dan Pengaturan',
  'nav.backToDashboard': 'Kembali ke Dasbor',

  // Common actions & states
  'common.save': 'Simpan',
  'common.saveChanges': 'Simpan Perubahan',
  'common.cancel': 'Batal',
  'common.add': 'Tambah',
  'common.edit': 'Ubah',
  'common.delete': 'Hapus',
  'common.archive': 'Arsipkan',
  'common.restore': 'Pulihkan',
  'common.enable': 'Aktifkan',
  'common.disable': 'Nonaktifkan',
  'common.active': 'Aktif',
  'common.archived': 'Diarsipkan',
  'common.enabled': 'Aktif',
  'common.disabled': 'Nonaktif',
  'common.all': 'Semua',
  'common.loading': 'Memuat...',
  'common.refresh': 'Muat Ulang',
  'common.reset': 'Reset',
  'common.close': 'Tutup',
  'common.optional': 'Opsional',

  // Reporting periods
  'period.this_month': 'Bulan Ini',
  'period.this_year': 'Tahun Ini',
  'period.custom': 'Rentang Kustom',

  // Page Titles & Subtitles
  'page.dashboard.overview': 'Ringkasan Keuangan',
  'page.transactions.title': 'Transaksi',
  'page.transactions.description': 'Kelola pemasukan, pengeluaran, dan transfer internal antar rekening lokal.',
  'page.investments.title': 'Investasi',
  'page.investments.description': 'Pantau dana investasi, platform, kepemilikan aset, dan riwayat valuasi secara lokal.',
  'page.analytics.title': 'Analitik Keuangan',
  'page.analytics.description': 'Pahami pola belanja, tren pemasukan, rasio tabungan, investasi, dan kesehatan finansial.',
  'page.budget.title': 'Manajemen Anggaran',
  'page.budget.description': 'Rencanakan batas pengeluaran bulanan per kategori, pantau realisasi, dan kelola peringatan lokal.',
  'page.profile.title': 'Profil & Pengaturan',
  'page.profile.description':
    'Kelola profil lokal, transparansi keamanan, tampilan, preferensi regional, rekening, kategori, platform investasi, kurs, dan cadangan data.',

  // Profile & Settings Section Titles (12 sections)
  'settings.group.identity': 'Identitas & Privasi',
  'settings.group.regional': 'Tampilan & Preferensi',
  'settings.group.taxonomy': 'Rekening & Kategori',
  'settings.group.data': 'Integrasi & Penyimpanan',

  'settings.section.personal': 'Informasi Pribadi',
  'settings.section.security': 'Keamanan & Privasi',
  'settings.section.appearance': 'Tampilan',
  'settings.section.preferences': 'Preferensi Umum',
  'settings.section.accounts': 'Manajemen Rekening',
  'settings.section.categories': 'Manajemen Kategori',
  'settings.section.platforms': 'Platform Investasi',
  'settings.section.assetClasses': 'Kelas Aset',
  'settings.section.currencyFx': 'Mata Uang & Kurs Manual',
  'settings.section.email': 'Integrasi Email',
  'settings.section.storage': 'Penyimpanan & Cadangan',
  'settings.section.about': 'Tentang Aplikasi',
  'settings.viewAll': 'Semua Bagian',

  // Personal info
  'settings.personal.edit': 'Ubah Profil',
  'settings.personal.fullName': 'Nama Lengkap',
  'settings.personal.email': 'Alamat Email',
  'settings.personal.bio': 'Deskripsi Profil',
  'settings.personal.resetAvatar': 'Hapus Foto',
  'settings.personal.uploadAvatar': 'Unggah Foto',

  // Appearance & Preferences
  'settings.appearance.theme': 'Tema Warna',
  'settings.prefs.currency': 'Mata Uang Utama',
  'settings.prefs.numberFormat': 'Format Angka',
  'settings.prefs.dateFormat': 'Format Tanggal',
  'settings.prefs.firstDayOfWeek': 'Hari Pertama Minggu',
  'settings.prefs.language': 'Bahasa Antarmuka',
  'settings.prefs.timezone': 'Zona Waktu',
  'settings.prefs.monday': 'Senin',
  'settings.prefs.sunday': 'Minggu',

  // Backup & Data
  'settings.backup.export': 'Ekspor Cadangan JSON',
  'settings.backup.import': 'Impor & Pulihkan JSON',
  'settings.backup.clear': 'Hapus Semua Data Aplikasi',
};

export function translate(
  language: LanguagePreference | string | undefined,
  key: I18nKey
): string {
  const lang = language === 'id' ? 'id' : 'en';
  return lang === 'id' ? ID_DICTIONARY[key] : EN_DICTIONARY[key];
}

export function getPeriodLabel(
  preset: ReportingPeriodPreset,
  language: LanguagePreference | string | undefined
): string {
  const key = `period.${preset}` as I18nKey;
  return translate(language, key);
}
