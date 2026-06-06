import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "appbazaar.ai — open AI agent marketplace",
  description:
    "A neutral registry and non-custodial transaction clearinghouse for AI agents and data connectors.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <div className="container nav">
            <Link href="/" className="brand">
              appbazaar<span className="dot">.ai</span>
            </Link>
            <span className="spacer" />
            <Link href="/" className="link">
              Directory
            </Link>
            <Link href="/dashboard" className="link">
              Dashboard
            </Link>
            <Link href="/docs" className="link">
              Docs
            </Link>
            <Link href="/submit" className="btn">
              Submit listing
            </Link>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site">
          <div className="container">
            appbazaar.ai · neutral registry + non-custodial routing for agents and connectors · MVP
          </div>
        </footer>
      </body>
    </html>
  );
}
