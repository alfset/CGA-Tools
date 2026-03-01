import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { WalletConnect } from "@/app/components/wallet-connect";
import { WalletProvider } from "@/app/components/wallet-provider";

export const metadata: Metadata = {
  title: "Cardano Governance Analytics",
  description: "Dashboard KPI governance vote DRep, SPO, dan CC"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const setInitialTheme = `
    (function() {
      try {
        var stored = localStorage.getItem('site-theme');
        var theme = stored === 'dark' || stored === 'light'
          ? stored
          : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.dataset.theme = theme;
      } catch (e) {
        document.documentElement.dataset.theme = 'light';
      }
    })();
  `;

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: setInitialTheme }} />
        <WalletProvider>
          <div className="app-shell">
            <header className="top-nav">
              <div className="top-nav-inner">
                <Link href="/" className="brand-mark">
                  Cardano Governance
                </Link>
                <nav className="top-links">
                  <Link href="/">Dashboard</Link>
                  <Link href="/proposals">Proposals</Link>
                  <Link href="/funded">Funded</Link>
                  <Link href="/participants">Participants</Link>
                </nav>
                <WalletConnect />
                <ThemeToggle />
              </div>
            </header>
            {children}
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}
