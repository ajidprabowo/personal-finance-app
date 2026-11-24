import type { Metadata } from 'next';
import { DM_Sans, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { AppBootstrapProvider } from '@/components/providers/app-bootstrap-provider';
import { ConfirmDialogProvider } from '@/components/providers/confirm-dialog-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { ToastProvider } from '@/components/providers/toast-provider';
import { APP_CONFIG } from '@/lib/config';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-plus-jakarta',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-dm-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  title: APP_CONFIG.appName,
  description: APP_CONFIG.appDescription,
  openGraph: {
    title: APP_CONFIG.appName,
    description: APP_CONFIG.appDescription,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: APP_CONFIG.appName,
    description: APP_CONFIG.appDescription,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('pfa_theme_hint');var d=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`,
          }}
        />
      </head>
      <body className="bg-canvas text-ink antialiased" suppressHydrationWarning>
        <ToastProvider>
          <AppBootstrapProvider>
            <ThemeProvider>
              <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
            </ThemeProvider>
          </AppBootstrapProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
